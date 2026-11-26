// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MemoryShardPin, SmallLlmRecipeTarget } from "@modelscript/runtime";
import { BeakerIcon, DatabaseIcon, FileCodeIcon, PlusIcon, RepoForkedIcon, TrashIcon } from "@primer/octicons-react";
import React, { useState } from "react";
import {
  buildRecipeBlogMarkdownDraft,
  buildTrainingRecipeArtifactPayload,
  type TrainingRecipeArtifactPayload,
  type TrainingRecipeComposerInput,
} from "./training-recipe-composer-helpers";
import { parseTrainingRecipeViewConfig, type NormalizedTrainingRecipeCard } from "./training-recipe-model";

export interface TrainingRecipeDraftResult {
  markdown: string;
  artifactPayload: TrainingRecipeArtifactPayload;
  normalizedRecipe: NormalizedTrainingRecipeCard;
}

export interface TrainingRecipeComposerFormProps {
  /** Optional recipe used to pre-populate the form (e.g., when forking or editing). */
  initialRecipe?: NormalizedTrainingRecipeCard | undefined;
  /** Optional parent recipe used to compute a semantic diff in the drafted lab report. */
  parentRecipe?: NormalizedTrainingRecipeCard | undefined;
  /** Optional package name when forking via `?forkRecipe=...` without a full recipe object yet. */
  forkedFromPackage?: string | null | undefined;
  /** Invoked when the user clicks "Auto-Draft Lab Report". */
  onDraftGenerated: (draft: TrainingRecipeDraftResult) => void;
}

interface DatasetRow {
  packageName: string;
  versionRange: string;
}

const MODE_OPTIONS: { value: SmallLlmRecipeTarget["mode"]; label: string }[] = [
  { value: "posttrain-qlora", label: "Post-train QLoRA (WebGPU)" },
  { value: "posttrain-lora", label: "Post-train LoRA (WebGPU)" },
  { value: "projection-head-align", label: "Projection-Head Align (WebGPU)" },
  { value: "pretrain", label: "Pretrain (Cluster)" },
];

const SCALE_OPTIONS = ["0.5B", "1B", "1.5B", "3B", "7B", "10B"];

