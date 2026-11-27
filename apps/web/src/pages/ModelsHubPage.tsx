// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import styled from "styled-components";
import { usePageTitle } from "../util/title";

// ─────────────────────────────────────────────────────────────────────────────
// Types (mirroring apps/api/src/routes/models-and-runs.ts & recipe-debug.ts)
// ─────────────────────────────────────────────────────────────────────────────

type ModelRegistryKind = "model-core" | "lora-adapter" | "projection-head";
type ModelPromotionStage = "draft" | "staging" | "production" | "deprecated";

interface UncertaintyCalibrationResult {
  ece: number;
  meanSpreadOnErrors: number;
  meanSpreadOnValid: number;
  separationGap: number;
  sampleCount: number;
}

interface FormalModelEvalReport {
  promoted: boolean;
  totalCases: number;
  formalGatePassRate: number;
  nonTrivialPassRate: number;
  rewardHackingRate: number;
  diskAnnRecallAtK: number;
  calibration?: UncertaintyCalibrationResult | null;
  failureReasons?: string[];
  perCase?: {
    caseId: string;
    formalPassed: boolean;
    behavioralPassed: boolean;
    rewardHacking: boolean;
    rewardHackingReasons: string[];
    outputSpreadDeltaT: number;
  }[];
}

interface StoredPromotionProof {
  attestation: Record<string, unknown>;
  proof: {
    type: string;
    cryptosuite: string;
    created: string;
    verificationMethod: string;
    proofPurpose?: string;
    publicKeyMultibase?: string;
    payloadSha256?: string;
    proofValue: string;
  };
}

interface ModelRegistryEntry {
  id: number;
  name: string;
  version: string;
  kind: ModelRegistryKind;
  baseModelRef: string | null;
  recipeName: string | null;
  recipeVersion: string | null;
  promotionStage: ModelPromotionStage;
  parameterScale: string | null;
  loraRank: number | null;
  projectionLayerIndex: number | null;
  retrieverEmbeddingDim: number | null;
  memoryContract: Record<string, unknown> | null;
  evalReport: FormalModelEvalReport | null;
  zonotopeCert: Record<string, unknown> | null;
  ed25519Proof: StoredPromotionProof | null;
  weightSha256: string | null;
  weightBytes: number;
  storageKey: string | null;
  weightsDownloadUrl: string | null;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
}

interface RegressionDiff {
  promotionChange: "unchanged-pass" | "unchanged-fail" | "promoted" | "regressed";
  formalPassRateDelta: number;
  nonTrivialPassRateDelta: number;
  rewardHackingRateDelta: number;
  eceDelta: number;
  flippedPassToFail: string[];
  flippedFailToPass: string[];
}

interface PromotionDiagnosticError {
  status: number;
  error: string;
  failureReasons: string[];
  previousProductionVersion?: string;
  regressionDiff?: RegressionDiff;
}

interface XRayTokenHeat {
  index: number;
  text: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  groupId: number;
  spreadDeltaT: number;
  worstCaseLoss: number;
  intensity: number;
  exceedsRetrievalTau: boolean;
}

interface WorstCaseCornerComponent {
  groupId: number;
  label: string;
  symbolName?: string;
  xiSign: 1 | -1;
  contributionMagnitude: number;
}

interface LayerTelemetrySnapshot {
  layerIndex: number;
  layerName: string;
  mIn: number;
  mOut: number;
  maxGeneratorNorm: number;
  meanBoxHalfWidth: number;
  events: { kind?: string; [k: string]: unknown }[];
}

interface ExampleXRayDiagnostics {
  exampleId: string;
  dialect: string;
  mInit: number;
  meanWorstCaseLoss: number;
  maxSpreadDeltaT: number;
  peakTokenIndex: number;
  peakTokenText: string;
  retrievalTau: number;
  tokenHeat: XRayTokenHeat[];
  layerWaterfall: LayerTelemetrySnapshot[];
  worstCaseCorner: WorstCaseCornerComponent[];
  rewardHackingAudit?: {
    suspected?: boolean;
    score?: number;
    reasons?: string[];
  };
}

interface DiskAnnQueryResult {
  mode?: string;
  latencyMs?: number;
  results?: {
    id?: string;
    title?: string;
    symbol?: string;
    packageName?: string;
    version?: string;
    score?: number;
    snippet?: string;
    content?: string;
    dialect?: string;
  }[];
  compatibleShards?: { shardId: string; packageName: string; version: string; embedderId: string }[];
  incompatibleShards?: { shardId: string; packageName: string; reasons: string[] }[];
  error?: string;
  reasons?: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function getAuthHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const token = localStorage.getItem("modelscript-auth-token") || localStorage.getItem("token");
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
    }
  } catch {
    // Ignore sandboxed storage access errors
  }
  return headers;
}

function formatPct(value: number | null | undefined, digits = 1): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

function formatNum(value: number | null | undefined, digits = 4): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let idx = 0;
  let val = bytes;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx += 1;
  }
  return `${val.toFixed(idx === 0 ? 0 : 2)} ${units[idx]}`;
}

function stageLabel(stage: ModelPromotionStage): string {
  switch (stage) {
    case "production":
      return "Production ✓";
    case "staging":
      return "Staging CI";
    case "draft":
      return "Draft";
    case "deprecated":
      return "Deprecated";
  }
}

function kindLabel(kind: ModelRegistryKind): string {
  switch (kind) {
    case "model-core":
      return "Model Core";
    case "lora-adapter":
      return "LoRA Adapter";
    case "projection-head":
      return "Projection Head";
  }
}

const DEFAULT_PLAYGROUND_SNIPPET = `model RCThermalPlant
  parameter Real R(unit="Ohm") = 100.0;
  parameter Real C(unit="F") = 1e-3;
  Real v(start=0.0, unit="V");
  Real i(unit="A");
equation
  i = (5.0 - v) / R;
  C * der(v) = i;
end RCThermalPlant;`;

// ─────────────────────────────────────────────────────────────────────────────
// Styled Components
// ─────────────────────────────────────────────────────────────────────────────

const PageContainer = styled.div`
  max-width: 1120px;
  margin: 0 auto;
  padding: 20px 20px 56px;
  color: var(--color-text-primary);
`;

const HeaderRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
`;

const TitleBlock = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const PageTitle = styled.h1`
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--color-text-heading);
`;

const Subtitle = styled.p`
  margin: 0;
  font-size: 13px;
  color: var(--color-text-muted);
`;

const ButtonRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
`;

const ActionButton = styled.button<{ $variant?: "primary" | "secondary" | "success" | "danger" }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 13px;
  border-radius: 8px;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition:
    opacity 0.15s ease,
    border-color 0.15s ease;
  border: 1px solid
    ${(p) =>
      p.$variant === "primary"
        ? "var(--ms-brand)"
        : p.$variant === "success"
          ? "var(--status-verified-border)"
          : p.$variant === "danger"
            ? "var(--status-danger-border)"
            : "var(--color-border-default)"};
  background: ${(p) =>
    p.$variant === "primary"
      ? "var(--ms-brand)"
      : p.$variant === "success"
        ? "var(--status-verified-bg)"
        : p.$variant === "danger"
          ? "var(--status-danger-bg)"
          : "var(--color-bg-surface)"};
  color: ${(p) =>
    p.$variant === "primary"
      ? "var(--ms-brand-contrast, #ffffff)"
      : p.$variant === "success"
        ? "var(--status-verified-fg)"
        : p.$variant === "danger"
          ? "var(--status-danger-fg)"
          : "var(--color-text-primary)"};
  &:hover:not(:disabled) {
    opacity: ${(p) => (p.$variant === "primary" ? 0.92 : 1)};
  }
  &:disabled {
    opacity: 0.48;
    cursor: not-allowed;
  }
