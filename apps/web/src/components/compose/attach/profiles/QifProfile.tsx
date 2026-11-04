// SPDX-License-Identifier: AGPL-3.0-or-later

import { parseQif } from "@modelscript/qif/parser";
import { evaluateQifSpc } from "@modelscript/qif/spc";
import { reconcileStepWithQif } from "@modelscript/qif/step-bridge";
import type { QifDocument } from "@modelscript/qif/types";
import React, { useCallback } from "react";
import { ArtifactPicker, ChoiceCards, FileSlot, IssueList, ProvenanceBadge } from "../Primitives";
import type {
  AttachAnalysis,
  AttachArtifactSummary,
  AttachChip,
  AttachContext,
  AttachIssue,
  AttachProfile,
  WizardStepProps,
} from "../types";

export type QifGeometryMode = "none" | "upload" | "linked";

export interface QifReconciliationSummary {
  matched: number;
  total: number;
  unresolved: string[];
}

export interface QifAttachDraft {
  file: File;
  text: string;
  partName?: string | undefined;
  geometryMode: QifGeometryMode;
  stepFile?: File | undefined;
  stepText?: string | undefined;
  linked?: { id: number | string; title: string } | undefined;
  reconciliation?: QifReconciliationSummary | undefined;
  reconciliationError?: string | undefined;
  /** Kept so reconciliation can be recomputed without re-parsing when the geometry changes. */
  doc: QifDocument;
}

export const QIF_GEOMETRY_ACCEPT = ".step,.stp,.p21";
const STEP_VIEW_TYPES = ["cad-step", "cad_step", "step", "stp", "cad"];

/** Match the QIF's STEP entity references against a STEP model. Pure, so it is unit-testable. */
export function summarizeReconciliation(doc: QifDocument, stepText: string): QifReconciliationSummary {
  const result = reconcileStepWithQif(stepText, doc);
  return {
    matched: result.matchedFeatures.length,
    total: result.matchedFeatures.length + result.unresolvedFeatures.length,
    unresolved: result.unresolvedFeatures.map((f) => f.featureName || f.featureId),
  };
}

function geometryIssues(d: QifAttachDraft): AttachIssue[] {
  const issues: AttachIssue[] = [];
  if (d.geometryMode === "upload" && !d.stepText) {
    issues.push({ severity: "error", message: "Choose a STEP file, or pick another option." });
  }
  if (d.geometryMode === "linked" && !d.linked) {
    issues.push({ severity: "error", message: "Pick one of your STEP models, or choose another option." });
  }
  if (d.reconciliationError) {
    issues.push({ severity: "warning", message: d.reconciliationError });
  }
  const r = d.reconciliation;
  if (r && r.total > 0 && r.unresolved.length > 0) {
    issues.push({
      severity: "warning",
      message: `${r.unresolved.length} of ${r.total} features reference STEP entities that were not found in this model (${r.unresolved.slice(0, 3).join(", ")}${r.unresolved.length > 3 ? ", …" : ""}).`,
    });
  }
  return issues;
}

function reconcileSafely(d: QifAttachDraft, stepText: string | undefined): Partial<QifAttachDraft> {
  if (!stepText) return { reconciliation: undefined, reconciliationError: undefined };
  try {
    return { reconciliation: summarizeReconciliation(d.doc, stepText), reconciliationError: undefined };
  } catch {
    return {
      reconciliation: undefined,
      reconciliationError: "Could not read this STEP file to check feature matches.",
    };
  }
}

