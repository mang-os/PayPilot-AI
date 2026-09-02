import enum
from datetime import datetime
from app import timeutils

from sqlalchemy import DateTime, Enum, ForeignKey, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base, generate_id




class AgentStatus(str, enum.Enum):
    ACTIVE = "ACTIVE"
    SUSPENDED = "SUSPENDED"
    REVOKED = "REVOKED"


class AgentRegistry(Base):
    """
    UAP-inspired agent identity. Every buyer agent that wants to transact
    must have a row here. `public_key` is the Ed25519 public key (hex)
    used to verify signatures on that agent's cart mandates - this is
    the cryptographic anchor for "is this really the agent it claims to be".
    """
    __tablename__ = "agent_registry"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: generate_id("agent"))
    agent_name: Mapped[str] = mapped_column(String)
    status: Mapped[AgentStatus] = mapped_column(Enum(AgentStatus), default=AgentStatus.ACTIVE)
    public_key: Mapped[str] = mapped_column(String)  # hex-encoded Ed25519 public key
    max_transaction_limit: Mapped[float] = mapped_column(Numeric(10, 2))
    max_daily_limit: Mapped[float] = mapped_column(Numeric(10, 2))
    created_at: Mapped[datetime] = mapped_column(DateTime(), default=timeutils.utcnow)

    credentials: Mapped[list["AgentCredential"]] = relationship(back_populates="agent")


class AgentCredential(Base):
    """API key material, kept separate from identity/limits in agent_registry
    so credentials can be rotated without touching the trust profile."""
    __tablename__ = "agent_credentials"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: generate_id("cred"))
    agent_id: Mapped[str] = mapped_column(ForeignKey("agent_registry.id"), index=True)
    api_key_hash: Mapped[str] = mapped_column(String, unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(), default=timeutils.utcnow)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)

    agent: Mapped["AgentRegistry"] = relationship(back_populates="credentials")


class MandateStatus(str, enum.Enum):
    ACTIVE = "ACTIVE"
    CONSUMED = "CONSUMED"
    EXPIRED = "EXPIRED"
    REVOKED = "REVOKED"


class CartMandate(Base):
    """
    AP2-inspired cart mandate: a signed, bounded, single-use authorization
    for one checkout. Signed by the agent's private key at creation time,
    re-verified against agent_registry.public_key again at checkout
    completion (never trust a DB row alone for a spend authorization).
    """
    __tablename__ = "cart_mandates"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: generate_id("mand"))
    agent_id: Mapped[str] = mapped_column(ForeignKey("agent_registry.id"), index=True)
    max_amount: Mapped[float] = mapped_column(Numeric(10, 2))
    currency: Mapped[str] = mapped_column(String, default="INR")
    expires_at: Mapped[datetime] = mapped_column(DateTime())
    signature: Mapped[str] = mapped_column(String)  # hex-encoded Ed25519 signature
    # The exact canonical payload string that was signed (see
    # mandate_service.canonical_payload). Stored verbatim rather than
    # reconstructed from `expires_at` at verification time, because
    # SQLite round-trips datetimes as naive - reconstructing
    # expires_at.isoformat() from the stored column would produce a
    # different string than the one the agent actually signed (which
    # included a UTC offset), and the signature would spuriously fail.
    signed_payload: Mapped[str] = mapped_column(String)
    status: Mapped[MandateStatus] = mapped_column(Enum(MandateStatus), default=MandateStatus.ACTIVE)
    # No FK back to checkout_sessions here on purpose - checkout_sessions.mandate_id
    # already points at this table, and a second, reverse FK would form a
    # circular dependency between the two tables. "Which checkout consumed
    # this mandate" is answered by querying checkout_sessions.mandate_id.
    created_at: Mapped[datetime] = mapped_column(DateTime(), default=timeutils.utcnow)
