"use client";

import { useState } from "react";

/* My Actions & Notes — a private personal workspace on Home. A checkable to-do
   list and free-form notes for duties / reminders. Everything here is scoped to
   the signed-in user on the server; nothing is shared or visible to anyone else.
   State is managed locally and persisted through /api/personal. */

async function post(body) {
  const res = await fetch("/api/personal", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

const cardWrap = { border: "1px solid var(--line)", borderRadius: 12, background: "var(--surface)", padding: "16px 18px", display: "flex", flexDirection: "column", minHeight: 0 };
const heading = { fontFamily: "var(--mono)", fontSize: 10.5, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--faint)" };
const inputStyle = { flex: 1, height: 34, fontSize: 13.5, padding: "0 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--card)", color: "var(--ink)" };
const addBtn = { fontSize: 12.5, fontWeight: 600, padding: "0 14px", height: 34, borderRadius: 8, border: "1px solid var(--accent)", background: "var(--accent)", color: "var(--on-accent,#fff)", cursor: "pointer" };
const iconBtn = { appearance: "none", background: "none", border: "none", cursor: "pointer", color: "var(--faint)", fontSize: 13, padding: "2px 6px", lineHeight: 1 };

export default function MyActionsNotes({ initialNotes = [], initialTodos = [] }) {
  const [todos, setTodos] = useState(initialTodos);
  const [notes, setNotes] = useState(initialNotes);
  const [err, setErr] = useState("");
  const fail = (x) => setErr(x.message || "Something went wrong");

  return (
    <section style={{ margin: "8px 0 26px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 13 }}>
        <span style={{ fontSize: 16, fontWeight: 650 }}>My Actions &amp; Notes</span>
        <span style={{ fontSize: 11.5, color: "var(--faint)" }}>· your private to-do list &amp; notes — only you can see this</span>
      </div>
      {err && <div style={{ fontSize: 12.5, color: "var(--red)", marginBottom: 10 }}>{err}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 16, alignItems: "start" }}>
        <TodoList todos={todos} setTodos={setTodos} fail={fail} clearErr={() => setErr("")} />
        <Notes notes={notes} setNotes={setNotes} fail={fail} clearErr={() => setErr("")} />
      </div>
    </section>
  );
}

function TodoList({ todos, setTodos, fail, clearErr }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const openCount = todos.filter((t) => !t.done).length;
  const doneCount = todos.length - openCount;

  async function add(e) {
    e.preventDefault();
    const body = text.trim();
    if (!body || busy) return;
    clearErr(); setBusy(true);
    try { const { todo } = await post({ action: "addTodo", body }); setTodos((xs) => [todo, ...xs]); setText(""); }
    catch (x) { fail(x); } finally { setBusy(false); }
  }
  async function toggle(t) {
    clearErr();
    try {
      const { todo } = await post({ action: "setTodoDone", id: t.todo_id, done: !t.done });
      setTodos((xs) => xs.map((x) => (x.todo_id === t.todo_id ? todo : x)).sort((a, b) => (a.done === b.done ? 0 : a.done ? 1 : -1)));
    } catch (x) { fail(x); }
  }
  async function remove(t) {
    clearErr();
    try { await post({ action: "deleteTodo", id: t.todo_id }); setTodos((xs) => xs.filter((x) => x.todo_id !== t.todo_id)); }
    catch (x) { fail(x); }
  }
  async function clearDone() {
    clearErr();
    try { await post({ action: "clearDone" }); setTodos((xs) => xs.filter((x) => !x.done)); }
    catch (x) { fail(x); }
  }

  return (
    <div style={cardWrap}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={heading}>To-do list</span>
        <span style={{ fontSize: 11, color: "var(--faint)" }}>{openCount} open{doneCount ? ` · ${doneCount} done` : ""}</span>
      </div>
      <form onSubmit={add} style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a task…" style={inputStyle} maxLength={4000} aria-label="Add a task" />
        <button type="submit" disabled={busy || !text.trim()} style={{ ...addBtn, opacity: busy || !text.trim() ? 0.6 : 1 }}>Add</button>
      </form>
      {todos.length === 0 ? (
        <div style={{ fontSize: 12.5, color: "var(--faint)", padding: "6px 0" }}>No tasks yet — add one above.</div>
      ) : (
        <div>
          {todos.map((t) => (
            <div key={t.todo_id} className="fos-row-hover" style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--hairline)" }}>
              <input type="checkbox" checked={t.done} onChange={() => toggle(t)} style={{ marginTop: 2, accentColor: "var(--accent)", cursor: "pointer" }} aria-label={`Mark "${t.body}" ${t.done ? "not done" : "done"}`} />
              <span style={{ flex: 1, fontSize: 13.5, lineHeight: 1.45, color: t.done ? "var(--faint)" : "var(--ink)", textDecoration: t.done ? "line-through" : "none", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{t.body}</span>
              <button onClick={() => remove(t)} style={iconBtn} title="Delete" aria-label="Delete task">✕</button>
            </div>
          ))}
          {doneCount > 0 && (
            <button onClick={clearDone} style={{ ...iconBtn, marginTop: 10, fontSize: 11.5, color: "var(--muted)" }}>Clear {doneCount} completed</button>
          )}
        </div>
      )}
    </div>
  );
}

function Notes({ notes, setNotes, fail, clearErr }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editText, setEditText] = useState("");

  async function add() {
    const body = text.trim();
    if (!body || busy) return;
    clearErr(); setBusy(true);
    try { const { note } = await post({ action: "addNote", body }); setNotes((xs) => [note, ...xs]); setText(""); }
    catch (x) { fail(x); } finally { setBusy(false); }
  }
  async function saveEdit(n) {
    const body = editText.trim();
    if (!body) return;
    clearErr();
    try {
      const { note } = await post({ action: "updateNote", id: n.note_id, body });
      setNotes((xs) => xs.map((x) => (x.note_id === n.note_id ? note : x)));
      setEditId(null);
    } catch (x) { fail(x); }
  }
  async function remove(n) {
    clearErr();
    try { await post({ action: "deleteNote", id: n.note_id }); setNotes((xs) => xs.filter((x) => x.note_id !== n.note_id)); }
    catch (x) { fail(x); }
  }

  return (
    <div style={cardWrap}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={heading}>Notes</span>
        <span style={{ fontSize: 11, color: "var(--faint)" }}>{notes.length || "no"} note{notes.length === 1 ? "" : "s"}</span>
      </div>
      <div style={{ marginBottom: 12 }}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Jot down a duty, reminder or note…" rows={2}
          style={{ width: "100%", fontSize: 13.5, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--card)", color: "var(--ink)", resize: "vertical", fontFamily: "inherit", lineHeight: 1.45 }} maxLength={4000} aria-label="New note" />
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
          <button onClick={add} disabled={busy || !text.trim()} style={{ ...addBtn, opacity: busy || !text.trim() ? 0.6 : 1 }}>Add note</button>
        </div>
      </div>
      {notes.length === 0 ? (
        <div style={{ fontSize: 12.5, color: "var(--faint)", padding: "6px 0" }}>No notes yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {notes.map((n) => (
            <div key={n.note_id} className="fos-row-hover" style={{ border: "1px solid var(--hairline)", borderRadius: 8, padding: "10px 12px", background: "var(--card)" }}>
              {editId === n.note_id ? (
                <>
                  <textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={3}
                    style={{ width: "100%", fontSize: 13, padding: "6px 8px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)", resize: "vertical", fontFamily: "inherit" }} maxLength={4000} />
                  <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 6 }}>
                    <button onClick={() => setEditId(null)} style={iconBtn}>Cancel</button>
                    <button onClick={() => saveEdit(n)} style={{ ...iconBtn, color: "var(--accent)", fontWeight: 600 }}>Save</button>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 13.5, lineHeight: 1.5, color: "var(--ink)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{n.body}</div>
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 6 }}>
                    <button onClick={() => { setEditId(n.note_id); setEditText(n.body); }} style={iconBtn} title="Edit">Edit</button>
                    <button onClick={() => remove(n)} style={iconBtn} title="Delete">Delete</button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
