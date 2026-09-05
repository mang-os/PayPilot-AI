# PayPilot AI

### AI-to-AI Commerce with Deterministic Financial Controls

PayPilot AI is an agentic commerce system where a **Buyer AI Agent can autonomously discover products, select an eligible option, apply offers, create a checkout, and transact with a Merchant Agent**.

The key idea is simple:

> **AI can decide what to buy, but it should not have unrestricted control over money.**

Every purchase must pass deterministic financial controls such as merchant policy validation, delegated spending authority, inventory validation, and payment verification before Razorpay is allowed to execute the payment.

---

## Problem

AI agents are becoming capable of searching, comparing, and purchasing products on behalf of users.

But autonomous commerce creates a major trust problem:

> If an AI decides to buy something, should it also be allowed to directly move money?

Giving an LLM unrestricted financial authority can lead to:

- Overspending
- Unauthorized purchases
- Policy violations
- Invalid transactions
- Inventory inconsistencies
- Unverified payments
- Poor auditability

PayPilot AI solves this by separating **AI decision-making** from **financial execution**.

```text
AI DECISION MAKING
        ↓
DETERMINISTIC FINANCIAL CONTROLS
        ↓
RAZORPAY PAYMENT EXECUTION
```

## Solution

The user provides a high-level purchasing intent such as:

> Find and buy 2 ANC earbuds under ₹6,000.

From there, the Buyer Agent can autonomously:

- Understand the intent
- Search the merchant catalog
- Evaluate matching products
- Select an eligible product
- Apply available offers
- Construct the cart
- Create the checkout
- Request transaction execution

Before any payment is allowed, the transaction must pass:

- Merchant policy validation
- Delegated spending authority validation
- Inventory validation

Only after these controls succeed can Razorpay be invoked.

## How It Works

```text
Human Intent
     ↓
Buyer Agent
     ↓
Merchant Agent
     ↓
Product Discovery
     ↓
Product Selection
     ↓
Offer Application
     ↓
Checkout Creation
     ↓
Policy Validation
     ↓
Spending Authority Validation
     ↓
Inventory Reservation
     ↓
Razorpay
     ↓
Webhook Verification
     ↓
Audit Trail
     ↓
Purchase Complete
```

## Core Features

### AI-to-AI Commerce

PayPilot AI is built around interaction between a Buyer Agent and a Merchant Agent.

Instead of manually browsing an ecommerce store, the user provides the purchasing intent while the agents handle the commerce workflow.

### Autonomous Product Discovery

The Buyer Agent searches the merchant catalog using constraints such as:

- Product type
- Budget
- Quantity
- Product attributes
- Availability

The agent evaluates matching products and selects an eligible option.

### Deterministic Financial Controls

The most important architectural rule in PayPilot AI is:

> LLMs reason about commerce. Deterministic systems control money.

The AI can:

- Understand intent
- Search products
- Compare candidates
- Select tools
- Choose products
- Apply offers
- Orchestrate checkout

The AI cannot:

- Override merchant policy
- Bypass spending limits
- Bypass inventory checks
- Mark a payment as verified
- Force payment execution

### Delegated Spending Authority

Buyer Agents operate within explicit spending limits.

Example:

```text
Authorized Limit:  ₹5,000
Purchase Amount:   ₹5,307.88
```

Result:

```text
Spending Authority    REJECTED
Inventory              NOT RESERVED
Razorpay               NOT INVOKED
Payment                NOT ATTEMPTED
Money Moved            ₹0
```

This ensures that an AI agent cannot spend beyond the authority delegated to it.

### Merchant Policy Engine

Merchant-side purchase rules are evaluated using deterministic backend logic.

```text
AI requests transaction
        ↓
Policy Engine
        ↓
APPROVED / REJECTED
```

The AI cannot override the result.

### Inventory Protection

Inventory is validated before payment execution.

A rejected transaction does not reserve inventory, and payment cannot continue when inventory requirements are not satisfied.

### Razorpay Integration

Razorpay acts as the payment execution layer.

```text
Buyer Agent
    ↓
Merchant Agent
    ↓
Policy Check
    ↓
Spending Authority Check
    ↓
Inventory Check
    ↓
Razorpay Order
    ↓
Payment
    ↓
Webhook Verification
```

The current project uses Razorpay Test Mode.

### Webhook Verification

A transaction is not marked complete simply because a Razorpay order was created.

PayPilot verifies payment/webhook evidence before the checkout is considered successfully completed.

### Audit Trail

Important transaction events are recorded as structured evidence.