const GeometryStep: React.FC<WizardStepProps<QifAttachDraft>> = ({ draft, update, ctx }) => {
  const loadSteps = useCallback(() => ctx.listArtifacts({ types: STEP_VIEW_TYPES }), [ctx]);
  const r = draft.reconciliation;

  const chooseMode = (mode: QifGeometryMode) => {
    update((prev) => ({
      ...prev,
      geometryMode: mode,
      ...(mode === "none" ? { stepFile: undefined, stepText: undefined, linked: undefined } : {}),
      ...(mode === "upload" ? { linked: undefined } : {}),
      ...(mode === "linked" ? { stepFile: undefined } : {}),
      ...(mode === "none" ? reconcileSafely(prev, undefined) : {}),
    }));
  };

  const onStepFile = async (file: File) => {
    let text = "";
    try {
      text = await file.text();
    } catch {
      text = "";
    }
    update((prev) => ({
      ...prev,
      stepFile: file,
      stepText: text || undefined,
      ...reconcileSafely(prev, text || undefined),
    }));
  };

  const onLink = async (item: AttachArtifactSummary) => {
    update((prev) => ({ ...prev, linked: { id: item.id, title: item.title }, stepText: undefined }));
    const text = await ctx.loadArtifactSource(item.id).catch(() => undefined);
    update((prev) =>
      prev.linked && String(prev.linked.id) === String(item.id)
        ? { ...prev, stepText: text, ...reconcileSafely(prev, text) }
        : prev,
    );
  };

  return (
    <>
      <ChoiceCards<QifGeometryMode>
        label="3D model"
        value={draft.geometryMode}
        onChange={chooseMode}
        options={[
          { value: "upload", title: "Upload STEP", hint: "Attach the part this report inspects" },
          { value: "linked", title: "My artifacts", hint: "Reuse a STEP model you already posted" },
          { value: "none", title: "No 3D model", hint: "Show GD&T and measurements only" },
        ]}
      />

      {draft.geometryMode === "upload" && (
        <FileSlot
          label="a STEP file"
          accept={QIF_GEOMETRY_ACCEPT}
          file={draft.stepFile}
          onFile={(f) => void onStepFile(f)}
          onClear={() =>
            update((prev) => ({
              ...prev,
              stepFile: undefined,
              stepText: undefined,
              reconciliation: undefined,
              reconciliationError: undefined,
            }))
          }
        />
      )}

      {draft.geometryMode === "linked" && (
        <ArtifactPicker
          label="Your STEP models"
          load={loadSteps}
          selectedId={draft.linked?.id}
          onSelect={(item) => void onLink(item)}
          suggestMatch={draft.partName}
          emptyMessage="You haven't posted any STEP models yet. Upload one instead."
        />
      )}

      {draft.geometryMode !== "none" && (draft.stepFile || draft.linked) && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <ProvenanceBadge
            provenance={draft.geometryMode === "linked" ? "linked" : "user-provided"}
            detail={draft.linked?.title ?? draft.stepFile?.name}
          />
          {r && r.total > 0 && (
            <span style={{ fontSize: 13, color: r.unresolved.length === 0 ? "#16a34a" : "var(--ms-text-2)" }}>
              {r.matched}/{r.total} features matched to STEP entities
            </span>
          )}
          {r && r.total === 0 && (
            <span style={{ fontSize: 13, color: "var(--ms-text-3)" }}>
              This report doesn&apos;t reference STEP entity IDs, so features can&apos;t be tied to faces automatically.
            </span>
          )}
        </div>
      )}

      <IssueList issues={geometryIssues(draft).filter((i) => i.severity !== "error")} />
    </>
  );
};

function readGeometryRef(config: Record<string, unknown>): GeometryRef | undefined {
  const companions = config["companions"];
  const g =
    companions && typeof companions === "object" ? (companions as Record<string, unknown>)["geometry"] : undefined;
  if (!g || typeof g !== "object") return undefined;
  const rec = g as Record<string, unknown>;
  const id = rec["artifactId"];
  if (typeof id !== "string" && typeof id !== "number") return undefined;
  return {
    artifactId: id,
    title: typeof rec["title"] === "string" ? rec["title"] : `Artifact ${id}`,
    provenance: rec["provenance"] === "user-provided" ? "user-provided" : "linked",
  };
}

interface GeometryRef {
  artifactId: number | string;
  title: string;
  provenance: "user-provided" | "linked";
}

/** Turn the user's geometry choice into a stored reference, creating the STEP artifact when it was uploaded. */
async function resolveGeometryRef(draft: QifAttachDraft, ctx: AttachContext): Promise<GeometryRef | undefined> {
  if (draft.geometryMode === "upload" && draft.stepFile) {
    const stepUpload = await ctx.uploadFile(draft.stepFile);
    const created = await ctx.createArtifact({
      artifact_type: stepUpload.view_type && stepUpload.view_type !== "other" ? stepUpload.view_type : "cad-step",
      title: draft.stepFile.name,
      view_config: {
        url: stepUpload.url,
        ...(stepUpload.thumbnail_url ? { thumbnailUrl: stepUpload.thumbnail_url } : {}),
        ...(stepUpload.view_config_additions || {}),
        ...(stepUpload.metadata || {}),
      },
    });
    return { artifactId: created.id, title: draft.stepFile.name, provenance: "user-provided" };
  }
  if (draft.geometryMode === "linked" && draft.linked) {
    return { artifactId: draft.linked.id, title: draft.linked.title, provenance: "linked" };
  }
  return undefined;
}

function describeQif(file: File, text: string): AttachAnalysis<QifAttachDraft> {
  const base = { file, text, geometryMode: "none" as QifGeometryMode };
  let doc: QifDocument;
  try {
    doc = parseQif(text, file.name);
  } catch (err) {
    return {
      draft: { ...base, doc: parseQif("", file.name) },
      chips: [],
      issues: [
        { severity: "error", message: `Could not parse QIF: ${err instanceof Error ? err.message : String(err)}` },
      ],
    };
  }

  const issues: AttachIssue[] = [];
  const chips: AttachChip[] = [];
  if (text.trim().length === 0) {
    issues.push({ severity: "error", message: "This file is empty." });
  } else if (doc.features.length === 0 && doc.characteristics.length === 0) {
    issues.push({ severity: "error", message: "No features or characteristics were found in this QIF file." });
  } else {
    chips.push({ label: `${doc.features.length} feature${doc.features.length === 1 ? "" : "s"}` });
    chips.push({
      label: `${doc.characteristics.length} characteristic${doc.characteristics.length === 1 ? "" : "s"}`,
    });
    if (doc.actuals.length > 0) chips.push({ label: `${doc.actuals.length} measurements` });
    try {
      const spc = evaluateQifSpc(doc);
      const cpks = spc.characteristics.map((c) => c.cpk).filter((v) => Number.isFinite(v));
      if (cpks.length > 0) {
        const minCpk = Math.min(...cpks);
        chips.push({ label: `Min Cpk ${minCpk.toFixed(2)}`, tone: minCpk >= 1.33 ? "success" : "warning" });
      }
    } catch {
      /* SPC is informational; ignore evaluation failures here */
    }
  }

  return { draft: { ...base, doc, partName: doc.header.partName }, chips, issues };
}

