// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  BeakerIcon,
  CheckCircleIcon,
  CopyIcon,
  CpuIcon,
  DatabaseIcon,
  GitBranchIcon,
  RepoForkedIcon,
  ShieldCheckIcon,
  TrophyIcon,
  ZapIcon,
} from "@primer/octicons-react";
import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { generateRecipeBibtex, parseTrainingRecipeViewConfig, type RecipeRewardWeights } from "./training-recipe-model";

export interface TrainingRecipeArtifactCardProps {
  artifactId?: number | string | undefined;
  viewType?: string | undefined;
  title?: string | undefined;
  viewConfig?: Record<string, unknown> | null | undefined;
  isFullScreen?: boolean | undefined;
}

type RecipeTab = "overview" | "samples" | "lineage" | "bounties";

const REWARD_LABELS: { key: keyof RecipeRewardWeights; label: string; color: string }[] = [
  { key: "gate1Syntax", label: "Gate 1 · Syntax", color: "#0284c7" },
  { key: "gate2Units", label: "Gate 2 · SI-7 Units", color: "#0891b2" },
  { key: "gate3Smt", label: "Gate 3 · SMT / Invariants", color: "#7c3aed" },
  { key: "gate4Dae", label: "Gate 4 · DAE / BLT", color: "#2563eb" },
  { key: "physicsSim", label: "Physics Sim RMSE", color: "#059669" },
  { key: "cadClearance", label: "CAD Clearance", color: "#d97706" },
  { key: "zonotopeContraction", label: "Zonotope Contraction", color: "#db2777" },
];

