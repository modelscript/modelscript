// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BeakerIcon,
  CheckCircleFillIcon,
  CloudIcon,
  CpuIcon,
  DownloadIcon,
  FileCodeIcon,
  FlameIcon,
  GraphIcon,
  PlayIcon,
  PulseIcon,
  RocketIcon,
  SearchIcon,
  ServerIcon,
  ShieldCheckIcon,
  SlidersIcon,
  SparklesFillIcon,
  SyncIcon,
  XCircleIcon,
  XIcon,
  ZapIcon,
} from "@primer/octicons-react";
import { Text } from "@primer/react";
import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  dispatchCloudJob,
  getCloudSimulationResultCsv,
  getCloudSimulationStatus,
  getComputeProfiles,
  getTimeline,
  getUserWallet,
  submitCloudSimulation,
  type CloudSimulationStatus,
  type ComputeProfileInfo,
  type UserWalletInfo,
} from "../../api";
import { useAuth } from "../../AuthContext";
import { safeJsonParse } from "../../util/json";
import Box from "../Box";
import {
  BUILTIN_HPC_TEMPLATES,
  CURATED_MODEL_ARTIFACTS,
  extractArtifactMetadata,
  generateSbatchPreview,
  type HpcModelArtifactItem,
  type HpcTemplateCategory,
  type HpcWizardTemplate,
} from "./hpcTemplates";
import { ProfileSelector } from "./ProfileSelector";
import { SimulationProgressSteps } from "./SimulationProgressSteps";
import { SimulationResultsView } from "./SimulationResultsView";
import {
  BoundArtifactBar,
  CategoryPill,
  GalleryGrid,
  ModalBody,
  ModalCard,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  PresetCard,
  PresetGrid,
  ProfileCard,
  StepCircle,
  StyledInput,
  StyledSelect,
  TemplateCard,
  WizardStepperBar,
  WizardStepTab,
} from "./styles";
import type { CloudSimulationModalProps, ParsedCsvData, SimPhase, WizardStepId } from "./types";

export interface ExtendedCloudSimulationModalProps extends CloudSimulationModalProps {
  modelName?: string | undefined;
  parameterOverrides?: Record<string, number> | undefined;
  experimentConfig?:
    | {
        startTime?: number | undefined;
        stopTime?: number | undefined;
        interval?: number | undefined;
        tolerance?: number | undefined;
        numberOfIntervals?: number | undefined;
        solver?: string | undefined;
        parameterOverrides?: Record<string, number> | undefined;
      }
    | undefined;
  onResultLoaded?: ((data: { t: number[]; y: number[][]; states: string[] }) => void) | undefined;
  onResultsLoaded?: ((data: { t: number[]; y: number[][]; states: string[] }) => void) | undefined;
}

