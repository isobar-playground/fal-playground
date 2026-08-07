// Server-only Neon access for Maszynka configs (ADR 0001 — configs are append-only
// versioned rows, stored server-side so the UX operator can iterate them without a
// developer deploy). Mirrors lib/maszynka/store.ts's shape: schema-on-first-write,
// `getSql()` returns null when DATABASE_URL isn't set so routes can turn that into 503.
import "../neonLocal";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { CONFIG_KINDS, type ConfigKind } from "./configSchemas";
import { CONFIG_SEEDS } from "./configSeeds";
import { nextVersion } from "./configVersion";

export const runtime = "nodejs";

export interface MaszynkaConfigVersion {
  kind: ConfigKind;
  version: number;
  body: unknown;
  createdAt: string;
}

interface ConfigRow {
  kind: string;
  version: number;
  body: unknown;
  created_at: string;
}

function rowToVersion(row: ConfigRow): MaszynkaConfigVersion {
  return { kind: row.kind as ConfigKind, version: row.version, body: row.body, createdAt: row.created_at };
}

/** Thrown when two saves race on the same kind (both computed the same next version).
 *  The route maps this to 409 — the operator's editor should refetch and retry. */
export class ConfigVersionConflictError extends Error {
  constructor(kind: ConfigKind, version: number) {
    super(`Config "${kind}" version ${version} was just created by another save — refresh and retry.`);
    this.name = "ConfigVersionConflictError";
  }
}

function isUniqueViolation(e: unknown): boolean {
  return Boolean(e && typeof e === "object" && "code" in e && (e as { code?: string }).code === "23505");
}

let schemaReady: Promise<void> | null = null;
export function ensureSchema(sql: NeonQueryFunction<false, false>) {
  schemaReady ??= sql`
    CREATE TABLE IF NOT EXISTS maszynka_configs (
      kind       text        NOT NULL,
      version    integer     NOT NULL,
      body       jsonb       NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (kind, version)
    )
  `
    .then(() => undefined)
    .catch((e) => {
      schemaReady = null;
      throw e;
    });
  return schemaReady;
}

// Seeds any config kind that has zero rows with its version-1 seed content (see
// configSeeds.ts). Runs after ensureSchema on every read/write entrypoint below so an
// empty database self-populates on first use without a separate migration step —
// same "created on first write" pattern as ensureSchema / app/api/log-generation.
let seedReady: Promise<void> | null = null;
export function ensureSeeded(sql: NeonQueryFunction<false, false>) {
  seedReady ??= (async () => {
    const rows = await sql`SELECT DISTINCT kind FROM maszynka_configs`;
    const present = new Set(rows.map((r) => r.kind as string));
    const missing = CONFIG_KINDS.filter((k) => !present.has(k));
    for (const kind of missing) {
      // INSERT ... WHERE NOT EXISTS so two concurrent cold-start requests seeding the
      // same kind don't both try to insert version 1 and throw a PK violation.
      await sql`
        INSERT INTO maszynka_configs (kind, version, body)
        SELECT ${kind}, 1, ${JSON.stringify(CONFIG_SEEDS[kind])}::jsonb
        WHERE NOT EXISTS (SELECT 1 FROM maszynka_configs WHERE kind = ${kind})
      `;
    }
  })().catch((e) => {
    seedReady = null;
    throw e;
  });
  return seedReady;
}

export async function ensureReady(sql: NeonQueryFunction<false, false>): Promise<void> {
  await ensureSchema(sql);
  await ensureSeeded(sql);
}

/** Latest version of every config kind — the Configs section's overview list. */
export async function listLatestConfigs(sql: NeonQueryFunction<false, false>): Promise<MaszynkaConfigVersion[]> {
  const rows = await sql`
    SELECT DISTINCT ON (kind) kind, version, body, created_at
    FROM maszynka_configs
    ORDER BY kind, version DESC
  `;
  return (rows as ConfigRow[]).map(rowToVersion);
}

/** Full version history for one kind, oldest first. */
export async function listConfigVersions(
  sql: NeonQueryFunction<false, false>,
  kind: ConfigKind,
): Promise<MaszynkaConfigVersion[]> {
  const rows = await sql`
    SELECT kind, version, body, created_at FROM maszynka_configs
    WHERE kind = ${kind}
    ORDER BY version ASC
  `;
  return (rows as ConfigRow[]).map(rowToVersion);
}

/** Insert a new version for a kind (append-only — never UPDATE). */
export async function insertConfigVersion(
  sql: NeonQueryFunction<false, false>,
  kind: ConfigKind,
  body: unknown,
): Promise<MaszynkaConfigVersion> {
  const existing = await sql`SELECT version FROM maszynka_configs WHERE kind = ${kind}`;
  const version = nextVersion(existing.map((r) => r.version as number));
  try {
    const rows = await sql`
      INSERT INTO maszynka_configs (kind, version, body)
      VALUES (${kind}, ${version}, ${JSON.stringify(body)}::jsonb)
      RETURNING kind, version, body, created_at
    `;
    return rowToVersion(rows[0] as ConfigRow);
  } catch (e) {
    if (isUniqueViolation(e)) throw new ConfigVersionConflictError(kind, version);
    throw e;
  }
}

/** Returns null (not an error) when DATABASE_URL isn't set — callers turn that into 503. */
export function getSql(): NeonQueryFunction<false, false> | null {
  const url = process.env.DATABASE_URL;
  return url ? neon(url) : null;
}
