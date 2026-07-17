"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";

function periodOptions() {
  const out = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const dt = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({
      key: `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`,
      label: dt.toLocaleString("en-GB", { month: "long", year: "numeric" }),
    });
  }
  return out;
}

const taskKey = (entity, stageId, i) => `${entity}|${stageId}|${i}`;

export default function Dashboard({ user, stages, entities }) {
  const router = useRouter();
  const periods = useMemo(periodOptions, []);
  const [period, setPeriod] = useState(periods[0].key);
  const [state, setState] = useState({});
  const [filter, setFilter] = useState("all");
  const [open, setOpen] = useState({});
  const [loading, setLoading] = useState(true);

  const totalTasks = useMemo(() => stages.reduce((s, st) => s + st.tasks.length, 0), [stages]);

  const load = useCallback(async (p) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/tasks?period=${encodeURIComponent(p)}`);
      if (res.status === 401) { router.push("/login"); return; }
      const data = await res.json();
      setState(data.state || {});
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { load(period); }, [period, load]);

  // Light polling so the team sees each other's updates without refreshing.
  useEffect(() => {
    const id = setInterval(() => load(period), 15000);
    return () => clearInterval(id);
  }, [period, load]);

  async function toggle(entity, stageId, i) {
    const k = taskKey(entity, stageId, i);
    const next = !state[k]?.done;
    setState((s) => ({ ...s, [k]: next ? { done: true, by: user.name, at: new Date().toISOString() } : undefined }));
    await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ period, taskKey: k, done: next }),
    });
    load(period);
  }

  function entityDone(entity) {
    let n = 0;
    for (const st of stages) for (let i = 0; i < st.tasks.length; i++) if (state[taskKey(entity, st.id, i)]?.done) n++;
    return n;
  }
  function entityStatus(entity) {
    const d = entityDone(entity);
    return d === 0 ? "notstarted" : d === totalTasks ? "done" : "progress";
  }
  function stageRollup(stageId) {
    let n = 0, t = 0;
    const st = stages.find((s) => s.id === stageId);
    for (const e of entities) for (let i = 0; i < st.tasks.length; i++) { t++; if (state[taskKey(e, stageId, i)]?.done) n++; }
    return { n, t };
  }

  const closed = entities.filter((e) => entityStatus(e) === "done").length;
  const allCells = entities.length * totalTasks;
  const doneCells = entities.reduce((s, e) => s + entityDone(e), 0);
  const pct = allCells ? Math.round((doneCells / allCells) * 100) : 0;

  const shown = entities.filter((e) => filter === "all" || entityStatus(e) === filter);
  const dotColor = (st) => (st === "done" ? "var(--green)" : st === "progress" ? "var(--amber)" : "var(--faint)");

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <div style={{ maxWidth: 920, margin: "0 auto", padding: "1.5rem 1.25rem 4rem" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.75rem" }}>
        <div>
          <div style={{ fontSize: 12.5, color: "var(--faint)", letterSpacing: ".05em", textTransform: "uppercase" }}>Finance</div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>Month-end close</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 13.5, color: "var(--muted)" }}>
          <a href="/finance-os" style={{ textDecoration: "none" }}>Finance OS</a>
          <span>{user.name}</span>
          <button onClick={logout} style={{ border: "1px solid var(--line-strong)", background: "var(--surface)", color: "var(--ink)", borderRadius: 8, padding: "6px 12px", fontSize: 13 }}>Sign out</button>
        </div>
      </header>

      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 18 }}>
        <div>
          <div style={{ fontSize: 13, color: "var(--faint)", marginBottom: 2 }}>{periods.find((p) => p.key === period)?.label} close</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontSize: 36, fontWeight: 600, lineHeight: 1 }}>{closed}</span>
            <span style={{ fontSize: 15, color: "var(--muted)" }}>of {entities.length} entities closed</span>
          </div>
        </div>
        <select value={period} onChange={(e) => setPeriod(e.target.value)}
          style={{ height: 38, padding: "0 10px", border: "1px solid var(--line-strong)", borderRadius: 8, background: "var(--surface)", color: "var(--ink)", fontSize: 14 }}>
          {periods.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
      </div>

      <div style={{ height: 6, borderRadius: 99, background: "var(--line)", overflow: "hidden", marginBottom: 22 }}>
        <div style={{ height: "100%", width: `${pct}%`, background: "var(--accent)", transition: "width .35s ease" }} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12, marginBottom: 26 }}>
        {stages.map((st) => {
          const { n, t } = stageRollup(st.id);
          const sp = t ? Math.round((n / t) * 100) : 0;
          return (
            <div key={st.id} style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "12px 14px" }}>
              <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 8 }}>{st.label}</div>
              <div style={{ fontSize: 22, fontWeight: 600, lineHeight: 1 }}>{sp}%</div>
              <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 3 }}>{n} / {t} tasks</div>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>Entities {loading && <span style={{ fontSize: 12, color: "var(--faint)", fontWeight: 400 }}>· syncing…</span>}</div>
        <div style={{ display: "flex", gap: 6 }}>
          {[["all", "All"], ["progress", "In progress"], ["notstarted", "Not started"], ["done", "Closed"]].map(([id, lbl]) => {
            const on = filter === id;
            return (
              <button key={id} onClick={() => setFilter(id)}
                style={{ fontSize: 12.5, padding: "4px 11px", borderRadius: 7, border: `1px solid ${on ? "var(--accent)" : "var(--line)"}`, background: on ? "var(--accent-bg)" : "transparent", color: on ? "var(--accent)" : "var(--muted)" }}>
                {lbl}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {shown.length === 0 && <div style={{ fontSize: 13.5, color: "var(--faint)", padding: "16px 0" }}>No entities in this view.</div>}
        {shown.map((entity) => {
          const done = entityDone(entity);
          const status = entityStatus(entity);
          const isOpen = !!open[entity];
          return (
            <div key={entity} style={{ border: "1px solid var(--line)", borderRadius: "var(--radius)", background: "var(--surface)", overflow: "hidden" }}>
              <button onClick={() => setOpen((o) => ({ ...o, [entity]: !o[entity] }))}
                style={{ width: "100%", border: "none", background: "transparent", display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", textAlign: "left", color: "var(--ink)" }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: dotColor(status), flex: "none" }} />
                <span style={{ fontSize: 14.5, fontWeight: 500, flex: 1 }}>{entity}</span>
                <span style={{ fontSize: 12.5, color: "var(--faint)" }}>{done}/{totalTasks}</span>
                <span style={{ fontSize: 16, color: "var(--faint)", transform: isOpen ? "rotate(180deg)" : "none", transition: "transform .2s" }}>⌄</span>
              </button>
              {isOpen && (
                <div style={{ padding: "2px 16px 14px 34px", borderTop: "1px solid var(--line)" }}>
                  {stages.map((st) => (
                    <div key={st.id} style={{ marginTop: 12 }}>
                      <div style={{ fontSize: 11.5, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--faint)", marginBottom: 5 }}>{st.label}</div>
                      {st.tasks.map((task, i) => {
                        const cell = state[taskKey(entity, st.id, i)];
                        const checked = !!cell?.done;
                        return (
                          <label key={i} style={{ display: "flex", alignItems: "center", gap: 9, padding: "5px 0", cursor: "pointer", fontSize: 13.5 }}>
                            <input type="checkbox" checked={checked} onChange={() => toggle(entity, st.id, i)}
                              style={{ width: 16, height: 16, flex: "none", accentColor: "var(--accent)", cursor: "pointer" }} />
                            <span style={{ color: checked ? "var(--faint)" : "var(--ink)", textDecoration: checked ? "line-through" : "none" }}>{task}</span>
                            {checked && cell?.by && (
                              <span style={{ fontSize: 11.5, color: "var(--faint)", marginLeft: "auto" }}>
                                {cell.by}{cell.at ? ` · ${new Date(cell.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}
                              </span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
