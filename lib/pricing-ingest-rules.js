/*
 * Pricing upload — pure parsing. No imports, no DB. Turns an uploaded SKU
 * cost-build CSV into normalised pricing.sku_price rows so the parsing is
 * unit-tested independently of the database. Unit-tested in
 * tests/pricing-ingest.test.mjs.
 */

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

// A plain £/number: strips currency + thousands separators.
const numOf = (v) => {
  if (v == null || v === "") return 0;
  const n = Number(String(v).replace(/[£$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

// A percentage/rate as a fraction (0..1): "25%"→0.25, "25"→0.25, "0.25"→0.25.
const pctOf = (v) => {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  const hasPct = s.includes("%");
  const n = Number(s.replace(/[%\s]/g, ""));
  if (!Number.isFinite(n)) return null;
  if (hasPct) return n / 100;
  return n > 1 ? n / 100 : n;
};

// Header → field map. Every header matched case-insensitively; unknown columns ignored.
const FIELD_HEADERS = {
  sku_code: ["sku", "sku code", "sku_code"],
  description: ["description", "product", "product name"],
  category: ["category"], subcategory: ["subcategory", "sub category", "sub-category"],
  brand: ["brand"], supplier: ["supplier"], country: ["country"],
  season: ["season"], range: ["range"], status: ["status"],
  rmb_cost: ["rmb cost", "rmb", "cost rmb", "purchase cost"],
  sea_freight: ["sea freight", "container freight", "sea"],
  air_freight: ["air freight", "air"],
  duty: ["duty"], insurance: ["insurance"], port_charges: ["port charges", "port"],
  customs: ["customs"], other_import: ["other import", "other import costs", "other import cost"],
  goods_in: ["goods in"], goods_out: ["goods out"],
  warehouse_storage: ["warehouse storage", "storage"], warehouse_admin: ["warehouse admin", "admin"],
  handling: ["handling"], other_logistics: ["other logistics", "other distribution"],
  actual_retail_price: ["actual retail price", "actual price", "current price", "sell price", "current sell price"],
  rrp: ["rrp", "recommended retail price"],
  promotional_price: ["promotional price", "promo price"], markdown_price: ["markdown price"],
};
const PCT_HEADERS = {
  discount_pct: ["discount", "discount %"],
  fx_rate: ["fx", "fx rate", "rmb per gbp"], // handled as a plain rate below, not a pct
  wholesale_margin_pct: ["wholesale margin", "wholesale margin %", "wholesale %"],
  distributor_margin_pct: ["distributor margin", "distributor margin %", "distributor %"],
  retail_vat_pct: ["retail vat", "vat", "vat %"],
  target_gp_pct: ["target gp", "target gp %", "target margin"],
};

function findCol(header, names) {
  for (const n of names) { const i = header.indexOf(n); if (i >= 0) return i; }
  return -1;
}

export function parsePricingCsv(text) {
  const lines = String(text || "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (!lines.length) return { rows: [], errors: ["The file is empty"] };
  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const skuIdx = findCol(header, FIELD_HEADERS.sku_code);
  const chIdx = findCol(header, ["channel", "purchase channel"]);
  if (skuIdx < 0 || chIdx < 0) return { rows: [], errors: ["The file needs at least SKU and Channel columns"] };

  const rows = []; const errors = [];
  for (let i = 1; i < lines.length; i++) {
    const c = splitCsvLine(lines[i]);
    const sku = c[skuIdx];
    if (!sku) { errors.push(`Row ${i + 1}: missing SKU`); continue; }
    const channel = CHANNEL_ALIAS[String(c[chIdx] || "").toLowerCase()];
    if (!channel) { errors.push(`Row ${i + 1}: unknown channel "${c[chIdx]}"`); continue; }
    const row = { sku_code: sku, channel_code: channel };
    // Text + number fields
    for (const [field, names] of Object.entries(FIELD_HEADERS)) {
      if (field === "sku_code") continue;
      const idx = findCol(header, names);
      if (idx < 0) continue;
      const raw = c[idx];
      if (raw == null || raw === "") continue;
      const isText = ["description", "category", "subcategory", "brand", "supplier", "country", "season", "range", "status"].includes(field);
      row[field] = isText ? raw : numOf(raw);
    }
    // Percentages / rates
    for (const [field, names] of Object.entries(PCT_HEADERS)) {
      const idx = findCol(header, names);
      if (idx < 0) continue;
      const raw = c[idx];
      if (raw == null || raw === "") continue;
      row[field] = field === "fx_rate" ? numOf(raw) : pctOf(raw);
    }
    rows.push(row);
  }
  return { rows, errors };
}
