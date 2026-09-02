from datetime import datetime

from pydantic import BaseModel, Field


class CheckoutItemIn(BaseModel):
    product_id: str
    quantity: int = Field(gt=0)


class CheckoutCreateRequest(BaseModel):
    items: list[CheckoutItemIn]
    offer_code: str | None = None
    mandate_id: str | None = None
    idempotency_key: str | None = None


class CheckoutUpdateRequest(BaseModel):
    items: list[CheckoutItemIn] | None = None
    offer_code: str | None = None
    mandate_id: str | None = None


class CheckoutItemOut(BaseModel):
    product_id: str
    name: str
    quantity: int
    unit_price: float


class CheckoutResponse(BaseModel):
    checkout_id: str
    status: str
    items: list[CheckoutItemOut]
    offer_code: str | None
    mandate_id: str | None
    subtotal: float | None
    discount_amount: float | None
    tax_amount: float | None
    final_amount: float | None
    currency: str
    razorpay_order_id: str | None
    failure_reason: str | None
    created_at: datetime
    updated_at: datetime


class CheckoutCompleteResponse(CheckoutResponse):
    razorpay_key_id: str | None = None
    payment_instructions: str = (
        "Server-created Razorpay order above. Complete payment via Razorpay "
        "Checkout (test mode) using this order_id and key_id. This API will "
        "only mark the order COMPLETED once it receives and verifies the "
        "razorpay webhook - a client-reported 'success' is never trusted."
    )
