"use client";
import { useEffect, useRef, useState } from "react";

/*
 * DateField — a UK-format (DD/MM/YYYY) date input you can TYPE and freely edit.
 * The browser's native date control edits in fixed day/month/year segments, so a
 * mis-typed digit can't simply be backspaced — you have to select the segment
 * first. This field is a plain text box instead: type, backspace and correct
 * anywhere, with a calendar button beside it for pointer entry. It reports the
 * value to the parent as an ISO yyyy-mm-dd string via onChange, and only when the
 * text parses to a real date (so 31/02/2026 is rejected, not silently accepted).
 */

function isoToUk(iso) {
  if (!iso) return "";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : "";
}

// Parse DD/MM/YYYY → ISO yyyy-mm-dd, or null if not a real date.
export function ukToIso(uk) {
  const m = String(uk || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export default function DateField({ value = "", onChange, disabled = false, inputStyle = {}, placeholder = "DD/MM/YYYY" }) {
  const [text, setText] = useState(isoToUk(value));
  const native = useRef(null);

  // Re-sync when the value changes from outside (e.g. an auto-computed due date).
  useEffect(() => { setText(isoToUk(value)); }, [value]);

  function onText(e) {
    const t = e.target.value;
    setText(t);
    if (t.trim() === "") { onChange && onChange(""); return; }
    const iso = ukToIso(t);
    if (iso) onChange && onChange(iso);
  }
  function onBlur() {
    if (text.trim() === "") return;
    const iso = ukToIso(text);
    if (iso) setText(isoToUk(iso)); // normalise a valid date's formatting
  }
  function onNative(e) {
    const iso = e.target.value; // yyyy-mm-dd
    setText(isoToUk(iso));
    onChange && onChange(iso || "");
  }
  function openPicker() {
    const el = native.current;
    if (!el) return;
    if (typeof el.showPicker === "function") { try { el.showPicker(); return; } catch { /* fall through */ } }
    el.focus();
  }

  const box = {
    display: "inline-flex", alignItems: "stretch", position: "relative",
    border: "1px solid var(--line)", borderRadius: 8, background: "var(--surface)",
    opacity: disabled ? 0.6 : 1, ...inputStyle,
  };
  return (
    <span style={box}>
      <input
        type="text" inputMode="numeric" placeholder={placeholder} value={text} disabled={disabled}
        onChange={onText} onBlur={onBlur}
        style={{ flex: 1, minWidth: 0, fontSize: 13.5, padding: "8px 10px", border: "none", borderRadius: 8, background: "transparent", color: "var(--ink)", outline: "none" }}
      />
      <button type="button" onClick={openPicker} disabled={disabled} aria-label="Open calendar" title="Pick from calendar"
        style={{ border: "none", borderLeft: "1px solid var(--line)", background: "transparent", cursor: disabled ? "default" : "pointer", padding: "0 10px", fontSize: 14, color: "var(--muted)" }}>
        📅
      </button>
      {/* Native picker: visually hidden, anchored bottom-left for showPicker(). */}
      <input
        ref={native} type="date" value={value ? String(value).slice(0, 10) : ""} disabled={disabled}
        onChange={onNative} tabIndex={-1} aria-hidden="true"
        style={{ position: "absolute", left: 8, bottom: 0, width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
      />
    </span>
  );
}
