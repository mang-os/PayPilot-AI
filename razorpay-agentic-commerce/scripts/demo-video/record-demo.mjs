import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright-core";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const successIntent = "Find and buy 2 ANC earbuds under ₹6,000";
const failureAuthority = 5000;

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0 || index === process.argv.length - 1) return fallback;
  return process.argv[index + 1];
}

const baseUrl = argument("base-url", "http://localhost:3000").replace(/\/$/, "");
const backendUrl = argument("backend-url", "http://localhost:8000").replace(/\/$/, "");
const requestedBrowserChannel = argument("browser-channel", "chrome");
const paymentTimeoutMs = Number(argument("payment-timeout-ms", String(10 * 60 * 1000)));

if (!Number.isFinite(paymentTimeoutMs) || paymentTimeoutMs <= 0) {
  throw new Error("--payment-timeout-ms must be a positive number.");
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const recordingDirectory = path.join(scriptDirectory, "recordings", timestamp);
await mkdir(recordingDirectory, { recursive: true });

function log(message) {
  process.stdout.write(`[PayPilot demo] ${message}\n`);
}

async function launchBrowser() {
  const channels = [...new Set([requestedBrowserChannel, "chrome", "msedge"])];
  const failures = [];
  for (const channel of channels) {
    try {
      const browser = await chromium.launch({
        channel,
        headless: false,
        args: ["--disable-notifications"],
      });
      log(`Using the installed ${channel} browser.`);
      return browser;
    } catch (error) {
      failures.push(`${channel}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
    }
  }
  throw new Error(`Could not launch an installed Chrome or Edge browser. ${failures.join(" | ")}`);
}

async function pause(page, milliseconds, label) {
  log(`${label} (${Math.round(milliseconds / 1000)}s)`);
  await page.waitForTimeout(milliseconds);
}

async function show(page, selector, milliseconds, label) {
  const target = page.locator(selector);
  await target.waitFor({ state: "visible", timeout: 60_000 });
  await target.evaluate((element) => element.scrollIntoView({ block: "start", behavior: "smooth" }));
  await page.waitForTimeout(900);
  await pause(page, milliseconds, label);
}

async function pacedResponse(route, holdMilliseconds) {
  const response = await route.fetch();
  await delay(holdMilliseconds);
  await route.fulfill({ response });
}

async function checkoutDetail(checkoutId) {
  const response = await fetch(`${backendUrl}/dashboard/checkouts/${encodeURIComponent(checkoutId)}`);
  if (!response.ok) {
    throw new Error(`Could not verify checkout ${checkoutId}: HTTP ${response.status}`);
  }
  return response.json();
}

async function waitForCheckoutUrl(page) {
  await page.waitForFunction(() => new URL(window.location.href).searchParams.has("checkout"), null, { timeout: 60_000 });
  const checkoutId = new URL(page.url()).searchParams.get("checkout");
  if (!checkoutId) throw new Error("The Buyer page did not retain the checkout ID.");
  return checkoutId;
}

async function runDiscovery(page) {
  const intentInput = page.getByLabel("What would you like PayPilot AI to buy?");
  await intentInput.fill(successIntent);
  await pause(page, 3_000, "Buyer intent is visible");

  const queryResponsePromise = page.waitForResponse(
    (response) => response.url().includes("/api/agent-commerce/query") && response.request().method() === "POST",
    { timeout: 60_000 },
  );
  await page.getByRole("button", { name: /Start shopping/i }).click();
  await page.getByText("Searching the merchant catalog", { exact: false }).first().waitFor({ timeout: 15_000 });
  await pause(page, 4_000, "Live merchant discovery is running");

  const queryResponse = await queryResponsePromise;
  if (!queryResponse.ok()) {
    throw new Error(`Live product discovery failed: HTTP ${queryResponse.status()}`);
  }
  await page.getByRole("button", { name: "Choose recommendation", exact: true }).waitFor({ timeout: 60_000 });
  await show(page, "#discovery", 5_000, "Real discovery results, rationale, and offer are visible");
}

async function startRecommendedPurchase(page) {
  const purchaseResponsePromise = page.waitForResponse(
    (response) => response.url().includes("/api/agent-commerce/purchase") && response.request().method() === "POST",
    { timeout: 60_000 },
  );
  await page.getByRole("button", { name: "Choose recommendation", exact: true }).click();
  await page.getByText("Preparing your purchase", { exact: false }).first().waitFor({ timeout: 15_000 });
  await pause(page, 4_000, "Autonomous selection and cart preparation are visible");

  const purchaseResponse = await purchaseResponsePromise;
  if (!purchaseResponse.ok()) {
    throw new Error(`Purchase preparation failed: HTTP ${purchaseResponse.status()}`);
  }
  const purchasePayload = await purchaseResponse.json();
  const checkoutId = await waitForCheckoutUrl(page);
  return { checkoutId, purchasePayload };
}

async function runSuccessFlow(page) {
  log("Starting the successful Buyer Commerce flow.");
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.getByRole("heading", { name: "What would you like PayPilot AI to buy?" }).waitFor({ timeout: 60_000 });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await pause(page, 3_000, "PayPilot AI Buyer branding is visible");

  await runDiscovery(page);
  const { checkoutId, purchasePayload } = await startRecommendedPurchase(page);
  const detail = await checkoutDetail(checkoutId);
  if (!(Number(detail.final_amount) <= 6000)) {
    throw new Error(`The recommended success checkout total is ₹${detail.final_amount}, above the ₹6,000 intent.`);
  }
  log(`Success checkout created: ${checkoutId} (₹${Number(detail.final_amount).toFixed(2)}).`);

  await page.getByText("APPROVED", { exact: true }).first().waitFor({ timeout: 60_000 });
  await page.getByText("VALIDATED", { exact: true }).first().waitFor({ timeout: 60_000 });
  await page.getByText("RESERVED", { exact: true }).first().waitFor({ timeout: 60_000 });
  await show(page, "#selection", 5_000, "Selected product and constructed cart are visible");
  await show(page, "section[aria-label='Transaction progress']", 3_000, "Buyer progress has advanced through selection, cart, and checks");
  await show(page, "#checks", 7_000, "Policy APPROVED, Spending Authority VALIDATED, and Inventory RESERVED are visible");
  await page.getByText("CREATED", { exact: true }).first().waitFor({ timeout: 60_000 });
  await show(page, "#payment", 6_000, "Razorpay order evidence is visible");

  const payment = purchasePayload?.payment;
  if (!payment?.order_id || !payment?.key_id) {
    throw new Error("The successful checkout did not return an existing Razorpay payment order.");
  }
  if (payment.key_id === "rzp_test_MOCKMODE") {
    throw new Error(
      "The backend is in Razorpay mock mode. Configure Razorpay test credentials and a webhook endpoint before recording the completed success flow; the automation will not fabricate payment evidence.",
    );
  }

  await page.getByRole("button", { name: "Continue to Razorpay", exact: true }).click();
  log("ACTION REQUIRED: Complete the Razorpay TEST payment in the opened checkout window.");
  log("The recorder is paused and will resume automatically after the verified webhook completes this checkout.");
  await page.getByRole("heading", { name: "Purchase Complete", exact: true }).waitFor({ timeout: paymentTimeoutMs });
  await show(page, "#complete", 6_000, "Verified payment and Purchase Complete are visible");

  const completed = await checkoutDetail(checkoutId);
  if (completed.status !== "COMPLETED") {
    throw new Error(`Checkout ${checkoutId} did not persist as COMPLETED after payment.`);
  }

  await page.getByRole("link", { name: /View transaction in Merchant Control/i }).first().click();
  await page.waitForURL((url) => url.pathname === "/agent-trace" && url.searchParams.get("checkout") === checkoutId, { timeout: 60_000 });
  await page.getByRole("link", { name: "Execution", exact: true }).click();
  await page.getByRole("heading", { name: "Transaction execution", exact: true }).waitFor({ timeout: 60_000 });
  await page.getByText("APPROVED", { exact: true }).first().waitFor({ timeout: 60_000 });
  await page.getByText("VALIDATED", { exact: true }).first().waitFor({ timeout: 60_000 });
  await show(page, "#execution", 8_000, "Merchant Transaction Execution and persisted payment evidence are visible");

  await page.getByRole("link", { name: "Audit Trail", exact: true }).click();
  await page.getByRole("heading", { name: "Audit Trail", exact: true }).waitFor({ timeout: 60_000 });
  await show(page, "#audit-trail", 5_000, "Checkout-scoped Audit Trail evidence is visible");
  const paymentVerifiedEvent = page.getByText("PAYMENT_VERIFIED", { exact: true });
  if (await paymentVerifiedEvent.count()) {
    await paymentVerifiedEvent.first().scrollIntoViewIfNeeded();
    await pause(page, 4_000, "Verified webhook evidence is visible in the Audit Trail");
  }

  return checkoutId;
}

async function runFailureFlow(page) {
  log("Starting the deterministic ₹5,000 Spending Authority rejection flow.");
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.getByRole("heading", { name: "What would you like PayPilot AI to buy?" }).waitFor({ timeout: 60_000 });
  await runDiscovery(page);

  const authorityInput = page.getByLabel("Maximum authorized spend");
  await authorityInput.fill(String(failureAuthority));
  await show(page, "#discovery", 4_000, "Failure setup shows a ₹5,000 delegated Spending Authority");

  const { checkoutId } = await startRecommendedPurchase(page);
  const detail = await checkoutDetail(checkoutId);
  if (!(Number(detail.final_amount) > failureAuthority)) {
    throw new Error(`Failure checkout total ₹${detail.final_amount} does not exceed the ₹${failureAuthority} authority.`);
  }
  log(`Rejected checkout created: ${checkoutId} (₹${Number(detail.final_amount).toFixed(2)} requested / ₹${failureAuthority.toFixed(2)} authorized).`);

  await page.getByRole("heading", { name: "Purchase Blocked", exact: true }).waitFor({ timeout: 60_000 });
  await page.getByText("REJECTED", { exact: true }).first().waitFor({ timeout: 60_000 });
  await page.getByText("NOT RESERVED", { exact: true }).first().waitFor({ timeout: 60_000 });
  await page.getByText("NOT INVOKED", { exact: true }).first().waitFor({ timeout: 60_000 });
  await page.getByText("NOT ATTEMPTED", { exact: true }).first().waitFor({ timeout: 60_000 });
  await show(page, "section[aria-label='Transaction progress']", 4_000, "Buyer progress shows Checks FAILED");
  await show(page, "#checks", 6_000, "Spending Authority REJECTED and Inventory NOT RESERVED are visible");
  await show(page, "#payment", 6_000, "Razorpay NOT INVOKED, Payment NOT ATTEMPTED, and ₹0 moved are visible");
  await show(page, "#complete", 8_000, "Deterministic rejection evidence remains visible");

  const rejected = await checkoutDetail(checkoutId);
  if (rejected.status !== "FAILED" || rejected.razorpay_order_id) {
    throw new Error(`Checkout ${checkoutId} did not persist the expected pre-Razorpay failure state.`);
  }
  await pause(page, 3_000, "PayPilot AI safety outcome outro");
  return checkoutId;
}

const browser = await launchBrowser();
let context;
let video;
let runError;

try {
  context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    screen: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    locale: "en-IN",
    colorScheme: "light",
    recordVideo: {
      dir: recordingDirectory,
      size: { width: 1920, height: 1080 },
    },
  });
  const page = await context.newPage();
  video = page.video();
  page.setDefaultTimeout(60_000);

  await page.route("**/api/agent-commerce/query", (route) => pacedResponse(route, 5_000));
  await page.route("**/api/agent-commerce/purchase", (route) => pacedResponse(route, 5_000));

  const successCheckoutId = await runSuccessFlow(page);
  const failedCheckoutId = await runFailureFlow(page);
  log(`Demo flows complete. Success: ${successCheckoutId}; rejected: ${failedCheckoutId}.`);
} catch (error) {
  runError = error;
  log(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  if (context) await context.close().catch(() => {});
  await browser.close().catch(() => {});
}

if (video) {
  const recordingPath = await video.path().catch(() => null);
  if (recordingPath) log(`Playwright recording saved: ${recordingPath}`);
}

if (runError) {
  process.exitCode = 1;
}
