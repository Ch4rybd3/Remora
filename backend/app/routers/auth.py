import time
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from threading import Lock

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from ..core.deps import get_current_user
from ..database import get_db
from ..models.user import User
from ..schemas.user import LoginPayload, TokenResponse, UserRead
from ..services import mfa as mfa_service
from ..services.audit_service import audit_log
from ..services.auth_service import (
    create_access_token,
    create_mfa_token,
    decode_access_token,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])

# ── In-memory rate limiter ────────────────────────────────────────────────────
# Tracks failed login attempts per username.
# State: username -> [fail_count, window_start, locked_until]

_attempts: dict[str, list] = defaultdict(lambda: [0, 0.0, 0.0])
_attempts_lock = Lock()
_MAX_ATTEMPTS    = 5
_LOCKOUT_SECONDS = 30
_WINDOW_SECONDS  = 300   # reset counter after 5 min of no failures


def _check_rate_limit(username: str) -> None:
    with _attempts_lock:
        state = _attempts[username]
        now   = time.monotonic()
        if now < state[2]:
            remaining = int(state[2] - now) + 1
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Too many attempts. Try again in {remaining}s.",
            )
        if now - state[1] > _WINDOW_SECONDS:
            state[0] = 0
            state[1] = now
            state[2] = 0.0


def _record_failure(username: str) -> None:
    with _attempts_lock:
        state = _attempts[username]
        now   = time.monotonic()
        if now - state[1] > _WINDOW_SECONDS:
            state[0] = 0
            state[1] = now
        state[0] += 1
        if state[0] >= _MAX_ATTEMPTS:
            state[2] = now + _LOCKOUT_SECONDS
            print(f"[remora] auth: account '{username}' locked for {_LOCKOUT_SECONDS}s after {_MAX_ATTEMPTS} failed attempts", flush=True)


def _record_success(username: str) -> None:
    with _attempts_lock:
        _attempts[username] = [0, 0.0, 0.0]


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginPayload, request: Request, db: Session = Depends(get_db)):
    _check_rate_limit(payload.username)

    user = db.query(User).filter(
        User.username == payload.username,
        User.is_active.is_(True),
    ).first()
    if not user or not verify_password(payload.password, user.hashed_password):
        _record_failure(payload.username)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
        )
    _record_success(payload.username)
    user.last_login = datetime.now(UTC)
    audit_log(db, user=user, action="auth.login",
              resource_type="user", resource_id=user.id,
              resource_name=user.username, request=request)
    db.commit()

    # The password is not a session on its own once a second factor is enrolled.
    if user.mfa_enabled:
        return TokenResponse(mfa_required=True, mfa_token=create_mfa_token(str(user.id)))

    token = create_access_token(user.id, user.role.value)
    return TokenResponse(access_token=token, user=UserRead.model_validate(user))


@router.get("/me", response_model=UserRead)
def me(current_user: User = Depends(get_current_user)):
    return current_user


# ── Second factor ─────────────────────────────────────────────────────────────
# Enrolment is a two-step handshake on purpose: the secret is stored on setup
# but MFA is only switched on once the user has proved their authenticator
# produces a matching code. Enabling it in one step would lock out anyone who
# mistyped the secret or whose phone clock is wrong.


def _mfa_lock_check(user: User) -> None:
    """Refuse verification while the account is locked out."""
    locked_until = user.mfa_locked_until
    if locked_until and locked_until > datetime.now(UTC).replace(tzinfo=None):
        remaining = int((locked_until - datetime.now(UTC).replace(tzinfo=None)).total_seconds()) + 1
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many incorrect codes. Try again in {remaining}s.",
        )


def _mfa_record_failure(user: User, db: Session) -> None:
    """
    Count a failure and lock the account once there have been enough.

    Persisted on the user rather than held in memory like the password limiter:
    a restart must not hand an attacker a fresh budget of attempts, and six
    digits is a million possibilities.
    """
    user.mfa_failed_attempts = (user.mfa_failed_attempts or 0) + 1
    if user.mfa_failed_attempts >= mfa_service.MAX_ATTEMPTS:
        user.mfa_locked_until = datetime.now(UTC).replace(tzinfo=None) + timedelta(
            seconds=mfa_service.LOCKOUT_SECONDS)
        user.mfa_failed_attempts = 0
    db.commit()


