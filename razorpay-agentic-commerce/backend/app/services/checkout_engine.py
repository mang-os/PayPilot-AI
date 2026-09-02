"""
The Checkout Engine is authoritative, per spec. That means exactly one
thing in code terms: nowhere in this file do we accept a price, subtotal,
discount, or total from the caller. Every number here is either fetched
fresh from the database or derived from numbers that were.
"""
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import timeutils
from app.config import settings
from app.errors import CartMinimumNotMetError, OfferInvalidError, ProductNotFoundError
from app.models.catalog import DiscountType, Offer, Product


@dataclass
class LineItem:
    product_id: str
    name: str
    quantity: int
    unit_price: float


@dataclass
class CheckoutTotals:
    items: list[LineItem]
    subtotal: float
    discount_amount: float
    tax_amount: float
    final_amount: float
    currency: str


def resolve_line_items(db: Session, requested_items: list[dict]) -> list[LineItem]:
    """Turns [{product_id, quantity}] into priced line items, using only
    the live `products` table. Raises ProductNotFoundError for anything
    that isn't a real, active product - this is what powers the
    'Invalid Product ID' failure-recovery scenario."""
    line_items: list[LineItem] = []
    for entry in requested_items:
        product = db.get(Product, entry["product_id"])
        if product is None or not product.is_active:
            raise ProductNotFoundError(
                f"Product '{entry['product_id']}' does not exist or is inactive.",
                details={"product_id": entry["product_id"]},
            )
        line_items.append(
            LineItem(
                product_id=product.id,
                name=product.name,
                quantity=entry["quantity"],
                unit_price=float(product.price),
            )
        )
    return line_items


def _validate_offer(db: Session, offer_code: str, subtotal: float) -> Offer:
    offer = db.execute(select(Offer).where(Offer.code == offer_code)).scalar_one_or_none()
    if offer is None:
        raise OfferInvalidError(f"Offer code '{offer_code}' does not exist.", details={"offer_code": offer_code})
    if not offer.is_active:
        raise OfferInvalidError(f"Offer '{offer_code}' is not active.", details={"offer_code": offer_code})
    now = timeutils.utcnow()
    if offer.valid_from and offer.valid_from > now:
        raise OfferInvalidError(f"Offer '{offer_code}' is not valid yet.", details={"offer_code": offer_code})
    if offer.valid_until and offer.valid_until < now:
        raise OfferInvalidError(f"Offer '{offer_code}' has expired.", details={"offer_code": offer_code})
    if offer.usage_limit is not None and offer.times_used >= offer.usage_limit:
        raise OfferInvalidError(f"Offer '{offer_code}' has reached its usage limit.", details={"offer_code": offer_code})
    if subtotal < float(offer.min_cart_amount):
        raise CartMinimumNotMetError(
            f"Cart subtotal {subtotal:.2f} is below offer minimum {float(offer.min_cart_amount):.2f}.",
            details={"offer_code": offer_code, "min_cart_amount": float(offer.min_cart_amount), "subtotal": subtotal},
        )
    return offer


def compute_totals(db: Session, requested_items: list[dict], offer_code: str | None) -> CheckoutTotals:
    line_items = resolve_line_items(db, requested_items)
    subtotal = round(sum(li.unit_price * li.quantity for li in line_items), 2)

    discount_amount = 0.0
    if offer_code:
        offer = _validate_offer(db, offer_code, subtotal)
        if offer.discount_type == DiscountType.PERCENTAGE:
            discount_amount = subtotal * (float(offer.discount_value) / 100.0)
        else:
            discount_amount = float(offer.discount_value)
        if offer.max_discount_amount is not None:
            discount_amount = min(discount_amount, float(offer.max_discount_amount))
        discount_amount = round(min(discount_amount, subtotal), 2)

    taxable_amount = subtotal - discount_amount
    tax_amount = round(taxable_amount * settings.TAX_RATE, 2)
    final_amount = round(taxable_amount + tax_amount, 2)

    return CheckoutTotals(
        items=line_items,
        subtotal=subtotal,
        discount_amount=discount_amount,
        tax_amount=tax_amount,
        final_amount=final_amount,
        currency=settings.CURRENCY,
    )


def to_paise(amount: float) -> int:
    """Razorpay amounts are in the smallest currency unit (paise for INR)."""
    return int(round(amount * 100))
