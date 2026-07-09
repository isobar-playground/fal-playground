"use client";

// Dedicated structured form for the `stage_prompts` Config kind (issue #23 — the PRD's
// last slice; stories 19-28). Deliberately NOT a `ConfigItemFormDef` registered in
// CONFIG_FORM_DEFS (lib/maszynka/configFormDefs.ts): that model exists for a kind whose
// body is an array of interchangeable, id-keyed items (Hooks, Styles, ... — see that
// file's header). `stage_prompts`' body (StagePromptsConfig, configSchemas.ts) is the
// opposite shape — a single fixed-shape record with five named sub-sections, one of which
// (`assetAnalysis`) itself has shared base + per-role sub-fields, another (`promptBuilder`)
// has a main prompt + a less-prominent revision template. There's no list to add/remove/
// reorder items from, so this component just renders the five sections directly and
// reports the whole edited record back up via `onChange` — the parent shell
// (app/MaszynkaConfigs.tsx) still owns loading versions, the form/raw-JSON toggle, and
// the actual "Save as new version" call, exactly like every other Config kind.
//
// Restore (PRD stories 27-28 / ADR 0001 follow-up decision) is the one stage_prompts-only
// feature this component adds beyond a plain field editor: each section has its own
// "Restore from…" control scoped to that one slot (lib/maszynka/stagePromptRestore.ts),
// so recovering an old Prompt reviewer prompt can't accidentally revert an in-progress
// edit to Content safety sitting in the same draft. The restore-candidate list (which
// historical versions actually parse as a valid `stage_prompts` body) is computed exactly
// once here and passed down to every section, rather than each section's own restore
// control re-validating the whole (append-only, ever-growing) version history itself.
import { useMemo, useState } from "react";
import type { StagePromptsConfig } from "@/lib/maszynka/configSchemas";
import type { MaszynkaConfigVersion } from "@/lib/maszynka/configApi";
import { ASSET_ROLES, type AssetRole } from "@/lib/maszynka/contract";
import {
  parseValidStagePromptsBody,
  restoreStagePromptSlot,
  stagePromptSlotLabel,
  type StagePromptSlot,
} from "@/lib/maszynka/stagePromptRestore";
import { FIELD_CLASS, LABEL_CLASS } from "./MaszynkaConfigItemForm";

const ASSET_ROLE_LABELS: Record<AssetRole, string> = {
  packshot: "Packshot",
  style_reference: "Style reference",
  brand_reference: "Brand reference",
  campaign_reference: "Campaign reference",
};

type RestoreCandidate = { version: MaszynkaConfigVersion; parsed: StagePromptsConfig };

/** One slot's "Restore from…" control: a version picker plus a Restore button, scoped to
 *  exactly the slot it's rendered under. Selecting a version doesn't do anything by
 *  itself — only clicking Restore stages that slot's historical content into the current
 *  draft (still not saved until the operator hits the shell's "Save as new version"). */
