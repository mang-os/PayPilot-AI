import { NextResponse } from "next/server";

const BACKEND_URL = (
  process.env.AGENT_COMMERCE_API_URL
  || process.env.NEXT_PUBLIC_API_URL
  || "http://localhost:8000"
).replace(/\/$/, "");

export async function POST(request: Request) {
  const apiKey = process.env.AGENT_COMMERCE_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { message: "PayPilot AI is not configured for Buyer purchases." },
      { status: 503 },
    );
  }

  let query = "";
  try {
    const body = await request.json() as { query?: unknown };
    query = typeof body.query === "string" ? body.query.trim() : "";
  } catch {
    return NextResponse.json({ message: "Enter a valid shopping request." }, { status: 400 });
  }

  if (!query) {
    return NextResponse.json({ message: "Enter a shopping request." }, { status: 400 });
  }

  try {
    const response = await fetch(`${BACKEND_URL}/agent-commerce/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      return NextResponse.json(
        { message: "PayPilot AI could not complete this search." },
        { status: response.status >= 500 ? 503 : response.status },
      );
    }

    return NextResponse.json(await response.json());
  } catch {
    return NextResponse.json(
      { message: "PayPilot AI is unavailable right now. Try again shortly." },
      { status: 503 },
    );
  }
}
