from datetime import datetime

from app import timeutils

from sqlalchemy import JSON, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base




class AuditEvent(Base):
    """
    The audit ledger. Every state-changing or trust-relevant action in the
    system writes one row here - see app/services/audit_service.py for the
    canonical event_type vocabulary. This table is what powers the
    "Agent Trace" and "Failure Monitor" dashboard screens, and is the
    thing a merchant would actually hand to an auditor.
    """
    __tablename__ = "audit_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    event_type: Mapped[str] = mapped_column(String, index=True)
    checkout_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    agent_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    message: Mapped[str] = mapped_column(String, default="")
    payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(), default=timeutils.utcnow, index=True)


class AgentRequest(Base):
    """Raw request/response log for every call that hits the Agent Commerce
    API, independent of the higher-level audit_events narrative. Useful for
    debugging protocol-level issues (malformed payloads, retries, etc)."""
    __tablename__ = "agent_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    agent_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    endpoint: Mapped[str] = mapped_column(String)
    method: Mapped[str] = mapped_column(String)
    request_payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    response_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(), default=timeutils.utcnow, index=True)
