// SPDX-License-Identifier: AGPL-3.0-or-later

import { parseQif } from "@modelscript/qif/parser";
import { evaluateQifSpc } from "@modelscript/qif/spc";
import { reconcileStepWithQif } from "@modelscript/qif/step-bridge";
import type { QifDocument } from "@modelscript/qif/types";
import { strFromU8, unzipSync } from "fflate";
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
import { QifPreview, qifPreviewRenderer } from "./QifPreview";
export { QifPreview, qifPreviewRenderer };

export type QifGeometryMode = "none" | "upload" | "linked";

export interface QifUnitMismatch {
  qifUnit: string;
  stepUnit: string;
  ratio: number;
  suggestedScale: number;
}

export interface QifReconciliationSummary {
  matched: number;
  total: number;
  unresolved: string[];
  unitMismatch?: QifUnitMismatch | undefined;
  byMethod?: { entityId: number; semanticName: number; spatialProximity: number } | undefined;
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
  scaleFactor?: number | undefined;
  /** Kept so reconciliation can be recomputed without re-parsing when the geometry changes. */
  doc: QifDocument;
}

export const QIF_GEOMETRY_ACCEPT = ".step,.stp,.p21";
const STEP_VIEW_TYPES = ["cad-step", "cad_step", "step", "stp", "cad"];

