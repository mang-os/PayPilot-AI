from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ProductOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    sku: str
    name: str
    description: str
    category: str
    price: float
    image_url: str
    is_active: bool


class InventoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    product_id: str
    quantity_available: int
    reserved_quantity: int


class OfferOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    code: str
    description: str
    discount_type: str
    discount_value: float
    min_cart_amount: float
    max_discount_amount: float | None
    valid_from: datetime
    valid_until: datetime | None
    is_active: bool


class StorefrontInventoryOut(BaseModel):
    quantity_available: int
    reserved_quantity: int


class StorefrontProductOut(BaseModel):
    id: str
    sku: str
    name: str
    description: str
    category: str
    price: float
    image_url: str
    inventory: StorefrontInventoryOut | None


class StorefrontCatalogResponse(BaseModel):
    products: list[StorefrontProductOut]
    offers: list[OfferOut]
