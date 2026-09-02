from types import SimpleNamespace

import openai

from app.config import settings
from app.orchestrator.llm_client import GroqClient, ToolCall


def test_groq_client_uses_compatible_endpoint_and_preserves_tool_calls(monkeypatch):
    captured: dict = {}

    class FakeOpenAI:
        def __init__(self, **kwargs):
            captured["client_kwargs"] = kwargs
            self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))

        def create(self, **kwargs):
            captured["request_kwargs"] = kwargs
            tool_call = SimpleNamespace(
                id="call_1",
                function=SimpleNamespace(name="search_products", arguments='{"query": "earbuds"}'),
            )
            message = SimpleNamespace(content=None, tool_calls=[tool_call])
            return SimpleNamespace(choices=[SimpleNamespace(message=message)])

    monkeypatch.setattr(openai, "OpenAI", FakeOpenAI)
    monkeypatch.setattr(settings, "GROQ_API_KEY", "test-groq-key")
    monkeypatch.setattr(settings, "GROQ_AI_MODEL", "test-groq-model")

    response = GroqClient().chat(messages=[{"role": "user", "content": "earbuds"}], tools=[])

    assert captured["client_kwargs"] == {
        "api_key": "test-groq-key",
        "base_url": "https://api.groq.com/openai/v1",
    }
    assert captured["request_kwargs"]["model"] == "test-groq-model"
    assert response.content is None
    assert response.tool_calls == [ToolCall(id="call_1", name="search_products", arguments={"query": "earbuds"})]
