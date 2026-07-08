// Pure version-increment logic for append-only config storage (ADR 0001: "every save
// inserts a new row with an incremented version, never UPDATE"). Split out from
// configStore.ts so it's testable without a database — see config.check.ts.
export function nextVersion(existingVersions: number[]): number {
  return existingVersions.length === 0 ? 1 : Math.max(...existingVersions) + 1;
}
