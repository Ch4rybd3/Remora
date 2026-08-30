from datetime import UTC, datetime, timedelta

import bcrypt
from jose import jwt

from ..config import settings

ALGORITHM = "HS256"
TOKEN_EXPIRE_HOURS = 24


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


#: Lifetime of the token issued between the password and the second factor. It
#: authorises exactly one call - the code check - so it only has to outlive a
#: person reaching for their phone.
MFA_TOKEN_EXPIRE_MINUTES = 5


def create_access_token(user_id: str, role: str) -> str:
    expires = datetime.now(UTC) + timedelta(hours=TOKEN_EXPIRE_HOURS)
    return jwt.encode(
        # `scope` is explicit so a half-authenticated token can never be
        # mistaken for a session. Tokens issued before this field existed carry
        # no scope, and are read as access tokens - see `core/deps.py`.
        {"sub": user_id, "role": role, "scope": "access", "exp": expires},
        settings.secret_key,
        algorithm=ALGORITHM,
    )


def create_mfa_token(user_id: str) -> str:
    """
    A token proving the password was right and nothing more.

    It carries no role, because it does not authorise anything: presenting it
    anywhere but the code check is rejected.
    """
    expires = datetime.now(UTC) + timedelta(minutes=MFA_TOKEN_EXPIRE_MINUTES)
    return jwt.encode(
        {"sub": user_id, "scope": "mfa", "exp": expires},
        settings.secret_key,
        algorithm=ALGORITHM,
    )


def decode_access_token(token: str) -> dict:
    return jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
