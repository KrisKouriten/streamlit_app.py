import { NextResponse } from "next/server";
import { query } from "../../../../lib/db";
import { getSession, hasRole } from "../../../../lib/auth";
import { audit } from "../../../../lib/governance";
import { TRANSITIONS, transitionError, generateWeek, escalateOverdue } from "../../../../lib/workflow";

/*
 * Task actions. Body: { action, taskId?, ... }.
 * Status transitions are validated by lib/workflow.transitionError and every
 * change writes task_status_history + governance.audit_event.
 */

async function loadTask(taskId) {
  const { rows } = await query(`SELECT * FROM workflow.task_instance WHERE task_id = $1`, [taskId]);
  return rows[0] || null;
}

async function setStatus(task, toStatus, actor, note) {
  await query(
    `UPDATE workflow.task_instance
     SET status = $1::varchar,
         completed_at = CASE WHEN $1::varchar = 'COMPLETE' AND completed_at IS NULL THEN CURRENT_TIMESTAMP ELSE completed_at END
     WHERE task_id = $2`,
    [toStatus, task.task_id]
  );
  await query(
    `INSERT INTO workflow.task_status_history (task_id, from_status, to_status, changed_by, note)
     VALUES ($1, $2, $3, $4, $5)`,
    [task.task_id, task.status, toStatus, actor.email, note || null]
  );
}

export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const isManager = hasRole(session, "ADMIN", "FINANCE");

  const body = await request.json().catch(() => ({}));
  const { action, taskId } = body;

  try {
    // --- week generation & escalation (manager only) ---------------------
    if (action === "generate-week") {
      if (!isManager) return NextResponse.json({ error: "Manager access required" }, { status: 403 });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(body.weekStart || "")) {
        return NextResponse.json({ error: "weekStart must be a Monday (YYYY-MM-DD)" }, { status: 400 });
      }
      const created = await generateWeek(body.weekStart, session);
      const escalated = await escalateOverdue(session.email);
      return NextResponse.json({ ok: true, created, escalated });
    }

    // --- assignment -------------------------------------------------------
    if (action === "assign") {
      const task = await loadTask(taskId);
      if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
      const targetId = body.userId === null ? null : Number(body.userId);
      const isSelf = targetId === session.id;
      if (!isManager && !isSelf) return NextResponse.json({ error: "You can only assign tasks to yourself" }, { status: 403 });
      if (!isManager && task.assigned_to && task.assigned_to !== session.id) {
        return NextResponse.json({ error: "Task is already assigned — ask a manager to reassign" }, { status: 403 });
      }
      if (["COMPLETE", "CANCELLED", "READY_FOR_REVIEW"].includes(task.status)) {
        return NextResponse.json({ error: `Cannot reassign a task that is ${task.status}` }, { status: 400 });
      }
      const type = targetId === null ? "UNASSIGNED" : task.assigned_to ? "REASSIGNED" : isSelf ? "SELF" : "MANAGER";
      await query(`UPDATE workflow.task_instance SET assigned_to = $1, status = $2 WHERE task_id = $3`,
        [targetId, targetId === null ? "AVAILABLE" : "ASSIGNED", taskId]);
      await query(
        `INSERT INTO workflow.task_assignment (task_id, assigned_to, assigned_by, assignment_type)
         VALUES ($1, $2, $3, $4)`,
        [taskId, targetId, session.email, type]
      );
      await query(
        `INSERT INTO workflow.task_status_history (task_id, from_status, to_status, changed_by, note)
         VALUES ($1, $2, $3, $4, $5)`,
        [taskId, task.status, targetId === null ? "AVAILABLE" : "ASSIGNED", session.email, `assignment: ${type}`]
      );
      await audit({ actor: session, eventType: "workflow.assign", objectType: "task_instance", objectRef: String(taskId), detail: { targetId, type } });
      return NextResponse.json({ ok: true });
    }

    // --- comments & evidence ---------------------------------------------
    if (action === "comment") {
      if (!body.body?.trim()) return NextResponse.json({ error: "Comment cannot be empty" }, { status: 400 });
      await query(`INSERT INTO workflow.task_comment (task_id, author, body) VALUES ($1, $2, $3)`,
        [taskId, session.email, body.body.trim()]);
      return NextResponse.json({ ok: true });
    }
    if (action === "evidence") {
      if (!body.label?.trim()) return NextResponse.json({ error: "Evidence needs a label" }, { status: 400 });
      await query(
        `INSERT INTO workflow.task_evidence (task_id, label, url, note, added_by) VALUES ($1, $2, $3, $4, $5)`,
        [taskId, body.label.trim(), body.url?.trim() || null, body.note?.trim() || null, session.email]
      );
      await audit({ actor: session, eventType: "workflow.evidence", objectType: "task_instance", objectRef: String(taskId), detail: { label: body.label.trim() } });
      return NextResponse.json({ ok: true });
    }

    if (action === "log-time") {
      const mins = Number(body.actualMinutes);
      if (!Number.isFinite(mins) || mins < 0 || mins > 10000) return NextResponse.json({ error: "Invalid minutes" }, { status: 400 });
      await query(`UPDATE workflow.task_instance SET actual_minutes = $1 WHERE task_id = $2`, [Math.round(mins), taskId]);
      return NextResponse.json({ ok: true });
    }

    // --- status transitions ----------------------------------------------
    if (TRANSITIONS[action]) {
      const task = await loadTask(taskId);
      if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

      const err = transitionError(action, task, session);
      if (err) return NextResponse.json({ error: err }, { status: 400 });

      // dependency gate: cannot start until predecessors are complete
      if (action === "start") {
        const { rows: open } = await query(
          `SELECT i.title FROM workflow.task_dependency d
           JOIN workflow.task_instance i ON i.task_id = d.depends_on
           WHERE d.task_id = $1 AND i.status <> 'COMPLETE'`,
          [taskId]
        );
        if (open.length) return NextResponse.json({ error: `Blocked by dependency: ${open[0].title}` }, { status: 400 });
      }
      // evidence gate: submission requires evidence when the task demands it
      if ((action === "submit" || action === "complete") && task.requires_evidence) {
        const { rows: ev } = await query(`SELECT 1 FROM workflow.task_evidence WHERE task_id = $1 LIMIT 1`, [taskId]);
        if (!ev.length) return NextResponse.json({ error: "This task requires evidence before it can be submitted" }, { status: 400 });
      }

      // reviewer decisions are recorded distinctly from the status change
      if (action === "approve" || action === "return") {
        await query(
          `INSERT INTO workflow.task_review (task_id, reviewer, decision, comment) VALUES ($1, $2, $3, $4)`,
          [taskId, session.email, action === "approve" ? "APPROVED" : "RETURNED", body.comment?.trim() || null]
        );
        if (action === "approve") {
          await query(`UPDATE workflow.task_instance SET approved_at = CURRENT_TIMESTAMP WHERE task_id = $1`, [taskId]);
        }
      }

      await setStatus(task, TRANSITIONS[action].to, session, body.comment?.trim());
      await audit({ actor: session, eventType: `workflow.${action}`, objectType: "task_instance", objectRef: String(taskId) });
      return NextResponse.json({ ok: true, status: TRANSITIONS[action].to });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    console.error("workflow/tasks error:", e.message);
    return NextResponse.json({ error: "Could not complete the action" }, { status: 500 });
  }
}
