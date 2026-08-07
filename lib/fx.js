import { query } from "./db";
import { audit } from "./governance";
import { FX_RATE_TYPE_KEYS, FX_CURRENCIES, validRate } from "./fx-rules.js";

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
  const ccy = String(currency || "").toUpperCase();
  const rt = String(rate_type || "").toUpperCase();
  if (!FX_CURRENCIES.includes(ccy)) throw new Error(`Unsupported currency ${ccy}`);
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
