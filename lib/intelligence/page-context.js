import { query } from "../db";

/*
 * The governed page-relationship registry (CR §4.4): each page's primary and
 * related finance domains, plus its contextual suggested questions (CR §13).
 * Held as configuration (migration 038), not hard-coded inside prompts.
 */

export async function getPageRegistry(pageId) {
  const { rows } = await query(
    `SELECT page_id, page_name, route, note
     FROM intelligence.page_context_registry
     WHERE page_id = $1 AND is_active = true`,
    [pageId]
  );
  return rows[0] || null;
}

// Returns { primary: string[], related: string[] } of retrieval-domain ids.
export async function getPageDomains(pageId) {
  const { rows } = await query(
    `SELECT domain, relation
     FROM intelligence.page_relationship
     WHERE page_id = $1 ORDER BY display_order`,
    [pageId]
  );
  return {
    primary: rows.filter((r) => r.relation === "PRIMARY").map((r) => r.domain),
    related: rows.filter((r) => r.relation !== "PRIMARY").map((r) => r.domain),
  };
}

export async function getSuggestedQuestions(pageId) {
  const { rows } = await query(
    `SELECT question FROM intelligence.suggested_question
     WHERE page_id = $1 AND is_active = true ORDER BY display_order`,
    [pageId]
  );
  return rows.map((r) => r.question);
}
