"""
Small abstraction over "the thing that does tool-calling", so the
orchestrator logic in merchant_agent.py doesn't care which provider is
behind it. GroqClient uses Groq's OpenAI-compatible tool-calling API.
FakeLLMClient is a deterministic keyword-matcher used when Groq is not
configured (local dev, CI, the
demo script) - it exercises the exact same tool-dispatch code path as the
real client, just without a network call.

Swapping to Anthropic later is a small, contained change: Claude's Messages
API accepts the same {name, description, parameters} tool shape (as
`input_schema`), and returns tool_use blocks instead of tool_calls - the
translation layer would live entirely in a new AnthropicClient class here.
"""
import json
from abc import ABC, abstractmethod
from dataclasses import dataclass, field

from app.config import settings


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: dict


@dataclass
class LLMResponse:
    content: str | None
    tool_calls: list[ToolCall] = field(default_factory=list)


class LLMClient(ABC):
    @abstractmethod
    def chat(self, messages: list[dict], tools: list[dict]) -> LLMResponse:
        ...


class GroqClient(LLMClient):
    def __init__(self):
        from openai import OpenAI

        self._client = OpenAI(
            api_key=settings.GROQ_API_KEY,
            base_url="https://api.groq.com/openai/v1",
        )

    def chat(self, messages: list[dict], tools: list[dict]) -> LLMResponse:
        response = self._client.chat.completions.create(
            model=settings.GROQ_AI_MODEL,
            messages=messages,
            tools=tools,
        )
        choice = response.choices[0].message
        tool_calls = [
            ToolCall(id=tc.id, name=tc.function.name, arguments=json.loads(tc.function.arguments or "{}"))
            for tc in (choice.tool_calls or [])
        ]
        return LLMResponse(content=choice.content, tool_calls=tool_calls)


class FakeLLMClient(LLMClient):
    """
    Deterministic stand-in used when LLM_MOCK_MODE is on. Mimics a
    reasonable tool-calling model: on the first turn it always calls
    search_products with the user's query, then get_available_offers;
    on the second turn (once it has tool results in `messages`) it emits
    a final answer built only from what the tools returned.
    """

    def chat(self, messages: list[dict], tools: list[dict]) -> LLMResponse:
        has_tool_results = any(m.get("role") == "tool" for m in messages)

        if not has_tool_results:
            user_query = next((m["content"] for m in messages if m["role"] == "user"), "")
            max_price = self._extract_price_ceiling(user_query)
            search_args = {"query": user_query}
            if max_price is not None:
                search_args["max_price"] = max_price
            return LLMResponse(
                content=None,
                tool_calls=[
                    ToolCall(id="fake_call_search", name="search_products", arguments=search_args),
                    ToolCall(id="fake_call_offers", name="get_available_offers", arguments={}),
                ],
            )

        # Second turn: synthesize a final structured answer purely from
        # tool results already present in the conversation.
        products: list[dict] = []
        offers: list[dict] = []
        for m in messages:
            if m.get("role") != "tool":
                continue
            try:
                parsed = json.loads(m["content"])
            except (json.JSONDecodeError, TypeError):
                continue
            if m.get("name") == "search_products" and isinstance(parsed, list):
                products = parsed
            elif m.get("name") == "get_available_offers" and isinstance(parsed, list):
                offers = parsed

        product_ids = [p["id"] for p in products[:3]]
        suggested_offer_code = offers[0]["code"] if offers else None
        rationale = (
            f"Found {len(products)} matching product(s) via search_products."
            + (f" Suggesting offer '{suggested_offer_code}' from get_available_offers." if suggested_offer_code else " No active offers to suggest.")
        )
        final = {
            "product_ids": product_ids,
            "suggested_offer_code": suggested_offer_code,
            "rationale": rationale,
        }
        return LLMResponse(content=json.dumps(final), tool_calls=[])

    @staticmethod
    def _extract_price_ceiling(query: str) -> float | None:
        import re

        match = re.search(r"(?:under|below|less than|<=?)\s*(?:rs\.?|inr|₹)?\s*(\d+)", query.lower())
        return float(match.group(1)) if match else None


def get_llm_client() -> LLMClient:
    if settings.LLM_MOCK_MODE:
        return FakeLLMClient()
    return GroqClient()
