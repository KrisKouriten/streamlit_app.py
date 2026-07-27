import { query } from "../db";

/*
 * Corporate Reporting Centre — template reads. The five corporate templates and
 * their default section structure are seeded in migration 045; this layer reads
 * them for the template cards and the creation wizard. Degrades to
 * { ready:false } before the migration is applied (42P01), matching the
 * codebase convention.
 */

const tableMissing = (e) => e?.code === "42P01";

export async function listTemplates() {
  try {
    const { rows } = await query(
      `SELECT t.template_id, t.template_key, t.name, t.purpose, t.audience, t.frequency,
              t.classification, t.default_confidentiality, t.default_ai, t.is_active,
              (SELECT count(*)::int FROM finance.report_template_section s WHERE s.template_id = t.template_id) AS section_count,
              (SELECT max(created_at) FROM finance.report_instance i WHERE i.template_key = t.template_key) AS last_generated
       FROM finance.report_template t
       WHERE t.is_active
       ORDER BY t.template_id`
    );
    return { ready: true, templates: rows };
  } catch (e) {
    if (tableMissing(e)) return { ready: false, templates: [] };
    throw e;
  }
}

export async function getTemplate(templateKey) {
  try {
    const { rows } = await query(
      `SELECT template_id, template_key, name, purpose, audience, frequency, classification,
              default_confidentiality, default_ai
       FROM finance.report_template WHERE template_key = $1 AND is_active`,
      [templateKey]
    );
    const template = rows[0] || null;
    if (!template) return null;
    const { rows: sections } = await query(
      `SELECT section_id, section_key, title, purpose, position, mandatory,
              default_source_key, default_ai_perspective, default_page_type, default_layout
       FROM finance.report_template_section WHERE template_id = $1 ORDER BY position`,
      [template.template_id]
    );
    return { ...template, sections };
  } catch (e) {
    if (tableMissing(e)) return null;
    throw e;
  }
}