export function detectStepUnits(stepText: string): "mm" | "inch" | "meter" | "unknown" {
  if (
    /CONVERSION_BASED_UNIT\s*\(\s*['"]INCH['"]/i.test(stepText) ||
    /SI_UNIT\s*\(\s*[^,)]*,\s*\.INCH\.\s*\)/i.test(stepText) ||
    /NAMED_UNIT\s*\([^)]*\)\s*,\s*CONVERSION_BASED_UNIT\s*\(\s*['"]INCH['"]/i.test(stepText)
  ) {
    return "inch";
  }
  if (/SI_UNIT\s*\(\s*\.MILLI\.\s*,\s*\.METRE\.\s*\)/i.test(stepText)) {
    return "mm";
  }
  if (/SI_UNIT\s*\(\s*\$\s*,\s*\.METRE\.\s*\)/i.test(stepText)) {
    return "meter";
  }
  return "unknown";
}

export function detectQifUnits(doc: QifDocument): "mm" | "inch" | "meter" | "unknown" {
  const raw = (doc.header.fileUnits || "").toLowerCase().trim();
  if (raw.includes("inch") || raw === "in") return "inch";
  if (raw.includes("milli") || raw === "mm") return "mm";
  if (raw.includes("meter") || raw === "m") return "meter";
  return "unknown";
}

export function detectUnitMismatch(doc: QifDocument, stepText: string): QifUnitMismatch | undefined {
  const qifUnit = detectQifUnits(doc);
  const stepUnit = detectStepUnits(stepText);

  if (qifUnit !== "unknown" && stepUnit !== "unknown" && qifUnit !== stepUnit) {
    if (qifUnit === "mm" && stepUnit === "inch") {
      return { qifUnit: "mm", stepUnit: "inch", ratio: 25.4, suggestedScale: 25.4 };
    }
    if (qifUnit === "inch" && stepUnit === "mm") {
      return { qifUnit: "inch", stepUnit: "mm", ratio: 1 / 25.4, suggestedScale: 1 / 25.4 };
    }
    if (qifUnit === "mm" && stepUnit === "meter") {
      return { qifUnit: "mm", stepUnit: "meter", ratio: 1000, suggestedScale: 1000 };
    }
  }

  // Coordinate magnitude heuristic:
  const ptRegex =
    /CARTESIAN_POINT\s*\([^)]*,\s*\(\s*([-+0-9.eE]+)\s*,\s*([-+0-9.eE]+)\s*(?:,\s*([-+0-9.eE]+))?\s*\)\s*\)/g;
  let sMatch: RegExpExecArray | null;
  let maxStepCoord = 0;
  let stepPtCount = 0;
  while ((sMatch = ptRegex.exec(stepText)) !== null && stepPtCount < 300) {
    stepPtCount++;
    const x = Math.abs(parseFloat(sMatch[1] || "0"));
    const y = Math.abs(parseFloat(sMatch[2] || "0"));
    const z = Math.abs(parseFloat(sMatch[3] || "0"));
    const m = Math.max(x, y, z);
    if (m > maxStepCoord) maxStepCoord = m;
  }

  let maxQifCoord = 0;
  for (const feat of doc.features) {
    if (feat.nominalSize && feat.nominalSize > maxQifCoord) maxQifCoord = feat.nominalSize;
    if (feat.location) {
      const [x, y, z] = feat.location;
      const m = Math.max(Math.abs(x), Math.abs(y), Math.abs(z));
      if (m > maxQifCoord) maxQifCoord = m;
    }
  }

  if (maxStepCoord > 0 && maxQifCoord > 0) {
    const ratio = maxQifCoord / maxStepCoord;
    if (ratio >= 20 && ratio <= 30) {
      return {
        qifUnit: qifUnit !== "unknown" ? qifUnit : "mm",
        stepUnit: stepUnit !== "unknown" ? stepUnit : "inch",
        ratio,
        suggestedScale: 25.4,
      };
    }
    if (ratio >= 0.03 && ratio <= 0.05) {
      return {
        qifUnit: qifUnit !== "unknown" ? qifUnit : "inch",
        stepUnit: stepUnit !== "unknown" ? stepUnit : "mm",
        ratio,
        suggestedScale: 1 / 25.4,
      };
    }
    if (ratio >= 800 && ratio <= 1200) {
      return {
        qifUnit: qifUnit !== "unknown" ? qifUnit : "mm",
        stepUnit: stepUnit !== "unknown" ? stepUnit : "meter",
        ratio,
        suggestedScale: 1000,
      };
    }
  }

  return undefined;
}

/** Match the QIF's STEP entity references against a STEP model. Pure, so it is unit-testable. */
export function summarizeReconciliation(doc: QifDocument, stepText: string): QifReconciliationSummary {
  const result = reconcileStepWithQif(stepText, doc);
  const unitMismatch = detectUnitMismatch(doc, stepText);
  const byMethod = { entityId: 0, semanticName: 0, spatialProximity: 0 };
  for (const m of result.matchedFeatures) {
    if (m.matchType === "entityId") byMethod.entityId++;
    else if (m.matchType === "semanticName") byMethod.semanticName++;
    else if (m.matchType === "spatialProximity") byMethod.spatialProximity++;
  }
  return {
    matched: result.matchedFeatures.length,
    total: result.matchedFeatures.length + result.unresolvedFeatures.length,
    unresolved: result.unresolvedFeatures.map((f) => f.featureName || f.featureId),
    byMethod,
    ...(unitMismatch ? { unitMismatch } : {}),
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
  if (r?.unitMismatch) {
    const factorStr =
      r.unitMismatch.ratio > 1 ? r.unitMismatch.ratio.toFixed(1) : (1 / r.unitMismatch.ratio).toFixed(1);
    issues.push({
      severity: "warning",
      message: `Unit mismatch detected: QIF report is in ${r.unitMismatch.qifUnit} while STEP model is in ${r.unitMismatch.stepUnit} (~${factorStr}× difference). A scale factor of ${r.unitMismatch.suggestedScale}× will be applied.`,
    });
  }
  return issues;
}

function reconcileSafely(d: QifAttachDraft, stepText: string | undefined): Partial<QifAttachDraft> {
  if (!stepText) return { reconciliation: undefined, reconciliationError: undefined, scaleFactor: undefined };
  try {
    const summary = summarizeReconciliation(d.doc, stepText);
    return {
      reconciliation: summary,
      reconciliationError: undefined,
      scaleFactor: summary.unitMismatch ? summary.unitMismatch.suggestedScale : undefined,
    };
  } catch {
    return {
      reconciliation: undefined,
      reconciliationError: "Could not read this STEP file to check feature matches.",
      scaleFactor: undefined,
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
              {r.byMethod && (r.byMethod.semanticName > 0 || r.byMethod.spatialProximity > 0) && (
                <span style={{ fontSize: 11, color: "var(--ms-text-3)", marginLeft: 6 }}>
                  ({r.byMethod.entityId} direct, {r.byMethod.semanticName} by name, {r.byMethod.spatialProximity} by
                  proximity)
                </span>
              )}
            </span>
          )}
          {r && r.total === 0 && (
            <span style={{ fontSize: 13, color: "var(--ms-text-3)" }}>
              This report doesn&apos;t reference STEP entity IDs, so features can&apos;t be tied to faces automatically.
            </span>
          )}
          {r?.unitMismatch && (
            <span
              style={{
                fontSize: 12,
                padding: "2px 8px",
                borderRadius: "12px",
                background: "rgba(245, 158, 11, 0.15)",
                color: "#f59e0b",
                fontWeight: 600,
              }}
            >
              Scale: {r.unitMismatch.suggestedScale}× ({r.unitMismatch.stepUnit} → {r.unitMismatch.qifUnit})
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
  const sf =
    typeof rec["scaleFactor"] === "number" && rec["scaleFactor"] > 0
      ? rec["scaleFactor"]
      : typeof config["geometryScale"] === "number" && (config["geometryScale"] as number) > 0
        ? (config["geometryScale"] as number)
        : undefined;
  return {
    artifactId: id,
    title: typeof rec["title"] === "string" ? rec["title"] : `Artifact ${id}`,
    provenance: rec["provenance"] === "user-provided" ? "user-provided" : "linked",
    ...(sf !== undefined ? { scaleFactor: sf } : {}),
  };
}

interface GeometryRef {
  artifactId: number | string;
  title: string;
  provenance: "user-provided" | "linked";
  scaleFactor?: number | undefined;
}

/** Turn the user's geometry choice into a stored reference, creating the STEP artifact when it was uploaded. */
async function resolveGeometryRef(draft: QifAttachDraft, ctx: AttachContext): Promise<GeometryRef | undefined> {
  const scaleFactor = draft.scaleFactor ?? draft.reconciliation?.unitMismatch?.suggestedScale;
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
    return {
      artifactId: created.id,
      title: draft.stepFile.name,
      provenance: "user-provided",
      ...(scaleFactor !== undefined ? { scaleFactor } : {}),
    };
  }
  if (draft.geometryMode === "linked" && draft.linked) {
    return {
      artifactId: draft.linked.id,
      title: draft.linked.title,
      provenance: "linked",
      ...(scaleFactor !== undefined ? { scaleFactor } : {}),
    };
  }
  return undefined;
}

export function isArchive(fileName: string): boolean {
  const ext = fileName.toLowerCase();
  return ext.endsWith(".qifz") || ext.endsWith(".zip");
}

export function extractQifFromArchive(
  unzipped: Record<string, Uint8Array>,
  _archiveFileName: string,
): { qifFile: File; qifText: string; stepFile?: File; stepText?: string } | null {
  const entries = Object.keys(unzipped).filter((k) => !k.startsWith("__MACOSX/") && !k.endsWith("/"));
  const qifEntry = entries.find((k) => k.toLowerCase().endsWith(".qif"));
  if (!qifEntry) return null;

  const qifText = strFromU8(unzipped[qifEntry]!);
  const qifFileName = qifEntry.split("/").pop() || "inspection.qif";
  const qifFile = new File([qifText], qifFileName);

  const stepEntry = entries.find((k) => /\.(step|stp|p21)$/i.test(k));
  let stepFile: File | undefined;
  let stepText: string | undefined;
  if (stepEntry) {
    stepText = strFromU8(unzipped[stepEntry]!);
    const stepFileName = stepEntry.split("/").pop() || "geometry.step";
    stepFile = new File([stepText], stepFileName);
  }

  return { qifFile, qifText, stepFile, stepText };
}

export async function analyzeQifArchive(file: File, _ctx: AttachContext): Promise<AttachAnalysis<QifAttachDraft>> {
  let unzipped: Record<string, Uint8Array>;
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    unzipped = unzipSync(buf);
  } catch (err) {
    const emptyDoc = parseQif("", file.name);
    return {
      draft: { file, text: "", geometryMode: "none", doc: emptyDoc },
      chips: [],
      issues: [
        {
          severity: "error",
          message: `Could not read archive: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
    };
  }

  const extracted = extractQifFromArchive(unzipped, file.name);
  if (!extracted) {
    const emptyDoc = parseQif("", file.name);
    return {
      draft: { file, text: "", geometryMode: "none", doc: emptyDoc },
      chips: [],
      issues: [
        {
          severity: "error",
          message: "No QIF (.qif) inspection document found in this archive.",
        },
      ],
    };
  }

  const analysis = describeQif(extracted.qifFile, extracted.qifText);
  if (extracted.stepFile && extracted.stepText) {
    analysis.draft = {
      ...analysis.draft,
      geometryMode: "upload",
      stepFile: extracted.stepFile,
      stepText: extracted.stepText,
      ...reconcileSafely(analysis.draft, extracted.stepText),
    };
    analysis.chips.push({ label: `Auto-paired: ${extracted.stepFile.name}`, tone: "success" });
  }

  return analysis;
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
  match: { extensions: [".qif", ".qifz"] },

  async analyze(file, ctx): Promise<AttachAnalysis<QifAttachDraft>> {
    if (isArchive(file.name)) {
      return analyzeQifArchive(file, ctx);
    }
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

  Preview: QifPreview,

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
    const scaleFactor = draft.scaleFactor ?? draft.reconciliation?.unitMismatch?.suggestedScale;

    const reportBits = [`${draft.doc.features.length} features`, `${draft.doc.characteristics.length} characteristics`];
    let spcDetail = "";
    try {
      const spc = evaluateQifSpc(draft.doc);
      const cpks = spc.characteristics.map((c) => c.cpk).filter((v) => Number.isFinite(v));
      const failCount = spc.characteristics.filter((c) => c.status === "FAIL").length;
      if (failCount > 0) {
        spcDetail = ` (${failCount} out of tolerance)`;
      } else if (cpks.length > 0) {
        spcDetail = ` (Min Cpk ${Math.min(...cpks).toFixed(2)})`;
      }
    } catch {}

    const modelSuffix = geometry ? ` · Paired with 3D model '${geometry.title}'` : "";
    const suggestedCaption = `Inspection report${draft.partName ? ` for ${draft.partName}` : ""}: ${reportBits.join(", ")}${spcDetail}${modelSuffix}.`;

    return {
      artifact_type: upload.view_type && upload.view_type !== "other" ? upload.view_type : "qif",
      title: draft.file.name,
      suggestedCaption,
      view_config: {
        url: upload.url,
        ...(upload.svg ? { svg: upload.svg } : {}),
        ...(upload.thumbnail_url ? { thumbnailUrl: upload.thumbnail_url } : {}),
        ...additions,
        ...(upload.metadata || {}),
        code: draft.text,
        ...(geometry ? { companions: { geometry } } : {}),
        ...(scaleFactor !== undefined ? { geometryScale: scaleFactor } : {}),
      },
    };
  },
};
