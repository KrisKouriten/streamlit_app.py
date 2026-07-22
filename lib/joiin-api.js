/*
 * Joiin Connect API client (Phase 21). Direct server-side integration so the
 * app can refresh from Joiin without a Claude session in the loop.
 *
 * Base https://app-api.joiin.co/v1, auth via the x-api-key header, JSON POST.
 * The key comes from JOIIN_API_KEY (a Vercel/environment secret) — never
 * committed. Endpoints used: report/profit-loss, report/custom-report,
 * companies. Response mapping lives in joiin-api-map.js (pure + tested);
 * this module only does the HTTP.
 */
const BASE = process.env.JOIIN_API_BASE || "https://app-api.joiin.co/v1";

export function joiinConfigured() {
  return !!process.env.JOIIN_API_KEY;
}

async function post(pathname, body) {
  const key = process.env.JOIIN_API_KEY;
  if (!key) throw new Error("JOIIN_API_KEY is not set — add it as an environment secret to enable the Joiin connection.");
  const res = await fetch(`${BASE}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Joiin ${pathname} failed (${res.status}): ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { throw new Error(`Joiin ${pathname} returned non-JSON: ${text.slice(0, 200)}`); }
}

// List companies/groups on the account. Shape is normalised in the mapper.
export async function listCompanies() {
  return post("/company/list", {});
}

// Profit & Loss for a set of companies over a month range (YYYY-MM). The Joiin
// endpoint is /report/profit-loss (per the Connect API docs); companies are
// identified by name, dates are YYYY-MM.
export async function profitAndLoss({ companies, startDate, endDate, currency = "GBP" }) {
  return post("/report/profit-loss", { companies, startDate, endDate, currency });
}

// A saved Custom Report (Layout) by id — returns the P&L already laid out in
// sections exactly as Joiin computes/consolidates it.
export async function customReport({ customReportId, companies, startDate, endDate, currency = "GBP" }) {
  return post("/report/custom-report", { customReportId, companies, startDate, endDate, currency });
}