const TrainingRecipeArtifactCard: React.FC<TrainingRecipeArtifactCardProps> = ({
  artifactId,
  viewType,
  title,
  viewConfig,
  isFullScreen = false,
}) => {
  const navigate = useNavigate();
  const recipe = useMemo(
    () => parseTrainingRecipeViewConfig(viewConfig, title, viewType),
    [viewConfig, title, viewType],
  );

  const [activeTab, setActiveTab] = useState<RecipeTab>("overview");
  const [sampleIdx, setSampleIdx] = useState(0);
  const [showRecipeOutput, setShowRecipeOutput] = useState(true);
  const [copiedMode, setCopiedMode] = useState<"bibtex" | "manifest" | null>(null);

  const hasSamples = recipe.beforeAfterSamples.length > 0;
  const hasLineage = Boolean(recipe.lineage?.parentPackage || recipe.lineage?.diffEntries?.length);
  const hasBounties = recipe.failureBounties.length > 0;
  const activeSample = recipe.beforeAfterSamples[sampleIdx];

  const handleCopy = (mode: "bibtex" | "manifest") => {
    const text =
      mode === "bibtex"
        ? generateRecipeBibtex(recipe, typeof window !== "undefined" ? window.location.href : undefined)
        : JSON.stringify(
            {
              name: recipe.packageName,
              version: recipe.version,
              modelscript: {
                category: recipe.kind,
                aiGovernance: recipe.aiGovernance,
                ml: {
                  kind: recipe.kind,
                  targetModel: recipe.targetModel,
                  dynamicM: recipe.dynamicM,
                  rewardWeights: recipe.rewardWeights,
                  memoryContract: recipe.memoryContract,
                  memoryPins: recipe.memoryPins,
                },
              },
              dependencies: recipe.datasetDependencies,
            },
            null,
            2,
          );
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(text);
    }
    setCopiedMode(mode);
    window.setTimeout(() => setCopiedMode(null), 1800);
  };

  const pct = (v: number | undefined) => (v !== undefined ? `${Math.round(v * 100)}%` : null);

  return (
    <div
      data-testid="training-recipe-artifact-card"
      style={{
        display: "flex",
        flexDirection: "column",
        height: isFullScreen ? "100%" : "auto",
        background: "var(--color-canvas-default)",
        color: "var(--color-fg-default)",
        fontSize: "13px",
      }}
    >
      {/* Top Header Strip: Identity, Model Scale, Dynamic-m & Formal Eval Badges */}
      <div
        style={{
          padding: "12px 14px",
          borderBottom: "1px solid var(--color-border-default)",
          background: "var(--color-canvas-subtle)",
          display: "flex",
          flexDirection: "column",
          gap: "8px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "8px",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                padding: "2px 8px",
                borderRadius: "999px",
                fontSize: "11px",
                fontWeight: 700,
                background: recipe.kind === "memory-shard" ? "rgba(14, 116, 144, 0.14)" : "rgba(124, 58, 237, 0.14)",
                color: recipe.kind === "memory-shard" ? "var(--ms-brand, #0e7490)" : "#7c3aed",
                fontFamily: "var(--font-mono, monospace)",
              }}
            >
              {recipe.kind === "memory-shard" ? <DatabaseIcon size={12} /> : <BeakerIcon size={12} />}
              {recipe.kind}
            </span>
            <strong
              style={{
                fontSize: "14px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {recipe.title}
            </strong>
            <span
              style={{
                fontSize: "11px",
                color: "var(--color-fg-muted)",
                fontFamily: "var(--font-mono, monospace)",
              }}
            >
              {recipe.packageName}@{recipe.version}
            </span>
          </div>

          {recipe.evalMetrics.domainLeaderboardRank && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                padding: "2px 8px",
                borderRadius: "999px",
                fontSize: "11px",
                fontWeight: 700,
                background: "rgba(217, 119, 6, 0.14)",
                color: "#b45309",
              }}
            >
              <TrophyIcon size={12} />#{recipe.evalMetrics.domainLeaderboardRank.rank}{" "}
              {recipe.evalMetrics.domainLeaderboardRank.domain} ({recipe.evalMetrics.domainLeaderboardRank.tier})
            </span>
          )}
        </div>

        {/* Badge Ribbon */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center" }}>
          {recipe.targetModel && (
            <span style={badgeStyle("var(--color-canvas-default)", "var(--color-fg-default)")}>
              <CpuIcon size={11} /> {recipe.targetModel.baseModel} · {recipe.targetModel.parameterScale} (
              {recipe.targetModel.mode})
            </span>
          )}
          {recipe.dynamicM && (
            <span style={badgeStyle("rgba(8, 145, 178, 0.12)", "#0e7490")}>
              Dynamic-m: {recipe.dynamicM.mStart}→{recipe.dynamicM.mMax} (cap {recipe.dynamicM.mCap})
            </span>
          )}
          {recipe.memoryContract?.embedderId && (
            <span style={badgeStyle("rgba(37, 99, 235, 0.12)", "#1d4ed8")}>
              <DatabaseIcon size={11} /> {recipe.memoryContract.embedderId}
            </span>
          )}
          {pct(recipe.evalMetrics.gate1To4PassRate) && (
            <span style={badgeStyle("rgba(5, 150, 105, 0.14)", "#047857")}>
              <ShieldCheckIcon size={11} /> Gate 1–4: {pct(recipe.evalMetrics.gate1To4PassRate)}
            </span>
          )}
          {pct(recipe.evalMetrics.passAt1) && (
            <span style={badgeStyle("rgba(5, 150, 105, 0.14)", "#047857")}>
              Pass@1: {pct(recipe.evalMetrics.passAt1)}
            </span>
          )}
          {recipe.evalMetrics.simRmse !== undefined && (
            <span style={badgeStyle("var(--color-canvas-default)", "var(--color-fg-muted)")}>
              Sim RMSE: {recipe.evalMetrics.simRmse}
            </span>
          )}
          {recipe.evalMetrics.independentReproductions !== undefined &&
            recipe.evalMetrics.independentReproductions > 0 && (
              <span style={badgeStyle("rgba(124, 58, 237, 0.12)", "#6d28d9")}>
                <CheckCircleIcon size={11} /> {recipe.evalMetrics.independentReproductions}× Reproduced
              </span>
            )}
        </div>
      </div>

      {/* Interactive Tab Bar */}
      <div
        style={{
          display: "flex",
          gap: "2px",
          padding: "0 12px",
          borderBottom: "1px solid var(--color-border-default)",
          background: "var(--color-canvas-default)",
        }}
      >
        <TabButton active={activeTab === "overview"} onClick={() => setActiveTab("overview")}>
          Recipe &amp; Pins
        </TabButton>
        {hasSamples && (
          <TabButton active={activeTab === "samples"} onClick={() => setActiveTab("samples")}>
            Before / After ({recipe.beforeAfterSamples.length})
          </TabButton>
        )}
        {hasLineage && (
          <TabButton active={activeTab === "lineage"} onClick={() => setActiveTab("lineage")}>
            <GitBranchIcon size={12} /> Diff &amp; Lineage
          </TabButton>
        )}
        {hasBounties && (
          <TabButton active={activeTab === "bounties"} onClick={() => setActiveTab("bounties")}>
            Fix-It Bounties ({recipe.failureBounties.length})
          </TabButton>
        )}
      </div>

      {/* Tab Body */}
      <div style={{ padding: "12px 14px", flex: "1 1 auto", overflowY: "auto" }}>
        {activeTab === "overview" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "14px" }}>
            {/* Left: Pinned Datasets & Memory Shards */}
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <div style={sectionLabelStyle}>Pinned Datasets &amp; Memory Shards</div>
              {Object.keys(recipe.datasetDependencies).length === 0 && recipe.memoryPins.length === 0 ? (
                <div style={{ color: "var(--color-fg-muted)", fontSize: "12px" }}>
                  No external dataset or memory-shard pins declared.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {Object.entries(recipe.datasetDependencies).map(([pkg, ver]) => (
                    <div key={pkg} style={pinRowStyle}>
                      <span style={{ fontFamily: "var(--font-mono, monospace)", fontWeight: 600 }}>{pkg}</span>
                      <span style={{ fontFamily: "var(--font-mono, monospace)", color: "var(--color-fg-muted)" }}>
                        {ver}
                      </span>
                    </div>
                  ))}
                  {recipe.memoryPins.map((pin) => (
                    <div key={`${pin.originNode}:${pin.packageName}`} style={pinRowStyle}>
                      <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 }}>
                        <span style={{ fontFamily: "var(--font-mono, monospace)", fontWeight: 600 }}>
                          {pin.packageName}@{pin.version}
                        </span>
                        <span style={{ fontSize: "11px", color: "var(--color-fg-muted)" }}>
                          {pin.originNode} · {pin.signerPubkey ? `${pin.signerPubkey.slice(0, 12)}…` : "unsigned"}
                        </span>
                      </div>
                      <span style={{ fontSize: "10px", fontWeight: 700, color: "#0e7490" }}>MEMORY</span>
                    </div>
                  ))}
                </div>
              )}

              {recipe.aiGovernance && (
                <div style={{ marginTop: "4px", fontSize: "11px", color: "var(--color-fg-muted)" }}>
                  Governance: RAG {recipe.aiGovernance.allowRag ? "✓" : "✕"} · Pretrain{" "}
                  {recipe.aiGovernance.allowPretrain ? "✓" : "✕"} · Posttrain{" "}
                  {recipe.aiGovernance.allowPosttrain ? "✓" : "✕"}
                  {recipe.aiGovernance.reciprocalTrainingLicense
                    ? ` · ${recipe.aiGovernance.reciprocalTrainingLicense}`
                    : ""}
                </div>
              )}
            </div>

            {/* Right: Formal RLVR Reward Weights */}
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <div style={sectionLabelStyle}>Formal RLVR Reward Weights</div>
              {recipe.rewardWeights ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {REWARD_LABELS.map(({ key, label, color }) => {
                    const val = recipe.rewardWeights?.[key] ?? 0;
                    const widthPct = Math.max(4, Math.min(100, Math.round(val * 100)));
                    return (
                      <div key={key} style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px" }}>
                          <span>{label}</span>
                          <span style={{ fontFamily: "var(--font-mono, monospace)", color: "var(--color-fg-muted)" }}>
                            {val.toFixed(2)}
                          </span>
                        </div>
                        <div
                          style={{
                            height: "5px",
                            borderRadius: "999px",
                            background: "var(--color-canvas-subtle)",
                            overflow: "hidden",
                          }}
                        >
                          <div style={{ width: `${widthPct}%`, height: "100%", background: color }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ color: "var(--color-fg-muted)", fontSize: "12px" }}>
                  Uses default 4-gate formal verification reward profile.
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "samples" && activeSample && (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: "8px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <strong>{activeSample.title}</strong>
                <span style={badgeStyle("var(--color-canvas-subtle)", "var(--color-fg-muted)")}>
                  {activeSample.dialect}
                </span>
              </div>
              <div style={{ display: "flex", gap: "4px" }}>
                <button
                  type="button"
                  onClick={() => setShowRecipeOutput(false)}
                  style={togglePillStyle(!showRecipeOutput)}
                >
                  Base (Gates {activeSample.baseGatesPassed}/4 · Δt {activeSample.baseDeltaT.toFixed(2)})
                </button>
                <button
                  type="button"
                  onClick={() => setShowRecipeOutput(true)}
                  style={togglePillStyle(showRecipeOutput)}
                >
                  Recipe (Gates {activeSample.recipeGatesPassed}/4 · Δt {activeSample.recipeDeltaT.toFixed(2)})
                </button>
              </div>
            </div>
            {activeSample.prompt && (
              <div style={{ fontSize: "12px", color: "var(--color-fg-muted)" }}>Prompt: {activeSample.prompt}</div>
            )}
            <pre
              style={{
                margin: 0,
                padding: "10px",
                borderRadius: "8px",
                background: "var(--color-canvas-subtle)",
                border: "1px solid var(--color-border-default)",
                fontFamily: "var(--font-mono, monospace)",
                fontSize: "12px",
                overflowX: "auto",
                maxHeight: "200px",
              }}
            >
              {showRecipeOutput ? activeSample.recipeOutput : activeSample.baseOutput}
            </pre>
            {recipe.beforeAfterSamples.length > 1 && (
              <div style={{ display: "flex", gap: "6px" }}>
                {recipe.beforeAfterSamples.map((s, idx) => (
                  <button
                    key={s.title}
                    type="button"
                    onClick={() => setSampleIdx(idx)}
                    style={togglePillStyle(idx === sampleIdx)}
                  >
                    Sample {idx + 1}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "lineage" && recipe.lineage && (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {recipe.lineage.parentPackage && (
              <div style={{ fontSize: "12px" }}>
                Forked from{" "}
                <strong style={{ fontFamily: "var(--font-mono, monospace)" }}>{recipe.lineage.parentPackage}</strong>
                {recipe.lineage.parentAuthor ? ` by ${recipe.lineage.parentAuthor}` : ""}
              </div>
            )}
            {recipe.lineage.diffEntries && recipe.lineage.diffEntries.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                {recipe.lineage.diffEntries.map((d) => (
                  <div key={`${d.field}:${d.kind}`} style={pinRowStyle}>
                    <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "12px" }}>{d.field}</span>
                    <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "12px" }}>
                      {d.before ? `${d.before} → ` : "+ "}
                      {d.after ?? "(removed)"}
                      {d.deltaLabel ? ` (${d.deltaLabel})` : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {recipe.lineage.upstreamCredits && recipe.lineage.upstreamCredits.length > 0 && (
              <div style={{ fontSize: "11px", color: "var(--color-fg-muted)" }}>
                Upstream attribution: {recipe.lineage.upstreamCredits.join(", ")}
              </div>
            )}
          </div>
        )}

        {activeTab === "bounties" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{ fontSize: "12px", color: "var(--color-fg-muted)" }}>
              Remaining high-Δt failure rollouts — submit a 4-gate verified fix to earn reputation &amp; co-author
              credit in v1.1:
            </div>
            {recipe.failureBounties.map((b) => (
              <div key={b.title} style={pinRowStyle}>
                <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                  <strong>{b.title}</strong>
                  <span style={{ fontSize: "11px", color: "var(--color-fg-muted)" }}>
                    {b.dialect} · Δt = {b.deltaT.toFixed(2)}
                    {b.bountyCredits ? ` · +${b.bountyCredits} HPC credits` : ""}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (b.url) navigate(b.url);
                    else if (b.challengeId) navigate(`/annotate/${b.challengeId}`);
                  }}
                  style={actionButtonStyle(true)}
                >
                  Fix in Annotator
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bottom 1-Click Action Footer */}
      <div
        style={{
          padding: "8px 14px",
          borderTop: "1px solid var(--color-border-default)",
          background: "var(--color-canvas-subtle)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "8px",
        }}
      >
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() =>
              navigate(`/editor?mode=training-studio&forkRecipe=${encodeURIComponent(recipe.packageName)}`)
            }
            style={actionButtonStyle(true)}
          >
            <RepoForkedIcon size={12} /> Fork &amp; Tune
          </button>
          {recipe.webGpuRunnable && (
            <button
              type="button"
              onClick={() =>
                navigate(
                  `/editor?mode=training-studio&run=webgpu&recipe=${encodeURIComponent(recipe.packageName)}${
                    artifactId ? `&artifact=${artifactId}` : ""
                  }`,
                )
              }
              style={actionButtonStyle(false)}
            >
              <ZapIcon size={12} /> Run in WebGPU
            </button>
          )}
        </div>

        <div style={{ display: "flex", gap: "6px" }}>
          <button type="button" onClick={() => handleCopy("bibtex")} style={actionButtonStyle(false)}>
            <CopyIcon size={12} /> {copiedMode === "bibtex" ? "Copied BibTeX" : "BibTeX"}
          </button>
          <button type="button" onClick={() => handleCopy("manifest")} style={actionButtonStyle(false)}>
            <CopyIcon size={12} /> {copiedMode === "manifest" ? "Copied JSON" : "Manifest"}
          </button>
        </div>
      </div>
    </div>
  );
};

const TabButton: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({
  active,
  onClick,
  children,
}) => (
  <button
    type="button"
    onClick={onClick}
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: "4px",
      padding: "7px 10px",
      border: "none",
      borderBottom: active ? "2px solid var(--ms-brand, #0e7490)" : "2px solid transparent",
      background: "transparent",
      color: active ? "var(--color-fg-default)" : "var(--color-fg-muted)",
      fontWeight: active ? 600 : 500,
      fontSize: "12px",
      cursor: "pointer",
    }}
  >
    {children}
  </button>
);

const sectionLabelStyle: React.CSSProperties = {
  fontSize: "11px",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "var(--color-fg-muted)",
};

const pinRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "8px",
  padding: "6px 8px",
  borderRadius: "6px",
  border: "1px solid var(--color-border-default)",
  background: "var(--color-canvas-subtle)",
  fontSize: "12px",
};

function badgeStyle(bg: string, fg: string): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    padding: "2px 7px",
    borderRadius: "6px",
    fontSize: "11px",
    fontWeight: 600,
    background: bg,
    color: fg,
    border: "1px solid var(--color-border-default)",
  };
}

function togglePillStyle(active: boolean): React.CSSProperties {
  return {
    padding: "3px 8px",
    borderRadius: "999px",
    border: "1px solid var(--color-border-default)",
    background: active ? "var(--ms-brand, #0e7490)" : "var(--color-canvas-subtle)",
    color: active ? "#ffffff" : "var(--color-fg-default)",
    fontSize: "11px",
    fontWeight: 600,
    cursor: "pointer",
  };
}

function actionButtonStyle(primary: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: "5px",
    padding: "5px 10px",
    borderRadius: "6px",
    border: primary ? "1px solid var(--ms-brand, #0e7490)" : "1px solid var(--color-border-default)",
    background: primary ? "var(--ms-brand, #0e7490)" : "var(--color-canvas-default)",
    color: primary ? "#ffffff" : "var(--color-fg-default)",
    fontSize: "12px",
    fontWeight: 600,
    cursor: "pointer",
  };
}

export default TrainingRecipeArtifactCard;