def _mfa_record_success(user: User, step: int | None, db: Session) -> None:
    user.mfa_failed_attempts = 0
    user.mfa_locked_until = None
    if step is not None:
        user.mfa_last_step = step
    db.commit()


def _check_second_factor(user: User, code: str, db: Session) -> None:
    """
    Accept a TOTP or a recovery code, or raise.

    Recovery codes are tried second and only when the code does not look like a
    TOTP, so a mistyped six-digit code never silently burns one.
    """
    _mfa_lock_check(user)

    cleaned = (code or "").strip().replace(" ", "")
    if not cleaned:
        raise HTTPException(400, "A code is required")

    if cleaned.isdigit():
        try:
            secret = mfa_service.decrypt_secret(str(user.mfa_secret), str(user.mfa_salt))
            step = mfa_service.verify_code(secret, cleaned, user.mfa_last_step)
        except mfa_service.MfaError as e:
            _mfa_record_failure(user, db)
            raise HTTPException(401, str(e)) from None
        _mfa_record_success(user, step, db)
        return

    remaining = mfa_service.consume_recovery_code(cleaned, user.mfa_recovery_codes)
    if remaining is None:
        _mfa_record_failure(user, db)
        raise HTTPException(401, "Incorrect code")
    user.mfa_recovery_codes = remaining
    _mfa_record_success(user, None, db)


@router.get("/mfa/status")
def mfa_status(current_user: User = Depends(get_current_user)):
    return {
        "enabled":              bool(current_user.mfa_enabled),
        "enrolled_at":          current_user.mfa_enrolled_at.isoformat()
                                if current_user.mfa_enrolled_at else None,
        "recovery_codes_left":  mfa_service.recovery_codes_left(current_user.mfa_recovery_codes),
        # Surfaced so a user can be told to print more before they run out,
        # rather than discovering the recovery path is empty when they need it.
        "recovery_codes_total": mfa_service.RECOVERY_CODE_COUNT,
    }


@router.post("/mfa/setup")
def mfa_setup(request: Request, db: Session = Depends(get_db),
              current_user: User = Depends(get_current_user)):
    """
    Begin enrolment. Returns the QR, the URI behind it, and the recovery codes.

    The recovery codes are returned **once**, here. They are stored hashed, so
    nothing can show them again - which is the point, and has to be said plainly
    in the interface.
    """
    if current_user.mfa_enabled:
        raise HTTPException(
            409, "A second factor is already enabled. Disable it before enrolling again.")

    enrolment = mfa_service.start_enrolment(str(current_user.username))
    current_user.mfa_secret = enrolment.secret_encrypted
    current_user.mfa_salt = enrolment.salt
    current_user.mfa_recovery_codes = enrolment.recovery_hashes
    current_user.mfa_enabled = False       # not until a code is proved
    current_user.mfa_last_step = None
    db.commit()

    audit_log(db, user=current_user, action="auth.mfa.setup_started",
              resource_type="user", resource_id=str(current_user.id),
              resource_name=str(current_user.username), request=request)
    db.commit()

    return {
        "qr_svg":           enrolment.qr_svg,
        "provisioning_uri": enrolment.provisioning_uri,
        "recovery_codes":   enrolment.recovery_codes,
    }


