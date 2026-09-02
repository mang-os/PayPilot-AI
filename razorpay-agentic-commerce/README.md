# Agentic Commerce API

**Razorpay Buildathon Track 01 — AI Growth & Agentic Commerce**

A machine-readable commerce interface that lets an external AI buyer agent discover
products, sign a bounded spending mandate, and check out with a merchant — with every
money-movement decision gated by a deterministic policy engine the LLM cannot influence.

> **The LLM never sees a price field.** The Merchant Agent (the orchestrator) can search
> products, check inventory, and list offers — its final output is a list of `product_ids`
> and a suggested `offer_code`, nothing else. The Checkout Engine re-derives subtotal,
> discount, tax, and final amount from the database on every single call, including the
> one right before payment. This isn't a prompt instruction the model could ignore — the
> schema the LLM responds in has no slot for a number that matters financially.

---

## Architecture

```
External Buyer Agent
  -> Protocol Adapter Layer + Agent Commerce API   (routers/agent_commerce.py, routers/acp_checkouts.py)
  -> Merchant Agent / LLM Orchestrator             (orchestrator/) — read-only, advisory
  -> Catalog / Inventory / Offer Tools              (tools.py) — pure DB reads
  -> Deterministic Policy Engine                    (services/policy_engine.py)
  -> Checkout Engine                                (services/checkout_engine.py) — authoritative pricing
  -> Razorpay Test Mode                             (services/razorpay_service.py)
  -> Webhook Verification                           (routers/webhooks.py) — the only place a payment is trusted
  -> Audit Ledger                                   (services/audit_service.py -> audit_events table)
```

All 11 tables from the spec exist: `products`, `inventory`, `offers`, `orders`,
`transactions`, `agent_requests`, `audit_events`, `agent_registry`, `agent_credentials`,
`cart_mandates`, `checkout_sessions`.

---

## Quickstart (Docker)

```bash
cp .env.example .env          # fill in Razorpay test keys if you have them - optional, see below
docker-compose up --build
```

- Backend: `http://localhost:8000` (interactive API docs at `/docs`)
- Frontend dashboard: `http://localhost:3000`
- The backend container runs migrations and seeds demo data automatically on startup.

**Note on this path:** I don't have a Docker daemon or unrestricted package-mirror access
in the environment I built this in, so I could not run `docker-compose up` end-to-end
myself. I tested the equivalent logic directly — the actual FastAPI app, running against
a real SQLite database — and reviewed every place the code touches a `Numeric` (money)
column for the one real SQLite/Postgres behavioral difference (Postgres returns `Decimal`
where SQLite tends to hand back `float`); every arithmetic site wraps with `float()`
first. But **this is the one part of the deliverable I'd ask you to verify first**,
before a live demo.

## Quickstart (without Docker)

