import { query } from "./db";
import { audit } from "./governance";
import { STATUSES, TRANSITIONS, transitionError } from "./workflow-rules.js";

export { STATUSES, TRANSITIONS, transitionError };

/*
 * Weekly Finance Schedule engine.
 *
 * Controlled statuses and who may move a task between them. Completion and
 * reviewer approval are separate events: an assignee can only take a task to
 * READY_FOR_REVIEW (or COMPLETE when the template doesn't require review);
 * only a reviewer decision moves READY_FOR_REVIEW to COMPLETE or RETURNED.
 */

const mondayOf = (d) => {
  const dt = new Date(d + "T00:00:00Z");
  return new Date(dt.getTime() - (((dt.getUTCDay() + 6) % 7) * 86400000)).toISOString().slice(0, 10);
};

// ---------------------------------------------------------------- generation
// Create dated instances for a week from active templates. Idempotent via the
// (template_id, due_date) unique constraint. Also escalates overdue criticals.
export async function generateWeek(weekStartIso, actor) {
  const { rows } = await query(
    `INSERT INTO workflow.task_instance
       (template_id, title, description, week_start, due_date, priority, status,
        assigned_to, reviewer_id, est_minutes, entity_id, store_id, sop_url,
        dashboard_code, requires_review, requires_evidence)
     SELECT t.template_id, t.title, t.description, $1::date,
            CASE WHEN t.frequency = 'WEEKLY'
                 THEN $1::date + t.due_weekday
                 ELSE date_trunc('month', $1::date)::date + (t.due_day - 1) END,
            t.priority,
            CASE WHEN t.default_assignee IS NULL THEN 'AVAILABLE' ELSE 'ASSIGNED' END,
            t.default_assignee, t.default_reviewer, t.est_minutes, t.entity_id, t.store_id,
            t.sop_url, t.dashboard_code, t.requires_review, t.requires_evidence
     FROM workflow.task_template t
     WHERE t.is_active
       AND (t.frequency = 'WEEKLY'
            OR (t.frequency = 'MONTHLY'
                AND date_trunc('month', $1::date)::date + (t.due_day - 1)
                    BETWEEN $1::date AND $1::date + 6))
     ON CONFLICT (template_id, due_date) DO NOTHING
     RETURNING task_id, title, status`,
    [weekStartIso]
  );
  for (const r of rows) {
    await query(
      `INSERT INTO workflow.task_status_history (task_id, from_status, to_status, changed_by, note)
       VALUES ($1, NULL, $2, $3, 'generated from template')`,
      [r.task_id, r.status, actor.email]
    );
  }
  await audit({ actor, eventType: "workflow.generate", objectType: "task_instance", objectRef: weekStartIso, detail: { created: rows.length } });
  return rows.length;
}

// Escalate overdue tasks (any active status past due). Critical ones surface first in UI.
export async function escalateOverdue(actorEmail = "system") {
  const { rows } = await query(
    `UPDATE workflow.task_instance
     SET status = 'OVERDUE'
     WHERE due_date < CURRENT_DATE
       AND status IN ('AVAILABLE','ASSIGNED','IN_PROGRESS','WAITING_FOR_INFORMATION','RETURNED')
     RETURNING task_id, status`
  );
  for (const r of rows) {
    await query(
      `INSERT INTO workflow.task_status_history (task_id, from_status, to_status, changed_by, note)
       VALUES ($1, NULL, 'OVERDUE', $2, 'automatic escalation: past due date')`,
      [r.task_id, actorEmail]
    );
  }
  return rows.length;
}

// ---------------------------------------------------------------- queries
const TASK_SELECT = `
  SELECT i.*, u.name AS assignee_name, rv.name AS reviewer_name,
         t.frequency, st.store_name, e.entity_name
  FROM workflow.task_instance i
  LEFT JOIN public.users u ON u.id = i.assigned_to
  LEFT JOIN public.users rv ON rv.id = i.reviewer_id
  LEFT JOIN workflow.task_template t ON t.template_id = i.template_id
  LEFT JOIN core.dim_store st ON st.store_id = i.store_id
  LEFT JOIN core.dim_entity e ON e.entity_id = i.entity_id`;

export async function getWeekTasks(weekStartIso, { userId = null } = {}) {
  const { rows } = await query(
    `${TASK_SELECT}
     WHERE i.week_start = $1 ${userId ? "AND (i.assigned_to = $2 OR (i.assigned_to IS NULL AND i.status = 'AVAILABLE'))" : ""}
     ORDER BY CASE i.status WHEN 'OVERDUE' THEN 0 ELSE 1 END,
              i.due_date, CASE i.priority WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END`,
    userId ? [weekStartIso, userId] : [weekStartIso]
  );
  return rows;
}

export async function getTask(taskId) {
  const [task, history, comments, evidence, reviews, deps] = await Promise.all([
    query(`${TASK_SELECT} WHERE i.task_id = $1`, [taskId]),
    query(`SELECT * FROM workflow.task_status_history WHERE task_id = $1 ORDER BY changed_at`, [taskId]),
    query(`SELECT * FROM workflow.task_comment WHERE task_id = $1 ORDER BY created_at`, [taskId]),
    query(`SELECT * FROM workflow.task_evidence WHERE task_id = $1 ORDER BY added_at`, [taskId]),
    query(`SELECT * FROM workflow.task_review WHERE task_id = $1 ORDER BY decided_at`, [taskId]),
    query(
      `SELECT d.depends_on, i.title, i.status FROM workflow.task_dependency d
       JOIN workflow.task_instance i ON i.task_id = d.depends_on WHERE d.task_id = $1`,
      [taskId]
    ),
  ]);
  if (!task.rows.length) return null;
  return { ...task.rows[0], history: history.rows, comments: comments.rows, evidence: evidence.rows, reviews: reviews.rows, dependencies: deps.rows };
}

export async function getReviewQueue(reviewerId, isManager) {
  const { rows } = await query(
    `${TASK_SELECT}
     WHERE i.status = 'READY_FOR_REVIEW'
       AND (${isManager ? "true" : "i.reviewer_id = $1"})
     ORDER BY i.due_date`,
    isManager ? [] : [reviewerId]
  );
  return rows;
}

export async function getTeamWeek(weekStartIso) {
  const [tasks, capacity] = await Promise.all([
    getWeekTasks(weekStartIso),
    query(
      `SELECT u.id AS user_id, u.name, COALESCE(c.weekly_hours, 37.5) AS weekly_hours
       FROM public.users u
       LEFT JOIN workflow.team_capacity c ON c.user_id = u.id
       WHERE u.is_active ORDER BY u.name`
    ),
  ]);
  return { tasks, capacity: capacity.rows };
}

export async function getWeekStats(weekStartIso) {
  const { rows } = await query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE status = 'COMPLETE')::int AS complete,
            count(*) FILTER (WHERE status = 'OVERDUE')::int AS overdue,
            count(*) FILTER (WHERE status = 'READY_FOR_REVIEW')::int AS awaiting_review,
            count(*) FILTER (WHERE status = 'BLOCKED')::int AS blocked
     FROM workflow.task_instance WHERE week_start = $1 AND status <> 'CANCELLED'`,
    [weekStartIso]
  );
  return rows[0];
}

export async function listTemplates() {
  const { rows } = await query(
    `SELECT t.*, u.name AS default_assignee_name FROM workflow.task_template t
     LEFT JOIN public.users u ON u.id = t.default_assignee
     ORDER BY t.frequency, t.due_weekday NULLS LAST, t.title`
  );
  return rows;
}

export { mondayOf };