Example:

```text
REQUEST_RECEIVED
PRODUCT_SEARCH
PRODUCT_SELECTED
CHECKOUT_CREATED
POLICY_APPROVED
MANDATE_VALIDATED
INVENTORY_RESERVED
RAZORPAY_ORDER_CREATED
PAYMENT_VERIFIED
ORDER_COMPLETED
```

This gives merchants visibility into:

- What the Buyer Agent requested
- Which product was selected
- Which offer was applied
- Which controls were executed
- Why a transaction was approved or rejected
- Whether Razorpay was invoked
- Whether payment was verified

## Buyer Commerce

The Buyer interface is intent-driven.

The user gives a request such as:

> Find and buy 2 ANC earbuds under ₹6,000.

The UI then displays the real transaction progress:

```text
Intent
  ↓
Discovery
  ↓
Selection
  ↓
Cart
  ↓
Checks
  ↓
Razorpay
  ↓
Complete
```

The progress rail is driven by actual checkout and audit evidence.

If a financial control fails:

```text
Intent       ✓
Discovery    ✓
Selection    ✓
Cart         ✓
Checks       ✕
Razorpay     ○
Complete     ○
```

Execution stops before payment.

## Merchant Control

Merchant Control provides the merchant-side view of the same transaction.

It includes:

- Overview
- Execution
- Audit Trail
- Safety

### Execution View

Transactions are presented across three layers:

```text
AI DECISION
FINANCIAL CONTROL
PAYMENT
```

Example:

```text
AI DECISION

Product Selected      AeroBuds Pro
Offer Applied         WELCOME10
Cart Created          ₹5,307.88

FINANCIAL CONTROL

Policy                APPROVED
Spending Authority    ₹5,307.88 / ₹6,000 (VALIDATED)
Inventory             RESERVED

PAYMENT

Razorpay Order        CREATED
Webhook               VERIFIED
Payment               VERIFIED
```

## Successful Transaction Example

```text
User Intent
"Find and buy 2 ANC earbuds under ₹6,000"
        ↓
Buyer Agent
Discovers products
        ↓
Product Selected
AeroBuds Pro ×2
        ↓
Offer Applied
WELCOME10
        ↓
Checkout
₹5,307.88
        ↓
Policy
APPROVED
        ↓
Spending Authority
₹5,307.88 / ₹6,000
VALIDATED
        ↓
Inventory
RESERVED
        ↓
Razorpay
ORDER CREATED
        ↓
Webhook
VERIFIED
        ↓
Payment
VERIFIED
        ↓
PURCHASE COMPLETE
```

## Safety Rejection Example

A second flow demonstrates what happens when an autonomous agent exceeds its delegated authority.

```text
Spending Authority:    ₹5,000
Attempted Purchase:    Above ₹5,000
```

Result:

```text
Policy                 APPROVED
Spending Authority     REJECTED
Inventory              NOT RESERVED
Razorpay               NOT INVOKED
Payment                NOT ATTEMPTED
Money Moved            ₹0
```

This is one of the core safety guarantees of PayPilot AI.

## Architecture

```text
┌─────────────────────────┐
│       Human User        │
└────────────┬────────────┘
             │
             │ Intent
             ▼
┌─────────────────────────┐
│       Buyer Agent       │
│                         │
│ Intent Understanding    │
│ Product Discovery       │
│ Product Selection       │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│      Merchant Agent     │
│                         │
│ Catalog                 │
│ Offers                  │
│ Checkout                │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│   Financial Boundary    │
│                         │
│ Policy Engine           │
│ Mandate Validation      │
│ Inventory Validation    │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│        Razorpay         │
│                         │
│ Order Creation          │
│ Payment Execution       │
│ Webhook Verification    │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│       Audit Ledger      │
└─────────────────────────┘
```

## Tech Stack

### Frontend
- Next.js 15
- React
- TypeScript
- Tailwind CSS

### Backend
- Python
- FastAPI
- SQLAlchemy
- Alembic

### Database
- PostgreSQL

### AI
- Groq API
- LLM-based agent orchestration
- OpenAI-compatible Groq endpoint
- Deterministic fallback where applicable

### Payments
- Razorpay Test Mode
- Razorpay Orders
- Payment verification
- Webhook verification

### Infrastructure
- Docker
- Docker Compose
- Cloudflare Tunnel for webhook testing

### Testing
- Pytest
- TypeScript type checking
- Next.js production build
- Frontend regression tests
- Success and rejection transaction testing

## Project Structure