**Backend:**
```bash
cd backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python -m alembic upgrade head
python -m app.seed
uvicorn app.main:app --reload
```
This runs against SQLite (`backend/dev.db`) with zero extra setup — no Postgres, no
Razorpay keys, no Groq key required. Razorpay calls run in **mock mode** (realistic fake
order IDs, real webhook signature verification) and the LLM orchestrator falls back to a
**deterministic FakeLLMClient** (keyword search over the catalog) whenever Groq is not
fully configured (`GROQ_API_KEY` and `GROQ_AI_MODEL`).

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```
Requires internet access to fetch Space Grotesk / IBM Plex Sans / IBM Plex Mono from
Google Fonts at build time (standard `next/font/google` behavior). If you're on a
network that blocks `fonts.googleapis.com`, swap the `next/font/google` imports in
`app/layout.tsx` for a system font stack.

## Run the demo

This is what to actually run live during judging — the "buyer" here is an agent, not a
human clicking a UI, so the demo *is* a script hitting the API, narrated:

```bash
cd backend
python -m scripts.demo_buyer_agent                              # golden path: discover -> sign mandate -> checkout -> update -> complete -> webhook -> audit trail
python -m scripts.demo_buyer_agent --scenario invalid_product    # failure 1
python -m scripts.demo_buyer_agent --scenario duplicate_checkout # failure 2
python -m scripts.demo_buyer_agent --scenario razorpay_timeout   # failure 3 - retry, escalate, recover
```

Then open the dashboard and look at **Agent Trace** for the checkout_id each script prints,
and **Failure Monitor** after running the failure scenarios.

Run `pytest` from `backend/` for the automated suite (11 tests covering auth, pricing
authority, the golden path, all three failure scenarios, transaction-limit enforcement,
suspended-agent rejection, and LLM anti-hallucination).

---

## Design decisions

**LLM can't touch money, by construction, not by prompt.** `AgentQueryResponse` has no
price field. The Checkout Engine (`checkout_engine.py`) recomputes subtotal, discount,
tax, and final amount from live `products`/`offers` rows on every call — at checkout
creation, at every update, and again immediately before payment at completion, discarding
whatever was cached from the previous step. An offer that expires or a price that changes
between "create" and "complete" is caught by the *last* computation, not the first.

**Mandates use real Ed25519 signatures**, not the HMAC-style mock the spec says is
acceptable (`services/mandate_service.py`). Each agent gets a keypair at registration; a
mandate request is signed with the agent's private key and verified against the public
key stored in `agent_registry`. The Policy Engine re-verifies the signature *again* at
checkout completion — against the exact payload string that was originally signed, stored
verbatim rather than reconstructed, since a naive-vs-aware datetime round-trip through
SQLite would otherwise produce different bytes than what was actually signed and silently
break a legitimate mandate.

**Two independent spending limits, enforced separately.** `agent_registry.max_transaction_limit`
/ `max_daily_limit` are trust boundaries the *merchant* sets when onboarding an agent.
`cart_mandates.max_amount` is a *per-purchase* authorization the agent itself signs. The
Policy Engine checks both — a test (`test_transaction_limit_exceeded_is_a_policy_violation_not_a_crash`)
specifically proves a mandate can authorize more than the agent's own registry limit allows,
and the registry limit still wins.

**Inventory uses reserve -> commit/release, not a straight decrement.** Stock moves from
`quantity_available` to `reserved_quantity` only once policy passes and a Razorpay order is
about to be created — never earlier (an abandoned checkout shouldn't lock stock) and never
later (payment shouldn't be attempted against stock that might already be gone). A verified
`payment.captured` webhook clears the reservation permanently; a timeout or `payment.failed`
releases it back to `quantity_available`. Verified directly: after a simulated timeout and
successful retry, inventory counts came back exactly right with no leakage.

**A retryable failure has to actually be retryable.** This one came from a real bug I found
by testing, not by inspection: the first version of the Razorpay-timeout handler marked the
checkout `FAILED` — but `FAILED` is a terminal state the Policy Engine's own consistency
check refuses to complete, which silently contradicted the `retryable: true` the API was
telling the agent. Fixed by leaving retryable failures in `UPDATED` (the mandate freed,
inventory released, same `checkout_id` retryable) and reserving `FAILED` for failures an
agent has to actually fix something about (bad product ID, policy violation) before
retrying would ever help.

**The LLM orchestrator follows OpenAI's tool-calling schema** (as specced) behind a small
`LLMClient` interface (`orchestrator/llm_client.py`). Swapping to Anthropic later is a
contained change — Claude's Messages API accepts the same `{name, description, parameters}`
tool shape as `input_schema` and returns `tool_use` blocks instead of `tool_calls`; that
translation would live entirely in a new `AnthropicClient` class.

**SQLite for dev/test, Postgres for docker-compose**, same code either way. This surfaced a
real, non-obvious bug worth knowing about: SQLite silently drops timezone info on
round-trip through SQLAlchemy, so a datetime stored as UTC-aware comes back naive, and
comparing it against a fresh `datetime.now(timezone.utc)` throws. Fixed by standardizing on
naive-but-always-UTC datetimes everywhere (`app/timeutils.py`) rather than patching the one
comparison that happened to crash first.

---

## What's genuinely tested vs. reviewed

**Ran and verified directly**, not just written: the full golden path end-to-end against a
live server (with pricing math checked by hand at each step); all three failure scenarios,
including confirming the Razorpay-timeout checkout can actually be completed on retry, not
just that it fails gracefully; inventory integrity across a reserve/release/re-reserve
cycle; Ed25519 signing rejecting tampered payloads and wrong keys; the retry-then-escalate
behavior with both under- and over-budget timeout counts; the full pytest suite; a full
`next build` of the frontend (with fonts stubbed locally to isolate that from the rest of
the build — Google Fonts itself wasn't reachable from my sandboxed environment, not a code
issue).

**Reviewed but not live-tested**: the docker-compose path end-to-end, and therefore real
Postgres behavior specifically (see the Quickstart note above). If something's going to
break on a fresh environment, this is the most likely place — run it early, not the night
before judging.

## Known simplifications (fair game to call out if asked)

- Tax is a flat configurable rate (`TAX_RATE`, default 18%), not real GST slab logic.
- The "Protocol Adapter Layer" is the FastAPI routers themselves normalizing ACP-shaped
  requests — there's no separate adapter for other agent protocols (e.g. MCP-style tool
  calls) yet, though the Merchant Agent's tool schema would translate directly.
- No pagination on dashboard list endpoints (fine at hackathon data volumes).
- The admin agent-registration endpoint returns the new agent's private key once, for demo
  convenience — a real deployment would never have the server generate or see an agent's
  private key at all.
