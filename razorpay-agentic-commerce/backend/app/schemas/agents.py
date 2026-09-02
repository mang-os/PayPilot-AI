from datetime import datetime

from pydantic import BaseModel

from app.schemas.catalog import OfferOut, ProductOut


class AgentQueryRequest(BaseModel):
    query: str


class AgentQueryResponse(BaseModel):
    matched_products: list[ProductOut]
    suggested_offer: OfferOut | None
    rationale: str
    # Explicitly documents the contract: this response is advisory only.
    # No price the agent should pay appears in it - only product/offer
    # identifiers, which POST /acp/checkouts re-validates from the DB.
    note: str = "Advisory only. Submit product_id(s) to POST /acp/checkouts to get authoritative pricing."


class MandateCreateRequest(BaseModel):
    agent_id: str
    max_amount: float
    currency: str = "INR"
    expires_at: datetime  # exact timestamp the agent signed over - server does not recompute this
    signature: str  # hex Ed25519 signature over the canonical payload, see mandate_service.canonical_payload


class MandateCreateResponse(BaseModel):
    mandate_id: str
    agent_id: str
    max_amount: float
    currency: str
    expires_at: datetime
    status: str
