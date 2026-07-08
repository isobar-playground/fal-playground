// Full run trace detail view (issue #12 / PRD "Run history" story 21, spec section 18
// "Historia runów"). This module holds the one piece of genuinely non-trivial pure logic
// the detail view needs: turning a run's Contract snapshot (lib/maszynka/contract.ts) —
// itself already a snapshot of hook/style/camera setting/global rules/priority logic/
// model capability at whatever versions were selected when the run was created — into a
// flat, display-ready list. Everything else the detail view renders (input assets,
// generated assets, per-stage panels) is a direct 1:1 read of a `MaszynkaRun` field with a
// `null`/`[]` guard, which doesn't earn a pure module of its own; this summarization does,
// because it has to reach through several optional nested fields and decide a human label
// per config kind — exactly the kind of thing that's easy to get subtly wrong for a run
// missing some of them.
//
// A run created before slice 3 (issue's Contract stage) landed has `contract: null` —
// section 18's "wybrane configi"/"wersje configów" rows are simply absent for it, same as
// every other stage this run never reached; see MaszynkaView's SelectedConfigsPanel, which
// renders nothing when this returns `[]`. A run whose Contract exists but couldn't resolve
// a selection (e.g. a hook/style/camera id that no longer exists in the config version it
// referenced — `validateContract` would have already failed that run before it ever left
// `prompt_builder_contract_validation_failed`, but the trace view must still render such a
// contract without crashing since it IS recorded) shows that kind as unresolved rather than
// throwing.
import type { Contract } from "./contract";

export type SelectedConfigKind =
  | "hook"
  | "style"
  | "cameraSetting"
  | "globalRules"
  | "priorityLogic"
  | "modelCapability";

export interface SelectedConfigSummaryItem {
  kind: SelectedConfigKind;
  /** Selected config id — empty string for the two kinds with no per-run selection id
   *  (globalRules/priorityLogic apply wholesale, not by id). */
  id: string;
  version: number;
  /** Human-readable summary of what that version snapshot actually contained. */
  label: string;
  /** False when the id couldn't be resolved against its version's snapshot body (or the
   *  snapshot is otherwise empty) — see module header. */
  resolved: boolean;
}

/** Builds the "selected configs + versions" summary from a run's Contract snapshot.
 *  Returns `[]` for a run that never reached the Contract stage (`contract` is
 *  `null`/`undefined`) — never throws, so it's safe to call for any run regardless of how
 *  far its pipeline got. */
export function summarizeSelectedConfigs(contract: Contract | null | undefined): SelectedConfigSummaryItem[] {
  if (!contract) return [];

  const rulesCount = contract.globalRules?.snapshot?.length ?? 0;
  const layersCount = contract.priorityLogic?.snapshot?.layers?.length ?? 0;

  return [
    {
      kind: "hook",
      id: contract.hook?.id ?? "",
      version: contract.hook?.version ?? 0,
      label: contract.hook?.snapshot?.text ?? "(unresolved)",
      resolved: contract.hook?.snapshot != null,
    },
    {
      kind: "style",
      id: contract.style?.id ?? "",
      version: contract.style?.version ?? 0,
      label: contract.style?.snapshot?.styleName ?? "(unresolved)",
      resolved: contract.style?.snapshot != null,
    },
    {
      kind: "cameraSetting",
      id: contract.cameraSetting?.id ?? "",
      version: contract.cameraSetting?.version ?? 0,
      label: contract.cameraSetting?.snapshot?.cameraSettingName ?? "(unresolved)",
      resolved: contract.cameraSetting?.snapshot != null,
    },
    {
      kind: "globalRules",
      id: "",
      version: contract.globalRules?.version ?? 0,
      label: `${rulesCount} rule${rulesCount === 1 ? "" : "s"}`,
      resolved: rulesCount > 0,
    },
    {
      kind: "priorityLogic",
      id: "",
      version: contract.priorityLogic?.version ?? 0,
      label: `${layersCount} layer${layersCount === 1 ? "" : "s"}`,
      resolved: contract.priorityLogic?.snapshot != null && layersCount > 0,
    },
    {
      kind: "modelCapability",
      id: contract.modelCapability?.modelKey ?? "",
      version: contract.modelCapability?.version ?? 0,
      label: contract.modelCapability?.snapshot?.modelLabel ?? "(unresolved)",
      resolved: contract.modelCapability?.snapshot != null,
    },
  ];
}
