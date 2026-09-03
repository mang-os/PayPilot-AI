"""
The three tools the Merchant Agent (LLM orchestrator) is allowed to call.
Every one of them is a pure, deterministic DB read - there is no code path
by which the LLM can see a product, price, or offer that isn't actually in
the database, which is what makes "no hallucinated products" a structural
guarantee rather than a hope.

These are also used directly by routers (bypassing the LLM) when a buyer
agent already knows exactly what it wants and doesn't need the orchestrator.
"""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.catalog import Inventory, Offer, Product
from app.schemas.catalog import InventoryOut, OfferOut, ProductOut


_STOPWORDS = {"the", "a", "an", "for", "under", "below", "over", "above", "with", "and", "of", "in", "me", "find", "show", "search", "looking"}


def _keywords(query: str) -> list[str]:
    words = [w.strip(".,!?").lower() for w in query.split()]
    return [w for w in words if len(w) > 2 and w not in _STOPWORDS and not w.isdigit()]


def search_products(db: Session, query: str = "", max_price: float | None = None, limit: int = 10) -> list[ProductOut]:
    stmt = select(Product).where(Product.is_active.is_(True))
    keywords = _keywords(query)
    if keywords:
        clauses = [
            (Product.name.ilike(f"%{kw}%")) | (Product.description.ilike(f"%{kw}%")) | (Product.category.ilike(f"%{kw}%"))
            for kw in keywords
        ]
        combined = clauses[0]
        for c in clauses[1:]:
            combined = combined | c
        stmt = stmt.where(combined)
    if max_price is not None:
        stmt = stmt.where(Product.price <= max_price)
    stmt = stmt.limit(limit)
    rows = db.execute(stmt).scalars().all()
    return [ProductOut.model_validate(p) for p in rows]


def check_inventory(db: Session, product_id: str) -> InventoryOut | None:
    inv = db.execute(select(Inventory).where(Inventory.product_id == product_id)).scalar_one_or_none()
    if inv is None:
        return None
    return InventoryOut.model_validate(inv)


def get_available_offers(db: Session) -> list[OfferOut]:
    stmt = select(Offer).where(Offer.is_active.is_(True))
    rows = db.execute(stmt).scalars().all()
    return [OfferOut.model_validate(o) for o in rows]


# --- OpenAI-tool-calling-compatible schema definitions ---
# These are handed to the LLM client as `tools=TOOL_SCHEMAS`. Note there is
# no "price", "discount", or "total" parameter anywhere in these schemas -
# the LLM has no slot to fill in a number that matters financially.
TOOL_SCHEMAS = [
    {
        "type": "function",
        "function": {
            "name": "search_products",
            "description": "Search the merchant's product catalog by free-text query and optional max price. Returns only real, in-catalog products.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Free-text search, e.g. 'wireless earbuds'"},
                    "max_price": {"type": ["number", "null"], "description": "Optional upper price bound"},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "check_inventory",
            "description": "Check live stock for a specific product_id. Inventory truth comes from the database only.",
            "parameters": {
                "type": "object",
                "properties": {"product_id": {"type": "string"}},
                "required": ["product_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_available_offers",
            "description": "List merchant-approved offers currently active. The LLM may only suggest offer codes returned by this tool - it cannot invent discounts.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
]


def dispatch_tool(db: Session, name: str, arguments: dict):
    """Maps an LLM tool_call to the corresponding function and returns a
    JSON-serializable result. Raises KeyError for unknown tool names, which
    the orchestrator treats as a hard stop (never silently ignored)."""
    if name == "search_products":
        results = search_products(
            db,
            query=arguments.get("query", ""),
            max_price=arguments.get("max_price"),
        )
        return [r.model_dump(mode="json") for r in results]
    if name == "check_inventory":
        result = check_inventory(db, product_id=arguments["product_id"])
        return result.model_dump(mode="json") if result else None
    if name == "get_available_offers":
        results = get_available_offers(db)
        return [r.model_dump(mode="json") for r in results]
    raise KeyError(f"Unknown tool: {name}")
