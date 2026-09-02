import secrets

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import settings

connect_args = {}
if settings.DATABASE_URL.startswith("sqlite"):
    # needed so SQLite tolerates being used across FastAPI's request threads
    connect_args = {"check_same_thread": False}

engine = create_engine(settings.DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def generate_id(prefix: str) -> str:
    """Stripe-style readable IDs, e.g. prod_a1b2c3d4e5f6a7b8."""
    return f"{prefix}_{secrets.token_hex(8)}"
