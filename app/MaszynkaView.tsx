"use client";

// Maszynka — Content Factory test bench. Slice 1 was the walking skeleton: a raw prompt
// + one packshot upload went straight to a FAL model. Issue #6 replaces that single
// upload with four role-specific fields (packshot/style_reference/brand_reference/
// campaign_reference — spec section 3, CONTEXT.md "Asset role") and adds the Asset
// analysis LLM stage that runs on every uploaded asset before the Contract is
// assembled. Every run is created and updated server-side in Neon (ADR 0001) so run
// history is shared across browsers/operators — see docs/prd/0001-maszynka-test-bench.md.
import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { DEFAULT_SETTINGS, MODELS, MODEL_BY_KEY, MODEL_GROUPS, buildInput, type ModelSettings } from "@/lib/models";
import { configureFal, runModel, uploadReference } from "@/lib/fal";
import { createRun, getRun, listRuns, patchRun, type MaszynkaRun, type RunAsset } from "@/lib/maszynka/api";
import { classifyFalError } from "@/lib/maszynka/status";
import { assembleContract, validateContract, type AssetRole, type ContractAsset } from "@/lib/maszynka/contract";
import {
  ASSET_ANALYSIS_MODELS,
  ASSET_ANALYSIS_MODEL_GROUPS,
  DEFAULT_ASSET_ANALYSIS_MODEL,
  buildAssetAnalysisRequestBody,
  callAssetAnalysis,
  parseAssetAnalysisContent,
  type AssetAnalysisRecord,
} from "@/lib/maszynka/assetAnalysis";
import {
  DEFAULT_PROMPT_BUILDER_MODEL,
  PROMPT_BUILDER_MODELS,
  PROMPT_BUILDER_MODEL_GROUPS,
  buildPromptBuilderRequestBody,
  callPromptBuilder,
  parsePromptBuilderContent,
  type PromptBuilderAttemptRecord,
  type PromptBuilderOutput,
} from "@/lib/maszynka/promptBuilder";
import {
  DEFAULT_PROMPT_REVIEWER_MODEL,
  PROMPT_REVIEWER_MODELS,
  PROMPT_REVIEWER_MODEL_GROUPS,
  buildPromptReviewerRequestBody,
  callPromptReviewer,
  parsePromptReviewerContent,
  type PromptReviewerAttemptRecord,
  type PromptReviewerOutput,
} from "@/lib/maszynka/promptReviewer";
import { listLatestConfigs, type MaszynkaConfigVersion } from "@/lib/maszynka/configApi";
import type {
  CameraSettingConfig,
  ConfigKind,
  GlobalRuleConfig,
  HookConfig,
  ModelCapabilityEntry,
  PriorityLogicConfig,
  StyleConfig,
} from "@/lib/maszynka/configSchemas";
import { useImageLightbox } from "./ImageLightbox";
import MaszynkaConfigs from "./MaszynkaConfigs";

const ASPECT_RATIO_OPTIONS = ["1:1", "4:5", "9:16", "16:9", "3:4"];

// fal.ai's ApiError sets `message` from the response body's `.message` field, which
// validation errors (422, `{ detail: [...] }`) don't have — so `e.message` is often
// empty for exactly the failures an operator most needs explained. Fall back to the
// structured `.detail`/`.body` fal actually sent so `fal_generation_failed` runs carry
// a readable reason instead of a blank error field.
function errMsg(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  const body = (e as { body?: unknown } | null)?.body;
  if (body && typeof body === "object") {
    const detail = (body as { detail?: unknown }).detail;
    if (Array.isArray(detail)) {
      const parts = detail
        .map((d) => (d && typeof d === "object" && "msg" in d ? String((d as { msg: unknown }).msg) : null))
        .filter((s): s is string => Boolean(s));
      if (parts.length) return parts.join("; ");
    }
    try {
      return JSON.stringify(body);
    } catch {
      /* fall through */
    }
  }
  if (e instanceof Error) return e.name || "Unknown error";
  return typeof e === "string" ? e : "Unknown error";
}

/** One of the four role-specific upload fields' client-side state (issue #6). `id` is
 *  generated once at file-selection time and carried through as the asset's stable id
 *  on the run (see RunAsset / ContractAsset) — the analysis stage and debug preview both
 *  key off it. */
interface AssetUpload {
  id: string;
  file: File;
  previewUrl: string;
  uploadedUrl?: string;
  uploading?: boolean;
  error?: string;
}

/** The four upload fields, in the order the spec lists them (section 2/3). The role
 *  comes from which field an asset was dropped into, never from operator prose —
 *  CONTEXT.md "Asset role". */
const ASSET_ROLE_META: { role: AssetRole; label: string; hint: string }[] = [
  { role: "packshot", label: "Packshot", hint: "product to preserve — packaging, color, proportions, logo, label, variant" },
  { role: "style_reference", label: "Style reference", hint: "optional — visual look, mood, lighting" },
  { role: "brand_reference", label: "Brand reference", hint: "optional — brand elements, palette, key visual" },
  { role: "campaign_reference", label: "Campaign reference", hint: "optional — series rhythm/consistency" },
];

