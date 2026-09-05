"""
The Merchant Agent: an LLM tool-calling loop that can search products,
check inventory, and list offers - and nothing else. It never sees a
"set price" or "apply discount" tool, so it structurally cannot do those
things, regardless of what it's asked or how it's prompted.

handle_query() also defensively re-validates the LLM's final answer against
the DB before returning it: any product_id the LLM mentions that wasn't
actually present in a tool result gets dropped rather than trusted. This
means even a prompt-injected or hallucinating LLM can't smuggle a fake
product into the response - the worst it can do is recommend nothing.
"""
import json
import logging

from sqlalchemy.orm import Session

from app.orchestrator.llm_client import LLMClient, get_llm_client
from app.schemas.agents import AgentQueryResponse
from app.schemas.catalog import OfferOut, ProductOut
from app.tools import TOOL_SCHEMAS, dispatch_tool
from app.config import settings

logger = logging.getLogger("merchant_agent")

SYSTEM_PROMPT = """You are a merchant-side shopping assistant for an agentic commerce API.

You may ONLY use the provided tools (search_products, check_inventory,
get_available_offers) to gather information. You must NEVER state a final
payable price, invent a discount, promise a specific inventory count you
did not get from check_inventory, or mention any product that did not come
from search_products.

Follow this tool plan without repeating completed work:
1. Call search_products exactly once, carrying over the user's search terms
   and price ceiling. Do not broaden the request or search again.
2. If products were returned, call check_inventory for the products you may
   recommend. You may issue multiple inventory calls in one turn.
3. Call get_available_offers exactly once when products were returned.
If search_products returned no products, stop calling tools. Once the
required results are present, stop calling tools so a separate synthesis
step can produce the final answer.

When you have enough information, respond with ONLY a JSON object (no
markdown, no prose) of the form:
{"product_ids": ["..."], "suggested_offer_code": "..." or null, "rationale": "..."}

This response is advisory only - the merchant's Checkout Engine will
independently re-price everything from the database, so do not attempt to
compute totals."""

FINAL_SYNTHESIS_PROMPT = """You are the final response synthesizer. Tool execution is complete and no tools are available.
Use only the query and real tool results in the JSON evidence supplied by the user. Return ONLY one JSON object with this exact shape:
{"product_ids": ["..."], "suggested_offer_code": "..." or null, "rationale": "..."}
Include only product IDs present in search_products results and only an offer code present in get_available_offers results. If no product matched, return an empty product_ids list. Do not emit a tool call, markdown, or prose outside the JSON object."""


