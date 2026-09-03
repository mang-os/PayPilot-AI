import json
from unittest.mock import MagicMock
import pytest

from app.orchestrator.merchant_agent import MerchantAgent
from app.orchestrator.llm_client import LLMClient, LLMResponse, ToolCall
from app.config import settings

class MockLLMClient(LLMClient):
    def __init__(self, responses):
        self.responses = responses
        self.call_history = []
        self.turn = 0
        
    def chat(self, messages, tools):
        self.call_history.append({"messages": list(messages), "tools": list(tools)})
        if self.turn < len(self.responses):
            resp = self.responses[self.turn]
            
            # Simulate Groq 400 error if tools=[] but the mocked response tries to call a tool anyway
            if not tools and resp.tool_calls:
                raise Exception("Tool choice is none, but model called a tool")
                
            self.turn += 1
            return resp
        return LLMResponse(content="{}")

def test_merchant_agent_multiple_tool_rounds_and_synthesis(db_session, catalog):
    # Prove that multiple tool rounds work (search_products -> check_inventory -> get_available_offers) and final synthesis has no tools.
    responses = [
        LLMResponse(
            content=None,
            tool_calls=[ToolCall(id="call_1", name="search_products", arguments={"query": "test"})]
        ),
        LLMResponse(
            content=None,
            tool_calls=[ToolCall(id="call_2", name="check_inventory", arguments={"product_id": catalog["product_id"]})]
        ),
        LLMResponse(
            content=None,
            tool_calls=[ToolCall(id="call_3", name="get_available_offers", arguments={})]
        ),
        # Final synthesis turn – no tools.
        LLMResponse(
            content=json.dumps({"product_ids": [catalog["product_id"]], "suggested_offer_code": catalog["offer_code"], "rationale": "Found it"})
        ),
    ]
    mock_llm = MockLLMClient(responses)
    agent = MerchantAgent(llm_client=mock_llm)

    result = agent.handle_query(db_session, "find test")

    assert len(result.matched_products) == 1
    assert result.suggested_offer is not None
    assert mock_llm.turn == 4
    # Verify call history length and tool usage.
    assert len(mock_llm.call_history) == 4
    assert len(mock_llm.call_history[0]["tools"]) > 0
    assert len(mock_llm.call_history[1]["tools"]) > 0
    assert len(mock_llm.call_history[2]["tools"]) > 0
    assert len(mock_llm.call_history[3]["tools"]) == 0
    assert mock_llm.call_history[3]["messages"][-1]["content"].startswith("Tool use is finished.")


def test_merchant_agent_discards_hallucinated_product(db_session, catalog):
    responses = [
        LLMResponse(
            content=None,
            tool_calls=[ToolCall(id="call_1", name="search_products", arguments={"query": "test"})]
        ),
        # LLM tries to smuggle a fake product ID and a fake offer code along with a real one
        LLMResponse(
            content=json.dumps({"product_ids": [catalog["product_id"], "fake_id_123"], "suggested_offer_code": "FAKE_OFFER", "rationale": "Trust me"})
        )
    ]
    mock_llm = MockLLMClient(responses)
    agent = MerchantAgent(llm_client=mock_llm)
    
    result = agent.handle_query(db_session, "find test")
    
    assert len(result.matched_products) == 1
    assert result.matched_products[0].id == catalog["product_id"]
    assert result.suggested_offer is None

def test_merchant_agent_exhausts_iterations_and_does_synthesis(db_session, monkeypatch, catalog):
    # Prove that the loop remains bounded.
    # Prove final synthesis gets no tools.
    monkeypatch.setattr(settings, "LLM_MAX_TOOL_ITERATIONS", 2)
    
    responses = [
        LLMResponse(
            content=None,
            tool_calls=[ToolCall(id="call_1", name="search_products", arguments={"query": "test"})]
        ),
        LLMResponse(
            content=None,
            tool_calls=[ToolCall(id="call_2", name="get_available_offers", arguments={})]
        ),
        # Now iterations are exhausted (2). It will force a final synthesis turn with tools=[]
        LLMResponse(
            content=json.dumps({"product_ids": [catalog["product_id"]], "suggested_offer_code": None, "rationale": "Forced synthesis"})
        )
    ]
    mock_llm = MockLLMClient(responses)
    agent = MerchantAgent(llm_client=mock_llm)
    
    result = agent.handle_query(db_session, "find test")
    
    assert len(result.matched_products) == 1
    assert len(mock_llm.call_history) == 3
    # Turn 1 and 2 had tools
    assert len(mock_llm.call_history[0]["tools"]) > 0
    assert len(mock_llm.call_history[1]["tools"]) > 0
    # Turn 3 (forced synthesis) had NO tools
    assert len(mock_llm.call_history[2]["tools"]) == 0
    assert mock_llm.call_history[2]["messages"][-1]["content"].startswith("Tool use is finished.")


def test_merchant_agent_gracefully_handles_synthesis_tool_failure(db_session, monkeypatch):
    # Prove Groq/tool-use synthesis failure does not result in an uncaught server error
    monkeypatch.setattr(settings, "LLM_MAX_TOOL_ITERATIONS", 1)
    
    responses = [
        # Turn 1: tool call
        LLMResponse(
            content=None,
            tool_calls=[ToolCall(id="call_1", name="search_products", arguments={"query": "test"})]
        ),
        # Turn 2: Forced synthesis, but the mock model attempts to call a tool anyway!
        # The MockLLMClient will raise an Exception, simulating Groq's 400.
        LLMResponse(
            content=None,
            tool_calls=[ToolCall(id="call_2", name="check_inventory", arguments={"product_ids": []})]
        )
    ]
    mock_llm = MockLLMClient(responses)
    agent = MerchantAgent(llm_client=mock_llm)
    
    result = agent.handle_query(db_session, "find test")
    
    # Assert it gracefully failed and didn't crash
    assert result.matched_products == []
    assert "failed to synthesize a final answer" in result.rationale
