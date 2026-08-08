"use client";

/* A money-amount input that shows comma thousands separators as you type
   (e.g. 5,000,000) while storing a clean, comma-free number string. It drops
   into existing forms unchanged: onChange fires with a synthetic
   { target: { value } } carrying the raw number, so handlers written for a
   plain <input> (e.g. onChange={set("amount")}) keep working. Any extra props
   (style, className, placeholder, required, disabled…) pass straight through. */

// "5000000" → "5,000,000"; keeps decimals and a trailing "." while typing.
export function groupThousands(v) {
  if (v == null || v === "") return "";
  const s = String(v).replace(/,/g, "");
  const neg = s.startsWith("-") ? "-" : "";
  const clean = s.replace(/[^0-9.]/g, "");
  const [intPart, ...rest] = clean.split(".");
  const grouped = (intPart || "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const dec = rest.length ? "." + rest.join("") : (clean.endsWith(".") ? "." : "");
  return neg + grouped + dec;
}

export default function MoneyInput({ value, onChange, ...rest }) {
  return (
    <input
      type="text"
      inputMode="decimal"
      {...rest}
      value={groupThousands(value)}
      onChange={(e) => {
        const raw = e.target.value.replace(/,/g, "");
        if (raw === "" || /^\d*\.?\d*$/.test(raw)) onChange?.({ target: { value: raw } });
      }}
    />
  );
}