export const qifAttachProfile: AttachProfile<QifAttachDraft> = {
  id: "qif",
  label: "QIF inspection report",
  match: { extensions: [".qif"] },

  async analyze(file): Promise<AttachAnalysis<QifAttachDraft>> {
    return describeQif(file, await file.text());
  },

  companionExtensions: [".step", ".stp", ".p21"],

  async withCompanions(draft, companions) {
    const stepFile = companions[0];
    if (!stepFile) return draft;
    let text = "";
    try {
      text = await stepFile.text();
    } catch {
      text = "";
    }
    if (!text) return draft;
    return { ...draft, geometryMode: "upload", stepFile, stepText: text, ...reconcileSafely(draft, text) };
  },

  async withLinkedArtifact(draft, linked, ctx) {
    if (!STEP_VIEW_TYPES.includes(linked.viewType.toLowerCase())) return draft;
    const stepText = await ctx.loadArtifactSource(linked.id).catch(() => undefined);
    return {
      ...draft,
      geometryMode: "linked",
      linked: { id: linked.id, title: linked.title },
      stepText,
      ...reconcileSafely(draft, stepText),
    };
  },

  steps: [
    {
      id: "geometry",
      title: "Pair with a 3D model?",
      description: "A STEP model lets viewers see the inspected part. You can skip this and add one later.",
      skippable: true,
      when: (d) => d.doc.features.length > 0 || d.doc.characteristics.length > 0,
      validate: (d) => geometryIssues(d).filter((i) => i.severity === "error"),
      Component: GeometryStep,
    },
  ],

  edit: {
    matches: (view) =>
      view.artifact_type.toLowerCase() === "qif" &&
      typeof view.view_config["code"] === "string" &&
      (view.view_config["code"] as string).trim().length > 0,

    async open(view, ctx) {
      const text = view.view_config["code"] as string;
      const file = new File([text], view.title || "inspection.qif");
      const analysis = describeQif(file, text);
      const existing = readGeometryRef(view.view_config);
      if (existing) {
        const stepText = await ctx.loadArtifactSource(existing.artifactId).catch(() => undefined);
        analysis.draft = {
          ...analysis.draft,
          geometryMode: "linked",
          linked: { id: existing.artifactId, title: existing.title },
          stepText,
          ...reconcileSafely(analysis.draft, stepText),
        };
      }
      return analysis;
    },

    async apply(draft, view, ctx) {
      const current = readGeometryRef(view.view_config);
      const unchanged =
        draft.geometryMode === "linked" &&
        draft.linked &&
        current &&
        String(current.artifactId) === String(draft.linked.id);
      const next: GeometryRef | undefined = unchanged ? current : await resolveGeometryRef(draft, ctx);

      const view_config: Record<string, unknown> = { ...view.view_config };
      const companions: Record<string, unknown> = { ...((view_config["companions"] as object | undefined) ?? {}) };
      if (next) companions["geometry"] = next;
      else delete companions["geometry"];
      if (Object.keys(companions).length > 0) view_config["companions"] = companions;
      else delete view_config["companions"];
      return { view_config };
    },
  },

  async build(draft, ctx) {
    const upload = await ctx.uploadFile(draft.file);
    // The server previously injected a synthesized STEP here; real geometry is only ever user-provided.
    const additions: Record<string, unknown> = { ...(upload.view_config_additions ?? {}) };
    delete additions["stepSource"];
    delete additions["stepCode"];

    const geometry = await resolveGeometryRef(draft, ctx);

    const reportBits = [`${draft.doc.features.length} features`, `${draft.doc.characteristics.length} characteristics`];
    return {
      artifact_type: upload.view_type && upload.view_type !== "other" ? upload.view_type : "qif",
      title: draft.file.name,
      suggestedCaption: `Inspection report${draft.partName ? ` for ${draft.partName}` : ""}: ${reportBits.join(", ")}.`,
      view_config: {
        url: upload.url,
        ...(upload.svg ? { svg: upload.svg } : {}),
        ...(upload.thumbnail_url ? { thumbnailUrl: upload.thumbnail_url } : {}),
        ...additions,
        ...(upload.metadata || {}),
        code: draft.text,
        ...(geometry ? { companions: { geometry } } : {}),
      },
    };
  },
};