const STATUS_TONE: Record<string, string> = {
  run_started: "bg-neutral-100 text-neutral-600",
  asset_analysis_completed: "bg-amber-100 text-amber-800",
  asset_analysis_failed: "bg-red-100 text-red-700",
  prompt_builder_contract_created: "bg-amber-100 text-amber-800",
  prompt_builder_contract_validation_failed: "bg-red-100 text-red-700",
  prompt_builder_completed: "bg-amber-100 text-amber-800",
  prompt_builder_output_validation_failed: "bg-red-100 text-red-700",
  prompt_reviewer_passed: "bg-amber-100 text-amber-800",
  prompt_reviewer_revise_required: "bg-amber-100 text-amber-800",
  prompt_build_failed: "bg-red-100 text-red-700",
  fal_generation_started: "bg-amber-100 text-amber-800",
  generation_completed: "bg-green-100 text-green-700",
  fal_generation_failed: "bg-red-100 text-red-700",
  provider_policy_blocked: "bg-red-100 text-red-700",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_TONE[status] ?? "bg-neutral-100 text-neutral-600"}`}>
      {status}
    </span>
  );
}

export default function MaszynkaView({
  apiKey,
  setApiKey,
  orKey,
  setOrKey,
  prompt,
  setPrompt,
}: {
  apiKey: string;
  setApiKey: Dispatch<SetStateAction<string>>;
  /** OpenRouter BYOK key (same one Chat tab uses, "chat:orKey" in localStorage) — the
   *  Prompt builder LLM stage (slice 4) calls OpenRouter through it. */
  orKey: string;
  setOrKey: Dispatch<SetStateAction<string>>;
  prompt: string;
  setPrompt: (next: string | ((p: string) => string)) => void;
}) {
  const [showKey, setShowKey] = useState(false);
  const [showOrKey, setShowOrKey] = useState(false);
  const [assetUploads, setAssetUploads] = useState<Partial<Record<AssetRole, AssetUpload>>>({});
  const [modelKey, setModelKey] = useState<string>("nano-banana");
  const model = MODEL_BY_KEY[modelKey] ?? MODELS[0];
  // Asset analysis stage (issue #6): the operator's OpenRouter model for that stage,
  // recorded on the run at creation — see lib/maszynka/assetAnalysis.ts.
  const [assetAnalysisModel, setAssetAnalysisModel] = useState<string>(DEFAULT_ASSET_ANALYSIS_MODEL);
  // Prompt builder stage (slice 4): the operator's OpenRouter model for that stage,
  // recorded on the run at creation — see lib/maszynka/promptBuilder.ts.
  const [promptBuilderModel, setPromptBuilderModel] = useState<string>(DEFAULT_PROMPT_BUILDER_MODEL);
  // Prompt reviewer stage (slice 5): the operator's OpenRouter model for that stage,
  // recorded on the run at creation — see lib/maszynka/promptReviewer.ts.
  const [promptReviewerModel, setPromptReviewerModel] = useState<string>(DEFAULT_PROMPT_REVIEWER_MODEL);

  const [running, setRunning] = useState(false);
  const [logLine, setLogLine] = useState<string>("");
  const [currentRun, setCurrentRun] = useState<MaszynkaRun | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const [history, setHistory] = useState<MaszynkaRun[]>([]);
  const [historyState, setHistoryState] = useState<"idle" | "loading" | "error">("idle");
  const lightbox = useImageLightbox();

  const refreshHistory = useCallback(() => {
    setHistoryState("loading");
    listRuns(50)
      .then((runs) => {
        setHistory(runs);
        setHistoryState("idle");
      })
      .catch(() => setHistoryState("error"));
  }, []);
  useEffect(() => refreshHistory(), [refreshHistory]);

  // --- Creative config (slice 3): hook/style/camera setting/language/aspect/variants,
  // fed from Neon config storage (never hardcoded) — see lib/maszynka/contract.ts.
  const [configs, setConfigs] = useState<Partial<Record<ConfigKind, MaszynkaConfigVersion>>>({});
  const [configsState, setConfigsState] = useState<"idle" | "loading" | "error">("loading");
  const [configsError, setConfigsError] = useState<string | null>(null);

  useEffect(() => {
    setConfigsState("loading");
    listLatestConfigs()
      .then((list) => {
        setConfigs(Object.fromEntries(list.map((c) => [c.kind, c])));
        setConfigsState("idle");
      })
      .catch((e) => {
        setConfigsState("error");
        setConfigsError(errMsg(e));
      });
  }, []);

  const hooks = (configs.hooks?.body as HookConfig[] | undefined) ?? [];
  const styles = (configs.styles?.body as StyleConfig[] | undefined) ?? [];
  const cameraSettings = (configs.camera_settings?.body as CameraSettingConfig[] | undefined) ?? [];

  const [selectedHookId, setSelectedHookId] = useState("");
  const [selectedStyleId, setSelectedStyleId] = useState("");
  const [selectedCameraSettingId, setSelectedCameraSettingId] = useState("");
  const [targetLanguage, setTargetLanguage] = useState("Polish");
  const [aspectRatio, setAspectRatio] = useState(ASPECT_RATIO_OPTIONS[0]);
  const [variantsCount, setVariantsCount] = useState(1);

  // Default each dropdown to the first available option once its config loads, so a
  // fresh Run is usable without the operator having to touch every field.
  useEffect(() => {
    if (!selectedHookId && hooks.length) setSelectedHookId(hooks[0].id);
  }, [hooks, selectedHookId]);
  useEffect(() => {
    if (!selectedStyleId && styles.length) setSelectedStyleId(styles[0].styleId);
  }, [styles, selectedStyleId]);
  useEffect(() => {
    if (!selectedCameraSettingId && cameraSettings.length) setSelectedCameraSettingId(cameraSettings[0].cameraSettingId);
  }, [cameraSettings, selectedCameraSettingId]);

  // Eager-upload every asset as soon as it's picked, mirroring the Images-tab reference
  // pattern (upload cost is paid once, not on every Run click) — generalized from
  // slice 1's single packshot effect to all four role-specific fields (issue #6).
  useEffect(() => {
    if (!apiKey) return;
    const pending = ASSET_ROLE_META.filter(({ role }) => {
      const u = assetUploads[role];
      return u && !u.uploadedUrl && !u.uploading && !u.error;
    });
    if (!pending.length) return;
    configureFal(apiKey);
    for (const { role } of pending) {
      const upload = assetUploads[role]!;
      setAssetUploads((prev) => {
        const cur = prev[role];
        if (!cur || cur.id !== upload.id) return prev;
        return { ...prev, [role]: { ...cur, uploading: true } };
      });
      uploadReference(upload.file)
        .then((url) =>
          setAssetUploads((prev) => {
            const cur = prev[role];
            if (!cur || cur.id !== upload.id) return prev;
            return { ...prev, [role]: { ...cur, uploadedUrl: url, uploading: false } };
          }),
        )
        .catch((e) =>
          setAssetUploads((prev) => {
            const cur = prev[role];
            if (!cur || cur.id !== upload.id) return prev;
            return { ...prev, [role]: { ...cur, uploading: false, error: errMsg(e) } };
          }),
        );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    apiKey,
    assetUploads.packshot?.id,
    assetUploads.style_reference?.id,
    assetUploads.brand_reference?.id,
    assetUploads.campaign_reference?.id,
  ]);

  const setAssetFile = useCallback((role: AssetRole, file: File) => {
    if (!file.type.startsWith("image/")) return;
    setAssetUploads((prev) => {
      const old = prev[role];
      if (old) URL.revokeObjectURL(old.previewUrl);
      return { ...prev, [role]: { id: crypto.randomUUID(), file, previewUrl: URL.createObjectURL(file) } };
    });
  }, []);
  const clearAsset = useCallback((role: AssetRole) => {
    setAssetUploads((prev) => {
      const old = prev[role];
      if (old) URL.revokeObjectURL(old.previewUrl);
      const next = { ...prev };
      delete next[role];
      return next;
    });
  }, []);

  const anyAssetUploading = ASSET_ROLE_META.some(({ role }) => assetUploads[role]?.uploading);
  const canRun =
    Boolean(apiKey) &&
    Boolean(orKey) &&
    prompt.trim().length > 0 &&
    !running &&
    !anyAssetUploading &&
    configsState === "idle" &&
    Boolean(selectedHookId) &&
    Boolean(selectedStyleId) &&
    Boolean(selectedCameraSettingId) &&
    Boolean(targetLanguage.trim()) &&
    Boolean(aspectRatio);

  const handleRun = useCallback(async () => {
    if (!canRun) return;
    setRunning(true);
    setRunError(null);
    setLogLine("");
    const promptText = prompt.trim();

    try {
      configureFal(apiKey);

      // Resolve every uploaded asset's URL — eager-uploaded already, but this also
      // covers the race where the operator clicks Run before the upload effect
      // finishes. Issue #6 replaces slice 1's single packshot upload with these four
      // role-specific, all-optional fields (spec section 3).
      const runAssets: RunAsset[] = [];
      for (const { role } of ASSET_ROLE_META) {
        const upload = assetUploads[role];
        if (!upload) continue;
        const url = upload.uploadedUrl ?? (await uploadReference(upload.file));
        runAssets.push({ id: upload.id, role, url });
      }

      const run = await createRun({
        assetType: "image",
        userPromptRaw: promptText,
        modelKey: model.key,
        modelId: model.id,
        modelLabel: model.label,
        assets: runAssets,
        assetAnalysisModel,
        promptBuilderModel,
        promptReviewerModel,
      });
      setCurrentRun(run);
      refreshHistory();

      // --- Asset analysis stage (issue #6): one OpenRouter call per uploaded asset,
      // run before the Contract is assembled — the Contract needs every asset's
      // analysis output (see lib/maszynka/contract.ts's `ContractAsset.analysis` and
      // status.ts's ALLOWED_NEXT). A run with zero uploaded assets completes this
      // stage trivially (there is simply nothing to analyze). Any single asset's
      // analysis failing (network error, invalid JSON, schema violation) ends the
      // whole run at `asset_analysis_failed` — there is no revise loop for this stage,
      // unlike the Prompt builder/reviewer pair.
      const assetAnalysisRecords: AssetAnalysisRecord[] = [];
      let assetAnalysisFailure: string | null = null;
      for (const asset of runAssets) {
        const analysisRequest = buildAssetAnalysisRequestBody(asset, assetAnalysisModel);
        try {
          const { raw: analysisResponse, content } = await callAssetAnalysis(orKey, analysisRequest);
          const { output, errors: analysisErrors } = parseAssetAnalysisContent(content);
          assetAnalysisRecords.push({
            assetId: asset.id,
            role: asset.role,
            url: asset.url,
            request: analysisRequest,
            response: analysisResponse,
            output,
            ...(output ? {} : { errors: analysisErrors }),
          });
          if (!output) {
            assetAnalysisFailure = `${asset.role}: ${analysisErrors.join("; ")}`;
            break; // one bad asset stops the whole stage — never reach the Contract
          }
        } catch (e) {
          assetAnalysisRecords.push({
            assetId: asset.id,
            role: asset.role,
            url: asset.url,
            request: analysisRequest,
            response: null,
            output: null,
            errors: [errMsg(e)],
          });
          assetAnalysisFailure = `${asset.role}: ${errMsg(e)}`;
          break;
        }
      }

      if (assetAnalysisFailure) {
        const failed = await patchRun(run.id, {
          status: "asset_analysis_failed",
          assetAnalysisResults: assetAnalysisRecords,
          detail: assetAnalysisFailure,
          error: assetAnalysisFailure,
        });
        setCurrentRun(failed);
        return; // a failed asset analysis must never reach the Contract or a builder call
      }

      const withAnalysis = await patchRun(run.id, {
        status: "asset_analysis_completed",
        assetAnalysisResults: assetAnalysisRecords,
      });
      setCurrentRun(withAnalysis);

      const analysisByAssetId = new Map(assetAnalysisRecords.map((r) => [r.assetId, r.output]));
      const contractAssets: ContractAsset[] = runAssets.map((a) => ({
        id: a.id,
        role: a.role,
        url: a.url,
        analysis: analysisByAssetId.get(a.id) ?? null,
      }));

      // --- Prompt builder contract (slice 3): assemble + validate before any builder or
      // FAL call. A contract that fails validation ends the run right here — see PRD
      // section 9 and lib/maszynka/contract.ts.
      const contract = assembleContract({
        userPromptRaw: promptText,
        assets: contractAssets,
        hooks: { version: configs.hooks?.version ?? 0, body: hooks },
        selectedHookId,
        styles: { version: configs.styles?.version ?? 0, body: styles },
        selectedStyleId,
        cameraSettings: { version: configs.camera_settings?.version ?? 0, body: cameraSettings },
        selectedCameraSettingId,
        globalRules: {
          version: configs.global_rules?.version ?? 0,
          body: (configs.global_rules?.body as GlobalRuleConfig[] | undefined) ?? [],
        },
        priorityLogic: {
          version: configs.priority_logic?.version ?? 0,
          body: (configs.priority_logic?.body as PriorityLogicConfig | undefined) ?? { layers: [] },
        },
        modelCapabilityMatrix: {
          version: configs.model_capability_matrix?.version ?? 0,
          body: (configs.model_capability_matrix?.body as ModelCapabilityEntry[] | undefined) ?? [],
        },
        modelKey: model.key,
        targetLanguage: targetLanguage.trim(),
        aspectRatio,
        variantsCount,
      });
      const contractErrors = validateContract(contract);

      if (contractErrors.length) {
        const failed = await patchRun(run.id, {
          status: "prompt_builder_contract_validation_failed",
          contract,
          detail: contractErrors.join("; "),
          error: contractErrors.join("; "),
        });
        setCurrentRun(failed);
        return; // an invalid contract must never reach a builder or FAL call
      }

      const withContract = await patchRun(run.id, { status: "prompt_builder_contract_created", contract });
      setCurrentRun(withContract);

      // --- Prompt builder LLM stage (slice 4) + Prompt reviewer gate (slice 5). A
      // Contract that fails the builder call or comes back schema-invalid ends the run
      // right here (prompt_builder_output_validation_failed). A builder output that
      // clears the Contract must still clear the reviewer: `pass` proceeds to
      // generation, `revise` triggers exactly one more builder attempt with the
      // reviewer's issues + instruction folded in, and if that second attempt still
      // doesn't pass, the run ends at `prompt_build_failed`. See
      // lib/maszynka/promptBuilder.ts, lib/maszynka/promptReviewer.ts and PRD section
      // 9/11/14.
      const runBuilderAttempt = async (
        attempt: 1 | 2,
        revision?: Parameters<typeof buildPromptBuilderRequestBody>[2],
      ): Promise<PromptBuilderOutput | null> => {
        const builderRequest = buildPromptBuilderRequestBody(contract, promptBuilderModel, revision);
        try {
          const { raw: builderResponse, content } = await callPromptBuilder(orKey, builderRequest);
          const { output, errors: builderErrors } = parsePromptBuilderContent(content);
          const attemptRecord: PromptBuilderAttemptRecord = {
            attempt,
            request: builderRequest,
            response: builderResponse,
            output,
            ...(output ? {} : { errors: builderErrors }),
          };
          if (!output) {
            const failed = await patchRun(run.id, {
              status: "prompt_builder_output_validation_failed",
              promptBuilderRequest: builderRequest,
              promptBuilderResponse: builderResponse,
              promptBuilderAttempt: attemptRecord,
              detail: builderErrors.join("; "),
              error: builderErrors.join("; "),
            });
            setCurrentRun(failed);
            return null; // invalid builder output must never reach the reviewer or FAL
          }
          const withBuilder = await patchRun(run.id, {
            status: "prompt_builder_completed",
            promptBuilderRequest: builderRequest,
            promptBuilderResponse: builderResponse,
            promptBuilderOutput: output,
            promptBuilderAttempt: attemptRecord,
          });
          setCurrentRun(withBuilder);
          return output;
        } catch (e) {
          const attemptRecord: PromptBuilderAttemptRecord = {
            attempt,
            request: builderRequest,
            response: null,
            output: null,
            errors: [errMsg(e)],
          };
          const failed = await patchRun(run.id, {
            status: "prompt_builder_output_validation_failed",
            promptBuilderRequest: builderRequest,
            promptBuilderAttempt: attemptRecord,
            error: errMsg(e),
            detail: errMsg(e),
          });
          setCurrentRun(failed);
          return null; // the builder call itself failed (network/auth/etc.) — never reach FAL
        }
      };

      // Runs the reviewer once. Returns null (and ends the run at prompt_build_failed
      // itself) when the reviewer call/response is unusable — there's no verdict to act
      // on in that case. Returns the parsed verdict otherwise so the caller — which
      // knows the attempt number and hence the one-rebuild rule — decides what run
      // status follows a `pass`/`revise`/`failed` verdict.
      const runReviewerAttempt = async (
        attempt: 1 | 2,
        builderOutput: PromptBuilderOutput,
      ): Promise<{ output: PromptReviewerOutput; request: unknown; response: unknown } | null> => {
        const reviewerRequest = buildPromptReviewerRequestBody(contract, builderOutput, promptReviewerModel);
        try {
          const { raw: reviewerResponse, content } = await callPromptReviewer(orKey, reviewerRequest);
          const { output, errors: reviewerErrors } = parsePromptReviewerContent(content);
          if (!output) {
            const attemptRecord: PromptReviewerAttemptRecord = {
              attempt,
              request: reviewerRequest,
              response: reviewerResponse,
              output: null,
              errors: reviewerErrors,
            };
            const failed = await patchRun(run.id, {
              status: "prompt_build_failed",
              promptReviewerAttempt: attemptRecord,
              detail: reviewerErrors.join("; "),
              error: reviewerErrors.join("; "),
            });
            setCurrentRun(failed);
            return null;
          }
          return { output, request: reviewerRequest, response: reviewerResponse };
        } catch (e) {
          const attemptRecord: PromptReviewerAttemptRecord = {
            attempt,
            request: reviewerRequest,
            response: null,
            output: null,
            errors: [errMsg(e)],
          };
          const failed = await patchRun(run.id, {
            status: "prompt_build_failed",
            promptReviewerAttempt: attemptRecord,
            error: errMsg(e),
            detail: errMsg(e),
          });
          setCurrentRun(failed);
          return null;
        }
      };

      const attempt1Output = await runBuilderAttempt(1);
      if (!attempt1Output) return;

      const review1 = await runReviewerAttempt(1, attempt1Output);
      if (!review1) return; // reviewer call itself failed — run already ended at prompt_build_failed

      let finalBuilderOutput: PromptBuilderOutput;

      if (review1.output.status === "pass") {
        const attemptRecord: PromptReviewerAttemptRecord = {
          attempt: 1,
          request: review1.request,
          response: review1.response,
          output: review1.output,
        };
        const passed = await patchRun(run.id, { status: "prompt_reviewer_passed", promptReviewerAttempt: attemptRecord });
        setCurrentRun(passed);
        finalBuilderOutput = attempt1Output;
      } else if (review1.output.status === "revise") {
        const attemptRecord: PromptReviewerAttemptRecord = {
          attempt: 1,
          request: review1.request,
          response: review1.response,
          output: review1.output,
        };
        const revising = await patchRun(run.id, {
          status: "prompt_reviewer_revise_required",
          promptReviewerAttempt: attemptRecord,
          detail: review1.output.revisionInstruction || review1.output.issues.join("; "),
        });
        setCurrentRun(revising);

        const attempt2Output = await runBuilderAttempt(2, {
          previousOutput: attempt1Output,
          reviewerIssues: review1.output.issues,
          revisionInstruction: review1.output.revisionInstruction,
        });
        if (!attempt2Output) return; // the one allowed rebuild itself failed — run already ended

        const review2 = await runReviewerAttempt(2, attempt2Output);
        if (!review2) return; // reviewer call itself failed on the retry — run already ended

        const attempt2Record: PromptReviewerAttemptRecord = {
          attempt: 2,
          request: review2.request,
          response: review2.response,
          output: review2.output,
        };
        if (review2.output.status === "pass") {
          const passed = await patchRun(run.id, { status: "prompt_reviewer_passed", promptReviewerAttempt: attempt2Record });
          setCurrentRun(passed);
          finalBuilderOutput = attempt2Output;
        } else {
          // The one allowed rebuild is spent — a second `revise` or `failed` verdict
          // both end the run the same way; there is no third attempt (PRD section 11:
          // "W MVP wystarczy maksymalnie jedna poprawka").
          const failed = await patchRun(run.id, {
            status: "prompt_build_failed",
            promptReviewerAttempt: attempt2Record,
            detail: review2.output.issues.join("; ") || "Prompt reviewer rejected the revised prompt.",
            error: review2.output.issues.join("; ") || "Prompt reviewer rejected the revised prompt.",
          });
          setCurrentRun(failed);
          return;
        }
      } else {
        // status === "failed" on the very first attempt: the reviewer judged this
        // unrecoverable (e.g. a safety violation) — no rebuild is worth spending.
        const attemptRecord: PromptReviewerAttemptRecord = {
          attempt: 1,
          request: review1.request,
          response: review1.response,
          output: review1.output,
        };
        const failed = await patchRun(run.id, {
          status: "prompt_build_failed",
          promptReviewerAttempt: attemptRecord,
          detail: review1.output.issues.join("; ") || "Prompt reviewer rejected the prompt.",
          error: review1.output.issues.join("; ") || "Prompt reviewer rejected the prompt.",
        });
        setCurrentRun(failed);
        return;
      }

      // finalPrompt (not the raw operator prompt) drives FAL generation from here on —
      // see PRD section 14 and the "Generation now sends finalPrompt" acceptance
      // criterion. The FAL request mapper (a later issue) will decide how to fold
      // multiple assets in; for now, same as slice 1, only the packshot (if any) is
      // sent as an image input — it's the one role that needs pixel-level preservation.
      const packshotAsset = runAssets.find((a) => a.role === "packshot");
      const imageUrls = packshotAsset ? [packshotAsset.url] : [];
      const settings: ModelSettings = { ...DEFAULT_SETTINGS, numImages: variantsCount, aspectRatio };
      const input = buildInput(model, finalBuilderOutput.finalPrompt, imageUrls, settings);

      const started = await patchRun(run.id, { status: "fal_generation_started", falRequest: input });
      setCurrentRun(started);

      try {
        const { images, raw } = await runModel(model, input, (line) => setLogLine(line));
        const done = await patchRun(run.id, {
          status: "generation_completed",
          falResponse: raw,
          outputs: images,
        });
        setCurrentRun(done);
      } catch (e) {
        const status = classifyFalError(e);
        const failed = await patchRun(run.id, { status, error: errMsg(e) });
        setCurrentRun(failed);
      }
    } catch (e) {
      setRunError(errMsg(e));
    } finally {
      setRunning(false);
      setLogLine("");
      refreshHistory();
    }
  }, [
    canRun,
    apiKey,
    orKey,
    assetUploads,
    model,
    prompt,
    refreshHistory,
    configs,
    hooks,
    styles,
    cameraSettings,
    selectedHookId,
    selectedStyleId,
    selectedCameraSettingId,
    targetLanguage,
    aspectRatio,
    variantsCount,
    assetAnalysisModel,
    promptBuilderModel,
    promptReviewerModel,
  ]);

  const openRun = useCallback(async (id: string) => {
    try {
      const run = await getRun(id);
      setCurrentRun(run);
      setRunError(null);
    } catch (e) {
      alert("Failed to load run:\n" + errMsg(e));
    }
  }, []);

  const packshotNote =
    assetUploads.packshot && model.mode !== "edit"
      ? `“${model.label}” is a generate model — it won't use the packshot. Pick an edit model to preserve it.`
      : undefined;

  return (
    <div className="mx-auto max-w-3xl px-4 pb-16 pt-8">
      <section className="mb-5 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 font-semibold">Fal.ai key</h2>
        <div className="flex gap-2">
          <input
            type={showKey ? "text" : "password"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="e.g. 4a1b2c3d-...:e5f6..."
            className="flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 font-mono text-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
          />
          <button
            type="button"
            onClick={() => setShowKey((s) => !s)}
            className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm hover:bg-neutral-50"
          >
            {showKey ? "Hide" : "Show"}
          </button>
        </div>
      </section>

      <section className="mb-5 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 font-semibold">OpenRouter key</h2>
        <div className="flex gap-2">
          <input
            type={showOrKey ? "text" : "password"}
            value={orKey}
            onChange={(e) => setOrKey(e.target.value)}
            placeholder="sk-or-v1-…"
            className="flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 font-mono text-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
          />
          <button
            type="button"
            onClick={() => setShowOrKey((s) => !s)}
            className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm hover:bg-neutral-50"
          >
            {showOrKey ? "Hide" : "Show"}
          </button>
        </div>
        <p className="mt-2 text-xs text-neutral-400">
          Shared with the Chat tab (stored in your browser). Used by the Asset analysis, Prompt builder and Prompt
          reviewer stages to call OpenRouter.
        </p>
      </section>

      <section className="mb-5 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 font-semibold">Run</h2>

        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-400">
          User prompt (raw)
        </label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          placeholder="Describe the creative intent for this test…"
          className="mb-4 w-full resize-y rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
        />

        {ASSET_ROLE_META.map(({ role, label, hint }) => {
          const upload = assetUploads[role];
          return (
            <div key={role} className="mb-4">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-400">
                {label} <span className="font-normal normal-case text-neutral-400">— {hint}</span>
              </label>
              {upload ? (
                <div className="flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={upload.previewUrl}
                    alt={label}
                    className="size-16 rounded-lg border border-neutral-200 object-cover"
                  />
                  <div className="text-xs text-neutral-500">
                    {upload.uploading && <span className="text-amber-600">Uploading…</span>}
                    {upload.uploadedUrl && <span className="text-green-600">Uploaded</span>}
                    {upload.error && <span className="text-red-500">Upload failed: {upload.error}</span>}
                  </div>
                  <button
                    type="button"
                    onClick={() => clearAsset(role)}
                    className="ml-auto text-sm text-neutral-400 hover:text-red-500"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) setAssetFile(role, f);
                    e.target.value = "";
                  }}
                  className="block w-full text-sm text-neutral-600 file:mr-3 file:rounded-lg file:border-0 file:bg-neutral-900 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-neutral-700"
                />
              )}
            </div>
          );
        })}

        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Hook
        </label>
        <select
          value={selectedHookId}
          onChange={(e) => setSelectedHookId(e.target.value)}
          disabled={configsState !== "idle"}
          className="mb-4 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-400 disabled:bg-neutral-50 disabled:text-neutral-400"
        >
          {hooks.length === 0 && <option value="">— none available —</option>}
          {hooks.map((h) => (
            <option key={h.id} value={h.id}>
              {h.text}
            </option>
          ))}
        </select>

        <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Style
            </label>
            <select
              value={selectedStyleId}
              onChange={(e) => setSelectedStyleId(e.target.value)}
              disabled={configsState !== "idle"}
              className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-400 disabled:bg-neutral-50 disabled:text-neutral-400"
            >
              {styles.length === 0 && <option value="">— none available —</option>}
              {styles.map((s) => (
                <option key={s.styleId} value={s.styleId}>
                  {s.styleName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Camera setting
            </label>
            <select
              value={selectedCameraSettingId}
              onChange={(e) => setSelectedCameraSettingId(e.target.value)}
              disabled={configsState !== "idle"}
              className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-400 disabled:bg-neutral-50 disabled:text-neutral-400"
            >
              {cameraSettings.length === 0 && <option value="">— none available —</option>}
              {cameraSettings.map((c) => (
                <option key={c.cameraSettingId} value={c.cameraSettingId}>
                  {c.cameraSettingName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Target language
            </label>
            <input
              value={targetLanguage}
              onChange={(e) => setTargetLanguage(e.target.value)}
              placeholder="e.g. Polish"
              className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Aspect ratio
            </label>
            <select
              value={aspectRatio}
              onChange={(e) => setAspectRatio(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-400"
            >
              {ASPECT_RATIO_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Variants
            </label>
            <input
              type="number"
              min={1}
              max={4}
              value={variantsCount}
              onChange={(e) => setVariantsCount(Math.min(4, Math.max(1, Number.parseInt(e.target.value, 10) || 1)))}
              className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
            />
          </div>
        </div>
        {configsState === "error" && (
          <p className="mb-4 text-xs text-red-600">Couldn't load configs: {configsError}</p>
        )}

        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Asset analysis model (OpenRouter)
        </label>
        <select
          value={assetAnalysisModel}
          onChange={(e) => setAssetAnalysisModel(e.target.value)}
          className="mb-4 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-400"
        >
          {ASSET_ANALYSIS_MODEL_GROUPS.map((group) => (
            <optgroup key={group} label={group}>
              {ASSET_ANALYSIS_MODELS.filter((m) => m.group === group).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>

        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Prompt builder model (OpenRouter)
        </label>
        <select
          value={promptBuilderModel}
          onChange={(e) => setPromptBuilderModel(e.target.value)}
          className="mb-4 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-400"
        >
          {PROMPT_BUILDER_MODEL_GROUPS.map((group) => (
            <optgroup key={group} label={group}>
              {PROMPT_BUILDER_MODELS.filter((m) => m.group === group).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>

        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Prompt reviewer model (OpenRouter)
        </label>
        <select
          value={promptReviewerModel}
          onChange={(e) => setPromptReviewerModel(e.target.value)}
          className="mb-4 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-400"
        >
          {PROMPT_REVIEWER_MODEL_GROUPS.map((group) => (
            <optgroup key={group} label={group}>
              {PROMPT_REVIEWER_MODELS.filter((m) => m.group === group).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>

        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-400">
          FAL model
        </label>
        <select
          value={modelKey}
          onChange={(e) => setModelKey(e.target.value)}
          className="mb-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-400"
        >
          {MODEL_GROUPS.map((group) => (
            <optgroup key={group} label={group}>
              {MODELS.filter((m) => m.group === group).map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {packshotNote && <p className="mb-4 text-xs text-amber-700">{packshotNote}</p>}
        {!packshotNote && <div className="mb-4" />}

        <button
          type="button"
          onClick={() => void handleRun()}
          disabled={!canRun}
          className="rounded-xl bg-amber-400 px-6 py-2.5 font-semibold text-amber-950 shadow-sm transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400"
        >
          {running ? `Running… ${logLine ? `(${logLine})` : ""}` : "Run"}
        </button>
        {runError && <p className="mt-2 text-sm text-red-600">{runError}</p>}
      </section>

      {currentRun && (
        <section className="mb-5 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="font-semibold">Run {currentRun.id.slice(0, 8)}</h2>
            <StatusBadge status={currentRun.status} />
            <span className="text-xs text-neutral-400">{new Date(currentRun.createdAt).toLocaleString()}</span>
          </div>
          <p className="mb-3 whitespace-pre-wrap text-sm text-neutral-700">{currentRun.userPromptRaw}</p>
          <p className="mb-3 text-xs text-neutral-500">
            Model: <b>{currentRun.modelLabel}</b>
            {currentRun.assets.length > 0 && ` · assets: ${currentRun.assets.map((a) => a.role).join(", ")}`}
          </p>
          {currentRun.error && (
            <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{currentRun.error}</p>
          )}
          {currentRun.outputs.length > 0 && (
            <div className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
              {currentRun.outputs.map((img, i) => (
                <button
                  key={img.url}
                  type="button"
                  onClick={() => lightbox.open(currentRun.outputs.map((o) => o.url), i)}
                  className="overflow-hidden rounded-lg border border-neutral-200"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.url} alt="generated" className="aspect-square w-full object-cover" />
                </button>
              ))}
            </div>
          )}
          <StatusHistory events={currentRun.statusHistory} />
          <AssetAnalysisPanel
            model={currentRun.assetAnalysisModel}
            results={(currentRun.assetAnalysisResults as AssetAnalysisRecord[] | undefined) ?? []}
          />
          <PromptBuilderPanel
            model={currentRun.promptBuilderModel}
            attempts={(currentRun.promptBuilderAttempts as PromptBuilderAttemptRecord[] | undefined) ?? []}
          />
          <PromptReviewerPanel
            model={currentRun.promptReviewerModel}
            attempts={(currentRun.promptReviewerAttempts as PromptReviewerAttemptRecord[] | undefined) ?? []}
          />
          <DebugJson label="Assets" value={currentRun.assets} />
          <DebugJson label="Asset analysis results" value={currentRun.assetAnalysisResults} />
          <DebugJson label="Contract" value={currentRun.contract} />
          <DebugJson label="Prompt builder attempts" value={currentRun.promptBuilderAttempts} />
          <DebugJson label="Prompt reviewer attempts" value={currentRun.promptReviewerAttempts} />
          <DebugJson label="FAL request" value={currentRun.falRequest} />
          <DebugJson label="FAL response" value={currentRun.falResponse} />
        </section>
      )}

      <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Run history</h2>
          <button type="button" onClick={refreshHistory} className="text-sm text-neutral-500 hover:text-amber-700">
            Refresh
          </button>
        </div>
        {historyState === "error" && (
          <p className="text-sm text-red-600">Couldn't load run history — check DATABASE_URL is configured.</p>
        )}
        {historyState !== "error" && history.length === 0 && (
          <p className="text-sm text-neutral-400">No runs yet. Runs are shared — anyone using this app sees them here.</p>
        )}
        <ul className="space-y-1">
          {history.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => void openRun(r.id)}
                className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm hover:border-amber-300 hover:bg-amber-50 ${
                  currentRun?.id === r.id ? "border-amber-300 bg-amber-50" : "border-neutral-200"
                }`}
              >
                <StatusBadge status={r.status} />
                <span className="min-w-0 flex-1 truncate text-neutral-700">{r.userPromptRaw}</span>
                <span className="shrink-0 text-xs text-neutral-400">{r.modelLabel}</span>
                <span className="shrink-0 text-xs text-neutral-400">{new Date(r.createdAt).toLocaleString()}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <MaszynkaConfigs />

      {lightbox.node}
    </div>
  );
}

/** Human-readable view of every uploaded asset's analysis (issue #6 acceptance
 *  criteria: "Analysis output per asset is visible in debug preview"). Written once per
 *  run (no revise loop, unlike the Prompt builder/reviewer pair below), so there is
 *  always at most one record per uploaded asset. Raw request/response for every asset
 *  stay in the "Asset analysis results" DebugJson panel next to this. */
function AssetAnalysisPanel({ model, results }: { model: string | null; results: AssetAnalysisRecord[] }) {
  if (!results.length) return null;
  return (
    <div className="mb-3 rounded-lg bg-neutral-50 p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
        Asset analysis{model && <span className="ml-1 font-normal normal-case text-neutral-400">· {model}</span>}
      </p>
      {results.map((r, i) => (
        <div key={r.assetId} className={i > 0 ? "mt-3 border-t border-neutral-200 pt-3" : ""}>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">{r.role}</p>
          {r.output ? (
            <>
              <p className="mb-1 whitespace-pre-wrap text-sm text-neutral-800">{r.output.description}</p>
              {r.output.attributes.length > 0 && (
                <p className="mb-1 text-xs text-neutral-600">
                  {r.output.attributes.map((a) => `${a.key}: ${a.value}`).join(" · ")}
                </p>
              )}
              {r.output.preserveElements.length > 0 && (
                <p className="text-xs text-amber-700">
                  <b>Preserve:</b> {r.output.preserveElements.join(", ")}
                </p>
              )}
            </>
          ) : (
            <p className="text-xs text-red-600">Failed: {r.errors?.join("; ") || "unknown error"}</p>
          )}
        </div>
      ))}
    </div>
  );
}

/** Human-readable view of every Prompt builder attempt — finalPrompt, negativePrompt,
 *  appliedRules, riskNotes (PRD section 14 / issue #4 acceptance criteria). A revise
 *  loop (issue #5) produces a second attempt; both are shown, oldest first, so the
 *  operator can see exactly what changed between them. Raw request/response for every
 *  attempt stay in the "Prompt builder attempts" DebugJson panel next to this. */
function PromptBuilderPanel({ model, attempts }: { model: string | null; attempts: PromptBuilderAttemptRecord[] }) {
  if (!attempts.length) return null;
  return (
    <div className="mb-3 rounded-lg bg-neutral-50 p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
        Prompt builder{model && <span className="ml-1 font-normal normal-case text-neutral-400">· {model}</span>}
      </p>
      {attempts.map((a) => (
        <div key={a.attempt} className={a.attempt > 1 ? "mt-3 border-t border-neutral-200 pt-3" : ""}>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
            Attempt {a.attempt}
          </p>
          {a.output ? (
            <>
              <p className="mb-2 whitespace-pre-wrap text-sm text-neutral-800">
                <b>Final prompt:</b> {a.output.finalPrompt}
              </p>
              {a.output.negativePrompt && (
                <p className="mb-2 whitespace-pre-wrap text-sm text-neutral-600">
                  <b>Negative prompt:</b> {a.output.negativePrompt}
                </p>
              )}
              {a.output.promptSummary && (
                <p className="mb-2 whitespace-pre-wrap text-xs text-neutral-500">
                  <b>Summary:</b> {a.output.promptSummary}
                </p>
              )}
              {a.output.appliedRules.length > 0 && (
                <p className="mb-2 text-xs text-neutral-600">
                  <b>Applied rules:</b> {a.output.appliedRules.join(", ")}
                </p>
              )}
              {a.output.riskNotes.length > 0 && (
                <p className="text-xs text-amber-700">
                  <b>Risk notes:</b> {a.output.riskNotes.join(", ")}
                </p>
              )}
            </>
          ) : (
            <p className="text-xs text-red-600">Failed: {a.errors?.join("; ") || "unknown error"}</p>
          )}
        </div>
      ))}
    </div>
  );
}

/** Human-readable view of every Prompt reviewer verdict — status, issues, revision
 *  instruction (issue #5 acceptance criteria: "Reviewer output ... visible in debug
 *  preview"). A revise loop produces a second verdict on the rebuilt attempt; both are
 *  shown, oldest first. Raw request/response for every call stay in the "Prompt
 *  reviewer attempts" DebugJson panel next to this. */
function PromptReviewerPanel({ model, attempts }: { model: string | null; attempts: PromptReviewerAttemptRecord[] }) {
  if (!attempts.length) return null;
  const STATUS_COLOR: Record<string, string> = {
    pass: "text-green-700",
    revise: "text-amber-700",
    failed: "text-red-700",
  };
  return (
    <div className="mb-3 rounded-lg bg-neutral-50 p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
        Prompt reviewer{model && <span className="ml-1 font-normal normal-case text-neutral-400">· {model}</span>}
      </p>
      {attempts.map((a) => (
        <div key={a.attempt} className={a.attempt > 1 ? "mt-3 border-t border-neutral-200 pt-3" : ""}>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
            Attempt {a.attempt}
          </p>
          {a.output ? (
            <>
              <p className="mb-1 text-sm text-neutral-800">
                <b>Status:</b>{" "}
                <span className={STATUS_COLOR[a.output.status] ?? "text-neutral-700"}>{a.output.status}</span>
              </p>
              {a.output.issues.length > 0 && (
                <p className="mb-1 whitespace-pre-wrap text-xs text-neutral-600">
                  <b>Issues:</b> {a.output.issues.join("; ")}
                </p>
              )}
              {a.output.revisionInstruction && (
                <p className="whitespace-pre-wrap text-xs text-amber-700">
                  <b>Revision instruction:</b> {a.output.revisionInstruction}
                </p>
              )}
            </>
          ) : (
            <p className="text-xs text-red-600">Failed: {a.errors?.join("; ") || "unknown error"}</p>
          )}
        </div>
      ))}
    </div>
  );
}

function StatusHistory({ events }: { events: MaszynkaRun["statusHistory"] }) {
  if (!events.length) return null;
  return (
    <div className="mb-3">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">Status history</p>
      <ol className="space-y-1">
        {events.map((e, i) => (
          <li key={i} className="flex items-center gap-2 text-xs text-neutral-500">
            <span className="font-mono text-neutral-400">{new Date(e.at).toLocaleTimeString()}</span>
            <StatusBadge status={e.status} />
            {e.detail && <span className="text-neutral-400">{e.detail}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}

function DebugJson({ label, value }: { label: string; value: unknown }) {
  const [open, setOpen] = useState(false);
  const text = useMemo(() => (value == null ? "" : JSON.stringify(value, null, 2)), [value]);
  if (value == null) return null;
  return (
    <div className="mb-2">
      <button type="button" onClick={() => setOpen((v) => !v)} className="text-xs font-medium text-neutral-500 hover:text-amber-700">
        {open ? "▾" : "▸"} {label}
      </button>
      {open && (
        <pre className="mt-1 max-h-72 overflow-auto rounded-lg bg-neutral-50 px-3 py-2 font-mono text-[11px] text-neutral-700">
          {text}
        </pre>
      )}
    </div>
  );
}
