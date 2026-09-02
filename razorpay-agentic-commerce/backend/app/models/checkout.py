import enum
from datetime import datetime
from app import timeutils

from sqlalchemy import JSON, DateTime, Enum, ForeignKey, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base, generate_id




class CheckoutStatus(str, enum.Enum):
    CREATED = "CREATED"
    UPDATED = "UPDATED"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class CheckoutSession(Base):
    """
    ACP-inspired checkout lifecycle object. This row is the single source
    of truth for a checkout's state machine: CREATED -> UPDATED* -> COMPLETED
    or -> FAILED. `items` stores [{product_id, name, quantity, unit_price}] -
    unit_price is a snapshot for display only; the Checkout Engine always
    re-fetches live product prices from `products` when computing totals.
    """
    __tablename__ = "checkout_sessions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: generate_id("chk"))
    agent_id: Mapped[str] = mapped_column(ForeignKey("agent_registry.id"), index=True)
    status: Mapped[CheckoutStatus] = mapped_column(Enum(CheckoutStatus), default=CheckoutStatus.CREATED)

    items: Mapped[list] = mapped_column(JSON, default=list)
    offer_code: Mapped[str | None] = mapped_column(String, nullable=True)
    mandate_id: Mapped[str | None] = mapped_column(ForeignKey("cart_mandates.id"), nullable=True)

    idempotency_key: Mapped[str | None] = mapped_column(String, nullable=True, index=True)

    subtotal: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    discount_amount: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    tax_amount: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    final_amount: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    currency: Mapped[str] = mapped_column(String, default="INR")

    razorpay_order_id: Mapped[str | None] = mapped_column(String, nullable=True, unique=True, index=True)
    failure_reason: Mapped[str | None] = mapped_column(String, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(), default=timeutils.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(), default=timeutils.utcnow, onupdate=timeutils.utcnow)


class OrderStatus(str, enum.Enum):
    PENDING = "PENDING"
    PAID = "PAID"
    FAILED = "FAILED"
    REFUNDED = "REFUNDED"


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: generate_id("ord"))
    checkout_session_id: Mapped[str] = mapped_column(ForeignKey("checkout_sessions.id"), unique=True)
    agent_id: Mapped[str] = mapped_column(ForeignKey("agent_registry.id"), index=True)
    items: Mapped[list] = mapped_column(JSON, default=list)
    subtotal: Mapped[float] = mapped_column(Numeric(10, 2))
    discount_amount: Mapped[float] = mapped_column(Numeric(10, 2))
    tax_amount: Mapped[float] = mapped_column(Numeric(10, 2))
    final_amount: Mapped[float] = mapped_column(Numeric(10, 2))
    currency: Mapped[str] = mapped_column(String, default="INR")
    status: Mapped[OrderStatus] = mapped_column(Enum(OrderStatus), default=OrderStatus.PENDING)
    created_at: Mapped[datetime] = mapped_column(DateTime(), default=timeutils.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(), default=timeutils.utcnow, onupdate=timeutils.utcnow)


class TransactionStatus(str, enum.Enum):
    CREATED = "CREATED"
    AUTHORIZED = "AUTHORIZED"
    CAPTURED = "CAPTURED"
    FAILED = "FAILED"
    REFUNDED = "REFUNDED"


class Transaction(Base):
    __tablename__ = "transactions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: generate_id("txn"))
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.id"), index=True)
    razorpay_order_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    razorpay_payment_id: Mapped[str | None] = mapped_column(String, nullable=True, unique=True)
    razorpay_signature: Mapped[str | None] = mapped_column(String, nullable=True)
    status: Mapped[TransactionStatus] = mapped_column(Enum(TransactionStatus), default=TransactionStatus.CREATED)
    amount: Mapped[float] = mapped_column(Numeric(10, 2))
    currency: Mapped[str] = mapped_column(String, default="INR")
    raw_webhook_payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(), default=timeutils.utcnow)