export function parseSimulationCsvTrajectory(csvText: string): { t: number[]; y: number[][]; states: string[] } | null {
  const lines = csvText
    .trim()
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);
  if (lines.length < 2) return null;
  const header = (lines[0]?.split(",") || []).map((h) => h.replace(/^["']|["']$/g, "").trim());
  const timeIdx = header.findIndex((h) => h.toLowerCase() === "time");
  const validTimeIdx = timeIdx >= 0 ? timeIdx : 0;

  const t: number[] = [];
  const states = header.filter((_, idx) => idx !== validTimeIdx);
  const y: number[][] = states.map(() => []);

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i]?.split(",").map((c) => Number(c.replace(/^["']|["']$/g, "").trim())) || [];
    if (parts.length === header.length) {
      t.push(parts[validTimeIdx] ?? 0);
      let varCounter = 0;
      for (let j = 0; j < parts.length; j++) {
        if (j !== validTimeIdx) {
          y[varCounter]?.push(parts[j] ?? 0);
          varCounter++;
        }
      }
    }
  }
  return { t, y, states };
}

function renderTemplateIcon(icon: string, size = 18): React.ReactNode {
  switch (icon) {
    case "wind":
      return <RocketIcon size={size} />;
    case "flame":
      return <FlameIcon size={size} />;
    case "shield":
      return <ShieldCheckIcon size={size} />;
    case "graph":
      return <GraphIcon size={size} />;
    case "beaker":
      return <BeakerIcon size={size} />;
    default:
      return <PulseIcon size={size} />;
  }
}

const WIZARD_STEPS: { id: WizardStepId; number: number; title: string; subtitle: string }[] = [
  { id: "template", number: 1, title: "Template Gallery", subtitle: "Pick simulation blueprint" },
  { id: "artifact", number: 2, title: "Model Artifact", subtitle: "Target model & parameters" },
  { id: "options", number: 3, title: "Solver Options", subtitle: "Fidelity, time & BCs" },
  { id: "compute", number: 4, title: "Compute Cluster", subtitle: "Slurm profile & cost" },
];

export const CloudSimulationModal: React.FC<ExtendedCloudSimulationModalProps> = ({
  isOpen,
  onClose,
  fileName = "",
  fileContent = "",
  libraryName,
  libraryVersion,
  artifactId,
  artifactTitle,
  dialect: explicitDialect,
  initialTemplateSlug,
  initialStep,
  modelName: explicitModelName,
  parameterOverrides: externalParamOverrides,
  experimentConfig,
  onResultLoaded,
  onResultsLoaded,
}) => {
  const hasExplicitArtifact = Boolean((fileContent && fileContent.trim().length > 0) || libraryName);

  // Discover feed/timeline artifacts when opened globally so the user can pick from real artifacts on the page
  const [discoveredArtifacts, setDiscoveredArtifacts] = useState<HpcModelArtifactItem[]>([]);

  const boundArtifactItem = useMemo<HpcModelArtifactItem | null>(() => {
    if (!hasExplicitArtifact) return null;
    const meta = extractArtifactMetadata(
      fileContent,
      explicitModelName || (fileName ? fileName.replace(/\.[^/.]+$/, "") : "Model"),
    );
    return {
      id: `bound-${artifactId || meta.modelName}`,
      artifactId,
      title: artifactTitle || meta.modelName || fileName || "Active Workspace Model",
      modelName: meta.modelName,
      dialect: explicitDialect || "modelica",
      category: "Bound Model Artifact",
      summary: `Pre-bound ${explicitDialect?.toUpperCase() || "MODELICA"} artifact (${meta.parameters.length} tunable parameters detected).`,
      code: fileContent,
      sourceType: "bound",
    };
  }, [hasExplicitArtifact, fileContent, explicitModelName, fileName, artifactId, artifactTitle, explicitDialect]);

  const allAvailableArtifacts = useMemo<HpcModelArtifactItem[]>(() => {
    const list: HpcModelArtifactItem[] = [];
    if (boundArtifactItem) list.push(boundArtifactItem);
    for (const d of discoveredArtifacts) {
      if (!list.some((x) => x.modelName === d.modelName)) {
        list.push(d);
      }
    }
    for (const c of CURATED_MODEL_ARTIFACTS) {
      if (!list.some((x) => x.modelName === c.modelName)) {
        list.push(c);
      }
    }
    return list;
  }, [boundArtifactItem, discoveredArtifacts]);

  const [selectedArtifactId, setSelectedArtifactId] = useState<string>(
    () => boundArtifactItem?.id || CURATED_MODEL_ARTIFACTS[0]!.id,
  );

  useEffect(() => {
    if (boundArtifactItem) {
      setSelectedArtifactId(boundArtifactItem.id);
    }
  }, [boundArtifactItem]);

  const activeArtifact = useMemo<HpcModelArtifactItem>(() => {
    return (
      allAvailableArtifacts.find((a) => a.id === selectedArtifactId) || boundArtifactItem || CURATED_MODEL_ARTIFACTS[0]!
    );
  }, [allAvailableArtifacts, selectedArtifactId, boundArtifactItem]);

  // Extract metadata from the active artifact's source code
  const extractedMeta = useMemo(
    () => extractArtifactMetadata(activeArtifact.code, explicitModelName || activeArtifact.modelName || "Model"),
    [activeArtifact, explicitModelName],
  );

  // Template state
  const defaultTemplate = useMemo(() => {
    if (initialTemplateSlug) {
      const found = BUILTIN_HPC_TEMPLATES.find(
        (t) =>
          t.slug === initialTemplateSlug ||
          t.id === initialTemplateSlug ||
          String(t.dbTemplateId) === initialTemplateSlug,
      );
      if (found) return found;
    }
    const d = (explicitDialect || activeArtifact.dialect || "modelica").toLowerCase();
    if (d === "cfd" || d === "su2" || d === "openfoam") {
      return BUILTIN_HPC_TEMPLATES.find((t) => t.id === "steady-state-cfd") || BUILTIN_HPC_TEMPLATES[0]!;
    }
    if (d === "fea" || d === "calculix") {
      return BUILTIN_HPC_TEMPLATES.find((t) => t.id === "static-structural-fea") || BUILTIN_HPC_TEMPLATES[0]!;
    }
    return BUILTIN_HPC_TEMPLATES[0]!;
  }, [initialTemplateSlug, explicitDialect, activeArtifact.dialect]);

  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(defaultTemplate.id);
  const selectedTemplate = useMemo(
    () => BUILTIN_HPC_TEMPLATES.find((t) => t.id === selectedTemplateId) || BUILTIN_HPC_TEMPLATES[0]!,
    [selectedTemplateId],
  );

  // Wizard step & filters
  const [activeStep, setActiveStep] = useState<WizardStepId>(initialStep || "template");
  const [templateCategoryFilter, setTemplateCategoryFilter] = useState<"ALL" | "RECOMMENDED" | HpcTemplateCategory>(
    "ALL",
  );
  const [templateSearch, setTemplateSearch] = useState("");
  const [selectedPresetId, setSelectedPresetId] = useState<"fast" | "balanced" | "high">("balanced");

  // Simulation parameters & experiment configuration
  const [modelName, setModelName] = useState<string>(extractedMeta.modelName);
  const [startTime, setStartTime] = useState<number>(
    experimentConfig?.startTime ?? extractedMeta.startTime ?? selectedTemplate.defaultExperiment.startTime,
  );
  const [stopTime, setStopTime] = useState<number>(
    experimentConfig?.stopTime ?? extractedMeta.stopTime ?? selectedTemplate.defaultExperiment.stopTime,
  );
  const [numberOfIntervals, setNumberOfIntervals] = useState<number>(
    experimentConfig?.numberOfIntervals ??
      extractedMeta.numberOfIntervals ??
      selectedTemplate.defaultExperiment.numberOfIntervals,
  );
  const [tolerance, setTolerance] = useState<string>(
    experimentConfig?.tolerance
      ? String(experimentConfig.tolerance)
      : extractedMeta.tolerance
        ? String(extractedMeta.tolerance)
        : selectedTemplate.defaultExperiment.tolerance,
  );
  const [templateFieldValues, setTemplateFieldValues] = useState<Record<string, string | number>>({});
  const [paramOverrides, setParamOverrides] = useState<Record<string, number>>(() => ({
    ...(externalParamOverrides || {}),
    ...(experimentConfig?.parameterOverrides || {}),
  }));
  const [selectedProfile, setSelectedProfile] = useState<string>(selectedTemplate.recommendedProfile);

  const { refreshWallet } = useAuth();
  const [profiles, setProfiles] = useState<ComputeProfileInfo[]>([]);
  const [wallet, setWallet] = useState<UserWalletInfo | null>(null);

  // Job lifecycle states
  const [phase, setPhase] = useState<SimPhase>("config");
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<CloudSimulationStatus | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [csvContent, setCsvContent] = useState<string | null>(null);

  // Sync model name and experiment settings when active artifact changes
  useEffect(() => {
    setModelName(extractedMeta.modelName);
    if (extractedMeta.startTime !== undefined) setStartTime(extractedMeta.startTime);
    if (extractedMeta.stopTime !== undefined) setStopTime(extractedMeta.stopTime);
    if (extractedMeta.numberOfIntervals !== undefined) setNumberOfIntervals(extractedMeta.numberOfIntervals);
    if (extractedMeta.tolerance !== undefined) setTolerance(String(extractedMeta.tolerance));
  }, [extractedMeta]);

  // Sync template defaults when template changes
  useEffect(() => {
    const defaults: Record<string, string | number> = {};
    for (const f of selectedTemplate.fields) {
      defaults[f.key] = f.defaultValue;
    }
    setTemplateFieldValues(defaults);
    setSelectedProfile(selectedTemplate.recommendedProfile);
  }, [selectedTemplate]);

  // Sync initial template slug or step when modal opens
  useEffect(() => {
    if (!isOpen) return;
    if (initialTemplateSlug) {
      const match = BUILTIN_HPC_TEMPLATES.find(
        (t) =>
          t.slug === initialTemplateSlug ||
          t.id === initialTemplateSlug ||
          String(t.dbTemplateId) === initialTemplateSlug,
      );
      if (match) setSelectedTemplateId(match.id);
    }
    if (initialStep) {
      setActiveStep(initialStep);
    }
  }, [isOpen, initialTemplateSlug, initialStep]);

  // Load profiles, wallet, and recent timeline model artifacts on open
  useEffect(() => {
    if (!isOpen) return;
    getComputeProfiles().then(setProfiles).catch(console.error);
    getUserWallet().then(setWallet).catch(console.error);

    getTimeline({ limit: 15 })
      .then((res) => {
        const items: HpcModelArtifactItem[] = [];
        for (const post of res?.posts || []) {
          const art = post?.artifact_view || post?.artifactView;
          if (!art) continue;
          const cfg = safeJsonParse<Record<string, unknown>>(art.view_config, {});
          const code = typeof cfg["code"] === "string" ? (cfg["code"] as string) : "";
          if (!code || code.trim().length < 20) continue;
          const dialect = String(cfg["dialect"] || art.view_type || "modelica").toLowerCase();
          const meta = extractArtifactMetadata(
            code,
            art.title || (typeof cfg["title"] === "string" ? (cfg["title"] as string) : "Model"),
          );
          items.push({
            id: `feed-art-${art.id}`,
            artifactId: art.id,
            title: art.title || cfg.title || meta.modelName,
            modelName: meta.modelName,
            dialect: dialect.includes("modelica") ? "modelica" : dialect,
            author: post.username ? `@${post.username}` : undefined,
            category: "Timeline Model Artifact",
            summary:
              typeof post.content === "string" && post.content.length > 0
                ? post.content.slice(0, 120) + (post.content.length > 120 ? "…" : "")
                : `${dialect.toUpperCase()} model artifact with ${meta.parameters.length} parameters.`,
            code,
            sourceType: "feed",
          });
        }
        if (items.length > 0) {
          setDiscoveredArtifacts(items);
        }
      })
      .catch(() => {
        /* ignore timeline discovery errors */
      });
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Elapsed time counter
  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    if (phase === "running" || phase === "submitting") {
      timer = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [phase]);

  // Status poller
  useEffect(() => {
    if (!jobId || phase !== "running") return;

    let active = true;
    const interval = setInterval(async () => {
      try {
        const status = await getCloudSimulationStatus(jobId);
        if (!active) return;
        setJobStatus(status);

        const s = String(status.status || "").toLowerCase();
        if (s === "completed" || s === "success") {
          setPhase("completed");
          void refreshWallet();
          getUserWallet()
            .then(setWallet)
            .catch(() => {});
          try {
            const csv = await getCloudSimulationResultCsv(jobId);
            setCsvContent(csv);
            const parsedTrajectory = parseSimulationCsvTrajectory(csv);
            if (parsedTrajectory) {
              onResultLoaded?.(parsedTrajectory);
              onResultsLoaded?.(parsedTrajectory);
            }
          } catch (e) {
            console.error("Failed to retrieve simulation CSV:", e);
          }
        } else if (s === "failed" || s === "cancelled") {
          setPhase("failed");
          setErrorMessage(status.error || "Simulation run failed on cluster.");
          void refreshWallet();
          getUserWallet()
            .then(setWallet)
            .catch(() => {});
        }
      } catch (err: unknown) {
        if (!active) return;
        setPhase("failed");
        setErrorMessage(err instanceof Error ? err.message : "Failed to poll job status.");
      }
    }, 1500);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [jobId, phase, onResultLoaded, onResultsLoaded, refreshWallet]);

  const parsedCsv = useMemo<ParsedCsvData | null>(() => {
    if (!csvContent) return null;
    const lines = csvContent.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) return null;
    const headers = lines[0]!.split(",").map((h) => h.replace(/^["']|["']$/g, "").trim());
    const rows = lines.slice(1, 11).map((row) => row.split(",").map((c) => c.replace(/^["']|["']$/g, "").trim()));
    return {
      headers,
      rows,
      totalRows: lines.length - 1,
      trajectory: parseSimulationCsvTrajectory(csvContent),
    };
  }, [csvContent]);

  // Filtered templates for the SharePoint-style gallery
  const filteredTemplates = useMemo(() => {
    const activeDialect = (explicitDialect || activeArtifact.dialect || "modelica").toLowerCase();
    return BUILTIN_HPC_TEMPLATES.filter((t) => {
      if (templateCategoryFilter === "RECOMMENDED") {
        if (!t.compatibleDialects.includes(activeDialect) && !t.featured) return false;
      } else if (templateCategoryFilter !== "ALL" && t.category !== templateCategoryFilter) {
        return false;
      }
      if (templateSearch.trim()) {
        const q = templateSearch.trim().toLowerCase();
        return (
          t.name.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.solver.toLowerCase().includes(q) ||
          t.category.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [templateCategoryFilter, templateSearch, explicitDialect, activeArtifact.dialect]);

  const currentProfile = useMemo(
    () => profiles.find((p) => p.id === selectedProfile) || profiles[0],
    [profiles, selectedProfile],
  );

  // Apply parameter overrides into the Modelica source if the user customized any parameter values
  const effectiveSourceCode = useMemo(() => {
    let src = activeArtifact.code || fileContent || CURATED_MODEL_ARTIFACTS[0]!.code;
    for (const [paramName, val] of Object.entries(paramOverrides)) {
      if (!Number.isFinite(val)) continue;
      const pattern = new RegExp(
        `(^\\s*parameter\\s+(?:Real|Integer)\\s+${paramName}(?:\\s*\\([^)]*\\))?\\s*=\\s*)([+-]?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)`,
        "m",
      );
      src = src.replace(pattern, `$1${val}`);
    }
    return src;
  }, [activeArtifact.code, fileContent, paramOverrides]);

  const sbatchPreview = useMemo(
    () =>
      generateSbatchPreview({
        jobName: `msx_${modelName}`,
        modelName: modelName || "Model",
        template: selectedTemplate,
        profileId: selectedProfile,
        cpus: currentProfile?.cpus ?? 4,
        memoryMb: currentProfile?.memoryMb ?? 16384,
        gpus: currentProfile?.gpus,
        gpuType: currentProfile?.gpuType,
        partition: currentProfile?.partition || "compute",
        startTime,
        stopTime,
        numberOfIntervals,
        tolerance,
        parameterOverrides: paramOverrides,
      }),
    [
      modelName,
      selectedTemplate,
      selectedProfile,
      currentProfile,
      startTime,
      stopTime,
      numberOfIntervals,
      tolerance,
      paramOverrides,
    ],
  );

  if (!isOpen) return null;

  const handleSelectPreset = (presetId: "fast" | "balanced" | "high") => {
    setSelectedPresetId(presetId);
    const preset = selectedTemplate.presets.find((p) => p.id === presetId);
    if (!preset) return;
    setNumberOfIntervals(preset.intervals);
    setTolerance(preset.tolerance);
    setSelectedProfile(preset.recommendedProfile);
    if (preset.extraOverrides) {
      setTemplateFieldValues((prev) => ({ ...prev, ...preset.extraOverrides }));
    }
  };

  const handleLaunch = async (overrideTemplate?: HpcWizardTemplate) => {
    const tpl = overrideTemplate || selectedTemplate;
    setPhase("submitting");
    setErrorMessage(null);
    setElapsedSeconds(0);
    setCsvContent(null);

    try {
      const targetName = (modelName || extractedMeta.modelName || "Model").trim();
      const solverMethod = String(
        experimentConfig?.solver ||
          templateFieldValues["solver"] ||
          templateFieldValues["integrator"] ||
          tpl.solver ||
          "cvode",
      );
      const res = await submitCloudSimulation({
        modelName: targetName,
        modelSource: effectiveSourceCode || undefined,
        libraryName,
        libraryVersion,
        profile: selectedProfile,
        startTime: parseFloat(String(startTime)) || 0,
        stopTime,
        numberOfIntervals,
        tolerance: parseFloat(tolerance) || 1e-6,
        solver: solverMethod,
      });

      setJobId(res.jobId);
      setPhase("running");
      void refreshWallet();
      getUserWallet()
        .then(setWallet)
        .catch(() => {});
    } catch (err: unknown) {
      // If the user selected a non-Modelica CAE/Monte-Carlo domain and /simulate rejected, try unified /cloud/dispatch
      if (tpl.domain === "cfd" || tpl.domain === "fea" || tpl.domain === "monte-carlo") {
        try {
          const dispatchRes = await dispatchCloudJob({
            domain: tpl.domain,
            name: (modelName || extractedMeta.modelName || tpl.shortTitle).trim(),
            profile: selectedProfile,
            sourceContent: effectiveSourceCode,
            experiment: {
              startTime,
              stopTime,
              numberOfIntervals,
              tolerance: parseFloat(tolerance) || 1e-6,
            },
            parameters: { ...templateFieldValues, ...paramOverrides },
          });
          setJobId(dispatchRes.jobId);
          setPhase("running");
          return;
        } catch {
          // Fall through to standard error reporting
        }
      }

      setPhase("failed");
      const axiosErr = err as {
        response?:
          | {
              status?: number | undefined;
              data?: { message?: string | undefined; error?: string | undefined } | undefined;
            }
          | undefined;
        message?: string | undefined;
      };
      const errData = axiosErr.response?.data;
      if (axiosErr.response?.status === 402) {
        setErrorMessage(
          `Insufficient Compute Credits: ${errData?.message || "Please top up your wallet to burst this workload."}`,
        );
      } else {
        setErrorMessage(errData?.error || axiosErr.message || "Cloud simulation submission failed.");
      }
    }
  };

  const handleDownloadCsv = () => {
    if (!csvContent) return;
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `${modelName}_res.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const stepIndex = WIZARD_STEPS.findIndex((s) => s.id === activeStep);

  const modalNode = (
    <ModalOverlay onClick={onClose} role="dialog" aria-modal="true" aria-label="Run on Cloud HPC">
      <ModalCard onClick={(e) => e.stopPropagation()}>
        {/* ── 1. Top Header ── */}
        <ModalHeader>
          <Box display="flex" alignItems="center" gap={2}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: "10px",
                background: "linear-gradient(135deg, rgba(6, 182, 212, 0.2), rgba(139, 92, 246, 0.2))",
                border: "1px solid rgba(139, 92, 246, 0.35)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--color-accent-cyan, #06b6d4)",
              }}
            >
              <CloudIcon size={18} />
            </div>
            <div>
              <Box display="flex" alignItems="center" gap={2}>
                <Text fontWeight="bold" fontSize="16px" color="var(--color-fg-default)">
                  Run on Cloud HPC
                </Text>
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: 700,
                    fontFamily: "var(--font-mono, monospace)",
                    padding: "2px 7px",
                    borderRadius: "999px",
                    background: "rgba(139, 92, 246, 0.15)",
                    color: "var(--color-accent-purple, #a855f7)",
                    border: "1px solid rgba(139, 92, 246, 0.3)",
                  }}
                >
                  SLURM + WASM STUDIO
                </span>
              </Box>
              <Text fontSize="12px" color="var(--color-fg-muted)">
                Pick a ready-to-run simulation blueprint or launch directly against your model artifact
              </Text>
            </div>
          </Box>

          <Box display="flex" alignItems="center" gap={2}>
            {phase === "config" && (
              <button
                type="button"
                onClick={() => void handleLaunch()}
                title="Immediately run simulation with smart template defaults"
                style={{
                  background: "rgba(6, 182, 212, 0.14)",
                  border: "1px solid rgba(6, 182, 212, 0.4)",
                  color: "var(--color-accent-cyan, #06b6d4)",
                  borderRadius: "999px",
                  padding: "5px 12px",
                  fontSize: "12px",
                  fontWeight: 700,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "5px",
                }}
              >
                <ZapIcon size={13} />
                <span>⚡ 1-Click Quick Run</span>
              </button>
            )}
            <Box
              as="button"
              onClick={onClose}
              aria-label="Close modal"
              style={{
                background: "transparent",
                border: "1px solid var(--color-border-default)",
                borderRadius: "8px",
                width: 30,
                height: 30,
                cursor: "pointer",
                color: "var(--color-fg-muted)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <XIcon size={16} />
            </Box>
          </Box>
        </ModalHeader>

        {/* ── 2. Bound Model Artifact Context Bar ── */}
        {phase === "config" && (
          <BoundArtifactBar>
            <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
              <span
                style={{
                  fontSize: "10px",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  padding: "2px 7px",
                  borderRadius: "6px",
                  background:
                    activeArtifact.sourceType === "bound" ? "rgba(16, 185, 129, 0.16)" : "rgba(6, 182, 212, 0.16)",
                  color: activeArtifact.sourceType === "bound" ? "#10b981" : "var(--color-accent-cyan, #06b6d4)",
                  border: `1px solid ${
                    activeArtifact.sourceType === "bound" ? "rgba(16, 185, 129, 0.35)" : "rgba(6, 182, 212, 0.35)"
                  }`,
                  fontFamily: "var(--font-mono, monospace)",
                }}
              >
                {activeArtifact.sourceType === "bound"
                  ? "● Bound Artifact"
                  : activeArtifact.sourceType === "feed"
                    ? "● Timeline Artifact"
                    : "● Benchmark Artifact"}
              </span>

              <Text fontSize="13px" fontWeight="bold" color="var(--color-fg-default)">
                {activeArtifact.title}
              </Text>

              <code
                style={{
                  fontSize: "11px",
                  padding: "1px 6px",
                  borderRadius: "4px",
                  background: "var(--color-neutral-muted, rgba(128, 128, 128, 0.15))",
                  color: "var(--color-fg-muted)",
                  fontFamily: "var(--font-mono, monospace)",
                }}
              >
                {modelName}.{activeArtifact.dialect === "modelica" ? "mo" : activeArtifact.dialect}
              </code>

              {extractedMeta.parameters.length > 0 && (
                <span style={{ fontSize: "11px", color: "var(--color-fg-muted)" }}>
                  · {extractedMeta.parameters.length} tunable parameters
                </span>
              )}
            </Box>

            <Box display="flex" alignItems="center" gap={2}>
              <span style={{ fontSize: "11px", color: "var(--color-fg-muted)" }}>
                Blueprint: <strong style={{ color: "var(--color-fg-default)" }}>{selectedTemplate.shortTitle}</strong>
              </span>
              <button
                type="button"
                onClick={() => setActiveStep(activeStep === "artifact" ? "template" : "artifact")}
                style={{
                  background: "var(--color-canvas-default)",
                  border: "1px solid var(--color-border-default)",
                  color: "var(--color-fg-default)",
                  borderRadius: "6px",
                  padding: "3px 9px",
                  fontSize: "11px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {activeStep === "artifact" ? "← Back to Templates" : "Switch Model / Tune Params"}
              </button>
            </Box>
          </BoundArtifactBar>
        )}

        {/* ── 3. Interactive 4-Step Wizard Stepper ── */}
        {phase === "config" && (
          <WizardStepperBar role="tablist" aria-label="HPC Simulation Wizard Steps">
            {WIZARD_STEPS.map((st, idx) => {
              const isAct = st.id === activeStep;
              const isDone = idx < stepIndex;
              return (
                <WizardStepTab
                  key={st.id}
                  type="button"
                  role="tab"
                  aria-selected={isAct}
                  $active={isAct}
                  $completed={isDone}
                  onClick={() => setActiveStep(st.id)}
                >
                  <StepCircle $active={isAct} $completed={isDone}>
                    {isDone ? "✓" : st.number}
                  </StepCircle>
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: "12.5px",
                        fontWeight: 700,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {st.title}
                    </div>
                    <div
                      style={{
                        fontSize: "11px",
                        opacity: 0.78,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {st.subtitle}
                    </div>
                  </div>
                </WizardStepTab>
              );
            })}
          </WizardStepperBar>
        )}

        {/* ── 4. Modal Body ── */}
        <ModalBody>
          {/* STEP 1: SHAREPOINT-STYLE TEMPLATE GALLERY */}
          {phase === "config" && activeStep === "template" && (
            <Box display="flex" flexDirection="column" gap={3}>
              {/* Search & Category Filter Bar */}
              <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
                <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
                  {(
                    [
                      { id: "ALL", label: "All Templates" },
                      { id: "RECOMMENDED", label: "★ Recommended" },
                      { id: "System Dynamics", label: "System Dynamics" },
                      { id: "Design & UQ", label: "Design & UQ" },
                      { id: "Fluid Dynamics (CFD)", label: "CFD" },
                      { id: "Structural & Thermal FEA", label: "Structural FEA" },
                      { id: "Verification & V&V", label: "Verification" },
                    ] as const
                  ).map((cat) => (
                    <CategoryPill
                      key={cat.id}
                      type="button"
                      $active={templateCategoryFilter === cat.id}
                      onClick={() => setTemplateCategoryFilter(cat.id)}
                    >
                      {cat.label}
                    </CategoryPill>
                  ))}
                </Box>

                <Box
                  display="flex"
                  alignItems="center"
                  gap={2}
                  px={3}
                  py={1}
                  borderRadius="999px"
                  bg="var(--color-canvas-subtle)"
                  border="1px solid var(--color-border-default)"
                  style={{ minWidth: 210 }}
                >
                  <SearchIcon size={13} />
                  <input
                    type="text"
                    value={templateSearch}
                    onChange={(e) => setTemplateSearch(e.target.value)}
                    placeholder="Search blueprints or solvers..."
                    style={{
                      background: "transparent",
                      border: "none",
                      outline: "none",
                      color: "var(--color-fg-default)",
                      fontSize: "12px",
                      width: "100%",
                    }}
                  />
                </Box>
              </Box>

              {/* Template Gallery Cards */}
              <GalleryGrid>
                {filteredTemplates.map((tpl) => {
                  const isSelected = tpl.id === selectedTemplate.id;
                  return (
                    <TemplateCard
                      key={tpl.id}
                      $selected={isSelected}
                      $accent={tpl.accentColor}
                      onClick={() => setSelectedTemplateId(tpl.id)}
                    >
                      <div>
                        <Box display="flex" justifyContent="space-between" alignItems="flex-start" gap={2} mb={2}>
                          <div
                            style={{
                              width: 34,
                              height: 34,
                              borderRadius: "8px",
                              background: `${tpl.accentColor}1f`,
                              border: `1px solid ${tpl.accentColor}4d`,
                              color: tpl.accentColor,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              flexShrink: 0,
                            }}
                          >
                            {renderTemplateIcon(tpl.icon, 17)}
                          </div>

                          <Box display="flex" alignItems="center" gap={1}>
                            <span
                              style={{
                                fontSize: "10px",
                                fontWeight: 700,
                                padding: "2px 7px",
                                borderRadius: "999px",
                                background: `${tpl.accentColor}1f`,
                                color: tpl.accentColor,
                                border: `1px solid ${tpl.accentColor}40`,
                                fontFamily: "var(--font-mono, monospace)",
                              }}
                            >
                              {tpl.badge}
                            </span>
                            {isSelected && <CheckCircleFillIcon size={16} fill={tpl.accentColor} />}
                          </Box>
                        </Box>

                        <Text fontWeight="bold" fontSize="14px" color="var(--color-fg-default)" display="block">
                          {tpl.name}
                        </Text>

                        <Text
                          fontSize="12px"
                          color="var(--color-fg-muted)"
                          display="block"
                          mt={1}
                          style={{ lineHeight: 1.45 }}
                        >
                          {tpl.description}
                        </Text>
                      </div>

                      <Box display="flex" flexDirection="column" gap={2}>
                        {/* Mini Pipeline Stages */}
                        <Box display="flex" gap={1} flexWrap="wrap">
                          {tpl.pipelineSteps.slice(0, 3).map((st, idx) => (
                            <span
                              key={idx}
                              style={{
                                fontSize: "10px",
                                padding: "1px 6px",
                                borderRadius: "4px",
                                background: "var(--color-neutral-muted, rgba(128, 128, 128, 0.12))",
                                color: "var(--color-fg-muted)",
                                fontFamily: "var(--font-mono, monospace)",
                              }}
                            >
                              {idx + 1}. {st.title}
                            </span>
                          ))}
                        </Box>

                        <Box
                          pt={2}
                          borderTop="1px solid var(--color-border-muted, rgba(128, 128, 128, 0.15))"
                          display="flex"
                          justifyContent="space-between"
                          alignItems="center"
                          fontSize="11px"
                          color="var(--color-fg-muted)"
                        >
                          <span style={{ fontFamily: "var(--font-mono, monospace)", fontWeight: 600 }}>
                            {tpl.solver} · {tpl.estimatedCredits}
                          </span>
                          <Box display="flex" gap={1}>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedTemplateId(tpl.id);
                                setActiveStep("options");
                              }}
                              style={{
                                background: isSelected ? tpl.accentColor : "transparent",
                                color: isSelected ? "#ffffff" : "var(--color-fg-default)",
                                border: `1px solid ${isSelected ? tpl.accentColor : "var(--color-border-default)"}`,
                                borderRadius: "6px",
                                padding: "3px 8px",
                                fontSize: "11px",
                                fontWeight: 600,
                                cursor: "pointer",
                              }}
                            >
                              Configure &rarr;
                            </button>
                          </Box>
                        </Box>
                      </Box>
                    </TemplateCard>
                  );
                })}
              </GalleryGrid>
            </Box>
          )}

          {/* STEP 2: MODEL ARTIFACT PICKER & TUNABLE PARAMETERS */}
          {phase === "config" && activeStep === "artifact" && (
            <Box display="flex" flexDirection="column" gap={4}>
              <Box>
                <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                  <div>
                    <Text fontSize="13px" fontWeight="bold" color="var(--color-fg-default)" display="block">
                      Select Target Model Artifact
                    </Text>
                    <Text fontSize="12px" color="var(--color-fg-muted)">
                      Choose from bound workspace artifacts, timeline models, or verified reference benchmarks
                    </Text>
                  </div>
                </Box>

                <GalleryGrid>
                  {allAvailableArtifacts.map((art) => {
                    const isSelected = art.id === activeArtifact.id;
                    return (
                      <ProfileCard key={art.id} $selected={isSelected} onClick={() => setSelectedArtifactId(art.id)}>
                        <Box display="flex" justifyContent="space-between" alignItems="flex-start" gap={2}>
                          <span
                            style={{
                              fontSize: "10px",
                              fontWeight: 700,
                              textTransform: "uppercase",
                              padding: "1px 6px",
                              borderRadius: "4px",
                              background:
                                art.sourceType === "bound"
                                  ? "rgba(16, 185, 129, 0.16)"
                                  : art.sourceType === "feed"
                                    ? "rgba(6, 182, 212, 0.16)"
                                    : "rgba(139, 92, 246, 0.16)",
                              color:
                                art.sourceType === "bound"
                                  ? "#10b981"
                                  : art.sourceType === "feed"
                                    ? "#06b6d4"
                                    : "#a855f7",
                              fontFamily: "var(--font-mono, monospace)",
                            }}
                          >
                            {art.sourceType === "bound"
                              ? "Bound Artifact"
                              : art.sourceType === "feed"
                                ? "Timeline Artifact"
                                : art.category}
                          </span>
                          {isSelected && <CheckCircleFillIcon size={15} fill="var(--color-accent-purple, #8b5cf6)" />}
                        </Box>

                        <Text fontWeight="bold" fontSize="13.5px" color="var(--color-fg-default)">
                          {art.title}
                        </Text>

                        <Text fontSize="12px" color="var(--color-fg-muted)" style={{ lineHeight: 1.4 }}>
                          {art.summary}
                        </Text>

                        <Box
                          display="flex"
                          justifyContent="space-between"
                          alignItems="center"
                          mt={1}
                          pt={1}
                          borderTop="1px solid var(--color-border-muted, rgba(128, 128, 128, 0.15))"
                          fontSize="11px"
                          color="var(--color-fg-muted)"
                        >
                          <code style={{ fontFamily: "var(--font-mono, monospace)" }}>
                            <FileCodeIcon size={11} /> {art.modelName}
                          </code>
                          {art.author && <span>{art.author}</span>}
                        </Box>
                      </ProfileCard>
                    );
                  })}
                </GalleryGrid>
              </Box>

              {/* Auto-Extracted Model Parameters */}
              {extractedMeta.parameters.length > 0 && (
                <Box
                  p={3}
                  borderRadius="12px"
                  bg="var(--color-canvas-subtle)"
                  border="1px solid var(--color-border-default)"
                >
                  <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                    <Box display="flex" alignItems="center" gap={2}>
                      <SlidersIcon size={14} />
                      <Text fontSize="13px" fontWeight="bold" color="var(--color-fg-default)">
                        Tunable Model Parameters ({extractedMeta.parameters.length} detected from{" "}
                        <code>{modelName}</code>)
                      </Text>
                    </Box>
                    {Object.keys(paramOverrides).length > 0 && (
                      <button
                        type="button"
                        onClick={() => setParamOverrides({})}
                        style={{
                          background: "transparent",
                          border: "1px solid var(--color-border-default)",
                          borderRadius: "6px",
                          padding: "2px 8px",
                          fontSize: "11px",
                          cursor: "pointer",
                          color: "var(--color-fg-muted)",
                        }}
                      >
                        Reset Overrides ({Object.keys(paramOverrides).length})
                      </button>
                    )}
                  </Box>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                      gap: "10px",
                    }}
                  >
                    {extractedMeta.parameters.map((param) => {
                      const currentVal = paramOverrides[param.name] ?? param.defaultValue;
                      const isModified =
                        paramOverrides[param.name] !== undefined && paramOverrides[param.name] !== param.defaultValue;
                      return (
                        <Box
                          key={param.name}
                          p={2}
                          borderRadius="8px"
                          bg="var(--color-canvas-default)"
                          border={`1px solid ${
                            isModified ? "var(--color-accent-cyan, #06b6d4)" : "var(--color-border-default)"
                          }`}
                        >
                          <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                            <code
                              style={{
                                fontSize: "12px",
                                fontWeight: 700,
                                color: isModified ? "var(--color-accent-cyan, #06b6d4)" : "var(--color-fg-default)",
                                fontFamily: "var(--font-mono, monospace)",
                              }}
                            >
                              {param.name}
                            </code>
                            {param.unit && (
                              <span
                                style={{
                                  fontSize: "10px",
                                  padding: "0 5px",
                                  borderRadius: "4px",
                                  background: "var(--color-neutral-muted, rgba(128, 128, 128, 0.15))",
                                  color: "var(--color-fg-muted)",
                                  fontFamily: "var(--font-mono, monospace)",
                                }}
                              >
                                {param.unit}
                              </span>
                            )}
                          </Box>
                          {param.description && (
                            <Text
                              fontSize="11px"
                              color="var(--color-fg-muted)"
                              display="block"
                              mb={1}
                              style={{
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                              title={param.description}
                            >
                              {param.description}
                            </Text>
                          )}
                          <StyledInput
                            type="number"
                            step="any"
                            value={currentVal}
                            onChange={(e) => {
                              const next = Number(e.target.value);
                              setParamOverrides((prev) => ({
                                ...prev,
                                [param.name]: next,
                              }));
                            }}
                          />
                        </Box>
                      );
                    })}
                  </div>
                </Box>
              )}
            </Box>
          )}

          {/* STEP 3: SOLVER & PIPELINE OPTIONS */}
          {phase === "config" && activeStep === "options" && (
            <Box display="flex" flexDirection="column" gap={4}>
              {/* 1-Click Fidelity Presets */}
              <Box>
                <Box display="flex" alignItems="center" gap={2} mb={2}>
                  <SparklesFillIcon size={14} fill="var(--color-accent-cyan, #06b6d4)" />
                  <Text fontSize="12px" fontWeight="bold" color="var(--color-fg-muted)">
                    1-Click Solver Fidelity Presets ({selectedTemplate.shortTitle})
                  </Text>
                </Box>
                <PresetGrid>
                  {selectedTemplate.presets.map((preset) => {
                    const isSel = selectedPresetId === preset.id;
                    return (
                      <PresetCard key={preset.id} $selected={isSel} onClick={() => handleSelectPreset(preset.id)}>
                        <Box display="flex" justifyContent="space-between" alignItems="center">
                          <Text fontWeight="bold" fontSize="13px" color="var(--color-fg-default)">
                            {preset.label}
                          </Text>
                          <span
                            style={{
                              fontSize: "10px",
                              fontWeight: 700,
                              padding: "1px 6px",
                              borderRadius: "999px",
                              background: isSel
                                ? "rgba(6, 182, 212, 0.2)"
                                : "var(--color-neutral-muted, rgba(128, 128, 128, 0.15))",
                              color: isSel ? "var(--color-accent-cyan, #06b6d4)" : "var(--color-fg-muted)",
                            }}
                          >
                            {preset.badge}
                          </span>
                        </Box>
                        <Text fontSize="11.5px" color="var(--color-fg-muted)" style={{ lineHeight: 1.4 }}>
                          {preset.description}
                        </Text>
                      </PresetCard>
                    );
                  })}
                </PresetGrid>
              </Box>

              {/* Core Experiment Horizon & Discretization */}
              <Box
                p={3}
                borderRadius="12px"
                bg="var(--color-canvas-subtle)"
                border="1px solid var(--color-border-default)"
              >
                <Text fontSize="12px" fontWeight="bold" color="var(--color-fg-muted)" mb={3} display="block">
                  Core Integration &amp; Time Horizon
                </Text>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                    gap: "12px",
                  }}
                >
                  <Box>
                    <Text fontSize="12px" fontWeight="bold" color="var(--color-fg-muted)" mb={1} display="block">
                      Target Model Name
                    </Text>
                    <StyledInput type="text" value={modelName} onChange={(e) => setModelName(e.target.value)} />
                  </Box>
                  <Box>
                    <Text fontSize="12px" fontWeight="bold" color="var(--color-fg-muted)" mb={1} display="block">
                      Start Time [s]
                    </Text>
                    <StyledInput
                      type="number"
                      step="any"
                      value={startTime}
                      onChange={(e) => setStartTime(Number(e.target.value))}
                    />
                  </Box>
                  <Box>
                    <Text fontSize="12px" fontWeight="bold" color="var(--color-fg-muted)" mb={1} display="block">
                      Stop Time [s]
                    </Text>
                    <StyledInput
                      type="number"
                      step="any"
                      value={stopTime}
                      onChange={(e) => setStopTime(Number(e.target.value))}
                    />
                  </Box>
                  <Box>
                    <Text fontSize="12px" fontWeight="bold" color="var(--color-fg-muted)" mb={1} display="block">
                      Intervals
                    </Text>
                    <StyledInput
                      type="number"
                      min={10}
                      max={100000}
                      value={numberOfIntervals}
                      onChange={(e) => setNumberOfIntervals(Number(e.target.value))}
                    />
                  </Box>
                  <Box>
                    <Text fontSize="12px" fontWeight="bold" color="var(--color-fg-muted)" mb={1} display="block">
                      Relative Tolerance
                    </Text>
                    <StyledInput type="text" value={tolerance} onChange={(e) => setTolerance(e.target.value)} />
                  </Box>
                </div>
              </Box>

              {/* Template-Specific Options */}
              {selectedTemplate.fields.length > 0 && (
                <Box
                  p={3}
                  borderRadius="12px"
                  bg="var(--color-canvas-subtle)"
                  border="1px solid var(--color-border-default)"
                >
                  <Text fontSize="12px" fontWeight="bold" color="var(--color-fg-muted)" mb={3} display="block">
                    {selectedTemplate.name} — Blueprint Options
                  </Text>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                      gap: "12px",
                    }}
                  >
                    {selectedTemplate.fields.map((field) => {
                      const val = templateFieldValues[field.key] ?? field.defaultValue;
                      return (
                        <Box key={field.key}>
                          <Text
                            fontSize="12px"
                            fontWeight="bold"
                            color="var(--color-fg-default)"
                            mb={1}
                            display="block"
                          >
                            {field.label} {field.unit ? `(${field.unit})` : ""}
                          </Text>
                          {field.type === "select" && field.options ? (
                            <StyledSelect
                              value={String(val)}
                              onChange={(e) =>
                                setTemplateFieldValues((prev) => ({
                                  ...prev,
                                  [field.key]: e.target.value,
                                }))
                              }
                            >
                              {field.options.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </StyledSelect>
                          ) : (
                            <StyledInput
                              type={field.type === "number" ? "number" : "text"}
                              min={field.min}
                              max={field.max}
                              step={field.step ?? "any"}
                              value={val}
                              onChange={(e) =>
                                setTemplateFieldValues((prev) => ({
                                  ...prev,
                                  [field.key]: field.type === "number" ? Number(e.target.value) : e.target.value,
                                }))
                              }
                            />
                          )}
                          {field.description && (
                            <Text fontSize="11px" color="var(--color-fg-muted)" mt={1} display="block">
                              {field.description}
                            </Text>
                          )}
                        </Box>
                      );
                    })}
                  </div>
                </Box>
              )}
            </Box>
          )}

          {/* STEP 4: SLURM COMPUTE CLUSTER & SBATCH PREVIEW */}
          {phase === "config" && activeStep === "compute" && (
            <ProfileSelector
              modelName={modelName}
              setModelName={setModelName}
              numberOfIntervals={numberOfIntervals}
              setNumberOfIntervals={setNumberOfIntervals}
              profiles={profiles}
              selectedProfile={selectedProfile}
              setSelectedProfile={setSelectedProfile}
              wallet={wallet}
              currentProfile={currentProfile}
              recommendedProfileId={selectedTemplate.recommendedProfile}
              sbatchPreview={sbatchPreview}
            />
          )}

          {/* Submitting or Running Telemetry */}
          {(phase === "submitting" || phase === "running") && (
            <SimulationProgressSteps
              phase={phase}
              elapsedSeconds={elapsedSeconds}
              selectedProfile={selectedProfile}
              numberOfIntervals={numberOfIntervals}
              template={selectedTemplate}
              modelName={modelName}
            />
          )}

          {/* Completed State */}
          {phase === "completed" && <SimulationResultsView jobStatus={jobStatus} parsedCsv={parsedCsv} />}

          {/* Failed State */}
          {phase === "failed" && (
            <Box display="flex" flexDirection="column" gap={3}>
              <Box
                p={3}
                borderRadius="10px"
                bg="rgba(248, 81, 73, 0.1)"
                border="1px solid var(--color-danger-fg, #f85149)"
                display="flex"
                alignItems="flex-start"
                gap={2}
              >
                <XCircleIcon
                  size={20}
                  fill="var(--color-danger-fg, #f85149)"
                  style={{ flexShrink: 0, marginTop: "2px" }}
                />
                <Box>
                  <Text fontWeight="bold" fontSize="14px" color="var(--color-danger-fg, #f85149)" display="block">
                    Simulation Failed
                  </Text>
                  <Text fontSize="13px" color="var(--color-fg-muted)" style={{ whiteSpace: "pre-wrap" }}>
                    {errorMessage || "An unknown error occurred during execution."}
                  </Text>
                </Box>
              </Box>
            </Box>
          )}
        </ModalBody>

        {/* ── 5. Modal Footer ── */}
        <ModalFooter>
          {phase === "config" && (
            <>
              <Box display="flex" alignItems="center" gap={2}>
                <button
                  type="button"
                  onClick={onClose}
                  style={{
                    background: "transparent",
                    border: "1px solid var(--color-border-default)",
                    borderRadius: "9999px",
                    padding: "7px 15px",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                    color: "var(--color-fg-default)",
                  }}
                >
                  Cancel
                </button>
                {stepIndex > 0 && (
                  <button
                    type="button"
                    onClick={() => setActiveStep(WIZARD_STEPS[stepIndex - 1]!.id)}
                    style={{
                      background: "var(--color-canvas-default)",
                      border: "1px solid var(--color-border-default)",
                      borderRadius: "9999px",
                      padding: "7px 14px",
                      fontSize: "13px",
                      fontWeight: 600,
                      cursor: "pointer",
                      color: "var(--color-fg-default)",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "5px",
                    }}
                  >
                    <ArrowLeftIcon size={13} />
                    <span>Back</span>
                  </button>
                )}
              </Box>

              <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
                <Box
                  display="flex"
                  alignItems="center"
                  gap={2}
                  px={3}
                  py={1}
                  borderRadius="999px"
                  bg="var(--color-canvas-default)"
                  border="1px solid var(--color-border-default)"
                  fontSize="11.5px"
                  color="var(--color-fg-muted)"
                >
                  <CpuIcon size={12} />
                  <span>{currentProfile?.name || "Standard Compute"}</span>
                  <span>·</span>
                  <span style={{ color: "var(--color-accent-purple, #a855f7)", fontWeight: 700 }}>
                    ~{((currentProfile?.costCreditsPerHour ?? 10) / 60).toFixed(2)} cr
                  </span>
                </Box>

                {stepIndex < WIZARD_STEPS.length - 1 && (
                  <button
                    type="button"
                    onClick={() => setActiveStep(WIZARD_STEPS[stepIndex + 1]!.id)}
                    style={{
                      background: "var(--color-canvas-default)",
                      border: "1px solid var(--color-border-default)",
                      borderRadius: "9999px",
                      padding: "8px 16px",
                      fontSize: "13px",
                      fontWeight: 600,
                      cursor: "pointer",
                      color: "var(--color-fg-default)",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                    }}
                  >
                    <span>Next: {WIZARD_STEPS[stepIndex + 1]!.title}</span>
                    <ArrowRightIcon size={13} />
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => void handleLaunch()}
                  disabled={!modelName.trim()}
                  style={{
                    background: "linear-gradient(135deg, #06b6d4 0%, #8b5cf6 100%)",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "9999px",
                    padding: "8px 20px",
                    fontSize: "13px",
                    fontWeight: 700,
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "8px",
                    boxShadow: "0 4px 16px rgba(139, 92, 246, 0.35)",
                    opacity: !modelName.trim() ? 0.6 : 1,
                  }}
                >
                  <PlayIcon size={15} />
                  <span>Launch Simulation</span>
                </button>
              </Box>
            </>
          )}

          {(phase === "submitting" || phase === "running") && (
            <>
              <Box display="flex" alignItems="center" gap={2}>
                <ServerIcon size={14} />
                <Text
                  fontSize="12px"
                  color="var(--color-fg-muted)"
                  style={{ fontFamily: "var(--font-mono, monospace)" }}
                >
                  Cluster Job ID: {jobId || "Assigning..."}
                </Text>
              </Box>
              <button
                type="button"
                onClick={onClose}
                style={{
                  background: "transparent",
                  border: "1px solid var(--color-border-default)",
                  borderRadius: "9999px",
                  padding: "8px 16px",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                  color: "var(--color-fg-default)",
                }}
              >
                Run in Background
              </button>
            </>
          )}

          {phase === "completed" && (
            <>
              <button
                type="button"
                onClick={() => setPhase("config")}
                style={{
                  background: "transparent",
                  border: "1px solid var(--color-border-default)",
                  borderRadius: "9999px",
                  padding: "8px 16px",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                  color: "var(--color-fg-default)",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <SyncIcon size={14} />
                <span>Configure &amp; Run Again</span>
              </button>
              <Box display="flex" gap={2}>
                <button
                  type="button"
                  onClick={handleDownloadCsv}
                  disabled={!csvContent}
                  style={{
                    background: "var(--color-canvas-default)",
                    border: "1px solid var(--color-border-default)",
                    borderRadius: "9999px",
                    padding: "8px 16px",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                    color: "var(--color-fg-default)",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <DownloadIcon size={14} />
                  <span>Download CSV</span>
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  style={{
                    background: "linear-gradient(135deg, #06b6d4 0%, #8b5cf6 100%)",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "9999px",
                    padding: "8px 20px",
                    fontSize: "13px",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Done
                </button>
              </Box>
            </>
          )}

          {phase === "failed" && (
            <>
              <button
                type="button"
                onClick={onClose}
                style={{
                  background: "transparent",
                  border: "1px solid var(--color-border-default)",
                  borderRadius: "9999px",
                  padding: "8px 16px",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                  color: "var(--color-fg-default)",
                }}
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => setPhase("config")}
                style={{
                  background: "linear-gradient(135deg, #06b6d4 0%, #8b5cf6 100%)",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "9999px",
                  padding: "8px 20px",
                  fontSize: "13px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Adjust Settings &amp; Retry
              </button>
            </>
          )}
        </ModalFooter>
      </ModalCard>
    </ModalOverlay>
  );

  return typeof document !== "undefined" ? createPortal(modalNode, document.body) : modalNode;
};

export default CloudSimulationModal;
