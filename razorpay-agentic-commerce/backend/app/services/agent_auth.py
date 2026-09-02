"""
UAP-inspired agent identity, steps 1-3 (authenticate, verify registry,
verify status=ACTIVE). Steps 4-5 (transaction limit, daily limit) depend
on knowing the checkout amount, so those live in the Policy Engine instead,
which runs later once totals are computed.
"""
import hashlib

from fastapi import Depends, Header
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import timeutils
from app.database import get_db
from app.errors import AgentAuthError, AgentSuspendedError
from app.models.agents import AgentCredential, AgentRegistry, AgentStatus


def hash_api_key(api_key: str) -> str:
    return hashlib.sha256(api_key.encode()).hexdigest()


def get_current_agent(
    authorization: str = Header(default=""),
    db: Session = Depends(get_db),
) -> AgentRegistry:
    if not authorization.startswith("Bearer "):
        raise AgentAuthError("Missing or malformed Authorization header. Expected 'Bearer <api_key>'.")

    api_key = authorization.removeprefix("Bearer ").strip()
    key_hash = hash_api_key(api_key)

    cred = db.execute(
        select(AgentCredential).where(AgentCredential.api_key_hash == key_hash)
    ).scalar_one_or_none()

    if cred is None:
        raise AgentAuthError("Unrecognized API key.")

    agent = db.get(AgentRegistry, cred.agent_id)
    if agent is None:
        raise AgentAuthError("Credential exists but agent registry entry is missing.")

    if agent.status != AgentStatus.ACTIVE:
        raise AgentSuspendedError(f"Agent '{agent.id}' has status {agent.status.value}, not ACTIVE.")

    cred.last_used_at = timeutils.utcnow()
    db.commit()

    return agent
