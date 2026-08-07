// Pure row↔run mapping for Maszynka Video runs (Video run — CONTEXT.md "Maszynka
// Video"), split from store.ts so the `.check.ts` self-check can run under plain
// `node` (store.ts pulls in the Neon driver via an extensionless import node can't
// resolve). The Video run field list lives here; store.ts owns the DDL and SQL.

export interface VideoRun {
  id: string;
  createdAt: string;
  updatedAt: string;
  /** Operator-facing name for finding the run in the shared history (PRD 0003 story 4). */
  name: string;
  /** Pasted verbatim by the operator — the app never authors this content (PRD 0003). */
  globalRules: string;
  priorityLogic: string;
}

export interface VideoRunRow {
  id: string;
  created_at: string;
  updated_at: string;
  name: string;
  global_rules: string | null;
  priority_logic: string | null;
}

export function rowToVideoRun(row: VideoRunRow): VideoRun {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    name: row.name,
    globalRules: row.global_rules ?? "",
    priorityLogic: row.priority_logic ?? "",
  };
}