@router.post("/mfa/confirm")
def mfa_confirm(body: dict, request: Request, db: Session = Depends(get_db),
                current_user: User = Depends(get_current_user)):
    """Prove the authenticator works, and switch the second factor on."""
    if current_user.mfa_enabled:
        raise HTTPException(409, "A second factor is already enabled")
    if not current_user.mfa_secret:
        raise HTTPException(409, "Start enrolment first")

    _check_second_factor(current_user, str(body.get("code") or ""), db)

    current_user.mfa_enabled = True
    current_user.mfa_enrolled_at = datetime.now(UTC).replace(tzinfo=None)
    db.commit()

    secret = mfa_service.decrypt_secret(str(current_user.mfa_secret), str(current_user.mfa_salt))
    audit_log(db, user=current_user, action="auth.mfa.enabled",
              resource_type="user", resource_id=str(current_user.id),
              resource_name=str(current_user.username), request=request,
              # A fingerprint, never the secret: the audit trail must not
              # become a second place the factor exists.
              details={"factor": mfa_service.fingerprint(secret)})
    db.commit()
    return {"enabled": True}


@router.post("/mfa/verify", response_model=TokenResponse)
def mfa_verify(body: dict, request: Request, db: Session = Depends(get_db)):
    """
    Finish a login. Takes the token issued by `/login` and a code.

    Deliberately unauthenticated: the caller has no session yet, which is the
    whole point. The `mfa_token` is what proves the password step happened, and
    it authorises nothing else.
    """
    token = str(body.get("mfa_token") or "")
    try:
        payload = decode_access_token(token)
        if payload.get("scope") != mfa_service.SCOPE_MFA:
            raise HTTPException(401, "That token cannot complete a login")
        user_id = payload["sub"]
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(401, "This login has expired. Sign in again.") from None

    user = db.query(User).filter(User.id == user_id, User.is_active.is_(True)).first()
    if not user or not user.mfa_enabled:
        raise HTTPException(401, "This login can no longer be completed")

    _check_second_factor(user, str(body.get("code") or ""), db)

    user.last_login = datetime.now(UTC)
    audit_log(db, user=user, action="auth.login.mfa",
              resource_type="user", resource_id=str(user.id),
              resource_name=str(user.username), request=request)
    db.commit()

    return TokenResponse(
        access_token=create_access_token(str(user.id), user.role.value),
        user=UserRead.model_validate(user),
    )


@router.post("/mfa/disable")
def mfa_disable(body: dict, request: Request, db: Session = Depends(get_db),
                current_user: User = Depends(get_current_user)):
    """
    Turn the second factor off.

    Both the password and a valid code are required. A session alone is not
    enough: an unattended browser is exactly the situation MFA exists to
    survive, and removing it must be harder than using it.
    """
    if not current_user.mfa_enabled:
        raise HTTPException(409, "No second factor is enabled")
    if not verify_password(str(body.get("password") or ""), str(current_user.hashed_password)):
        raise HTTPException(401, "Incorrect password")

    _check_second_factor(current_user, str(body.get("code") or ""), db)

    current_user.mfa_enabled = False
    current_user.mfa_secret = None
    current_user.mfa_salt = None
    current_user.mfa_recovery_codes = None
    current_user.mfa_last_step = None
    current_user.mfa_enrolled_at = None
    db.commit()

    audit_log(db, user=current_user, action="auth.mfa.disabled",
              resource_type="user", resource_id=str(current_user.id),
              resource_name=str(current_user.username), request=request)
    db.commit()
    return {"enabled": False}


@router.post("/mfa/recovery-codes")
def mfa_regenerate_recovery_codes(
    body: dict, request: Request, db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Issue a fresh set, invalidating the old one.

    Guarded like disabling, because a new set is as good as the old one: anyone
    who can mint recovery codes can bypass the factor at will.
    """
    if not current_user.mfa_enabled:
        raise HTTPException(409, "No second factor is enabled")
    if not verify_password(str(body.get("password") or ""), str(current_user.hashed_password)):
        raise HTTPException(401, "Incorrect password")

    _check_second_factor(current_user, str(body.get("code") or ""), db)

    codes, hashes_json = mfa_service.generate_recovery_codes()
    current_user.mfa_recovery_codes = hashes_json
    db.commit()

    audit_log(db, user=current_user, action="auth.mfa.recovery_codes_reissued",
              resource_type="user", resource_id=str(current_user.id),
              resource_name=str(current_user.username), request=request)
    db.commit()
    return {"recovery_codes": codes}