function RestoreControl({
  candidates,
  onRestore,
}: {
  candidates: RestoreCandidate[];
  onRestore: (historical: StagePromptsConfig) => void;
}) {
  const [selected, setSelected] = useState("");

  if (candidates.length === 0) return null;
  const chosen = candidates.find((c) => String(c.version.version) === selected);

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <select
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        className="rounded-lg border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-600 outline-none focus:border-amber-400"
      >
        <option value="">Restore from…</option>
        {candidates.map(({ version }) => (
          <option key={version.version} value={version.version}>
            v{version.version} — {new Date(version.createdAt).toLocaleString()}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={!chosen}
        onClick={() => {
          if (!chosen) return;
          onRestore(chosen.parsed);
          setSelected("");
        }}
        title="Copies only this section's prompt content into the current draft — nothing else changes, and history is never overwritten."
        className="shrink-0 rounded-lg border border-neutral-300 px-2 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Restore
      </button>
    </div>
  );
}

function Section({
  title,
  hint,
  slot,
  candidates,
  onRestore,
  children,
}: {
  title: string;
  hint?: string;
  slot: StagePromptSlot;
  candidates: RestoreCandidate[];
  onRestore: (slot: StagePromptSlot, historical: StagePromptsConfig) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 p-3">
      <h3 className="text-sm font-semibold text-neutral-700">{title}</h3>
      {hint && <p className="mt-0.5 text-[11px] text-neutral-500">{hint}</p>}
      <div className="mt-2 space-y-3">{children}</div>
      <RestoreControl candidates={candidates} onRestore={(historical) => onRestore(slot, historical)} />
    </div>
  );
}

/** The three slots that are nothing more than a single `{ systemPrompt: string }` field
 *  (contentSafety, promptImprovement, promptReviewer — configSchemas.ts) render through
 *  this one parameterized section instead of three near-identical copy-pasted blocks.
 *  `assetAnalysis` (base + per-role instructions) and `promptBuilder` (main prompt +
 *  revision template) are genuinely different shapes and stay as bespoke sections below. */
type SimplePromptSlot = "contentSafety" | "promptImprovement" | "promptReviewer";

function SimplePromptSection({
  slot,
  hint,
  rows,
  value,
  onChange,
  candidates,
  onRestore,
}: {
  slot: SimplePromptSlot;
  hint: string;
  rows: number;
  value: StagePromptsConfig;
  onChange: (next: StagePromptsConfig) => void;
  candidates: RestoreCandidate[];
  onRestore: (slot: StagePromptSlot, historical: StagePromptsConfig) => void;
}) {
  return (
    <Section title={stagePromptSlotLabel(slot)} hint={hint} slot={slot} candidates={candidates} onRestore={onRestore}>
      <div>
        <label className={LABEL_CLASS}>System prompt</label>
        <textarea
          value={value[slot].systemPrompt}
          onChange={(e) => onChange({ ...value, [slot]: { systemPrompt: e.target.value } })}
          rows={rows}
          className={`${FIELD_CLASS} resize-y font-mono`}
        />
      </div>
    </Section>
  );
}

export default function StagePromptsForm({
  value,
  onChange,
  versions,
}: {
  value: StagePromptsConfig;
  onChange: (next: StagePromptsConfig) => void;
  versions: MaszynkaConfigVersion[];
}) {
  // Computed once per `versions` change (not once per section) — five sections sharing
  // this one list means a save that appends one new version re-validates history once,
  // not five times over.
  const candidates = useMemo(
    () =>
      [...versions]
        .reverse() // newest first: the operator is almost always after "the version just before this went wrong"
        .map((version) => ({ version, parsed: parseValidStagePromptsBody(version.body) }))
        .filter((c): c is RestoreCandidate => c.parsed !== null),
    [versions],
  );

  const handleRestore = (slot: StagePromptSlot, historical: StagePromptsConfig) => {
    onChange(restoreStagePromptSlot(value, historical, slot));
  };

  return (
    <div className="space-y-3">
      <SimplePromptSection
        slot="contentSafety"
        hint="Runs FIRST, before Asset analysis and before any FAL generation call — its verdict overrides every other layer (PRD story 21)."
        rows={8}
        value={value}
        onChange={onChange}
        candidates={candidates}
        onRestore={handleRestore}
      />

      <Section
        title={stagePromptSlotLabel("assetAnalysis")}
        hint="Shared base instructions, plus one instruction block per Asset role (PRD story 22)."
        slot="assetAnalysis"
        candidates={candidates}
        onRestore={handleRestore}
      >
        <div>
          <label className={LABEL_CLASS}>Base instructions</label>
          <textarea
            value={value.assetAnalysis.baseInstructions}
            onChange={(e) =>
              onChange({ ...value, assetAnalysis: { ...value.assetAnalysis, baseInstructions: e.target.value } })
            }
            rows={5}
            className={`${FIELD_CLASS} resize-y font-mono`}
          />
        </div>
        <div className="space-y-3 border-l-2 border-neutral-200 pl-3">
          {ASSET_ROLES.map((role) => (
            <div key={role}>
              <label className={LABEL_CLASS}>{ASSET_ROLE_LABELS[role]} instructions</label>
              <textarea
                value={value.assetAnalysis.roleInstructions[role]}
                onChange={(e) =>
                  onChange({
                    ...value,
                    assetAnalysis: {
                      ...value.assetAnalysis,
                      roleInstructions: { ...value.assetAnalysis.roleInstructions, [role]: e.target.value },
                    },
                  })
                }
                rows={4}
                className={`${FIELD_CLASS} resize-y font-mono`}
              />
            </div>
          ))}
        </div>
      </Section>

      <SimplePromptSection
        slot="promptImprovement"
        hint="Rewrites the operator's raw creative prompt — a proposal only, never applied without explicit accept (PRD story 23)."
        rows={6}
        value={value}
        onChange={onChange}
        candidates={candidates}
        onRestore={handleRestore}
      />

      <Section
        title={stagePromptSlotLabel("promptBuilder")}
        hint="Turns the Contract into finalPrompt/negativePrompt (PRD story 24)."
        slot="promptBuilder"
        candidates={candidates}
        onRestore={handleRestore}
      >
        <div>
          <label className={LABEL_CLASS}>System prompt</label>
          <textarea
            value={value.promptBuilder.systemPrompt}
            onChange={(e) =>
              onChange({ ...value, promptBuilder: { ...value.promptBuilder, systemPrompt: e.target.value } })
            }
            rows={8}
            className={`${FIELD_CLASS} resize-y font-mono`}
          />
        </div>
        {/* Less prominent than the main system prompt above (PRD story 25) — collapsed by
            default behind a <details> disclosure rather than always-open. */}
        <details className="rounded-lg bg-neutral-50 px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-neutral-500">
            Revision instruction template (used for the one allowed rebuild after Prompt
            reviewer asks for revise)
          </summary>
          <textarea
            value={value.promptBuilder.revisionInstructionTemplate}
            onChange={(e) =>
              onChange({
                ...value,
                promptBuilder: { ...value.promptBuilder, revisionInstructionTemplate: e.target.value },
              })
            }
            rows={3}
            className={`${FIELD_CLASS} mt-2 resize-y font-mono text-xs`}
          />
        </details>
      </Section>

      <SimplePromptSection
        slot="promptReviewer"
        hint="Gates the Prompt builder's output before FAL generation — pass, revise, or failed (PRD story 26)."
        rows={8}
        value={value}
        onChange={onChange}
        candidates={candidates}
        onRestore={handleRestore}
      />
    </div>
  );
}
