from datetime import datetime, timedelta, timezone
import bcrypt
from jose import jwt
from ..config import settings

ALGORITHM = "HS256"
TOKEN_EXPIRE_HOURS = 24


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def create_access_token(user_id: str, role: str) -> str:
    expires = datetime.now(timezone.utc) + timedelta(hours=TOKEN_EXPIRE_HOURS)
    return jwt.encode(
        {"sub": user_id, "role": role, "exp": expires},
        settings.secret_key,
        algorithm=ALGORITHM,
    )


def decode_access_token(token: str) -> dict:
    return jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
