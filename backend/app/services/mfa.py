"""
Time-based one-time passwords.

A second factor for an application that holds evidence. The threat it answers
is the ordinary one: a password reused elsewhere and leaked, or phished.

What this module is careful about, in the order the failures actually happen:

1. **The secret is encrypted at rest.** A database file that leaks must not hand
   over every second factor with it. Encrypted with a key derived from
   `SECRET_KEY` and a per-user salt, so two users with the same secret do not
   produce the same ciphertext.
2. **A code cannot be replayed.** A TOTP is valid for a whole 30-second step,
   which is long enough for a code read over someone's shoulder - or captured by
   a proxy - to be used again. The step of the last accepted code is recorded
   and never accepted twice.
3. **Verification is rate-limited.** Six digits is a million possibilities and a
   script does that in minutes. Failures are counted and the account locks.
4. **Recovery codes are hashed and single-use.** They are passwords; storing
   them in the clear would make the recovery path weaker than the thing it
   recovers.

Operational consequence worth knowing: rotating `SECRET_KEY` makes every stored
secret undecryptable, and every enrolled user has to re-enrol. That is already
true of every issued session token, so it is not a new constraint - but MFA
makes it visible rather than merely inconvenient.
"""
from __future__ import annotations

import base64
import hashlib
import json
import secrets
import time
from dataclasses import dataclass

import bcrypt
import pyotp
from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

from ..config import settings

#: TOTP step, in seconds. The universal default; changing it breaks every
#: authenticator app that has already enrolled.
STEP_SECONDS = 30

#: Steps of tolerance either side of now. One covers a phone whose clock has
#: drifted by up to 30 seconds, which is common. Two would triple the window a
#: stolen code stays usable in, for very little extra forgiveness.
VALID_WINDOW = 1

#: Failed verifications before the account is locked out.
MAX_ATTEMPTS = 5

#: How long a lockout lasts. Long enough to make a script pointless, short
#: enough that an analyst who fat-fingered five codes is not locked out of an
#: active incident for the rest of the day.
LOCKOUT_SECONDS = 300

#: Recovery codes issued at enrolment.
RECOVERY_CODE_COUNT = 10

#: The `mfa` scope. A token carrying it has passed the password and nothing
#: else, and must never be accepted as a session.
SCOPE_MFA = "mfa"
SCOPE_ACCESS = "access"


class MfaError(Exception):
    """Verification failed, with a reason meant for the user."""


@dataclass(frozen=True)
class Enrolment:
    secret_encrypted: str
    salt:             str
    provisioning_uri: str
    qr_svg:           str
    recovery_codes:   list[str]      # plaintext, shown once and never stored
    recovery_hashes:  str            # JSON array of bcrypt hashes


# ─── Secret storage ───────────────────────────────────────────────────────────

def _key(salt: bytes) -> bytes:
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        # Matches the binary vault. High because the input is a single
        # server-side secret: if the database leaks, the attacker has the
        # ciphertext and all the time they want.
        iterations=600_000,
    )
    return base64.urlsafe_b64encode(kdf.derive(settings.secret_key.encode()))


def encrypt_secret(secret: str) -> tuple[str, str]:
    """Returns (ciphertext, salt_hex). A fresh salt per user, per enrolment."""
    salt = secrets.token_bytes(16)
    return Fernet(_key(salt)).encrypt(secret.encode()).decode(), salt.hex()


def decrypt_secret(ciphertext: str, salt_hex: str) -> str:
    """
    Recover the secret.

    A failure here means `SECRET_KEY` changed since enrolment. Saying so
    plainly matters: the alternative is an operator watching every MFA login
    fail with "invalid code" and concluding the codes are wrong.
    """
    try:
        return Fernet(_key(bytes.fromhex(salt_hex))).decrypt(ciphertext.encode()).decode()
    except (InvalidToken, ValueError) as e:
        raise MfaError(
            "This account's second factor cannot be read. SECRET_KEY has "
            "changed since it was enrolled, and the user must enrol again."
        ) from e


# ─── Recovery codes ───────────────────────────────────────────────────────────

def _new_recovery_code() -> str:
    """
    Two groups of five, from an unambiguous alphabet.

    No 0/O or 1/I/L: these are read off a screen and typed back, often from a
    printout, and a code that cannot be transcribed is not a recovery path.
    """
    alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
    body = "".join(secrets.choice(alphabet) for _ in range(10))
    return f"{body[:5]}-{body[5:]}"