```text
PayPilot-AI/
│
├── backend/
│   ├── app/
│   ├── tests/
│   ├── scripts/
│   └── ...
│
├── frontend/
│   ├── app/
│   ├── components/
│   ├── lib/
│   └── ...
│
├── docker-compose.yml
├── .env.example
├── .gitignore
└── README.md
```

## Running Locally

### 1. Clone the repository

```bash
git clone https://github.com/mang-os/PayPilot-AI.git
cd PayPilot-AI
```

### 2. Configure environment variables

Create a `.env` file using `.env.example`.

Example:

```text
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=

GROQ_API_KEY=
GROQ_AI_MODEL=

CURRENCY=INR
TAX_RATE=0.18
```

Do not commit real API keys or secrets.

### 3. Start the application

```bash
docker compose up -d
```

Check services:

```bash
docker compose ps
```

### 4. Verify backend health

```bash
curl http://localhost:8000/health
```

Expected:

```json
{
  "status": "ok"
}
```

### 5. Open the frontend

- Frontend: http://localhost:3000
- Backend: http://localhost:8000

## Build Validation

Frontend type check:

```bash
cd frontend
npx tsc --noEmit
```

Production build:

```bash
npm run build
```

Backend tests:

```bash
docker compose exec backend pytest
```

## Demo Flow

### Successful Autonomous Purchase

1. Open Buyer Commerce
2. Enter: `Find and buy 2 ANC earbuds under ₹6,000`
3. Buyer Agent discovers eligible products
4. Buyer Agent selects a product
5. Eligible offer is applied
6. Cart and checkout are created
7. Merchant policy is validated
8. Spending authority is validated
9. Inventory is reserved
10. Razorpay is invoked
11. Payment is verified
12. Transaction is completed
13. Audit Trail displays transaction evidence

### Safety Rejection

1. Use a spending authority of ₹5,000
2. Attempt a purchase above ₹5,000
3. Spending authority validation fails
4. Transaction stops at Checks
5. Inventory is not reserved
6. Razorpay is not invoked
7. Payment is not attempted
8. ₹0 moves

## Why PayPilot AI?

Most AI-commerce systems focus on:

> Can an AI buy something?

PayPilot AI focuses on:

> Under what conditions should an AI be allowed to buy something?

The system combines:

```text
AUTONOMY
Buyer Agent ↔ Merchant Agent

        +

CONTROL
Policy + Spending Authority + Inventory

        +

EXECUTION
Razorpay

        +

PROOF
Webhook Verification + Audit Trail
```

## Build Challenges

The main challenge was making AI-to-AI buying safe.

The AI needed to handle product discovery and checkout autonomously without being given unrestricted control over money.

This was solved by separating AI reasoning from deterministic financial controls using:

- Merchant policy validation
- Delegated spending limits
- Inventory validation
- Razorpay execution
- Webhook verification
- Checkout-scoped audit evidence

Another challenge was keeping the Buyer and Merchant interfaces synchronized around the exact same transaction. PayPilot uses checkout-specific transaction state so both views represent the same purchase.

## Validation

The project has been validated using:

- TypeScript type checking
- Next.js production build
- Frontend regression tests
- Successful checkout scenarios
- Rejected checkout scenarios
- Matching and no-match product searches
- Responsive layouts at mobile and desktop widths

The transaction progress UI is evidence-driven, and rejected financial controls stop the flow before Razorpay execution.

## Screenshots

Add your final screenshots here before submission.

- Buyer Commerce: `docs/buyer-commerce.png`
- Merchant Control: `docs/merchant-control.png`
- Spending Authority Rejection: `docs/safety-rejection.png`

Example Markdown after adding the images:

```markdown
![Buyer Commerce](docs/buyer-commerce.png)

![Merchant Control](docs/merchant-control.png)

![Safety Rejection](docs/safety-rejection.png)
```

## Current Scope

PayPilot AI is a hackathon MVP demonstrating:

- AI-to-AI commerce
- Autonomous product discovery
- Agent-based commerce orchestration
- Deterministic payment controls
- Delegated spending authority
- Merchant policy validation
- Inventory protection
- Razorpay payment execution
- Webhook verification
- Checkout-scoped auditability
- Safe transaction rejection

The current implementation uses Razorpay Test Mode and is not intended for production financial use.

## Hackathon

Built for the Razorpay AI Buildathon 2026 under the AI Growth / Agentic Commerce track.

## Repository

https://github.com/mang-os/PayPilot-AI

## Author

Tarun K

GitHub: https://github.com/mang-os