`;

const NavLinkButton = styled(Link)`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  border-radius: 8px;
  font-size: 12.5px;
  font-weight: 600;
  text-decoration: none;
  color: var(--color-text-primary);
  border: 1px solid var(--color-border-default);
  background: var(--color-bg-surface);
  &:hover {
    text-decoration: none;
    border-color: var(--ms-brand);
    background: var(--surface-row-hover);
  }
`;

const FilterBar = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px solid var(--color-border);
  background: var(--color-bg-card);
  box-shadow: var(--ms-shadow-card);
  margin-bottom: 18px;
`;

const FilterGroup = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
`;

const FilterLabel = styled.span`
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ms-text-2, #8b949e);
  min-width: 68px;
`;

const Pill = styled.button<{ $active?: boolean }>`
  padding: 5px 11px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid ${(p) => (p.$active ? "var(--ms-brand, #38bdf8)" : "var(--ms-border, #30363d)")};
  background: ${(p) => (p.$active ? "rgba(56, 189, 248, 0.16)" : "transparent")};
  color: ${(p) => (p.$active ? "var(--ms-brand, #38bdf8)" : "var(--ms-text-2, #8b949e)")};
  &:hover {
    color: var(--ms-text-1, #e6edf3);
    border-color: var(--ms-brand, #38bdf8);
  }
`;

const StageBadge = styled.span<{ $stage: ModelPromotionStage }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 700;
  padding: 3px 9px;
  border-radius: 999px;
  white-space: nowrap;
  background: ${(p) =>
    p.$stage === "production"
      ? "rgba(52, 211, 153, 0.16)"
      : p.$stage === "staging"
        ? "rgba(56, 189, 248, 0.16)"
        : p.$stage === "deprecated"
          ? "rgba(248, 113, 113, 0.16)"
          : "rgba(148, 163, 184, 0.16)"};
  color: ${(p) =>
    p.$stage === "production"
      ? "#34d399"
      : p.$stage === "staging"
        ? "#38bdf8"
        : p.$stage === "deprecated"
          ? "#f87171"
          : "#94a3b8"};
  border: 1px solid
    ${(p) =>
      p.$stage === "production"
        ? "rgba(52, 211, 153, 0.45)"
        : p.$stage === "staging"
          ? "rgba(56, 189, 248, 0.45)"
          : p.$stage === "deprecated"
            ? "rgba(248, 113, 113, 0.45)"
            : "rgba(148, 163, 184, 0.35)"};
`;

const KindBadge = styled.span<{ $kind: ModelRegistryKind }>`
  display: inline-flex;
  align-items: center;
  font-size: 11px;
  font-weight: 600;
  font-family: var(--ms-font-mono, monospace);
  padding: 3px 8px;
  border-radius: 6px;
  background: ${(p) =>
    p.$kind === "model-core"
      ? "rgba(99, 102, 241, 0.16)"
      : p.$kind === "lora-adapter"
        ? "rgba(245, 158, 11, 0.16)"
        : "rgba(236, 72, 153, 0.16)"};
  color: ${(p) => (p.$kind === "model-core" ? "#818cf8" : p.$kind === "lora-adapter" ? "#fbbf24" : "#f472b6")};
  border: 1px solid
    ${(p) =>
      p.$kind === "model-core"
        ? "rgba(99, 102, 241, 0.4)"
        : p.$kind === "lora-adapter"
          ? "rgba(245, 158, 11, 0.4)"
          : "rgba(236, 72, 153, 0.4)"};
`;

const ProofBadge = styled.span<{ $verified: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 600;
  font-family: var(--ms-font-mono, monospace);
  padding: 3px 9px;
  border-radius: 999px;
  background: ${(p) => (p.$verified ? "rgba(16, 185, 129, 0.14)" : "rgba(148, 163, 184, 0.12)")};
  color: ${(p) => (p.$verified ? "#34d399" : "#94a3b8")};
  border: 1px solid ${(p) => (p.$verified ? "rgba(16, 185, 129, 0.45)" : "rgba(148, 163, 184, 0.3)")};
`;

const CardsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 14px;
`;

const ModelCardBox = styled(Link)`
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border-radius: 12px;
  border: 1px solid var(--ms-border, #30363d);
  background: var(--ms-bg-elv, #161b22);
  text-decoration: none;
  color: inherit;
  transition:
    border-color 0.15s ease,
    transform 0.15s ease;
  &:hover {
    border-color: var(--ms-brand, #38bdf8);
    transform: translateY(-1px);
  }
`;

const SectionCard = styled.section`
  padding: 18px 20px;
  border-radius: 12px;
  border: 1px solid var(--ms-border, #30363d);
  background: var(--ms-bg-elv, #161b22);
  margin-bottom: 18px;
`;

const SectionTitle = styled.h2`
  margin: 0 0 12px;
  font-size: 15px;
  font-weight: 700;
  color: var(--ms-text-heading, var(--ms-text-1, #f0f6fc));
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`;

const MetricsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 12px;
`;

const MetricTile = styled.div`
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid var(--ms-divider, #21262d);
  background: var(--ms-bg, #0d1117);
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const MetricLabel = styled.span`
  font-size: 11px;
  font-weight: 600;
  color: var(--ms-text-2, #8b949e);
  text-transform: uppercase;
  letter-spacing: 0.04em;
`;

const MetricValue = styled.span<{ $tone?: "good" | "warn" | "bad" | "neutral" }>`
  font-size: 20px;
  font-weight: 700;
  font-family: var(--ms-font-mono, monospace);
  color: ${(p) =>
    p.$tone === "good"
      ? "#34d399"
      : p.$tone === "warn"
        ? "#fbbf24"
        : p.$tone === "bad"
          ? "#f87171"
          : "var(--ms-text-1, #e6edf3)"};
`;

const MetricSub = styled.span`
  font-size: 11px;
  color: var(--ms-text-2, #8b949e);
`;

const TwoColGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
  gap: 18px;
`;

const ContractTable = styled.dl`
  display: grid;
  grid-template-columns: minmax(160px, auto) 1fr;
  gap: 8px 16px;
  margin: 0;
  font-size: 13px;
  dt {
    color: var(--ms-text-2, #8b949e);
    font-weight: 600;
  }
  dd {
    margin: 0;
    font-family: var(--ms-font-mono, monospace);
    color: var(--ms-text-1, #e6edf3);
    word-break: break-all;
  }
`;

const DiagnosticBox = styled.div<{ $tone: "error" | "success" | "info" }>`
  margin-top: 12px;
  padding: 12px 14px;
  border-radius: 10px;
  font-size: 13px;
  border: 1px solid
    ${(p) =>
      p.$tone === "error"
        ? "rgba(248, 113, 113, 0.5)"
        : p.$tone === "success"
          ? "rgba(52, 211, 153, 0.5)"
          : "rgba(56, 189, 248, 0.45)"};
  background: ${(p) =>
    p.$tone === "error"
      ? "rgba(239, 68, 68, 0.1)"
      : p.$tone === "success"
        ? "rgba(16, 185, 129, 0.1)"
        : "rgba(56, 189, 248, 0.08)"};
  color: var(--ms-text-1, #e6edf3);
`;

const Input = styled.input`
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--ms-border, #30363d);
  background: var(--ms-bg, #0d1117);
  color: var(--ms-text-1, #e6edf3);
  font-size: 13px;
`;

const Select = styled.select`
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--ms-border, #30363d);
  background: var(--ms-bg, #0d1117);
  color: var(--ms-text-1, #e6edf3);
  font-size: 13px;
`;

const CodeTextArea = styled.textarea`
  width: 100%;
  box-sizing: border-box;
  min-height: 150px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--ms-border, #30363d);
  background: var(--ms-bg, #0d1117);
  color: var(--ms-text-1, #e6edf3);
  font-family: var(--ms-font-mono, monospace);
  font-size: 12px;
  line-height: 1.5;
  resize: vertical;
`;

const ModalBackdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: 1200;
  background: rgba(0, 0, 0, 0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
`;

const ModalCard = styled.div`
  width: 100%;
  max-width: 560px;
  max-height: 90vh;
  overflow-y: auto;
  padding: 20px 22px;
  border-radius: 14px;
  border: 1px solid var(--ms-border, #30363d);
  background: var(--ms-bg-elv, #161b22);
  color: var(--ms-text-1, #e6edf3);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
`;

const FormGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
`;

const FieldLabel = styled.label`
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ms-text-2, #8b949e);
`;

const TokenHeatChip = styled.span<{ $intensity: number; $exceeds: boolean }>`
  display: inline-block;
  padding: 2px 5px;
  margin: 2px;
  border-radius: 4px;
  font-family: var(--ms-font-mono, monospace);
  font-size: 11px;
  background: ${(p) => `rgba(248, 113, 113, ${Math.min(0.75, 0.08 + p.$intensity * 0.65).toFixed(2)})`};
  border: 1px solid ${(p) => (p.$exceeds ? "#fbbf24" : "rgba(148, 163, 184, 0.2)")};
  color: var(--ms-text-1, #e6edf3);
`;

const SmallTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  th,
  td {
    text-align: left;
    padding: 7px 10px;
    border-bottom: 1px solid var(--ms-divider, #21262d);
  }
  th {
    color: var(--ms-text-2, #8b949e);
    font-weight: 600;
    font-size: 11px;
    text-transform: uppercase;
  }
  td {
    font-family: var(--ms-font-mono, monospace);
  }
`;

// ─────────────────────────────────────────────────────────────────────────────
// Sub-component: Register Model / Adapter Modal
// ─────────────────────────────────────────────────────────────────────────────

interface RegisterModalProps {
  onClose: () => void;
  onRegistered: (model: ModelRegistryEntry) => void;
}

const RegisterModelModal: React.FC<RegisterModalProps> = ({ onClose, onRegistered }) => {
  const [name, setName] = useState("");
  const [version, setVersion] = useState("0.1.0");
  const [kind, setKind] = useState<ModelRegistryKind>("model-core");
  const [baseModelRef, setBaseModelRef] = useState("");
  const [parameterScale, setParameterScale] = useState("1.5B");
  const [recipeName, setRecipeName] = useState("");
  const [recipeVersion, setRecipeVersion] = useState("0.1.0");
  const [loraRank, setLoraRank] = useState("16");
  const [projectionLayerIndex, setProjectionLayerIndex] = useState("18");
  const [retrieverEmbeddingDim, setRetrieverEmbeddingDim] = useState("768");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        version: version.trim(),
        kind,
        parameterScale: parameterScale.trim() || undefined,
        baseModelRef: baseModelRef.trim() || undefined,
        recipeName: recipeName.trim() || undefined,
        recipeVersion: recipeName.trim() ? recipeVersion.trim() || undefined : undefined,
        retrieverEmbeddingDim: retrieverEmbeddingDim.trim() ? Number(retrieverEmbeddingDim) : undefined,
      };
      if (kind === "lora-adapter" && loraRank.trim()) {
        payload["loraRank"] = Number(loraRank);
      }
      if (kind === "projection-head" && projectionLayerIndex.trim()) {
        payload["projectionLayerIndex"] = Number(projectionLayerIndex);
      }

      const res = await fetch("/api/v1/models", {
        method: "POST",
        headers: getAuthHeaders({ "Content-Type": "application/json" }),
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as { model?: ModelRegistryEntry; error?: string };
      if (!res.ok || !data.model) {
        throw new Error(data.error || `Registration failed (${res.status})`);
      }
      onRegistered(data.model);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalBackdrop onClick={onClose}>
      <ModalCard onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 17 }}>Register Model / Adapter</h2>
            <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--ms-text-2, #8b949e)" }}>
              Validates compatibility contract against base model-core and registers a draft artifact.
            </p>
          </div>
          <ActionButton type="button" onClick={onClose}>
            ✕
          </ActionButton>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <FormGrid>
            <FieldLabel>
              Model Name *
              <Input
                required
                placeholder="e.g. ansatz-modelica-core"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </FieldLabel>
            <FieldLabel>
              Version *
              <Input required placeholder="0.1.0" value={version} onChange={(e) => setVersion(e.target.value)} />
            </FieldLabel>
          </FormGrid>

          <FormGrid>
            <FieldLabel>
              Artifact Kind *
              <Select value={kind} onChange={(e) => setKind(e.target.value as ModelRegistryKind)}>
                <option value="model-core">model-core</option>
                <option value="lora-adapter">lora-adapter</option>
                <option value="projection-head">projection-head</option>
              </Select>
            </FieldLabel>
            <FieldLabel>
              Parameter Scale
              <Input
                placeholder="e.g. 1.5B, 3B, 7B"
                value={parameterScale}
                onChange={(e) => setParameterScale(e.target.value)}
              />
            </FieldLabel>
          </FormGrid>

          <FormGrid>
            <FieldLabel>
              Base Model Ref {kind !== "model-core" ? "(Recommended)" : "(Optional)"}
              <Input
                placeholder="e.g. ansatz-core@1.0.0"
                value={baseModelRef}
                onChange={(e) => setBaseModelRef(e.target.value)}
              />
            </FieldLabel>
            <FieldLabel>
              Retriever Embedding Dim (W_q)
              <Input
                type="number"
                min={1}
                placeholder="768"
                value={retrieverEmbeddingDim}
                onChange={(e) => setRetrieverEmbeddingDim(e.target.value)}
              />
            </FieldLabel>
          </FormGrid>

          {kind === "lora-adapter" && (
            <FieldLabel>
              LoRA Rank (r)
              <Input
                type="number"
                min={1}
                placeholder="16"
                value={loraRank}
                onChange={(e) => setLoraRank(e.target.value)}
              />
            </FieldLabel>
          )}

          {kind === "projection-head" && (
            <FieldLabel>
              Projection Layer Index
              <Input
                type="number"
                min={0}
                placeholder="18"
                value={projectionLayerIndex}
                onChange={(e) => setProjectionLayerIndex(e.target.value)}
              />
            </FieldLabel>
          )}

          <FormGrid>
            <FieldLabel>
              Training Recipe Name
              <Input
                placeholder="e.g. modelica-sft-dynamic-m"
                value={recipeName}
                onChange={(e) => setRecipeName(e.target.value)}
              />
            </FieldLabel>
            <FieldLabel>
              Recipe Version
              <Input placeholder="0.1.0" value={recipeVersion} onChange={(e) => setRecipeVersion(e.target.value)} />
            </FieldLabel>
          </FormGrid>

          {error && <DiagnosticBox $tone="error">{error}</DiagnosticBox>}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
            <ActionButton type="button" onClick={onClose}>
              Cancel
            </ActionButton>
            <ActionButton type="submit" $variant="primary" disabled={submitting}>
              {submitting ? "Registering…" : "Register Draft Artifact"}
            </ActionButton>
          </div>
        </form>
      </ModalCard>
    </ModalBackdrop>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Detail View: Certified Model Card + Formal Promotion + Perturbation Playground
// ─────────────────────────────────────────────────────────────────────────────

const ModelCardDetailView: React.FC<{ name: string; version: string }> = ({ name, version }) => {
  const [model, setModel] = useState<ModelRegistryEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Formal-Proof-Gated Promotion state
  const [promotingStage, setPromotingStage] = useState<"staging" | "production" | null>(null);
  const [promotionError, setPromotionError] = useState<PromotionDiagnosticError | null>(null);
  const [promotionSuccess, setPromotionSuccess] = useState<string | null>(null);

  // Interactive Perturbation Playground state
  const [epsilon, setEpsilon] = useState<number>(0.08);
  const [computeDialM, setComputeDialM] = useState<number>(8);
  const [dialect, setDialect] = useState<string>("modelica");
  const [snippet, setSnippet] = useState<string>(DEFAULT_PLAYGROUND_SNIPPET);
  const [xrayLoading, setXrayLoading] = useState(false);
  const [xrayError, setXrayError] = useState<string | null>(null);
  const [xrayResult, setXrayResult] = useState<ExampleXRayDiagnostics | null>(null);

  // DiskANN query test state
  const [diskAnnQuery, setDiskAnnQuery] = useState<string>("RC thermal circuit differential equation");
  const [diskAnnLoading, setDiskAnnLoading] = useState(false);
  const [diskAnnResult, setDiskAnnResult] = useState<DiskAnnQueryResult | null>(null);

  usePageTitle(model ? `${model.name}@${model.version} — Certified Model Card` : "Certified Model Card");

  const loadModel = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/models/${encodeURIComponent(name)}/${encodeURIComponent(version)}`, {
        headers: getAuthHeaders(),
        credentials: "include",
      });
      const data = (await res.json().catch(() => ({}))) as { model?: ModelRegistryEntry; error?: string };
      if (!res.ok || !data.model) {
        throw new Error(data.error || `Failed to load model (${res.status})`);
      }
      setModel(data.model);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [name, version]);

  useEffect(() => {
    void loadModel();
  }, [loadModel]);

  const handlePromote = useCallback(
    async (targetStage: "staging" | "production") => {
      setPromotingStage(targetStage);
      setPromotionError(null);
      setPromotionSuccess(null);
      try {
        const res = await fetch(`/api/v1/models/${encodeURIComponent(name)}/${encodeURIComponent(version)}/promote`, {
          method: "POST",
          headers: getAuthHeaders({ "Content-Type": "application/json" }),
          credentials: "include",
          body: JSON.stringify({ targetStage }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          model?: ModelRegistryEntry;
          error?: string;
          failureReasons?: string[];
          previousProductionVersion?: string;
          regressionDiff?: RegressionDiff;
          proof?: { payloadSha256?: string; cryptosuite?: string };
        };
        if (!res.ok) {
          setPromotionError({
            status: res.status,
            error: data.error || `Promotion rejected (HTTP ${res.status})`,
            failureReasons: Array.isArray(data.failureReasons) ? data.failureReasons : [],
            previousProductionVersion: data.previousProductionVersion,
            regressionDiff: data.regressionDiff,
          });
          return;
        }
        if (data.model) {
          setModel(data.model);
        }
        const digestHint = data.proof?.payloadSha256 ? ` · sha256:${data.proof.payloadSha256.slice(0, 12)}…` : "";
        setPromotionSuccess(
          `Promoted to '${targetStage}' with Ed25519 (${data.proof?.cryptosuite ?? "eddsa-jcs-2022"}) proof${digestHint}.`,
        );
      } catch (err) {
        setPromotionError({
          status: 0,
          error: err instanceof Error ? err.message : String(err),
          failureReasons: [],
        });
      } finally {
        setPromotingStage(null);
      }
    },
    [name, version],
  );

  const handleRunDiskAnnTest = useCallback(
    async (queryText?: string) => {
      const q = (queryText ?? diskAnnQuery).trim();
      if (!q) return;
      setDiskAnnLoading(true);
      try {
        const embedderId =
          model?.memoryContract && typeof model.memoryContract["embedderId"] === "string"
            ? model.memoryContract["embedderId"]
            : undefined;
        const embedderHash =
          model?.memoryContract && typeof model.memoryContract["embedderHash"] === "string"
            ? model.memoryContract["embedderHash"]
            : undefined;

        const res = await fetch("/api/v1/memory/query", {
          method: "POST",
          headers: getAuthHeaders({ "Content-Type": "application/json" }),
          credentials: "include",
          body: JSON.stringify({
            mode: "hybrid",
            textQuery: q,
            topK: 5,
            ...(embedderId ? { embedderId } : {}),
            ...(embedderHash ? { embedderHash } : {}),
          }),
        });
        const data = (await res.json().catch(() => ({}))) as DiskAnnQueryResult;
        setDiskAnnResult(data);
      } catch (err) {
        setDiskAnnResult({ error: err instanceof Error ? err.message : String(err) });
      } finally {
        setDiskAnnLoading(false);
      }
    },
    [diskAnnQuery, model],
  );

  const handleRunXRay = useCallback(async () => {
    setXrayLoading(true);
    setXrayError(null);
    try {
      const res = await fetch("/api/v1/recipes/xray", {
        method: "POST",
        headers: getAuthHeaders({ "Content-Type": "application/json" }),
        credentials: "include",
        body: JSON.stringify({
          source: snippet,
          dialect,
          computeDialM,
          uri: `playground://${name}/${version}.${dialect}`,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as ExampleXRayDiagnostics & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || `X-Ray probe failed (${res.status})`);
      }
      setXrayResult(data);
      // Also run DiskANN memory probe using peak token + query for end-to-end verification
      const probeQuery = diskAnnQuery.trim() || data.peakTokenText || snippet.slice(0, 120);
      void handleRunDiskAnnTest(probeQuery);
    } catch (err) {
      setXrayError(err instanceof Error ? err.message : String(err));
    } finally {
      setXrayLoading(false);
    }
  }, [snippet, dialect, computeDialM, name, version, diskAnnQuery, handleRunDiskAnnTest]);

  if (loading) {
    return <PageContainer>Loading certified model card…</PageContainer>;
  }
  if (error || !model) {
    return (
      <PageContainer>
        <NavLinkButton to="/models">← Back to Models Hub</NavLinkButton>
        <DiagnosticBox $tone="error" style={{ marginTop: 16 }}>
          {error || "Model not found."}
        </DiagnosticBox>
      </PageContainer>
    );
  }

  const evalReport = model.evalReport;
  const ece = evalReport?.calibration?.ece;
  const hasProof = Boolean(model.ed25519Proof?.proof?.proofValue);
  const downloadHref =
    model.weightsDownloadUrl ||
    `/api/v1/models/${encodeURIComponent(model.name)}/${encodeURIComponent(model.version)}/weights`;
  const effectiveSpread = xrayResult ? xrayResult.maxSpreadDeltaT * Math.max(0, epsilon / 0.08) : null;

  return (
    <PageContainer>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <NavLinkButton to="/models">← Models Hub</NavLinkButton>
        <NavLinkButton to="/runs">Training Runs</NavLinkButton>
        <NavLinkButton to="/leaderboards">Leaderboards</NavLinkButton>
      </div>

      {/* Header & Attestation Strip */}
      <SectionCard>
        <HeaderRow style={{ marginBottom: 12 }}>
          <TitleBlock>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
              <PageTitle>
                {model.name} <span style={{ opacity: 0.65, fontWeight: 500 }}>@{model.version}</span>
              </PageTitle>
              <StageBadge $stage={model.promotionStage}>{stageLabel(model.promotionStage)}</StageBadge>
              <KindBadge $kind={model.kind}>{kindLabel(model.kind)}</KindBadge>
              <ProofBadge $verified={hasProof}>
                {hasProof
                  ? `✓ Ed25519 (${model.ed25519Proof?.proof.cryptosuite ?? "eddsa-jcs-2022"})`
                  : "Unsigned Draft"}
              </ProofBadge>
            </div>
            <Subtitle>
              {model.parameterScale ? `Scale: ${model.parameterScale}` : "Scale unspecified"}
              {model.recipeName ? ` · Recipe: ${model.recipeName}@${model.recipeVersion ?? "latest"}` : ""}
              {` · Updated ${new Date(model.updatedAt).toLocaleString()}`}
            </Subtitle>
          </TitleBlock>

          <ButtonRow>
            <ActionButton
              type="button"
              $variant="secondary"
              disabled={promotingStage !== null || model.promotionStage === "staging"}
              onClick={() => void handlePromote("staging")}
            >
              {promotingStage === "staging" ? "Verifying Gate…" : "Promote to Staging"}
            </ActionButton>
            <ActionButton
              type="button"
              $variant="success"
              disabled={promotingStage !== null || model.promotionStage === "production"}
              onClick={() => void handlePromote("production")}
            >
              {promotingStage === "production" ? "Verifying Gate & Diff…" : "Promote to Production"}
            </ActionButton>
          </ButtonRow>
        </HeaderRow>

        {/* Weights SHA-256 + Direct HTTP Range Download */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "10px 14px",
            borderRadius: 10,
            background: "var(--ms-bg, #0d1117)",
            border: "1px solid var(--ms-divider, #21262d)",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 12 }}>
            <span style={{ color: "var(--ms-text-2, #8b949e)", fontWeight: 600 }}>
              Weight Artifact Digest (SHA-256) &amp; HTTP Range Streaming
            </span>
            <code style={{ fontFamily: "var(--ms-font-mono, monospace)", wordBreak: "break-all" }}>
              {model.weightSha256 ? `sha256:${model.weightSha256}` : "No weight binary uploaded yet"}
              {model.weightBytes > 0 ? ` (${formatBytes(model.weightBytes)})` : ""}
            </code>
          </div>
          <a
            href={downloadHref}
            download
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "7px 13px",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 600,
              textDecoration: "none",
              border: "1px solid var(--ms-brand, #38bdf8)",
              color: "var(--ms-brand, #38bdf8)",
              background: "rgba(56, 189, 248, 0.1)",
              opacity: model.storageKey ? 1 : 0.65,
            }}
            title="Supports HTTP Range (206 Partial Content) & ETag verification"
          >
            ⬇ Download Weights (HTTP Range)
          </a>
        </div>

        {/* Ed25519 Proof Details */}
        {hasProof && model.ed25519Proof && (
          <div
            style={{
              marginTop: 10,
              padding: "8px 12px",
              borderRadius: 8,
              fontSize: 11,
              fontFamily: "var(--ms-font-mono, monospace)",
              color: "#34d399",
              background: "rgba(16, 185, 129, 0.08)",
              border: "1px solid rgba(16, 185, 129, 0.25)",
              wordBreak: "break-all",
            }}
          >
            Attestation: {model.ed25519Proof.proof.verificationMethod} · signed{" "}
            {new Date(model.ed25519Proof.proof.created).toLocaleString()}
            {model.ed25519Proof.proof.payloadSha256
              ? ` · payloadSha256=${model.ed25519Proof.proof.payloadSha256.slice(0, 20)}…`
              : ""}
          </div>
        )}

        {/* Formal-Proof-Gated Promotion feedback */}
        {promotionSuccess && <DiagnosticBox $tone="success">{promotionSuccess}</DiagnosticBox>}

        {promotionError && (
          <DiagnosticBox $tone="error">
            <div style={{ fontWeight: 700, marginBottom: 6 }}>
              {promotionError.status === 422 ? "422 Formal Promotion Gate Blocked: " : "Promotion Error: "}
              {promotionError.error}
            </div>
            {promotionError.previousProductionVersion && (
              <div style={{ fontSize: 12, marginBottom: 6 }}>
                Compared against production baseline: <code>@{promotionError.previousProductionVersion}</code>
              </div>
            )}
            {promotionError.failureReasons.length > 0 && (
              <ul style={{ margin: "4px 0 8px", paddingLeft: 18 }}>
                {promotionError.failureReasons.map((reason, idx) => (
                  <li key={idx} style={{ fontFamily: "var(--ms-font-mono, monospace)", fontSize: 12 }}>
                    {reason}
                  </li>
                ))}
              </ul>
            )}
            {promotionError.regressionDiff && (
              <div
                style={{
                  marginTop: 8,
                  padding: "8px 10px",
                  borderRadius: 8,
                  background: "rgba(0,0,0,0.22)",
                  fontSize: 12,
                  fontFamily: "var(--ms-font-mono, monospace)",
                }}
              >
                <div>
                  Regression Diff ({promotionError.regressionDiff.promotionChange}): ΔFormal=
                  {(promotionError.regressionDiff.formalPassRateDelta * 100).toFixed(2)}%, ΔNonTrivial=
                  {(promotionError.regressionDiff.nonTrivialPassRateDelta * 100).toFixed(2)}%, ΔHacking=
                  {(promotionError.regressionDiff.rewardHackingRateDelta * 100).toFixed(2)}%, ΔECE=
                  {promotionError.regressionDiff.eceDelta.toFixed(4)}
                </div>
                {promotionError.regressionDiff.flippedPassToFail.length > 0 && (
                  <div style={{ color: "#fca5a5", marginTop: 4 }}>
                    Regressed Cases ({promotionError.regressionDiff.flippedPassToFail.length}):{" "}
                    {promotionError.regressionDiff.flippedPassToFail.join(", ")}
                  </div>
                )}
              </div>
            )}
          </DiagnosticBox>
        )}
      </SectionCard>

      {/* Formal Scorecard + Compatibility Contract */}
      <TwoColGrid>
        <SectionCard>
          <SectionTitle>
            Formal Verification Scorecard
            {evalReport && (
              <StageBadge $stage={evalReport.promoted ? "production" : "deprecated"}>
                {evalReport.promoted ? "Gate Passed" : "Gate Failed"}
              </StageBadge>
            )}
          </SectionTitle>

          {evalReport ? (
            <>
              <MetricsGrid>
                <MetricTile>
                  <MetricLabel>Formal Gate 1–4</MetricLabel>
                  <MetricValue $tone={evalReport.formalGatePassRate >= 0.9 ? "good" : "warn"}>
                    {formatPct(evalReport.formalGatePassRate)}
                  </MetricValue>
                  <MetricSub>{evalReport.totalCases} benchmark cases</MetricSub>
                </MetricTile>
                <MetricTile>
                  <MetricLabel>Non-Trivial Pass</MetricLabel>
                  <MetricValue $tone={evalReport.nonTrivialPassRate >= 0.85 ? "good" : "warn"}>
                    {formatPct(evalReport.nonTrivialPassRate)}
                  </MetricValue>
                  <MetricSub>Behavioral + physical</MetricSub>
                </MetricTile>
                <MetricTile>
                  <MetricLabel>Reward Hacking</MetricLabel>
                  <MetricValue $tone={evalReport.rewardHackingRate <= 0.05 ? "good" : "bad"}>
                    {formatPct(evalReport.rewardHackingRate)}
                  </MetricValue>
                  <MetricSub>Threshold ≤ 5.0%</MetricSub>
                </MetricTile>
                <MetricTile>
                  <MetricLabel>Δ_t ECE</MetricLabel>
                  <MetricValue $tone={typeof ece === "number" && ece <= 0.12 ? "good" : "warn"}>
                    {formatNum(ece, 4)}
                  </MetricValue>
                  <MetricSub>
                    Gap: {evalReport.calibration ? formatNum(evalReport.calibration.separationGap, 3) : "—"}
                  </MetricSub>
                </MetricTile>
                <MetricTile>
                  <MetricLabel>DiskANN Recall@k</MetricLabel>
                  <MetricValue $tone={evalReport.diskAnnRecallAtK >= 0.8 ? "good" : "warn"}>
                    {formatPct(evalReport.diskAnnRecallAtK)}
                  </MetricValue>
                  <MetricSub>Latent W_q retrieval</MetricSub>
                </MetricTile>
              </MetricsGrid>

              {evalReport.failureReasons && evalReport.failureReasons.length > 0 && (
                <DiagnosticBox $tone="error">
                  <strong>Recorded Gate Failure Reasons:</strong>
                  <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                    {evalReport.failureReasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </DiagnosticBox>
              )}
            </>
          ) : (
            <div style={{ fontSize: 13, color: "var(--ms-text-2, #8b949e)" }}>
              No formal evaluation report attached yet. Run CI evaluation or pass an <code>evalReport</code> during
              promotion to unlock Staging/Production gates.
            </div>
          )}
        </SectionCard>

        <SectionCard>
          <SectionTitle>Compatibility Contract</SectionTitle>
          <ContractTable>
            <dt>baseModelRef</dt>
            <dd>{model.baseModelRef ?? "— (standalone core)"}</dd>
            <dt>loraRank</dt>
            <dd>{model.loraRank !== null ? String(model.loraRank) : "—"}</dd>
            <dt>projectionLayerIndex</dt>
            <dd>{model.projectionLayerIndex !== null ? String(model.projectionLayerIndex) : "—"}</dd>
            <dt>retrieverEmbeddingDim</dt>
            <dd>{model.retrieverEmbeddingDim !== null ? `${model.retrieverEmbeddingDim}d` : "—"}</dd>
            <dt>parameterScale</dt>
            <dd>{model.parameterScale ?? "—"}</dd>
            <dt>recipe</dt>
            <dd>{model.recipeName ? `${model.recipeName}@${model.recipeVersion ?? "0.1.0"}` : "—"}</dd>
            <dt>storageKey</dt>
            <dd>{model.storageKey ?? "—"}</dd>
          </ContractTable>

          {model.memoryContract && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ms-text-2, #8b949e)", marginBottom: 6 }}>
                MEMORY SHARD CONTRACT
              </div>
              <pre
                style={{
                  margin: 0,
                  padding: 10,
                  borderRadius: 8,
                  background: "var(--ms-bg, #0d1117)",
                  fontSize: 11,
                  overflowX: "auto",
                }}
              >
                {JSON.stringify(model.memoryContract, null, 2)}
              </pre>
            </div>
          )}
        </SectionCard>
      </TwoColGrid>

      {/* Interactive Perturbation Playground */}
      <SectionCard>
        <SectionTitle>Interactive Perturbation Playground (Dynamic-m Zonotope X-Ray &amp; DiskANN Probe)</SectionTitle>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 16,
            marginBottom: 14,
            padding: 14,
            borderRadius: 10,
            background: "var(--ms-bg, #0d1117)",
            border: "1px solid var(--ms-divider, #21262d)",
          }}
        >
          <FieldLabel>
            <span>
              Perturbation Radius ε = <strong style={{ color: "#38bdf8" }}>{epsilon.toFixed(2)}</strong> (∈ [0, 0.25])
            </span>
            <input
              type="range"
              min={0}
              max={0.25}
              step={0.01}
              value={epsilon}
              onChange={(e) => setEpsilon(Number(e.target.value))}
            />
          </FieldLabel>

          <FieldLabel>
            <span>
              Test-Time Compute Dial m = <strong style={{ color: "#a78bfa" }}>{computeDialM}</strong> (0 ↔ 32)
            </span>
            <input
              type="range"
              min={0}
              max={32}
              step={1}
              value={computeDialM}
              onChange={(e) => setComputeDialM(Number(e.target.value))}
            />
          </FieldLabel>

          <FieldLabel>
            Dialect
            <Select value={dialect} onChange={(e) => setDialect(e.target.value)}>
              <option value="modelica">Modelica (.mo)</option>
              <option value="scad">OpenSCAD (.scad)</option>
              <option value="sysml2">SysML v2 (.sysml)</option>
              <option value="spice">SPICE (.sp)</option>
            </Select>
          </FieldLabel>
        </div>

        <FieldLabel style={{ marginBottom: 12 }}>
          Engineering Model Snippet (Modelica / OpenSCAD / SysML2)
          <CodeTextArea value={snippet} onChange={(e) => setSnippet(e.target.value)} />
        </FieldLabel>

        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <ActionButton
            type="button"
            $variant="primary"
            disabled={xrayLoading || !snippet.trim()}
            onClick={handleRunXRay}
          >
            {xrayLoading ? "Running X-Ray Probe…" : "Run Certified X-Ray Probe"}
          </ActionButton>
          <Input
            style={{ flex: "1 1 260px", maxWidth: 420 }}
            value={diskAnnQuery}
            onChange={(e) => setDiskAnnQuery(e.target.value)}
            placeholder="DiskANN hybrid memory query…"
          />
          <ActionButton
            type="button"
            disabled={diskAnnLoading || !diskAnnQuery.trim()}
            onClick={() => void handleRunDiskAnnTest()}
          >
            {diskAnnLoading ? "Querying DiskANN…" : "Test DiskANN Query"}
          </ActionButton>
        </div>

        {xrayError && <DiagnosticBox $tone="error">{xrayError}</DiagnosticBox>}

        {xrayResult && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 12 }}>
            <MetricsGrid>
              <MetricTile>
                <MetricLabel>maxSpreadDeltaT (Raw)</MetricLabel>
                <MetricValue $tone={xrayResult.maxSpreadDeltaT <= xrayResult.retrievalTau ? "good" : "warn"}>
                  {xrayResult.maxSpreadDeltaT.toFixed(4)}
                </MetricValue>
                <MetricSub>Retrieval τ = {xrayResult.retrievalTau.toFixed(2)}</MetricSub>
              </MetricTile>
              <MetricTile>
                <MetricLabel>Scaled Δ_t (at ε={epsilon.toFixed(2)})</MetricLabel>
                <MetricValue
                  $tone={effectiveSpread !== null && effectiveSpread <= xrayResult.retrievalTau ? "good" : "warn"}
                >
                  {effectiveSpread !== null ? effectiveSpread.toFixed(4) : "—"}
                </MetricValue>
                <MetricSub>
                  m_init={xrayResult.mInit} · dial m={computeDialM}
                </MetricSub>
              </MetricTile>
              <MetricTile>
                <MetricLabel>Mean Worst-Case Loss</MetricLabel>
                <MetricValue>{xrayResult.meanWorstCaseLoss.toFixed(4)}</MetricValue>
                <MetricSub>
                  Peak token: &apos;{xrayResult.peakTokenText}&apos; (#{xrayResult.peakTokenIndex})
                </MetricSub>
              </MetricTile>
              <MetricTile>
                <MetricLabel>Worst-Case ξ* Dims</MetricLabel>
                <MetricValue>{xrayResult.worstCaseCorner.length}</MetricValue>
                <MetricSub>Adversarial hypercube corner</MetricSub>
              </MetricTile>
            </MetricsGrid>

            {/* Token Heatmap */}
            {xrayResult.tokenHeat.length > 0 && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6, color: "var(--ms-text-2, #8b949e)" }}>
                  Token Δ_t Uncertainty Heatmap (amber border = exceeds retrieval τ)
                </div>
                <div
                  style={{
                    padding: 10,
                    borderRadius: 8,
                    background: "var(--ms-bg, #0d1117)",
                    border: "1px solid var(--ms-divider, #21262d)",
                    maxHeight: 160,
                    overflowY: "auto",
                  }}
                >
                  {xrayResult.tokenHeat.slice(0, 120).map((tok) => (
                    <TokenHeatChip
                      key={tok.index}
                      $intensity={tok.intensity}
                      $exceeds={tok.exceedsRetrievalTau}
                      title={`#${tok.index} group=${tok.groupId} Δ_t=${tok.spreadDeltaT.toFixed(4)} worstLoss=${tok.worstCaseLoss.toFixed(4)}`}
                    >
                      {tok.text}
                    </TokenHeatChip>
                  ))}
                </div>
              </div>
            )}

            {/* Worst-Case Corner ξ* Table */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6, color: "var(--ms-text-2, #8b949e)" }}>
                Worst-Case Adversarial Corner ξ* ∈ &#123;-1, +1&#125;^m (at ε = {epsilon.toFixed(2)})
              </div>
              {xrayResult.worstCaseCorner.length > 0 ? (
                <SmallTable>
                  <thead>
                    <tr>
                      <th>Group</th>
                      <th>Symbol / Parameter</th>
                      <th>ξ* Sign</th>
                      <th>Effective Perturbation (ξ* · ε)</th>
                      <th>Contribution</th>
                    </tr>
                  </thead>
                  <tbody>
                    {xrayResult.worstCaseCorner.map((c) => (
                      <tr key={`${c.groupId}-${c.label}`}>
                        <td>ε_{c.groupId}</td>
                        <td>{c.symbolName || c.label}</td>
                        <td style={{ color: c.xiSign > 0 ? "#34d399" : "#f87171", fontWeight: 700 }}>
                          {c.xiSign > 0 ? "+1" : "-1"}
                        </td>
                        <td>{(c.xiSign * epsilon).toFixed(3)}</td>
                        <td>{c.contributionMagnitude.toFixed(4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </SmallTable>
              ) : (
                <div style={{ fontSize: 12, color: "var(--ms-text-2, #8b949e)" }}>
                  No active perturbation generators detected at m={computeDialM}. Increase m or add tunable parameters.
                </div>
              )}
            </div>
          </div>
        )}

        {/* DiskANN Query Test Output */}
        {diskAnnResult && (
          <div
            style={{
              marginTop: 14,
              padding: 12,
              borderRadius: 10,
              background: "var(--ms-bg, #0d1117)",
              border: "1px solid var(--ms-divider, #21262d)",
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6, color: "#38bdf8" }}>
              DiskANN Memory Query Test{" "}
              {diskAnnResult.latencyMs !== undefined ? `(${diskAnnResult.latencyMs.toFixed(1)} ms)` : ""}
            </div>
            {diskAnnResult.error ? (
              <div style={{ fontSize: 12, color: "#f87171" }}>
                {diskAnnResult.error}
                {diskAnnResult.reasons?.length ? ` — ${diskAnnResult.reasons.join("; ")}` : ""}
              </div>
            ) : (
              <>
                <div style={{ fontSize: 12, color: "var(--ms-text-2, #8b949e)", marginBottom: 6 }}>
                  Hits: {diskAnnResult.results?.length ?? 0}
                  {diskAnnResult.compatibleShards
                    ? ` · Compatible shards: ${diskAnnResult.compatibleShards.length}`
                    : ""}
                  {diskAnnResult.incompatibleShards?.length
                    ? ` · Incompatible shards skipped: ${diskAnnResult.incompatibleShards.length}`
                    : ""}
                </div>
                {diskAnnResult.results && diskAnnResult.results.length > 0 ? (
                  <SmallTable>
                    <thead>
                      <tr>
                        <th>Symbol / Title</th>
                        <th>Package</th>
                        <th>Score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {diskAnnResult.results.slice(0, 5).map((hit, idx) => (
                        <tr key={hit.id ?? idx}>
                          <td>{hit.symbol || hit.title || hit.id || `Hit #${idx + 1}`}</td>
                          <td>
                            {hit.packageName ? `${hit.packageName}@${hit.version ?? "latest"}` : (hit.dialect ?? "—")}
                          </td>
                          <td>{typeof hit.score === "number" ? hit.score.toFixed(4) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </SmallTable>
                ) : (
                  <div style={{ fontSize: 12, color: "var(--ms-text-2, #8b949e)" }}>
                    Query executed cleanly against DiskANN index (0 matching memory vectors indexed yet).
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </SectionCard>
    </PageContainer>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Catalog View (`/models`) + Route Dispatcher
// ─────────────────────────────────────────────────────────────────────────────

const KIND_FILTERS: ("all" | ModelRegistryKind)[] = ["all", "model-core", "lora-adapter", "projection-head"];
const STAGE_FILTERS: ("all" | ModelPromotionStage)[] = ["all", "production", "staging", "draft", "deprecated"];

export const ModelsHubPage: React.FC = () => {
  const { name, version } = useParams<{ name?: string; version?: string }>();
  const navigate = useNavigate();

  const [models, setModels] = useState<ModelRegistryEntry[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<"all" | ModelRegistryKind>("all");
  const [stageFilter, setStageFilter] = useState<"all" | ModelPromotionStage>("all");
  const [search, setSearch] = useState("");
  const [registerOpen, setRegisterOpen] = useState(false);

  const isDetail = Boolean(name && version);
  usePageTitle(isDetail ? `${name}@${version} — Models` : "Models Hub — Certified Registry");

  const fetchModels = useCallback(async () => {
    if (isDetail) return;
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (kindFilter !== "all") qs.set("kind", kindFilter);
      if (stageFilter !== "all") qs.set("promotionStage", stageFilter);
      const url = `/api/v1/models${qs.toString() ? `?${qs.toString()}` : ""}`;
      const res = await fetch(url, { headers: getAuthHeaders(), credentials: "include" });
      const data = (await res.json().catch(() => ({}))) as {
        models?: ModelRegistryEntry[];
        total?: number;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || `Failed to fetch models (${res.status})`);
      }
      setModels(Array.isArray(data.models) ? data.models : []);
      setTotal(typeof data.total === "number" ? data.total : (data.models?.length ?? 0));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [isDetail, kindFilter, stageFilter]);

  useEffect(() => {
    void fetchModels();
  }, [fetchModels]);

  const filteredModels = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return models;
    return models.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.version.toLowerCase().includes(q) ||
        (m.recipeName ?? "").toLowerCase().includes(q) ||
        (m.baseModelRef ?? "").toLowerCase().includes(q),
    );
  }, [models, search]);

  if (name && version) {
    return <ModelCardDetailView name={name} version={version} />;
  }

  return (
    <PageContainer>
      <HeaderRow>
        <TitleBlock>
          <PageTitle>Certified Models Hub</PageTitle>
          <Subtitle>
            Formal-proof-gated model cores, LoRA adapters, and W_q DiskANN projection heads ({total} registered)
          </Subtitle>
        </TitleBlock>
        <ButtonRow>
          <NavLinkButton to="/runs">Training Runs</NavLinkButton>
          <NavLinkButton to="/leaderboards">Leaderboards</NavLinkButton>
          <ActionButton type="button" $variant="primary" onClick={() => setRegisterOpen(true)}>
            + Register Model / Adapter
          </ActionButton>
        </ButtonRow>
      </HeaderRow>

      <FilterBar>
        <FilterGroup>
          <FilterLabel>Kind</FilterLabel>
          {KIND_FILTERS.map((k) => (
            <Pill key={k} type="button" $active={kindFilter === k} onClick={() => setKindFilter(k)}>
              {k === "all" ? "All" : kindLabel(k)}
            </Pill>
          ))}
        </FilterGroup>

        <FilterGroup>
          <FilterLabel>Stage</FilterLabel>
          {STAGE_FILTERS.map((s) => (
            <Pill key={s} type="button" $active={stageFilter === s} onClick={() => setStageFilter(s)}>
              {s === "all" ? "All" : stageLabel(s)}
            </Pill>
          ))}
          <Input
            style={{ marginLeft: "auto", maxWidth: 260 }}
            placeholder="Search name, recipe, base model…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </FilterGroup>
      </FilterBar>

      {error && (
        <DiagnosticBox $tone="error" style={{ marginBottom: 16 }}>
          {error}
        </DiagnosticBox>
      )}

      {loading ? (
        <div style={{ padding: 24, color: "var(--ms-text-2, #8b949e)" }}>Loading model registry…</div>
      ) : filteredModels.length === 0 ? (
        <SectionCard style={{ textAlign: "center", padding: "36px 20px" }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>No models match the active filters</div>
          <div style={{ fontSize: 13, color: "var(--ms-text-2, #8b949e)", marginBottom: 14 }}>
            Register a model-core, LoRA adapter, or projection-head to start tracking formal verification gates.
          </div>
          <ActionButton type="button" $variant="primary" onClick={() => setRegisterOpen(true)}>
            + Register Model / Adapter
          </ActionButton>
        </SectionCard>
      ) : (
        <CardsGrid>
          {filteredModels.map((m) => {
            const verified = Boolean(m.ed25519Proof?.proof?.proofValue);
            return (
              <ModelCardBox
                key={`${m.name}@${m.version}`}
                to={`/models/${encodeURIComponent(m.name)}/${encodeURIComponent(m.version)}`}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, wordBreak: "break-word" }}>
                      {m.name} <span style={{ fontWeight: 500, color: "var(--ms-text-2, #8b949e)" }}>@{m.version}</span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--ms-text-2, #8b949e)", marginTop: 2 }}>
                      {m.parameterScale ?? "Scale n/a"}
                      {m.baseModelRef ? ` · Base: ${m.baseModelRef}` : ""}
                    </div>
                  </div>
                  <StageBadge $stage={m.promotionStage}>{stageLabel(m.promotionStage)}</StageBadge>
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  <KindBadge $kind={m.kind}>{kindLabel(m.kind)}</KindBadge>
                  <ProofBadge $verified={verified}>{verified ? "✓ Ed25519" : "Unsigned"}</ProofBadge>
                  {m.loraRank !== null && (
                    <span
                      style={{
                        fontSize: 11,
                        padding: "3px 7px",
                        borderRadius: 6,
                        background: "var(--ms-bg, #0d1117)",
                        fontFamily: "var(--ms-font-mono, monospace)",
                      }}
                    >
                      r={m.loraRank}
                    </span>
                  )}
                  {m.retrieverEmbeddingDim !== null && (
                    <span
                      style={{
                        fontSize: 11,
                        padding: "3px 7px",
                        borderRadius: 6,
                        background: "var(--ms-bg, #0d1117)",
                        fontFamily: "var(--ms-font-mono, monospace)",
                      }}
                    >
                      W_q={m.retrieverEmbeddingDim}d
                    </span>
                  )}
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                    gap: 8,
                    padding: "8px 10px",
                    borderRadius: 8,
                    background: "var(--ms-bg, #0d1117)",
                    fontSize: 11,
                    fontFamily: "var(--ms-font-mono, monospace)",
                  }}
                >
                  <div>
                    <div style={{ color: "var(--ms-text-2, #8b949e)" }}>Gate 1–4</div>
                    <strong>{formatPct(m.evalReport?.formalGatePassRate)}</strong>
                  </div>
                  <div>
                    <div style={{ color: "var(--ms-text-2, #8b949e)" }}>Δ_t ECE</div>
                    <strong>{formatNum(m.evalReport?.calibration?.ece, 3)}</strong>
                  </div>
                  <div>
                    <div style={{ color: "var(--ms-text-2, #8b949e)" }}>Recall@k</div>
                    <strong>{formatPct(m.evalReport?.diskAnnRecallAtK)}</strong>
                  </div>
                </div>

                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 11,
                    color: "var(--ms-text-2, #8b949e)",
                    fontFamily: "var(--ms-font-mono, monospace)",
                  }}
                >
                  <span>{m.weightSha256 ? `sha256:${m.weightSha256.slice(0, 12)}…` : "No weights yet"}</span>
                  <span>{m.weightBytes > 0 ? formatBytes(m.weightBytes) : ""}</span>
                </div>
              </ModelCardBox>
            );
          })}
        </CardsGrid>
      )}

      {registerOpen && (
        <RegisterModelModal
          onClose={() => setRegisterOpen(false)}
          onRegistered={(created) => {
            setRegisterOpen(false);
            navigate(`/models/${encodeURIComponent(created.name)}/${encodeURIComponent(created.version)}`);
          }}
        />
      )}
    </PageContainer>
  );
};

export default ModelsHubPage;