def generate_recovery_codes() -> tuple[list[str], str]:
    """Returns (plaintext codes, JSON of their hashes). The plaintext is shown once."""
    codes = [_new_recovery_code() for _ in range(RECOVERY_CODE_COUNT)]
    hashes_json = json.dumps([
        bcrypt.hashpw(c.encode(), bcrypt.gensalt()).decode() for c in codes
    ])
    return codes, hashes_json


def consume_recovery_code(code: str, stored: str | None) -> str | None:
    """
    Check a recovery code and return the remaining hashes, or None if no match.

    The matched hash is removed rather than marked: a recovery code is a
    one-shot credential, and leaving it in the list to be flagged later is one
    bug away from it being accepted twice.
    """
    if not stored:
        return None
    try:
        remaining = json.loads(stored)
    except json.JSONDecodeError:
        return None

    candidate = code.strip().upper().replace(" ", "")
    for index, hashed in enumerate(remaining):
        if bcrypt.checkpw(candidate.encode(), hashed.encode()):
            return json.dumps(remaining[:index] + remaining[index + 1:])
    return None


def recovery_codes_left(stored: str | None) -> int:
    if not stored:
        return 0
    try:
        return len(json.loads(stored))
    except json.JSONDecodeError:
        return 0


# ─── Enrolment ────────────────────────────────────────────────────────────────

def start_enrolment(username: str, issuer: str = "Remora") -> Enrolment:
    """
    Produce everything the user needs to enrol, without touching the database.

    The QR is rendered here as inline SVG rather than shipping a QR library to
    the browser: it is a few hundred bytes, it cannot be blocked by a content
    policy, and the secret never has to be turned into an image client-side.
    """
    import segno

    secret = pyotp.random_base32()
    uri = pyotp.TOTP(secret, interval=STEP_SECONDS).provisioning_uri(
        name=username, issuer_name=issuer)
    ciphertext, salt = encrypt_secret(secret)
    codes, code_hashes = generate_recovery_codes()

    return Enrolment(
        secret_encrypted=ciphertext,
        salt=salt,
        provisioning_uri=uri,
        # Black on white, always - not themed. A QR read light-on-dark is
        # rejected by a good number of phone scanners, and an enrolment code
        # that half of users cannot scan is worse than one that clashes with a
        # dark interface. The background is painted rather than left
        # transparent for the same reason.
        qr_svg=segno.make(uri, error="m").svg_inline(
            scale=4, dark="#000000", light="#ffffff", border=2),
        recovery_codes=codes,
        recovery_hashes=code_hashes,
    )


# ─── Verification ─────────────────────────────────────────────────────────────

def current_step(at: float | None = None) -> int:
    return int((at if at is not None else time.time()) // STEP_SECONDS)


def verify_code(secret: str, code: str, last_step: int | None,
                at: float | None = None) -> int:
    """
    Check a TOTP and return the step it was issued in.

    Raises `MfaError` on a wrong code, and equally on a *correct* code that has
    already been used. A code stays valid for a whole 30-second step, which is
    long enough for one read over a shoulder to be typed in twice.
    """
    cleaned = code.strip().replace(" ", "")
    if not cleaned.isdigit():
        raise MfaError("A code is six digits")

    now = at if at is not None else time.time()
    totp = pyotp.TOTP(secret, interval=STEP_SECONDS)

    for offset in range(-VALID_WINDOW, VALID_WINDOW + 1):
        # int, because pyotp takes a Unix timestamp or a datetime, and a float
        # would be silently truncated somewhere less obvious than here.
        moment = int(now) + offset * STEP_SECONDS
        if secrets.compare_digest(totp.at(moment), cleaned):
            step = current_step(moment)
            if last_step is not None and step <= last_step:
                raise MfaError("That code has already been used. Wait for the next one.")
            return step

    raise MfaError("Incorrect code")


def fingerprint(secret: str) -> str:
    """
    A short, non-reversible identifier for a secret.

    Written to the audit trail so enrolment and disabling can be tied to the
    same factor, without the log becoming a place the secret exists.
    """
    return hashlib.sha256(secret.encode()).hexdigest()[:12]
