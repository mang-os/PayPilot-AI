import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.database import SessionLocal
from app.errors import AgentCommerceError
from app.models.audit import AgentRequest
from app.routers import acp_checkouts, admin, agent_commerce, dashboard, webhooks
from app.services import audit_service as audit

logging.basicConfig(level=logging.INFO)

app = FastAPI(
    title="Agentic Commerce API",
    description="Machine-readable commerce interface for AI buyer agents (Razorpay Buildathon Track 01).",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # hackathon MVP scope; tighten before any real deployment
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(agent_commerce.router)
app.include_router(acp_checkouts.router)
app.include_router(webhooks.router)
app.include_router(dashboard.router)
app.include_router(admin.router)


@app.middleware("http")
async def log_agent_requests(request: Request, call_next):
    """Lightweight AgentRequest logging for every call. Deliberately does
    NOT read the request body (to avoid interfering with downstream body
    parsing) - the richer, payload-carrying REQUEST_RECEIVED audit events
    are logged explicitly inside each router instead."""
    request.state.agent_id = None
    response = await call_next(request)

    if request.url.path not in ("/docs", "/openapi.json", "/redoc", "/health"):
        db = SessionLocal()
        try:
            db.add(
                AgentRequest(
                    agent_id=getattr(request.state, "agent_id", None),
                    endpoint=request.url.path,
                    method=request.method,
                    response_status=response.status_code,
                )
            )
            db.commit()
        finally:
            db.close()

    return response


@app.exception_handler(AgentCommerceError)
async def agent_commerce_error_handler(request: Request, exc: AgentCommerceError):
    """Single choke point: every AgentCommerceError subclass gets turned
    into (a) a structured JSON body an agent can act on, and (b) an audit
    log entry, so nothing fails silently."""
    db = SessionLocal()
    try:
        audit.log_event(
            db,
            event_type=f"{exc.error_code}",
            message=exc.message,
            agent_id=getattr(request.state, "agent_id", None),
            payload={"path": request.url.path, "details": exc.details},
        )
    finally:
        db.close()

    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error_code": exc.error_code,
            "message": exc.message,
            "retryable": exc.retryable,
            "details": exc.details,
        },
    )


@app.get("/health")
def health():
    return {"status": "ok"}