function parseOptionalNumber(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export const TrainingRecipeComposerForm: React.FC<TrainingRecipeComposerFormProps> = ({
  initialRecipe,
  parentRecipe,
  forkedFromPackage,
  onDraftGenerated,
}) => {
  const seed = initialRecipe ?? parentRecipe;

  const [kind, setKind] = useState<"training-recipe" | "memory-shard">(
    seed?.kind === "memory-shard" ? "memory-shard" : "training-recipe",
  );
  const [title, setTitle] = useState(seed?.title ?? "");
  const [packageName, setPackageName] = useState(
    initialRecipe?.packageName ?? (forkedFromPackage ? `${forkedFromPackage}-fork` : "@ansatz/ieee39-qlora-recipe"),
  );
  const [version, setVersion] = useState(initialRecipe?.version ?? "1.0.0");
  const [summary, setSummary] = useState(seed?.summary ?? "");

  const [baseModel, setBaseModel] = useState(seed?.targetModel?.baseModel ?? "ansatz-core-1.5b");
  const [parameterScale, setParameterScale] = useState<string>(seed?.targetModel?.parameterScale ?? "1.5B");
  const [mode, setMode] = useState<SmallLlmRecipeTarget["mode"]>(seed?.targetModel?.mode ?? "posttrain-qlora");
  const [loraRank, setLoraRank] = useState<string>(
    seed?.targetModel?.loraRank !== undefined ? String(seed.targetModel.loraRank) : "16",
  );

  const [mStart, setMStart] = useState<string>(String(seed?.dynamicM?.mStart ?? 1));
  const [mMax, setMMax] = useState<string>(String(seed?.dynamicM?.mMax ?? 16));
  const [mCap, setMCap] = useState<string>(String(seed?.dynamicM?.mCap ?? 32));

  const [embedderId, setEmbedderId] = useState(seed?.memoryContract?.embedderId ?? "ansatz-embed-v1");

  const [datasets, setDatasets] = useState<DatasetRow[]>(() => {
    const entries = Object.entries(seed?.datasetDependencies ?? {});
    if (entries.length > 0) {
      return entries.map(([pkg, ver]) => ({ packageName: pkg, versionRange: ver }));
    }
    return [{ packageName: "@modelica/msl-dataset", versionRange: "^4.1.0" }];
  });

  const [memoryPins, setMemoryPins] = useState<MemoryShardPin[]>(() =>
    seed?.memoryPins?.length
      ? seed.memoryPins
      : [
          {
            originNode: "ansatz.social",
            packageName: "@modelica/msl-memory",
            version: "4.1.0",
            signerPubkey: "",
          },
        ],
  );

  const [gate1To4Pct, setGate1To4Pct] = useState<string>(
    seed?.evalMetrics.gate1To4PassRate !== undefined ? String(Math.round(seed.evalMetrics.gate1To4PassRate * 100)) : "",
  );
  const [passAt1Pct, setPassAt1Pct] = useState<string>(
    seed?.evalMetrics.passAt1 !== undefined ? String(Math.round(seed.evalMetrics.passAt1 * 100)) : "",
  );
  const [simRmse, setSimRmse] = useState<string>(
    seed?.evalMetrics.simRmse !== undefined ? String(seed.evalMetrics.simRmse) : "",
  );

  const handleAutoDraft = (e: React.FormEvent) => {
    e.preventDefault();

    const datasetDependencies: Record<string, string> = {};
    for (const row of datasets) {
      const k = row.packageName.trim();
      const v = row.versionRange.trim();
      if (k && v) datasetDependencies[k] = v;
    }

    const gate1To4Num = parseOptionalNumber(gate1To4Pct);
    const passAt1Num = parseOptionalNumber(passAt1Pct);
    const simRmseNum = parseOptionalNumber(simRmse);

    const formInput: TrainingRecipeComposerInput = {
      kind,
      title: title.trim() || undefined,
      packageName,
      version,
      summary: summary.trim() || undefined,
      baseModel,
      parameterScale,
      mode,
      loraRank: parseOptionalNumber(loraRank),
      mStart: parseOptionalNumber(mStart) ?? 1,
      mMax: parseOptionalNumber(mMax) ?? 16,
      mCap: parseOptionalNumber(mCap) ?? 32,
      embedderId,
      datasetDependencies,
      memoryPins: memoryPins.filter((pin) => pin.packageName.trim().length > 0),
      evalMetrics: {
        gate1To4PassRate: gate1To4Num !== undefined ? gate1To4Num / 100 : undefined,
        passAt1: passAt1Num !== undefined ? passAt1Num / 100 : undefined,
        simRmse: simRmseNum,
      },
      failureBounties: seed?.failureBounties,
      beforeAfterSamples: seed?.beforeAfterSamples,
      lineage:
        parentRecipe || forkedFromPackage
          ? {
              parentPackage: parentRecipe?.packageName ?? forkedFromPackage ?? undefined,
              parentAuthor: parentRecipe?.authorHandle,
            }
          : seed?.lineage,
    };

    const artifactPayload = buildTrainingRecipeArtifactPayload(formInput);
    const normalizedRecipe = parseTrainingRecipeViewConfig(
      artifactPayload.view_config,
      artifactPayload.title,
      artifactPayload.view_type,
    );
    const markdown = buildRecipeBlogMarkdownDraft(normalizedRecipe, parentRecipe);

    onDraftGenerated({ markdown, artifactPayload, normalizedRecipe });
  };

  return (
    <form
      onSubmit={handleAutoDraft}
      data-testid="training-recipe-composer-form"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        padding: "14px",
        borderRadius: "8px",
        border: "1px solid var(--color-border-default)",
        background: "var(--color-canvas-default)",
        color: "var(--color-fg-default)",
        fontSize: "13px",
      }}
    >
      {/* Header */}
      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "6px", fontWeight: 700, fontSize: "14px" }}>
          {kind === "memory-shard" ? <DatabaseIcon size={15} /> : <BeakerIcon size={15} />}
          <span>{kind === "memory-shard" ? "Compose Memory Shard" : "Compose Training Recipe"}</span>
        </div>
        {(parentRecipe || forkedFromPackage) && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              padding: "2px 8px",
              borderRadius: "999px",
              fontSize: "11px",
              fontWeight: 600,
              background: "rgba(14, 116, 144, 0.12)",
              color: "var(--ms-brand, #0e7490)",
              fontFamily: "var(--font-mono, monospace)",
            }}
          >
            <RepoForkedIcon size={12} /> Forking {parentRecipe?.packageName ?? forkedFromPackage}
          </span>
        )}
      </div>

      {/* Kind & Package Identity */}
      <div style={gridStyle(3)}>
        <label style={fieldLabelStyle}>
          <span>Artifact Kind</span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as "training-recipe" | "memory-shard")}
            style={inputStyle}
          >
            <option value="training-recipe">training-recipe</option>
            <option value="memory-shard">memory-shard</option>
          </select>
        </label>
        <label style={fieldLabelStyle}>
          <span>Package Name</span>
          <input
            type="text"
            value={packageName}
            onChange={(e) => setPackageName(e.target.value)}
            placeholder="@scope/recipe-name"
            required
            style={inputStyle}
          />
        </label>
        <label style={fieldLabelStyle}>
          <span>Version</span>
          <input
            type="text"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            placeholder="1.0.0"
            required
            style={inputStyle}
          />
        </label>
      </div>

      <div style={gridStyle(2)}>
        <label style={fieldLabelStyle}>
          <span>Post Title</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="IEEE 39-Bus Fault Recovery QLoRA (1.5B)"
            style={inputStyle}
          />
        </label>
        <label style={fieldLabelStyle}>
          <span>Canonical Embedder ID</span>
          <input
            type="text"
            value={embedderId}
            onChange={(e) => setEmbedderId(e.target.value)}
            placeholder="ansatz-embed-v1"
            style={inputStyle}
          />
        </label>
      </div>

      <label style={fieldLabelStyle}>
        <span>Summary</span>
        <input
          type="text"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="Concise summary of architecture, data mix, and verification gains"
          style={inputStyle}
        />
      </label>

      {/* Target Model & Mode */}
      <div style={sectionHeaderStyle}>Target Model &amp; Training Mode</div>
      <div style={gridStyle(4)}>
        <label style={fieldLabelStyle}>
          <span>Base Model</span>
          <input
            type="text"
            value={baseModel}
            onChange={(e) => setBaseModel(e.target.value)}
            placeholder="ansatz-core-1.5b"
            style={inputStyle}
          />
        </label>
        <label style={fieldLabelStyle}>
          <span>Parameter Scale</span>
          <select value={parameterScale} onChange={(e) => setParameterScale(e.target.value)} style={inputStyle}>
            {SCALE_OPTIONS.map((scale) => (
              <option key={scale} value={scale}>
                {scale}
              </option>
            ))}
          </select>
        </label>
        <label style={fieldLabelStyle}>
          <span>Mode</span>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as SmallLlmRecipeTarget["mode"])}
            style={inputStyle}
          >
            {MODE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <label style={fieldLabelStyle}>
          <span>LoRA Rank</span>
          <input
            type="number"
            min={1}
            max={256}
            value={loraRank}
            onChange={(e) => setLoraRank(e.target.value)}
            style={inputStyle}
          />
        </label>
      </div>

      {/* Dynamic-m Zonotope Schedule */}
      <div style={sectionHeaderStyle}>Dynamic-m Zonotope Schedule</div>
      <div style={gridStyle(3)}>
        <label style={fieldLabelStyle}>
          <span>mStart</span>
          <input type="number" min={1} value={mStart} onChange={(e) => setMStart(e.target.value)} style={inputStyle} />
        </label>
        <label style={fieldLabelStyle}>
          <span>mMax</span>
          <input type="number" min={1} value={mMax} onChange={(e) => setMMax(e.target.value)} style={inputStyle} />
        </label>
        <label style={fieldLabelStyle}>
          <span>mCap</span>
          <input type="number" min={1} value={mCap} onChange={(e) => setMCap(e.target.value)} style={inputStyle} />
        </label>
      </div>

      {/* Dataset Dependencies */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={sectionHeaderStyle}>Pinned Datasets</span>
        <button
          type="button"
          onClick={() => setDatasets((prev) => [...prev, { packageName: "", versionRange: "^1.0.0" }])}
          style={smallButtonStyle}
        >
          <PlusIcon size={12} /> Add Dataset
        </button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {datasets.map((row, idx) => (
          <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr 140px auto", gap: "6px" }}>
            <input
              type="text"
              value={row.packageName}
              onChange={(e) =>
                setDatasets((prev) =>
                  prev.map((item, i) => (i === idx ? { ...item, packageName: e.target.value } : item)),
                )
              }
              placeholder="@org/dataset-pkg"
              style={inputStyle}
            />
            <input
              type="text"
              value={row.versionRange}
              onChange={(e) =>
                setDatasets((prev) =>
                  prev.map((item, i) => (i === idx ? { ...item, versionRange: e.target.value } : item)),
                )
              }
              placeholder="^1.0.0"
              style={inputStyle}
            />
            <button
              type="button"
              aria-label="Remove dataset pin"
              onClick={() => setDatasets((prev) => prev.filter((_, i) => i !== idx))}
              style={smallButtonStyle}
            >
              <TrashIcon size={12} />
            </button>
          </div>
        ))}
      </div>

      {/* Federated Memory Shard Pins */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={sectionHeaderStyle}>Federated Memory Shard Pins</span>
        <button
          type="button"
          onClick={() =>
            setMemoryPins((prev) => [
              ...prev,
              { originNode: "ansatz.social", packageName: "", version: "1.0.0", signerPubkey: "" },
            ])
          }
          style={smallButtonStyle}
        >
          <PlusIcon size={12} /> Add Memory Pin
        </button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {memoryPins.map((pin, idx) => (
          <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 100px 1fr auto", gap: "6px" }}>
            <input
              type="text"
              value={pin.originNode}
              onChange={(e) =>
                setMemoryPins((prev) =>
                  prev.map((item, i) => (i === idx ? { ...item, originNode: e.target.value } : item)),
                )
              }
              placeholder="ansatz.social"
              style={inputStyle}
            />
            <input
              type="text"
              value={pin.packageName}
              onChange={(e) =>
                setMemoryPins((prev) =>
                  prev.map((item, i) => (i === idx ? { ...item, packageName: e.target.value } : item)),
                )
              }
              placeholder="@modelica/msl-memory"
              style={inputStyle}
            />
            <input
              type="text"
              value={pin.version}
              onChange={(e) =>
                setMemoryPins((prev) =>
                  prev.map((item, i) => (i === idx ? { ...item, version: e.target.value } : item)),
                )
              }
              placeholder="1.0.0"
              style={inputStyle}
            />
            <input
              type="text"
              value={pin.signerPubkey}
              onChange={(e) =>
                setMemoryPins((prev) =>
                  prev.map((item, i) => (i === idx ? { ...item, signerPubkey: e.target.value } : item)),
                )
              }
              placeholder="z6Mk... (optional)"
              style={inputStyle}
            />
            <button
              type="button"
              aria-label="Remove memory pin"
              onClick={() => setMemoryPins((prev) => prev.filter((_, i) => i !== idx))}
              style={smallButtonStyle}
            >
              <TrashIcon size={12} />
            </button>
          </div>
        ))}
      </div>

      {/* Eval Metrics */}
      <div style={sectionHeaderStyle}>Formal Evaluation Metrics (Optional)</div>
      <div style={gridStyle(3)}>
        <label style={fieldLabelStyle}>
          <span>Gate 1–4 Pass Rate (%)</span>
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            value={gate1To4Pct}
            onChange={(e) => setGate1To4Pct(e.target.value)}
            placeholder="91"
            style={inputStyle}
          />
        </label>
        <label style={fieldLabelStyle}>
          <span>Pass@1 (%)</span>
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            value={passAt1Pct}
            onChange={(e) => setPassAt1Pct(e.target.value)}
            placeholder="78"
            style={inputStyle}
          />
        </label>
        <label style={fieldLabelStyle}>
          <span>Sim RMSE</span>
          <input
            type="number"
            min={0}
            step="0.001"
            value={simRmse}
            onChange={(e) => setSimRmse(e.target.value)}
            placeholder="0.018"
            style={inputStyle}
          />
        </label>
      </div>

      {/* Submit Action */}
      <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: "4px" }}>
        <button
          type="submit"
          data-testid="auto-draft-lab-report-btn"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            padding: "7px 14px",
            borderRadius: "6px",
            border: "1px solid var(--ms-brand, #0e7490)",
            background: "var(--ms-brand, #0e7490)",
            color: "#ffffff",
            fontSize: "12px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          <FileCodeIcon size={13} /> Auto-Draft Lab Report
        </button>
      </div>
    </form>
  );
};

function gridStyle(cols: number): React.CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
    gap: "8px",
  };
}

const sectionHeaderStyle: React.CSSProperties = {
  fontSize: "11px",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "var(--color-fg-muted)",
};

const fieldLabelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "4px",
  fontSize: "12px",
  fontWeight: 600,
  color: "var(--color-fg-default)",
};

const inputStyle: React.CSSProperties = {
  padding: "6px 8px",
  borderRadius: "6px",
  border: "1px solid var(--color-border-default)",
  background: "var(--color-canvas-subtle)",
  color: "var(--color-fg-default)",
  fontSize: "12px",
  width: "100%",
  boxSizing: "border-box",
};

const smallButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "4px",
  padding: "4px 8px",
  borderRadius: "6px",
  border: "1px solid var(--color-border-default)",
  background: "var(--color-canvas-subtle)",
  color: "var(--color-fg-default)",
  fontSize: "11px",
  fontWeight: 600,
  cursor: "pointer",
};

export default TrainingRecipeComposerForm;
