// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ArrowLeftIcon,
  BeakerIcon,
  CheckCircleFillIcon,
  CodeIcon,
  DownloadIcon,
  FileCodeIcon,
  PackageIcon,
  PlayIcon,
  SearchIcon,
  ServerIcon,
  SparklesFillIcon,
  VerifiedIcon,
  ZapIcon,
} from "@primer/octicons-react";
import { Button, Flash, FormControl, Heading, Label, Select, Text, TextInput } from "@primer/react";
import axios from "axios";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  getCompatibleModels,
  getJobTemplate,
  inspectModelSource,
  runJobTemplate,
  synthesizeStudyInstance,
  type CompatibleModelItem,
  type StudyDefinitionPayload,
  type StudyInputFieldPayload,
  type StudyInstanceArtifactPayload,
  type StudyPresetPayload,
  type StudyRunResultsPayload,
  type StudyStandardFormat,
} from "../api";
import Box from "../components/Box";
import { CircleIconButton } from "../components/SharedStyles";
import { safeJsonParse } from "../util/json";
import { usePageTitle } from "../util/title";

interface ScriptTemplate {
  id: number;
  name: string;
  slug: string;
  description: string;
  category: string;
  icon: string;
  config: string | StudyDefinitionPayload;
  studyDefinition?: StudyDefinitionPayload | undefined;
  compatibleModels?: CompatibleModelItem[] | undefined;
}

interface TemplateStepItem {
  id?: string | undefined;
  name?: string | undefined;
  title?: string | undefined;
  description?: string | undefined;
  command?: string | undefined;
}

const ARCHETYPE_BADGE_MAP: Record<string, { label: string; color: string; bg: string }> = {
  "time-domain": { label: "Transient DAE", color: "#3b82f6", bg: "rgba(59, 130, 246, 0.14)" },
  "time-course": { label: "Transient DAE", color: "#3b82f6", bg: "rgba(59, 130, 246, 0.14)" },
  "parameter-sweep": { label: "Parametric DOE Sweep", color: "#06b6d4", bg: "rgba(6, 182, 212, 0.14)" },
  "monte-carlo": { label: "Monte Carlo & UQ", color: "#a855f7", bg: "rgba(168, 85, 247, 0.14)" },
  optimization: { label: "Multi-Objective Optimization", color: "#f59e0b", bg: "rgba(245, 158, 11, 0.14)" },
  "frequency-modal": { label: "Eigenvalue / Modal Audit", color: "#10b981", bg: "rgba(16, 185, 129, 0.14)" },
  "eigen-frequency": { label: "Eigenvalue / Modal Audit", color: "#10b981", bg: "rgba(16, 185, 129, 0.14)" },
  verification: { label: "Standards Verification", color: "#10b981", bg: "rgba(16, 185, 129, 0.14)" },
  "steady-state": { label: "3D Continuum FEA / CFD", color: "#ec4899", bg: "rgba(236, 72, 153, 0.14)" },
  "continuum-cae": { label: "3D Continuum FEA / CFD", color: "#ec4899", bg: "rgba(236, 72, 153, 0.14)" },
  surrogate: { label: "AI Surrogate / ROM", color: "#8b5cf6", bg: "rgba(139, 92, 246, 0.14)" },
  "surrogate-rom": { label: "AI Surrogate / ROM", color: "#8b5cf6", bg: "rgba(139, 92, 246, 0.14)" },
};

const TemplateDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [template, setTemplate] = useState<ScriptTemplate | null>(null);
  const [studyDef, setStudyDef] = useState<StudyDefinitionPayload | null>(null);
  const [compatibleModels, setCompatibleModels] = useState<CompatibleModelItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  usePageTitle(template ? `${template.name} — Study Studio` : "Study Studio");

  // Zone 1: Model Binding state
  const [modelMode, setModelMode] = useState<"catalog" | "custom">("catalog");
  const [modelSearch, setModelSearch] = useState<string>("");
  const [selectedModelId, setSelectedModelId] = useState<string>("");
  const [customCode, setCustomCode] = useState<string>("");
  const [customModelName, setCustomModelName] = useState<string>("CustomModel");
  const [inspectedParams, setInspectedParams] = useState<
    {
      name: string;
      value?: number | undefined;
      defaultValue?: number | string | boolean | undefined;
      unit?: string | undefined;
      description?: string | undefined;
    }[]
  >([]);
  const [isInspecting, setIsInspecting] = useState<boolean>(false);
  const [parameterOverrides, setParameterOverrides] = useState<Record<string, number>>({});

  // Zone 2: Study Configuration & Presets state
  const [activePresetId, setActivePresetId] = useState<string>("");
  const [inputValues, setInputValues] = useState<Record<string, string | number | boolean>>({});
  const [meshResolution, setMeshResolution] = useState<"coarse" | "medium" | "fine">("medium");
  const [maxIterations, setMaxIterations] = useState<number>(1000);
  const [tolerance, setTolerance] = useState<string>("1e-5");

  // Zone 3: Execution Target, Study Instance Artifact & Instant Pre-Flight state
  const [executionTarget, setExecutionTarget] = useState<"local-wasm" | "hpc-slurm">("local-wasm");
  const [computeProfile, setComputeProfile] = useState<"standard" | "high-cpu" | "gpu-a100">("standard");
  const [selectedStandardFormat, setSelectedStandardFormat] = useState<StudyStandardFormat>("sedml");
  const [saveInstanceToPackage, setSaveInstanceToPackage] = useState<boolean>(false);
  const [synthesizedInstance, setSynthesizedInstance] = useState<StudyInstanceArtifactPayload | null>(null);
  const [customInstanceSource, setCustomInstanceSource] = useState<string>("");
  const [showInstanceSource, setShowInstanceSource] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isPreviewRunning, setIsPreviewRunning] = useState<boolean>(false);
  const [previewResult, setPreviewResult] = useState<{
    jobId: number | string;
    results: StudyRunResultsPayload;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      setLoadError("Template ID is missing.");
      return;
    }
    setLoading(true);
    setLoadError(null);
    getJobTemplate(id)
      .then((data) => {
        if (data?.template) {
          const tpl = data.template as ScriptTemplate;
          setTemplate(tpl);
          const parsedConfig =
            data.studyDefinition ||
            tpl.studyDefinition ||
            (typeof tpl.config === "string"
              ? safeJsonParse<StudyDefinitionPayload>(tpl.config, {} as StudyDefinitionPayload)
              : tpl.config);
          setStudyDef(parsedConfig || null);
          if (
            parsedConfig?.standardFormat === "sedml" ||
            parsedConfig?.standardFormat === "ssp-ssv" ||
            parsedConfig?.standardFormat === "dakota"
          ) {
            setSelectedStandardFormat(parsedConfig.standardFormat);
          }

          // Initialize input defaults
          const defaults: Record<string, string | number | boolean> = {};
          if (Array.isArray(parsedConfig?.inputs)) {
            for (const field of parsedConfig.inputs) {
              defaults[field.key] = field.defaultValue;
            }
          }
          // Apply first preset if available
          const firstPreset = parsedConfig?.presets?.[0];
          if (firstPreset) {
            setActivePresetId(firstPreset.id);
            const targetHint = firstPreset.target || firstPreset.targetHint;
            setExecutionTarget(targetHint === "hpc-slurm" || targetHint === "hpc-cluster" ? "hpc-slurm" : "local-wasm");
            if (firstPreset.profile) setComputeProfile(firstPreset.profile);
            Object.assign(defaults, firstPreset.values);
          } else if (parsedConfig?.execution) {
            const defTarget = parsedConfig.execution.defaultTarget;
            setExecutionTarget(defTarget === "hpc-cluster" ? "hpc-slurm" : "local-wasm");
            const recProf = parsedConfig.execution.recommendedProfile;
            if (recProf === "standard" || recProf === "high-cpu" || recProf === "gpu-a100") {
              setComputeProfile(recProf);
            }
          }
          setInputValues(defaults);

          if (defaults.meshResolution && typeof defaults.meshResolution === "string") {
            setMeshResolution(defaults.meshResolution as "coarse" | "medium" | "fine");
          }
          if (defaults.maxIterations !== undefined) {
            setMaxIterations(Number(defaults.maxIterations) || 1000);
          }
          if (defaults.tolerance !== undefined) {
            setTolerance(String(defaults.tolerance));
          }

          const models: CompatibleModelItem[] = Array.isArray(data.compatibleModels)
            ? [...data.compatibleModels]
            : Array.isArray(tpl.compatibleModels)
              ? [...tpl.compatibleModels]
              : [];

          const requestedModel = searchParams.get("model") || searchParams.get("artifact");
          const requestedPkg = searchParams.get("package");
          const requestedVer = searchParams.get("version");
          const requestedDomain = searchParams.get("domain");

          if (requestedPkg) {
            setSaveInstanceToPackage(true);
          }

          if (requestedModel) {
            const matched = models.find(
              (m: CompatibleModelItem) =>
                m.id === requestedModel ||
                m.modelName === requestedModel ||
                m.qualifiedName === requestedModel ||
                m.name === requestedModel,
            );
            if (matched) {
              setSelectedModelId(matched.id);
            } else {
              const shortName = requestedModel.split(/[/.]/).pop() || requestedModel;
              const injectedModel: CompatibleModelItem = {
                id: `context-${requestedModel}`,
                name: shortName,
                title: shortName,
                qualifiedName: requestedModel,
                modelName: requestedModel,
                domain: requestedDomain || parsedConfig?.modelContract?.domains?.[0] || "modelica",
                dialect: requestedDomain || parsedConfig?.modelContract?.domains?.[0] || "modelica",
                source: requestedPkg ? "package" : "artifact",
                packageName: requestedPkg || parsedConfig?.packageName || undefined,
                packageVersion: requestedVer || parsedConfig?.packageVersion || "1.0.0",
                description: `Context-bound target model ${requestedModel}${requestedPkg ? ` from ${requestedPkg}` : ""}`,
                parameters: [
                  {
                    name: "k_gain",
                    type: "Real",
                    defaultValue: 1.0,
                    min: 0.1,
                    max: 10.0,
                    description: "Primary gain / scale parameter",
                  },
                  {
                    name: "tau",
                    type: "Real",
                    defaultValue: 0.25,
                    unit: "s",
                    min: 0.01,
                    max: 5.0,
                    description: "Characteristic time constant",
                  },
                ],
                observables: [{ name: "y_response", type: "Real", description: "Primary system response" }],
              };
              models.unshift(injectedModel);
              setSelectedModelId(injectedModel.id);
            }
          } else if (models.length > 0 && models[0]) {
            setSelectedModelId(models[0].id);
          }
          setCompatibleModels(models);
        } else {
          setLoadError(`Template #${id} not found.`);
        }
      })
      .catch((err) => {
        console.error(err);
        setLoadError(err?.response?.data?.error || err?.message || `Failed to load template #${id}.`);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [id, searchParams]);

  // Search compatible models dynamically when query changes
  useEffect(() => {
    if (!template?.slug) return;
    const handle = setTimeout(() => {
      getCompatibleModels({
        templateSlug: template.slug,
        ...(modelSearch.trim() ? { q: modelSearch.trim() } : {}),
      })
        .then((res) => {
          if (Array.isArray(res?.models) && res.models.length > 0) {
            setCompatibleModels(res.models);
            if (!selectedModelId && res.models[0]) {
              setSelectedModelId(res.models[0].id);
            }
          }
        })
        .catch(() => {
          /* keep existing models on error */
        });
    }, 180);
    return () => clearTimeout(handle);
  }, [modelSearch, template?.slug]);

  const activeModel = useMemo<CompatibleModelItem | null>(() => {
    if (modelMode === "custom") {
      return {
        id: "custom-inline-model",
        name: customModelName || "CustomModel",
        title: customModelName || "Custom Workspace Model",
        qualifiedName: customModelName || "CustomModel",
        modelName: customModelName || "CustomModel",
        domain: studyDef?.modelContract?.domains?.[0] || studyDef?.modelContract?.dialects?.[0] || "modelica",
        dialect: studyDef?.modelContract?.dialects?.[0] || studyDef?.modelContract?.domains?.[0] || "modelica",
        sourceType: "workspace",
        description: "User-supplied inline model source code.",
        summary: "User-supplied inline model source code.",
        code: customCode,
        parameters: inspectedParams,
        observables:
          studyDef?.modelContract?.observableSlots?.map(
            (slot: { slotId: string; unit?: string; description?: string }) => ({
              name: slot.slotId,
              unit: slot.unit,
              description: slot.description,
            }),
          ) || [],
      };
    }
    return compatibleModels.find((m) => m.id === selectedModelId) || compatibleModels[0] || null;
  }, [modelMode, compatibleModels, selectedModelId, customModelName, customCode, inspectedParams, studyDef]);

  // Sync default parameter overrides when activeModel changes
  useEffect(() => {
    if (!activeModel) return;
    const nextOverrides: Record<string, number> = {};
    for (const p of activeModel.parameters || []) {
      const numVal = Number(p.value ?? p.defaultValue ?? 1.0);
      nextOverrides[p.name] = Number.isFinite(numVal) ? numVal : 1.0;
    }
    setParameterOverrides(nextOverrides);
    if (modelMode === "catalog" && activeModel.code && !customCode) {
      setCustomCode(activeModel.code);
      setCustomModelName(activeModel.modelName || activeModel.qualifiedName || activeModel.name || "CustomModel");
    }
  }, [activeModel?.id, modelMode]);

  // Live-synthesize the concrete Open Standard Study Instance Artifact (.sedml / .ssv / .dakota)
  useEffect(() => {
    if (!template?.slug && !id) return;
    const handle = setTimeout(() => {
      const resolvedModelName = activeModel?.modelName || activeModel?.qualifiedName || activeModel?.name || "Model";
      synthesizeStudyInstance({
        templateSlug: template?.slug || String(id),
        modelId: activeModel?.id,
        modelName: resolvedModelName,
        packageName: activeModel?.packageName || studyDef?.packageName,
        packageVersion: activeModel?.packageVersion || studyDef?.packageVersion,
        dialect: activeModel?.dialect || activeModel?.domain || "modelica",
        studyInputs: {
          ...inputValues,
          meshResolution,
          maxIterations: Number(maxIterations),
          tolerance: parseFloat(tolerance) || 1e-5,
        },
        parameterOverrides,
        executionTarget,
        computeProfile,
        presetId: activePresetId || undefined,
      })
        .then((res) => {
          if (res?.studyInstance) {
            setSynthesizedInstance(res.studyInstance);
            setCustomInstanceSource(res.studyInstance.sourceContent);
          }
        })
        .catch(() => {
          /* ignore live synthesis preview failure */
        });
    }, 220);
    return () => clearTimeout(handle);
  }, [
    template?.slug,
    id,
    activeModel?.id,
    activeModel?.modelName,
    activeModel?.packageName,
    inputValues,
    meshResolution,
    maxIterations,
    tolerance,
    parameterOverrides,
    executionTarget,
    computeProfile,
    activePresetId,
    selectedStandardFormat,
  ]);

  const handleDownloadStudyInstance = () => {
    const content = customInstanceSource || synthesizedInstance?.sourceContent;
    if (!content) return;
    const ext =
      selectedStandardFormat === "ssp-ssv" ? ".ssv" : selectedStandardFormat === "dakota" ? ".dakota" : ".sedml";
    const fileName =
      synthesizedInstance?.fileName ||
      `${template?.slug || "study"}-${(activeModel?.modelName || "model").toLowerCase()}${ext}`;
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleApplyPreset = (preset: StudyPresetPayload) => {
    setActivePresetId(preset.id);
    const targetHint = preset.target || preset.targetHint;
    setExecutionTarget(targetHint === "hpc-slurm" || targetHint === "hpc-cluster" ? "hpc-slurm" : "local-wasm");
    if (preset.profile) {
      setComputeProfile(preset.profile);
    }
    setInputValues((prev) => ({
      ...prev,
      ...preset.values,
    }));
    if (preset.values.meshResolution && typeof preset.values.meshResolution === "string") {
      setMeshResolution(preset.values.meshResolution as "coarse" | "medium" | "fine");
    }
    if (preset.values.maxIterations !== undefined) {
      setMaxIterations(Number(preset.values.maxIterations) || 1000);
    }
    if (preset.values.tolerance !== undefined) {
      setTolerance(String(preset.values.tolerance));
    }
  };

  const handleInspectCustomCode = async () => {
    if (!customCode.trim()) return;
    setIsInspecting(true);
    try {
      const res = await inspectModelSource(customCode, customModelName);
      if (res.modelName) setCustomModelName(res.modelName);
      if (Array.isArray(res.parameters)) {
        setInspectedParams(res.parameters);
        const nextOverrides: Record<string, number> = {};
        for (const p of res.parameters) {
          const numVal = Number(p.value ?? p.defaultValue ?? 1.0);
          nextOverrides[p.name] = Number.isFinite(numVal) ? numVal : 1.0;
        }
        setParameterOverrides(nextOverrides);
      }
    } catch (err) {
      console.error("Failed to inspect model source:", err);
    } finally {
      setIsInspecting(false);
    }
  };

  const buildRunPayload = (overrideTarget?: "local-wasm" | "hpc-slurm") => {
    const target = overrideTarget || executionTarget;
    const resolvedModelName = activeModel?.modelName || activeModel?.qualifiedName || activeModel?.name || "Model";
    const resolvedPackageName =
      searchParams.get("package") || activeModel?.packageName || studyDef?.packageName || undefined;
    const resolvedPackageVersion =
      searchParams.get("version") || activeModel?.packageVersion || studyDef?.packageVersion || undefined;
    const resolvedArtifact =
      searchParams.get("artifact") || activeModel?.qualifiedName || activeModel?.name || undefined;

    return {
      meshResolution,
      maxIterations: Number(maxIterations),
      tolerance: parseFloat(tolerance) || 1e-5,
      modelId: activeModel?.id,
      modelName: resolvedModelName,
      packageName: resolvedPackageName,
      packageVersion: resolvedPackageVersion,
      targetArtifact: resolvedArtifact,
      dialect: activeModel?.dialect || activeModel?.domain || "modelica",
      code: modelMode === "custom" ? customCode : activeModel?.code,
      studyInputs: {
        ...inputValues,
        meshResolution,
        maxIterations: Number(maxIterations),
        tolerance: parseFloat(tolerance) || 1e-5,
      },
      parameterOverrides,
      executionTarget: target,
      computeProfile,
      presetId: activePresetId || undefined,
      saveInstanceToPackage: saveInstanceToPackage ? resolvedPackageName || true : false,
      linkToPackage: saveInstanceToPackage ? resolvedPackageName || true : false,
      studyInstanceSource: customInstanceSource || synthesizedInstance?.sourceContent,
    };
  };

  const handleRun = async () => {
    if (!id) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const data = await runJobTemplate(id, buildRunPayload());
      if (data.jobId) {
        navigate(`/jobs/${data.jobId}`);
      }
    } catch (e: unknown) {
      console.error(e);
      const msg =
        (axios.isAxiosError(e) && (e.response?.data as { error?: string | undefined })?.error) ||
        (e instanceof Error ? e.message : "Error starting study run");
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleInstantPreview = async () => {
    if (!id) return;
    setIsPreviewRunning(true);
    setError(null);
    try {
      const data = await runJobTemplate(id, buildRunPayload("local-wasm"));
      const resolvedResults = data.studyResults || data.results;
      if (resolvedResults && data.jobId) {
        setPreviewResult({
          jobId: data.jobId,
          results: resolvedResults,
        });
      } else if (data.jobId) {
        navigate(`/jobs/${data.jobId}`);
      }
    } catch (e: unknown) {
      console.error(e);
      const msg =
        (axios.isAxiosError(e) && (e.response?.data as { error?: string | undefined })?.error) ||
        (e instanceof Error ? e.message : "Error running local pre-flight preview");
      setError(msg);
    } finally {
      setIsPreviewRunning(false);
    }
  };

  if (loading) {
    return (
      <Box display="flex" alignItems="center" justifyContent="center" height="100%" p={5}>
        <Text color="var(--color-fg-muted)">Loading Study Studio...</Text>
      </Box>
    );
  }

  if (loadError || !template) {
    return (
      <Box
        display="flex"
        flexDirection="column"
        alignItems="center"
        justifyContent="center"
        height="100%"
        p={5}
        gap={3}
      >
        <Flash variant="danger">{loadError || "Template not found."}</Flash>
        <Button onClick={() => navigate("/jobs")}>Back to Cloud Jobs</Button>
      </Box>
    );
  }

  const rawConfig =
    typeof template.config === "string"
      ? safeJsonParse<Record<string, unknown>>(template.config, {})
      : (template.config as Record<string, unknown>);
  const stepsList: (string | TemplateStepItem)[] = Array.isArray(studyDef?.execution?.pipelineSteps)
    ? studyDef.execution.pipelineSteps
    : Array.isArray(studyDef?.steps)
      ? studyDef.steps
      : Array.isArray(rawConfig?.steps)
        ? rawConfig.steps
        : [];
  const studyKindKey = studyDef?.archetype || studyDef?.kind || "time-domain";
  const archetypeInfo = ARCHETYPE_BADGE_MAP[studyKindKey] || ARCHETYPE_BADGE_MAP["time-domain"]!;
  const isPackageTemplate = studyDef?.sourceType === "package" || Boolean(studyDef?.packageName);
  const resolvedSolver =
    studyDef?.execution?.recommendedSolver || studyDef?.solver || rawConfig?.solver || "SUNDIALS CVODE";
  const resolvedDialects = studyDef?.modelContract?.domains || studyDef?.modelContract?.dialects || ["modelica"];
  const activeModelDisplayName = activeModel?.modelName || activeModel?.qualifiedName || activeModel?.name || "Default";

  // Compute sample count estimate for preview
  const estimatedSamples = Number(
    inputValues.samples ??
      inputValues.sampleCount ??
      inputValues.sweepSteps ??
      inputValues.evaluations ??
      inputValues.populationSize ??
      (inputValues.gridResolution ? Number(inputValues.gridResolution) ** 2 : 1),
  );

  return (
    <Box display="flex" flexDirection="column" style={{ minHeight: "100%", height: "100%" }}>
      {/* Top Studio Header */}
      <Box
        p={3}
        display="flex"
        alignItems="center"
        flexWrap="wrap"
        gap={3}
        borderBottom="1px solid var(--color-border-subtle)"
        bg="var(--color-canvas-default)"
      >
        <CircleIconButton onClick={() => navigate("/jobs")} aria-label="Back">
          <ArrowLeftIcon size={20} />
        </CircleIconButton>

        <Box flex={1} style={{ minWidth: "240px" }}>
          <Box display="flex" alignItems="center" gap={2} flexWrap="wrap" mb={1}>
            <Heading as="h2" style={{ fontSize: "20px", fontWeight: 800, margin: 0, color: "var(--color-fg-default)" }}>
              {template.name}
            </Heading>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
                fontSize: "11px",
                fontWeight: 700,
                padding: "2px 8px",
                borderRadius: "999px",
                color: archetypeInfo.color,
                background: archetypeInfo.bg,
              }}
            >
              <BeakerIcon size={12} />
              {archetypeInfo.label}
            </span>
            {isPackageTemplate ? (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "5px",
                  fontSize: "11px",
                  fontWeight: 700,
                  padding: "2px 8px",
                  borderRadius: "999px",
                  color: "#a855f7",
                  background: "rgba(168, 85, 247, 0.14)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                <PackageIcon size={12} />
                {studyDef?.packageName}
                {studyDef?.packageVersion ? `@${studyDef.packageVersion}` : ""}
              </span>
            ) : (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  fontSize: "11px",
                  fontWeight: 700,
                  padding: "2px 8px",
                  borderRadius: "999px",
                  color: "#06b6d4",
                  background: "rgba(6, 182, 212, 0.14)",
                }}
              >
                <VerifiedIcon size={12} />
                Official Built-In Study
              </span>
            )}
            {studyDef?.standardAlignment && (
              <span
                style={{
                  fontSize: "11px",
                  fontFamily: "var(--font-mono)",
                  color: "var(--color-fg-muted)",
                  padding: "2px 8px",
                  borderRadius: "6px",
                  background: "var(--color-canvas-subtle)",
                  border: "1px solid var(--color-border-subtle)",
                }}
              >
                {studyDef.standardAlignment}
              </span>
            )}
          </Box>
          <Text fontSize="12px" color="var(--color-fg-muted)">
            Bound Model: <strong>{activeModelDisplayName}</strong>
            {activeModel?.packageName ? ` (${activeModel.packageName})` : ""} · Solver:{" "}
            <strong>{resolvedSolver}</strong> · Target:{" "}
            <strong>
              {executionTarget === "local-wasm" ? "⚡ Local WASM Pre-Flight" : `🚀 Slurm (${computeProfile})`}
            </strong>
          </Text>
        </Box>

        <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
          <Button
            size="medium"
            leadingVisual={ZapIcon}
            onClick={handleInstantPreview}
            disabled={isPreviewRunning || isSubmitting}
          >
            {isPreviewRunning ? "Running Pre-Flight..." : "Instant Pre-Flight Preview"}
          </Button>
          <Button
            variant="primary"
            leadingVisual={PlayIcon}
            onClick={handleRun}
            disabled={isSubmitting || isPreviewRunning}
          >
            {isSubmitting ? "Starting..." : "Start Simulation"}
          </Button>
        </Box>
      </Box>

      {/* Main 3-Zone Study Studio Content */}
      <Box flex={1} p={4} bg="var(--color-canvas-subtle)" style={{ overflowY: "auto" }}>
        <Box maxWidth="1360px" mx="auto" display="flex" flexDirection="column" gap={4}>
          {error && <Flash variant="danger">{error}</Flash>}

          {/* Instant Local Pre-Flight Result Banner (when triggered inline) */}
          {previewResult && (
            <Box
              p={4}
              borderRadius="12px"
              style={{
                background: "linear-gradient(135deg, rgba(6, 182, 212, 0.10), rgba(16, 185, 129, 0.08))",
                border: "1px solid rgba(6, 182, 212, 0.4)",
              }}
            >
              <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2} mb={3}>
                <Box display="flex" alignItems="center" gap={2}>
                  <CheckCircleFillIcon size={18} fill="var(--color-success-fg)" />
                  <Heading as="h3" style={{ fontSize: "15px", fontWeight: 800, margin: 0 }}>
                    Instant Local Pre-Flight Completed — {previewResult.results.modelName}
                  </Heading>
                  <Label variant="success">{previewResult.results.sampleCount} samples evaluated</Label>
                </Box>
                <Box display="flex" alignItems="center" gap={2}>
                  <Button size="small" variant="primary" onClick={() => navigate(`/jobs/${previewResult.jobId}`)}>
                    Open Full Study Run Inspector →
                  </Button>
                </Box>
              </Box>
              <Box
                display="grid"
                style={{
                  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                  gap: "10px",
                }}
              >
                {previewResult.results.kpis.map(
                  (kpi: { id: string; label: string; value: number | string; unit?: string | undefined }) => (
                    <Box
                      key={kpi.id}
                      p={3}
                      borderRadius="8px"
                      bg="var(--color-canvas-default)"
                      border="1px solid var(--color-border-default)"
                    >
                      <Text fontSize="11px" color="var(--color-fg-muted)" display="block">
                        {kpi.label}
                      </Text>
                      <Text fontSize="18px" fontWeight="bold" style={{ fontFamily: "var(--font-mono)" }}>
                        {kpi.value} {kpi.unit || ""}
                      </Text>
                    </Box>
                  ),
                )}
              </Box>
            </Box>
          )}

          {/* Study Overview & Contract Banner */}
          <Box
            p={4}
            borderRadius="10px"
            bg="var(--color-canvas-default)"
            border="1px solid var(--color-border-default)"
            display="grid"
            sx={{
              gridTemplateColumns: ["1fr", "1fr", "minmax(0, 1.7fr) minmax(0, 1fr)"],
              gap: 4,
              alignItems: "center",
            }}
          >
            <Box>
              <Text fontSize="14px" color="var(--color-fg-default)" display="block" mb={2} style={{ lineHeight: 1.6 }}>
                {template.description}
              </Text>
              <Box display="flex" gap={2} flexWrap="wrap" alignItems="center">
                <Label variant="accent">{template.category}</Label>
                {(studyDef?.tags || []).map((tag: string) => (
                  <span
                    key={tag}
                    style={{
                      fontSize: "11px",
                      padding: "2px 8px",
                      borderRadius: "999px",
                      background: "var(--color-canvas-subtle)",
                      border: "1px solid var(--color-border-subtle)",
                      color: "var(--color-fg-muted)",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    #{tag}
                  </span>
                ))}
              </Box>
            </Box>

            <Box
              display="grid"
              gridTemplateColumns="1fr 1fr"
              gridGap={2}
              p={3}
              borderRadius="8px"
              bg="var(--color-canvas-subtle)"
              border="1px solid var(--color-border-subtle)"
            >
              <Box>
                <Text fontSize="11px" color="var(--color-fg-muted)" display="block">
                  Solver Kernel
                </Text>
                <Text fontWeight="bold" fontSize="13px">
                  {resolvedSolver}
                </Text>
              </Box>
              <Box>
                <Text fontSize="11px" color="var(--color-fg-muted)" display="block">
                  Estimated Wall Time
                </Text>
                <Text fontWeight="bold" fontSize="13px">
                  {studyDef?.estimatedDuration || rawConfig?.estimatedDuration || "5s – 2m"}
                </Text>
              </Box>
              <Box>
                <Text fontSize="11px" color="var(--color-fg-muted)" display="block">
                  Accepted Dialects
                </Text>
                <Text fontWeight="bold" fontSize="12px" style={{ fontFamily: "var(--font-mono)" }}>
                  {resolvedDialects.join(", ").toUpperCase()}
                </Text>
              </Box>
              <Box>
                <Text fontSize="11px" color="var(--color-fg-muted)" display="block">
                  Pipeline Stages
                </Text>
                <Text fontWeight="bold" fontSize="13px">
                  {stepsList.length} stages
                </Text>
              </Box>
            </Box>
          </Box>

          {/* 3-Zone Workbench Grid */}
          <Box
            display="grid"
            sx={{
              gridTemplateColumns: ["1fr", "1fr", "minmax(0, 1.15fr) minmax(0, 1.15fr) minmax(0, 0.9fr)"],
              gap: 4,
              alignItems: "start",
            }}
          >
            {/* ==================== ZONE 1: MODEL ARTIFACT BINDING ==================== */}
            <Box
              bg="var(--color-canvas-default)"
              p={4}
              borderRadius="10px"
              border="1px solid var(--color-border-default)"
              display="flex"
              flexDirection="column"
              gap={3}
            >
              <Box display="flex" justifyContent="space-between" alignItems="center" gap={2}>
                <Box display="flex" alignItems="center" gap={2}>
                  <span
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: "6px",
                      background: "rgba(6, 182, 212, 0.15)",
                      color: "#06b6d4",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 800,
                      fontSize: "13px",
                    }}
                  >
                    1
                  </span>
                  <Box>
                    <Heading as="h3" style={{ fontSize: "15px", fontWeight: 800, margin: 0 }}>
                      Target Model Binding
                    </Heading>
                    <Text fontSize="11px" color="var(--color-fg-muted)">
                      Bind any compatible package model or paste `.mo` source
                    </Text>
                  </Box>
                </Box>

                <Box display="flex" gap={1}>
                  <Button
                    size="small"
                    variant={modelMode === "catalog" ? "primary" : "default"}
                    onClick={() => setModelMode("catalog")}
                  >
                    Package Catalog
                  </Button>
                  <Button
                    size="small"
                    variant={modelMode === "custom" ? "primary" : "default"}
                    leadingVisual={CodeIcon}
                    onClick={() => setModelMode("custom")}
                  >
                    Custom Code
                  </Button>
                </Box>
              </Box>

              {modelMode === "catalog" ? (
                <>
                  <TextInput
                    block
                    leadingVisual={SearchIcon}
                    placeholder="Search models across packages, MSL, IEEE, EN 14363..."
                    value={modelSearch}
                    onChange={(e) => setModelSearch(e.target.value)}
                  />

                  <Box
                    display="flex"
                    flexDirection="column"
                    gap={2}
                    style={{ maxHeight: "290px", overflowY: "auto", paddingRight: "2px" }}
                  >
                    {compatibleModels.map((model: CompatibleModelItem) => {
                      const isSelected = activeModel?.id === model.id;
                      const displayTitle = model.title || model.name || model.qualifiedName || model.id;
                      const displayFqn = model.modelName || model.qualifiedName || model.name || model.id;
                      const displayDialect = model.dialect || model.domain || "modelica";
                      const displaySummary = model.summary || model.description || "";
                      return (
                        <Box
                          key={model.id}
                          p={3}
                          borderRadius="8px"
                          onClick={() => setSelectedModelId(model.id)}
                          style={{
                            cursor: "pointer",
                            background: isSelected ? "rgba(6, 182, 212, 0.10)" : "var(--color-canvas-subtle)",
                            border: isSelected ? "1.5px solid #06b6d4" : "1px solid var(--color-border-subtle)",
                            transition: "all 0.15s ease",
                          }}
                        >
                          <Box display="flex" justifyContent="space-between" alignItems="flex-start" gap={2}>
                            <Text fontWeight="bold" fontSize="13px" color="var(--color-fg-default)">
                              {displayTitle}
                            </Text>
                            <span
                              style={{
                                fontSize: "10px",
                                fontWeight: 700,
                                textTransform: "uppercase",
                                padding: "1px 6px",
                                borderRadius: "4px",
                                background: "rgba(59, 130, 246, 0.15)",
                                color: "#3b82f6",
                                fontFamily: "var(--font-mono)",
                                flexShrink: 0,
                              }}
                            >
                              {displayDialect}
                            </span>
                          </Box>
                          <Text
                            fontSize="11px"
                            color="var(--color-fg-muted)"
                            display="block"
                            mt={1}
                            style={{ fontFamily: "var(--font-mono)" }}
                          >
                            {displayFqn}
                            {model.packageName ? ` · ${model.packageName}` : ""}
                          </Text>
                          <Text fontSize="11px" color="var(--color-fg-muted)" display="block" mt={1}>
                            {displaySummary}
                          </Text>
                        </Box>
                      );
                    })}
                  </Box>
                </>
              ) : (
                <Box display="flex" flexDirection="column" gap={2}>
                  <FormControl>
                    <FormControl.Label>Model Name (FQN)</FormControl.Label>
                    <TextInput
                      block
                      value={customModelName}
                      onChange={(e) => setCustomModelName(e.target.value)}
                      placeholder="e.g. RLC_Resonator"
                    />
                  </FormControl>
                  <FormControl>
                    <FormControl.Label>Modelica / ModelScript Source (`.mo` / `.msx`)</FormControl.Label>
                    <textarea
                      rows={7}
                      value={customCode}
                      onChange={(e) => setCustomCode(e.target.value)}
                      placeholder="model MyModel&#10;  parameter Real R = 12.0;&#10;  Real v(start = 1.0);&#10;equation&#10;  der(v) = -v / R;&#10;end MyModel;"
                      style={{
                        width: "100%",
                        fontFamily: "var(--font-mono)",
                        fontSize: "12px",
                        padding: "10px",
                        borderRadius: "6px",
                        background: "var(--color-canvas-subtle)",
                        color: "var(--color-fg-default)",
                        border: "1px solid var(--color-border-default)",
                      }}
                    />
                  </FormControl>
                  <Button
                    size="small"
                    leadingVisual={SparklesFillIcon}
                    onClick={handleInspectCustomCode}
                    disabled={isInspecting}
                  >
                    {isInspecting ? "Extracting Parameters..." : "Extract Tunable Parameters from Code"}
                  </Button>
                </Box>
              )}

              {/* Tunable Model Parameters Inspector */}
              <Box
                p={3}
                borderRadius="8px"
                bg="var(--color-canvas-subtle)"
                border="1px solid var(--color-border-subtle)"
              >
                <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                  <Text fontWeight="bold" fontSize="12px" color="var(--color-fg-default)">
                    Model Parameter Overrides ({(activeModel?.parameters || []).length})
                  </Text>
                  <Text fontSize="11px" color="var(--color-fg-muted)" style={{ fontFamily: "var(--font-mono)" }}>
                    Nominal Baseline
                  </Text>
                </Box>

                {(activeModel?.parameters || []).length > 0 ? (
                  <Box display="flex" flexDirection="column" gap={2}>
                    {(activeModel?.parameters || []).map(
                      (param: {
                        name: string;
                        value?: number | undefined;
                        defaultValue?: number | string | boolean | undefined;
                        unit?: string | undefined;
                        description?: string | undefined;
                      }) => {
                        const fallbackVal = Number(param.value ?? param.defaultValue ?? 1.0);
                        return (
                          <Box
                            key={param.name}
                            display="grid"
                            gridTemplateColumns="minmax(0, 1.2fr) minmax(0, 1fr)"
                            gridGap={2}
                            alignItems="center"
                          >
                            <Box>
                              <Text
                                fontWeight="bold"
                                fontSize="12px"
                                style={{ fontFamily: "var(--font-mono)" }}
                                color="var(--color-fg-default)"
                              >
                                {param.name}
                                {param.unit ? (
                                  <span style={{ color: "var(--color-fg-muted)", fontWeight: 400 }}>
                                    {" "}
                                    [{param.unit}]
                                  </span>
                                ) : null}
                              </Text>
                              {param.description && (
                                <Text fontSize="10px" color="var(--color-fg-muted)" display="block">
                                  {param.description}
                                </Text>
                              )}
                            </Box>
                            <TextInput
                              size="small"
                              type="number"
                              step="any"
                              value={String(parameterOverrides[param.name] ?? fallbackVal)}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value);
                                setParameterOverrides((prev) => ({
                                  ...prev,
                                  [param.name]: Number.isFinite(val) ? val : 0,
                                }));
                              }}
                            />
                          </Box>
                        );
                      },
                    )}
                  </Box>
                ) : (
                  <Text fontSize="12px" color="var(--color-fg-muted)">
                    Default model parameters active.
                  </Text>
                )}

                {/* Observables Contract */}
                {(activeModel?.observables || []).length > 0 && (
                  <Box mt={3} pt={2} borderTop="1px solid var(--color-border-subtle)">
                    <Text fontWeight="bold" fontSize="11px" color="var(--color-fg-muted)" display="block" mb={1}>
                      Monitored Output Observables
                    </Text>
                    <Box display="flex" gap={1} flexWrap="wrap">
                      {(activeModel?.observables || []).map((obs: { name: string; unit?: string | undefined }) => (
                        <span
                          key={obs.name}
                          style={{
                            fontSize: "11px",
                            fontFamily: "var(--font-mono)",
                            padding: "2px 7px",
                            borderRadius: "4px",
                            background: "rgba(16, 185, 129, 0.12)",
                            color: "#10b981",
                          }}
                        >
                          {obs.name}
                          {obs.unit ? ` (${obs.unit})` : ""}
                        </span>
                      ))}
                    </Box>
                  </Box>
                )}
              </Box>
            </Box>

            {/* ==================== ZONE 2: STUDY CONFIGURATION & PRESETS ==================== */}
            <Box
              bg="var(--color-canvas-default)"
              p={4}
              borderRadius="10px"
              border="1px solid var(--color-border-default)"
              display="flex"
              flexDirection="column"
              gap={3}
            >
              <Box display="flex" alignItems="center" gap={2}>
                <span
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: "6px",
                    background: "rgba(168, 85, 247, 0.15)",
                    color: "#a855f7",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 800,
                    fontSize: "13px",
                  }}
                >
                  2
                </span>
                <Box>
                  <Heading as="h3" style={{ fontSize: "15px", fontWeight: 800, margin: 0 }}>
                    Study Configuration & Presets
                  </Heading>
                  <Text fontSize="11px" color="var(--color-fg-muted)">
                    Configure experiment fidelity, sampling strategy & solver tolerances
                  </Text>
                </Box>
              </Box>

              {/* 1-Click Study Presets */}
              {Array.isArray(studyDef?.presets) && studyDef.presets.length > 0 && (
                <Box>
                  <Text fontWeight="bold" fontSize="12px" color="var(--color-fg-muted)" display="block" mb={2}>
                    1-Click Fidelity & Target Presets
                  </Text>
                  <Box display="grid" gridTemplateColumns="1fr 1fr" gridGap={2}>
                    {studyDef.presets.map((preset: StudyPresetPayload) => {
                      const isSelected = activePresetId === preset.id;
                      const presetTarget = preset.target || preset.targetHint || "local-wasm";
                      return (
                        <Box
                          key={preset.id}
                          p={2}
                          borderRadius="8px"
                          onClick={() => handleApplyPreset(preset)}
                          style={{
                            cursor: "pointer",
                            background: isSelected ? "rgba(168, 85, 247, 0.12)" : "var(--color-canvas-subtle)",
                            border: isSelected ? "1.5px solid #a855f7" : "1px solid var(--color-border-subtle)",
                          }}
                        >
                          <Box display="flex" justifyContent="space-between" alignItems="center" gap={1}>
                            <Text fontWeight="bold" fontSize="12px" color="var(--color-fg-default)">
                              {preset.label}
                            </Text>
                            <span
                              style={{
                                fontSize: "10px",
                                fontFamily: "var(--font-mono)",
                                color: presetTarget === "local-wasm" ? "#06b6d4" : "#f59e0b",
                              }}
                            >
                              {presetTarget === "local-wasm" ? "⚡ WASM" : "🚀 HPC"}
                            </span>
                          </Box>
                          <Text fontSize="11px" color="var(--color-fg-muted)" display="block" mt={1}>
                            {preset.description}
                          </Text>
                        </Box>
                      );
                    })}
                  </Box>
                </Box>
              )}

              {/* Dynamic Study Input Fields */}
              {Array.isArray(studyDef?.inputs) && studyDef.inputs.length > 0 && (
                <Box display="flex" flexDirection="column" gap={2}>
                  {studyDef.inputs.map((field: StudyInputFieldPayload) => {
                    const currentVal = inputValues[field.key] ?? field.defaultValue;
                    return (
                      <FormControl key={field.key}>
                        <FormControl.Label>
                          {field.label}
                          {field.unit ? ` (${field.unit})` : ""}
                        </FormControl.Label>
                        {field.type === "select" && Array.isArray(field.options) ? (
                          <Select
                            block
                            value={String(currentVal)}
                            onChange={(e) => {
                              const next = e.target.value;
                              setInputValues((prev) => ({ ...prev, [field.key]: next }));
                              if (field.key === "meshResolution") {
                                setMeshResolution(next as "coarse" | "medium" | "fine");
                              }
                            }}
                          >
                            {field.options.map((opt: { value: string; label: string }) => (
                              <Select.Option key={opt.value} value={opt.value}>
                                {opt.label}
                              </Select.Option>
                            ))}
                          </Select>
                        ) : (
                          <TextInput
                            block
                            type={field.type === "number" || field.type === "integer" ? "number" : "text"}
                            value={String(currentVal)}
                            step={field.step ? String(field.step) : "any"}
                            min={field.min !== undefined ? String(field.min) : undefined}
                            max={field.max !== undefined ? String(field.max) : undefined}
                            onChange={(e) => {
                              const raw = e.target.value;
                              const parsed = field.type === "number" || field.type === "integer" ? Number(raw) : raw;
                              setInputValues((prev) => ({ ...prev, [field.key]: parsed }));
                              if (field.key === "maxIterations") setMaxIterations(Number(raw) || 0);
                              if (field.key === "tolerance") setTolerance(raw);
                            }}
                          />
                        )}
                        {field.description && <FormControl.Caption>{field.description}</FormControl.Caption>}
                      </FormControl>
                    );
                  })}
                </Box>
              )}

              {/* Standard Solver Convergence Controls (Always accessible for consistency & legacy compatibility) */}
              <Box
                p={3}
                borderRadius="8px"
                bg="var(--color-canvas-subtle)"
                border="1px solid var(--color-border-subtle)"
              >
                <Text fontWeight="bold" fontSize="12px" color="var(--color-fg-default)" display="block" mb={2}>
                  Solver Discretization & Convergence Overrides
                </Text>
                <Box display="grid" gridTemplateColumns="1fr 1fr 1fr" gridGap={2}>
                  <FormControl>
                    <FormControl.Label>Simulation Mesh Resolution</FormControl.Label>
                    <Select
                      block
                      value={meshResolution}
                      onChange={(e) => setMeshResolution(e.target.value as "coarse" | "medium" | "fine")}
                    >
                      <Select.Option value="coarse">Coarse (Fast)</Select.Option>
                      <Select.Option value="medium">Medium (Standard)</Select.Option>
                      <Select.Option value="fine">Fine (High Accuracy)</Select.Option>
                    </Select>
                  </FormControl>
                  <FormControl>
                    <FormControl.Label>Maximum Iterations</FormControl.Label>
                    <TextInput
                      block
                      value={String(maxIterations)}
                      onChange={(e) => setMaxIterations(Number(e.target.value) || 0)}
                      type="number"
                      min="1"
                      max="100000"
                    />
                  </FormControl>
                  <FormControl>
                    <FormControl.Label>Target Tolerance</FormControl.Label>
                    <TextInput
                      block
                      value={tolerance}
                      onChange={(e) => setTolerance(e.target.value)}
                      placeholder="1e-5"
                    />
                  </FormControl>
                </Box>
              </Box>
            </Box>

            {/* ==================== ZONE 3: EXECUTION TARGET & PIPELINE ==================== */}
            <Box display="flex" flexDirection="column" gap={3}>
              <Box
                bg="var(--color-canvas-default)"
                p={4}
                borderRadius="10px"
                border="1px solid var(--color-border-default)"
                display="flex"
                flexDirection="column"
                gap={3}
              >
                <Box display="flex" alignItems="center" gap={2}>
                  <span
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: "6px",
                      background: "rgba(16, 185, 129, 0.15)",
                      color: "#10b981",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 800,
                      fontSize: "13px",
                    }}
                  >
                    3
                  </span>
                  <Box>
                    <Heading as="h3" style={{ fontSize: "15px", fontWeight: 800, margin: 0 }}>
                      Execution Target & Dispatch
                    </Heading>
                    <Text fontSize="11px" color="var(--color-fg-muted)">
                      Run locally in WASM or scale out to Slurm HPC
                    </Text>
                  </Box>
                </Box>

                {/* Target Selector Cards */}
                <Box display="flex" flexDirection="column" gap={2}>
                  <Box
                    p={3}
                    borderRadius="8px"
                    onClick={() => setExecutionTarget("local-wasm")}
                    style={{
                      cursor: "pointer",
                      background:
                        executionTarget === "local-wasm" ? "rgba(6, 182, 212, 0.10)" : "var(--color-canvas-subtle)",
                      border:
                        executionTarget === "local-wasm"
                          ? "1.5px solid #06b6d4"
                          : "1px solid var(--color-border-subtle)",
                    }}
                  >
                    <Box display="flex" justifyContent="space-between" alignItems="center">
                      <Box display="flex" alignItems="center" gap={2}>
                        <ZapIcon size={16} fill="#06b6d4" />
                        <Text fontWeight="bold" fontSize="13px">
                          Local WASM / WebGPU Engine
                        </Text>
                      </Box>
                      <Label variant="accent">Free · 0 ms Queue</Label>
                    </Box>
                    <Text fontSize="11px" color="var(--color-fg-muted)" display="block" mt={1}>
                      Immediate local pre-flight execution with full KPI, fan chart & sensitivity analysis.
                    </Text>
                  </Box>

                  <Box
                    p={3}
                    borderRadius="8px"
                    onClick={() => setExecutionTarget("hpc-slurm")}
                    style={{
                      cursor: "pointer",
                      background:
                        executionTarget === "hpc-slurm" ? "rgba(245, 158, 11, 0.10)" : "var(--color-canvas-subtle)",
                      border:
                        executionTarget === "hpc-slurm"
                          ? "1.5px solid #f59e0b"
                          : "1px solid var(--color-border-subtle)",
                    }}
                  >
                    <Box display="flex" justifyContent="space-between" alignItems="center">
                      <Box display="flex" alignItems="center" gap={2}>
                        <ServerIcon size={16} fill="#f59e0b" />
                        <Text fontWeight="bold" fontSize="13px">
                          HPC Slurm Cluster Partition
                        </Text>
                      </Box>
                      <Label variant="attention">Distributed MPI / GPU</Label>
                    </Box>
                    <Text fontSize="11px" color="var(--color-fg-muted)" display="block" mt={1}>
                      Scale large Monte Carlo ensembles, 3D Tet10 FEA & RANS CFD across multi-node partitions.
                    </Text>

                    {executionTarget === "hpc-slurm" && (
                      <Box mt={2} pt={2} borderTop="1px solid var(--color-border-subtle)">
                        <FormControl>
                          <FormControl.Label>Slurm Partition Profile</FormControl.Label>
                          <Select
                            block
                            value={computeProfile}
                            onChange={(e) => setComputeProfile(e.target.value as "standard" | "high-cpu" | "gpu-a100")}
                          >
                            <Select.Option value="standard">compute-standard (16 vCPU · 64 GB RAM)</Select.Option>
                            <Select.Option value="high-cpu">high-cpu (64 vCPU · 256 GB RAM · OpenMPI)</Select.Option>
                            <Select.Option value="gpu-a100">gpu-accelerated (4x NVIDIA A100 80GB)</Select.Option>
                          </Select>
                        </FormControl>
                      </Box>
                    )}
                  </Box>
                </Box>

                {/* Synthesized Open-Standard Study Instance Artifact (.sedml / .ssv / .dakota) */}
                <Box
                  p={3}
                  borderRadius="8px"
                  bg="var(--color-canvas-subtle)"
                  border="1px solid var(--color-border-subtle)"
                  display="flex"
                  flexDirection="column"
                  gap={2}
                >
                  <Box display="flex" justifyContent="space-between" alignItems="center" gap={2} flexWrap="wrap">
                    <Box display="flex" alignItems="center" gap={1}>
                      <FileCodeIcon size={14} />
                      <Text fontWeight="bold" fontSize="11px" color="var(--color-fg-default)">
                        STUDY INSTANCE ARTIFACT
                      </Text>
                    </Box>
                    <span
                      style={{
                        fontSize: "10px",
                        fontWeight: 700,
                        fontFamily: "var(--font-mono)",
                        padding: "1px 7px",
                        borderRadius: "4px",
                        background: "rgba(6, 182, 212, 0.14)",
                        color: "#06b6d4",
                      }}
                    >
                      {synthesizedInstance?.standardFormat === "ssp-ssv"
                        ? "ASAM SSP 2.0 (.ssv)"
                        : synthesizedInstance?.standardFormat === "dakota"
                          ? "Sandia Dakota (.dakota)"
                          : "SED-ML L1V4 (.sedml)"}
                    </span>
                  </Box>

                  <Text fontSize="11px" color="var(--color-fg-muted)" style={{ fontFamily: "var(--font-mono)" }}>
                    {synthesizedInstance?.fileName || `${template.slug}.sedml`}
                  </Text>

                  {/* Storage & Relational Linking Selector: Job Record vs Linked to Package & Artifact */}
                  <Box display="flex" flexDirection="column" gap={1} mt={1}>
                    <Text fontWeight="bold" fontSize="11px" color="var(--color-fg-muted)">
                      Study Instance &amp; Provenance Link:
                    </Text>
                    <Box display="grid" gridTemplateColumns="1fr 1fr" gridGap={2}>
                      <Box
                        p={2}
                        borderRadius="6px"
                        onClick={() => setSaveInstanceToPackage(false)}
                        style={{
                          cursor: "pointer",
                          background: !saveInstanceToPackage
                            ? "rgba(6, 182, 212, 0.12)"
                            : "var(--color-canvas-default)",
                          border: !saveInstanceToPackage
                            ? "1.5px solid #06b6d4"
                            : "1px solid var(--color-border-default)",
                        }}
                      >
                        <Text fontWeight="bold" fontSize="11px" display="block">
                          Job Record Only
                        </Text>
                        <Text fontSize="10px" color="var(--color-fg-muted)">
                          Rerunnable &amp; saveable as template
                        </Text>
                      </Box>
                      <Box
                        p={2}
                        borderRadius="6px"
                        onClick={() => setSaveInstanceToPackage(true)}
                        style={{
                          cursor: "pointer",
                          background: saveInstanceToPackage
                            ? "rgba(168, 85, 247, 0.12)"
                            : "var(--color-canvas-default)",
                          border: saveInstanceToPackage
                            ? "1.5px solid #a855f7"
                            : "1px solid var(--color-border-default)",
                        }}
                      >
                        <Text fontWeight="bold" fontSize="11px" display="block">
                          Link to Package &amp; Model
                        </Text>
                        <Text fontSize="10px" color="var(--color-fg-muted)">
                          Surface in{" "}
                          <code>
                            {searchParams.get("package") ||
                              activeModel?.packageName ||
                              studyDef?.packageName ||
                              "package"}
                          </code>{" "}
                          Studies tab (keeps signed release immutable)
                        </Text>
                      </Box>
                    </Box>
                  </Box>

                  <Box display="flex" justifyContent="space-between" alignItems="center" gap={2} mt={1}>
                    <Button size="small" onClick={() => setShowInstanceSource((prev) => !prev)}>
                      {showInstanceSource ? "Hide Artifact Source" : "Inspect / Edit Artifact"}
                    </Button>
                    <Button
                      size="small"
                      leadingVisual={DownloadIcon}
                      onClick={handleDownloadStudyInstance}
                      disabled={!customInstanceSource && !synthesizedInstance?.sourceContent}
                    >
                      Download
                    </Button>
                  </Box>

                  {showInstanceSource && (
                    <textarea
                      rows={9}
                      value={customInstanceSource}
                      onChange={(e) => setCustomInstanceSource(e.target.value)}
                      style={{
                        width: "100%",
                        fontFamily: "var(--font-mono)",
                        fontSize: "11px",
                        padding: "8px",
                        borderRadius: "6px",
                        background: "var(--color-canvas-default)",
                        color: "var(--color-fg-default)",
                        border: "1px solid var(--color-border-default)",
                        marginTop: "4px",
                      }}
                    />
                  )}
                </Box>

                {/* Study Matrix Summary Box */}
                <Box
                  p={3}
                  borderRadius="8px"
                  bg="var(--color-canvas-subtle)"
                  border="1px solid var(--color-border-subtle)"
                >
                  <Text fontWeight="bold" fontSize="11px" color="var(--color-fg-muted)" display="block" mb={1}>
                    STUDY MATRIX SUMMARY
                  </Text>
                  <Box display="flex" justifyContent="space-between" fontSize="12px" mb={1}>
                    <Text color="var(--color-fg-muted)">Target Model:</Text>
                    <Text fontWeight="bold" style={{ fontFamily: "var(--font-mono)" }}>
                      {activeModelDisplayName}
                    </Text>
                  </Box>
                  <Box display="flex" justifyContent="space-between" fontSize="12px" mb={1}>
                    <Text color="var(--color-fg-muted)">Ensemble / Sweep Runs:</Text>
                    <Text fontWeight="bold" style={{ fontFamily: "var(--font-mono)" }}>
                      {estimatedSamples} {estimatedSamples === 1 ? "trajectory" : "parallel evaluations"}
                    </Text>
                  </Box>
                  <Box display="flex" justifyContent="space-between" fontSize="12px">
                    <Text color="var(--color-fg-muted)">Provenance Lockfile:</Text>
                    <Text fontWeight="bold" color="var(--color-success-fg)" style={{ fontFamily: "var(--font-mono)" }}>
                      SHA-256 Reproducible
                    </Text>
                  </Box>
                </Box>

                <Button
                  variant="primary"
                  size="large"
                  leadingVisual={PlayIcon}
                  onClick={handleRun}
                  disabled={isSubmitting || isPreviewRunning}
                  block
                >
                  {isSubmitting ? "Starting Study Run..." : "Run Study Against Model"}
                </Button>
              </Box>

              {/* Pipeline Execution Stages Card */}
              <Box
                bg="var(--color-canvas-default)"
                p={4}
                borderRadius="10px"
                border="1px solid var(--color-border-default)"
              >
                <Heading as="h3" style={{ fontSize: "14px", fontWeight: 700, margin: "0 0 12px 0" }}>
                  Pipeline Execution Steps ({stepsList.length})
                </Heading>
                {stepsList.length > 0 ? (
                  <Box display="flex" flexDirection="column" gap={2}>
                    {stepsList.map((step, index) => {
                      const stepTitle =
                        typeof step === "string"
                          ? step
                          : step?.name || step?.title || step?.command || `Stage ${index + 1}`;
                      const stepDesc = typeof step === "object" && step !== null ? step.description : undefined;
                      return (
                        <Box
                          key={index}
                          display="flex"
                          alignItems="flex-start"
                          gap={2}
                          p={2}
                          borderRadius="6px"
                          bg="var(--color-canvas-subtle)"
                          border="1px solid var(--color-border-subtle)"
                        >
                          <Box
                            style={{
                              width: 22,
                              height: 22,
                              borderRadius: "50%",
                              background: "rgba(6, 182, 212, 0.15)",
                              color: "var(--color-accent-cyan, #06b6d4)",
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: 11,
                              fontWeight: 700,
                              flexShrink: 0,
                            }}
                          >
                            {index + 1}
                          </Box>
                          <Box flex={1}>
                            <Text fontWeight="bold" fontSize="12px" display="block">
                              {stepTitle}
                            </Text>
                            {stepDesc && (
                              <Text fontSize="11px" color="var(--color-fg-muted)" display="block">
                                {stepDesc}
                              </Text>
                            )}
                          </Box>
                        </Box>
                      );
                    })}
                  </Box>
                ) : (
                  <Text color="var(--color-fg-muted)" fontSize="13px">
                    Standard single-stage solver execution.
                  </Text>
                )}
              </Box>
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export default TemplateDetailPage;