class MerchantAgent:
    def __init__(self, llm_client: LLMClient | None = None):
        self.llm_client = llm_client or get_llm_client()

    def handle_query(self, db: Session, query: str) -> AgentQueryResponse:
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": query},
        ]
        seen_product_ids: set[str] = set()
        seen_offer_codes: set[str] = set()

        got_search = False
        got_inventory = False
        got_offers = False

        for _ in range(settings.LLM_MAX_TOOL_ITERATIONS):
            # Phase A: always present full tool schema list.
            response = self.llm_client.chat(messages, tools=TOOL_SCHEMAS)

            if response.tool_calls:
                # Record assistant turn that requested tools.
                messages.append({
                    "role": "assistant",
                    "content": response.content,
                    "tool_calls": [
                        {
                            "id": tc.id,
                            "type": "function",
                            "function": {"name": tc.name, "arguments": json.dumps(tc.arguments)}
                        }
                        for tc in response.tool_calls
                    ],
                })

                for call in response.tool_calls:
                    try:
                        result = dispatch_tool(db, call.name, call.arguments)
                    except KeyError:
                        result = {"error": f"unknown tool {call.name}"}

                    # Update success flags based on result shape.
                    if call.name == "search_products" and isinstance(result, list):
                        if all(isinstance(p, dict) and "id" in p for p in result):
                            got_search = True
                            seen_product_ids.update(p["id"] for p in result)
                    if (
                        call.name == "check_inventory"
                        and isinstance(result, dict)
                        and result.get("product_id")
                    ):
                        got_inventory = True
                    if call.name == "get_available_offers" and isinstance(result, list):
                        if all(isinstance(o, dict) and "code" in o for o in result):
                            got_offers = True
                            seen_offer_codes.update(o["code"] for o in result)

                    messages.append({
                        "role": "tool",
                        "tool_call_id": call.id,
                        "name": call.name,
                        "content": json.dumps(result),
                    })

                # If all required data gathered, move to Phase B synthesis.
                if got_search and (
                    not seen_product_ids or (got_inventory and got_offers)
                ):
                    return self._synthesize_without_tools(
                        db, messages, seen_product_ids, seen_offer_codes
                    )
                continue

            # A tools-enabled turn never doubles as the final answer. Preserve
            # any content it produced, then make the dedicated JSON-only call.
            if response.content:
                messages.append({"role": "assistant", "content": response.content})
            return self._synthesize_without_tools(
                db, messages, seen_product_ids, seen_offer_codes
            )

        # Exceeded max iterations without a final answer; delegate to Phase B.
        return self._synthesize_without_tools(
            db, messages, seen_product_ids, seen_offer_codes
        )

    def _synthesize_without_tools(
        self,
        db: Session,
        messages: list,
        seen_product_ids: set[str],
        seen_offer_codes: set[str],
    ) -> AgentQueryResponse:
        """Phase B: synthesize from plain evidence with no tool controls at all."""
        query = next(
            (message.get("content", "") for message in messages if message.get("role") == "user"),
            "",
        )
        tool_results = []
        for message in messages:
            if message.get("role") != "tool":
                continue
            try:
                result = json.loads(message.get("content") or "null")
            except (json.JSONDecodeError, TypeError):
                result = message.get("content")
            tool_results.append({
                "name": message.get("name"),
                "result": result,
            })

        synthesis_messages = [
            {"role": "system", "content": FINAL_SYNTHESIS_PROMPT},
            {
                "role": "user",
                "content": json.dumps({"query": query, "tool_results": tool_results}),
            },
        ]
        try:
            synth_response = self.llm_client.chat(
                synthesis_messages,
                response_format={"type": "json_object"},
            )
            return self._finalize(
                db,
                synth_response.content,
                seen_product_ids,
                seen_offer_codes,
            )
        except Exception as e:
            logger.warning(f"Final synthesis failed gracefully: {e}")
            return AgentQueryResponse(
                matched_products=[],
                suggested_offer=None,
                rationale="Orchestrator exceeded max tool iterations and failed to synthesize a final answer.",
            )

    def _finalize(self, db: Session, content: str | None, seen_product_ids: set[str], seen_offer_codes: set[str]) -> AgentQueryResponse:
        product_ids: list[str] = []
        offer_code: str | None = None
        rationale = "No structured answer produced."

        try:
            parsed = json.loads(content or "{}")
            product_ids = parsed.get("product_ids", []) or []
            offer_code = parsed.get("suggested_offer_code")
            rationale = parsed.get("rationale", rationale)
        except json.JSONDecodeError:
            logger.warning("LLM final answer was not valid JSON; returning empty result.")

        # Defensive re-validation: drop anything the LLM mentioned that
        # wasn't actually returned by a real tool call in this conversation.
        valid_product_ids = [pid for pid in product_ids if pid in seen_product_ids]
        if offer_code and offer_code not in seen_offer_codes:
            offer_code = None

        from app.tools import search_products as _search  # local import to avoid cycle at module load
        from app.models.catalog import Product
        matched_products: list[ProductOut] = []
        for pid in valid_product_ids:
            product = db.get(Product, pid)
            if product and product.is_active:
                matched_products.append(ProductOut.model_validate(product))

        suggested_offer: OfferOut | None = None
        if offer_code:
            from app.models.catalog import Offer
            from sqlalchemy import select
            offer_row = db.execute(select(Offer).where(Offer.code == offer_code)).scalar_one_or_none()
            if offer_row and offer_row.is_active:
                suggested_offer = OfferOut.model_validate(offer_row)

        return AgentQueryResponse(matched_products=matched_products, suggested_offer=suggested_offer, rationale=rationale)
