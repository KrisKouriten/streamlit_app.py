import { query } from "./db";
import { audit } from "./governance";
import { FX_RATE_TYPE_KEYS, isValidCcyCode, normaliseCcy, validRate } from "./fx-rules.js";

const tableMissing = (e) => e?.code === "42P01" || e?.code === "42703";

// The USD→GBP rate table (SPOT / HEDGED / COSTING). Degrades to an empty list
// before migration 085 is run so callers can treat "no rates" gracefully.
export async function getFxRates() {
  try {
    const { rows } = await query(
      `SELECT currency, rate_type, rate, note, updated_by, updated_at FROM finance.fx_rate ORDER BY currency, rate_type`
    );
    return rows;
  } catch (e) {
    if (tableMissing(e)) return [];
    throw e;
  }
}

// Set one currency×rate-type rate. Finance-only (enforced at the API).
export async function setFxRate({ currency, rate_type, rate, note }, actor) {
  const ccy = normaliseCcy(currency);
  const rt = String(rate_type || "").toUpperCase();
  if (!isValidCcyCode(ccy)) throw new Error(`"${currency}" is not a currency code — use three letters, e.g. EUR. GBP needs no rate.`);
  if (!FX_RATE_TYPE_KEYS.includes(rt)) throw new Error(`Unknown rate type ${rt}`);
  const r = validRate(rate);
  if (r == null) throw new Error("Rate must be a positive number (foreign units per £1)");
  await query(
    `INSERT INTO finance.fx_rate (currency, rate_type, rate, note, updated_by)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (currency, rate_type) DO UPDATE SET rate = EXCLUDED.rate, note = EXCLUDED.note, updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP`,
    [ccy, rt, r, (note || "").trim() || null, actor]
  );
  await audit({ actor, eventType: "fx.rate.set", objectType: "fx_rate", objectRef: `${ccy}·${rt}`, detail: { rate: r } });
  return { ok: true };
}

/*
 * Put a currency on the rate desk: one row per rate type, with no rate yet.
 *
 * Rates are left NULL rather than seeded with a placeholder. A placeholder is a
 * number, and a number gets used — findRate would hand it to a conversion and
 * the desk would report a confident figure struck at something nobody chose.
 * Null reads as "not set", which is what it is, and every reader already
 * degrades on a missing rate rather than guessing.
 */
export async function addFxCurrency(currency, actor) {
  const ccy = normaliseCcy(currency);
  if (!isValidCcyCode(ccy)) throw new Error(`"${currency}" is not a currency code — use three letters, e.g. EUR. GBP needs no rate.`);
  const existing = await getFxRates();
  if (existing.some((r) => normaliseCcy(r.currency) === ccy)) throw new Error(`${ccy} is already on the rate desk.`);
  for (const rt of FX_RATE_TYPE_KEYS) {
    await query(
      `INSERT INTO finance.fx_rate (currency, rate_type, rate, note, updated_by)
       VALUES ($1,$2,NULL,NULL,$3) ON CONFLICT (currency, rate_type) DO NOTHING`,
      [ccy, rt, actor]);
  }
  await audit({ actor, eventType: "fx.currency.add", objectType: "fx_rate", objectRef: ccy, detail: { rateTypes: FX_RATE_TYPE_KEYS } });
  return { ok: true, currency: ccy };
}

/*
 * Take a currency off the desk. Refused while anything is priced in it, because
 * removing the rate would not remove the orders — it would leave them unvaluable
 * and reporting nil, which is the failure mode this codebase keeps having to fix.
 */
export async function removeFxCurrency(currency, actor) {
  const ccy = normaliseCcy(currency);
  if (!isValidCcyCode(ccy)) throw new Error(`"${currency}" is not a currency code.`);
  const inUse = await query(
    `SELECT count(*)::int AS n FROM finance.procurement_purchase WHERE upper(currency) = $1`, [ccy]
  ).then((r) => r.rows[0]?.n || 0).catch(() => 0);
  if (inUse) throw new Error(`${ccy} is used by ${inUse} purchase${inUse === 1 ? "" : "s"} — removing its rate would leave ${inUse === 1 ? "it" : "them"} unvaluable.`);
  await query(`DELETE FROM finance.fx_rate WHERE currency = $1`, [ccy]);
  await audit({ actor, eventType: "fx.currency.remove", objectType: "fx_rate", objectRef: ccy, detail: {} });
  return { ok: true, currency: ccy };
}
