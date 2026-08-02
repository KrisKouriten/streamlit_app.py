/*
 * OTB inventory ingest — pure parsing. No imports, no DB. Turns an uploaded CSV
 * into normalised inventory-position rows so the parsing is unit-tested
 * independently of the database. Unit-tested in tests/inventory-ingest.test.mjs.
 */

// Minimal CSV parse (handles quoted fields + commas within quotes).
export function splitCsvLine(line) {
  const out = []; let cur = ""; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const CHANNEL_ALIAS = {
  "miniso mds": "MINISO_MDS", "miniso": "MINISO_MDS", "mds": "MINISO_MDS", "miniso_mds": "MINISO_MDS",
  "local purchase": "LOCAL_PURCHASE", "local": "LOCAL_PURCHASE", "local_purchase": "LOCAL_PURCHASE",
};
const LOCATION_ALIAS = {
  "store": "STORE", "warehouse": "WAREHOUSE", "wh": "WAREHOUSE",
  "in transit": "IN_TRANSIT", "in-transit": "IN_TRANSIT", "in_transit": "IN_TRANSIT", "transit": "IN_TRANSIT",
};

const numOf = (v) => {
  if (v == null || v === "") return 0;
  const n = Number(String(v).replace(/[£$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

// Parse an inventory CSV into normalised rows. Header row required; columns matched
// case-insensitively. Returns { rows, errors }.
export function parseInventoryCsv(text) {
  const lines = String(text || "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (!lines.length) return { rows: [], errors: ["The file is empty"] };
  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const col = (names) => {
    for (const n of names) { const i = header.indexOf(n); if (i >= 0) return i; }
    return -1;
  };
  const idx = {
    channel: col(["channel", "purchase channel"]),
    location: col(["location", "location type", "location_type"]),
    store: col(["store", "store code", "store_code"]),
    units: col(["units", "units on hand"]),
    value: col(["stock value", "value", "value (£)", "stock_value"]),
    reserved: col(["reserved", "reserved value", "reserved_value"]),
    damaged: col(["damaged", "damaged value", "damaged_value", "quarantined"]),
    confidence: col(["confidence", "arrival confidence"]),
    age: col(["stock age days", "stock_age_days", "age days", "age"]),
    cover: col(["weeks cover", "weeks_cover", "cover"]),
    through: col(["data through", "data_through", "as at", "date"]),
  };
  if (idx.channel < 0 || idx.location < 0) return { rows: [], errors: ["The file needs at least Channel and Location columns"] };
  const rows = []; const errors = [];
  for (let i = 1; i < lines.length; i++) {
    const c = splitCsvLine(lines[i]);
    const channel = CHANNEL_ALIAS[String(c[idx.channel] || "").toLowerCase()];
    const location = LOCATION_ALIAS[String(c[idx.location] || "").toLowerCase()];
    if (!channel) { errors.push(`Row ${i + 1}: unknown channel "${c[idx.channel]}"`); continue; }
    if (!location) { errors.push(`Row ${i + 1}: unknown location "${c[idx.location]}"`); continue; }
    rows.push({
      channel_code: channel, location_type: location,
      store_code: location === "STORE" ? (c[idx.store] || null) : null,
      units: numOf(c[idx.units]), stock_value: numOf(c[idx.value]),
      reserved_value: idx.reserved >= 0 ? numOf(c[idx.reserved]) : 0,
      damaged_value: idx.damaged >= 0 ? numOf(c[idx.damaged]) : 0,
      confidence: idx.confidence >= 0 && c[idx.confidence] !== "" ? Number(c[idx.confidence]) : 1,
      stock_age_days: idx.age >= 0 && c[idx.age] !== "" ? Math.round(numOf(c[idx.age])) : null,
      weeks_cover: idx.cover >= 0 && c[idx.cover] !== "" ? numOf(c[idx.cover]) : null,
      data_through: idx.through >= 0 ? (c[idx.through] || null) : null,
    });
  }
  return { rows, errors };
}
