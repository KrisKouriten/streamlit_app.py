"use client";
import { useRouter } from "next/navigation";

/* Year picker for the Departmental Budget Dashboard. The department is fixed to
   the one the viewer is assigned to (each department sees only its own
   dashboard), so there is no department switcher. Navigates via query params so
   the page stays a server component. */
export default function DeptDashControls({ department, year, years }) {
  const router = useRouter();
  const go = (y) => router.push(`/dashboards/department-budget?dept=${encodeURIComponent(department || "")}&year=${y}`);
  const sel = { fontSize: 13, padding: "7px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)" };
  const lab = { fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--faint)" };
  return (
    <div className="fos-card" style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", padding: "10px 14px", marginBottom: 18 }}>
      <span style={lab}>Department</span>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{department || "—"}</span>
      <span style={lab}>Year</span>
      <select value={year} onChange={(e) => go(e.target.value)} style={sel}>
        {years.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
    </div>
  );
}
