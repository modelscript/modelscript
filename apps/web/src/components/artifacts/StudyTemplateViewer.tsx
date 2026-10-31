// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  BeakerIcon,
  CodeIcon,
  PackageIcon,
  PlayIcon,
  ServerIcon,
  SlidersIcon,
  VerifiedIcon,
  ZapIcon,
} from "@primer/octicons-react";
import { Button, Heading, Label, Text } from "@primer/react";
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import Box from "../Box";

export interface StudyTemplateViewerProps {
  viewConfig: {
    id?: string | undefined;
    slug?: string | undefined;
    name?: string | undefined;
    title?: string | undefined;
    version?: string | undefined;
    kind?: string | undefined;
    category?: string | undefined;
    description?: string | undefined;
    packageName?: string | undefined;
    packageVersion?: string | undefined;
    artifactPath?: string | undefined;
    domains?: string[] | undefined;
    supportedTargets?: string[] | undefined;
    recommendedSolver?: string | undefined;
    estimatedCredits?: number | undefined;
    inputsCount?: number | undefined;
    kpis?: ({ id?: string; label?: string; unit?: string } | string)[] | undefined;
    pipelineSteps?: string[] | undefined;
    studyDefinition?: Record<string, unknown> | undefined;
    [key: string]: unknown;
  };
  artifactPath?: string | undefined;
}

export const StudyTemplateViewer: React.FC<StudyTemplateViewerProps> = ({ viewConfig, artifactPath }) => {
  const navigate = useNavigate();
  const [showRawSpec, setShowRawSpec] = useState(false);

  const studyDef = (viewConfig.studyDefinition || viewConfig) as Record<string, any>;
  const rawPath = String(artifactPath || viewConfig.artifactPath || studyDef.artifactPath || "");
  const stdFormat: "sedml" | "ssp-ssv" | "dakota" =
    studyDef.standardFormat === "ssp-ssv" || rawPath.endsWith(".ssv")
      ? "ssp-ssv"
      : studyDef.standardFormat === "dakota" ||
          rawPath.endsWith(".dakota") ||
          studyDef.kind === "monte-carlo" ||
          studyDef.kind === "multi-objective"
        ? "dakota"
        : "sedml";
  const stdExt = stdFormat === "ssp-ssv" ? ".ssv" : stdFormat === "dakota" ? ".dakota" : ".sedml";
  const stdBadgeLabel =
    stdFormat === "ssp-ssv"
      ? "ASAM SSP 2.0 (.ssv)"
      : stdFormat === "dakota"
        ? "Sandia Dakota (.dakota)"
        : "SED-ML L1V4 (.sedml)";

  const slug = String(
    studyDef.slug ||
      viewConfig.slug ||
      rawPath
        .split("/")
        .pop()
        ?.replace(/\.(sedml|ssv|dakota|study\.json)$/i, "") ||
      "monte-carlo-sweep",
  );
  const title = String(studyDef.name || viewConfig.name || viewConfig.title || slug.replace(/-/g, " "));
  const kind = String(studyDef.kind || viewConfig.kind || "parameter-sweep");
  const category = String(studyDef.category || viewConfig.category || "simulation");
  const description = String(
    studyDef.description ||
      viewConfig.description ||
      `Reusable standards-compliant engineering study definition (${stdBadgeLabel}).`,
  );
  const domains: string[] = (
    Array.isArray(studyDef.modelContract?.domains)
      ? studyDef.modelContract.domains
      : Array.isArray(viewConfig.domains)
        ? viewConfig.domains
        : ["modelica", "fmu"]
  ).filter((d: string) => d !== "msx");
  const targets: string[] = Array.isArray(studyDef.execution?.supportedTargets)
    ? studyDef.execution.supportedTargets
    : Array.isArray(viewConfig.supportedTargets)
      ? viewConfig.supportedTargets
      : ["local-wasm", "hpc-cluster"];
  const solver = String(studyDef.execution?.recommendedSolver || viewConfig.recommendedSolver || "SUNDIALS CVODE");
  const steps: string[] = Array.isArray(studyDef.execution?.pipelineSteps)
    ? studyDef.execution.pipelineSteps
    : Array.isArray(viewConfig.pipelineSteps)
      ? viewConfig.pipelineSteps
      : ["Validate Model Contract", "Execute Solver Ensemble", "Compute KPIs & Lockfile"];
  const kpisRaw = Array.isArray(studyDef.outputs?.kpis)
    ? studyDef.outputs.kpis
    : Array.isArray(viewConfig.kpis)
      ? viewConfig.kpis
      : [];

  return (
    <Box
      p={4}
      borderRadius="12px"
      bg="var(--color-canvas-default)"
      border="1px solid var(--color-border-default)"
      style={{
        background: "linear-gradient(135deg, rgba(6, 182, 212, 0.05) 0%, rgba(168, 85, 247, 0.04) 100%)",
      }}
    >
      <Box display="flex" justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap={3} mb={3}>
        <Box>
          <Box display="flex" alignItems="center" gap={2} flexWrap="wrap" mb={1}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
                fontSize: "11px",
                fontWeight: 700,
                padding: "2px 8px",
                borderRadius: "999px",
                background: "rgba(6, 182, 212, 0.15)",
                color: "#06b6d4",
              }}
            >
              <BeakerIcon size={12} />
              STUDY TEMPLATE ({kind.toUpperCase()})
            </span>
            <Label variant="accent">{category}</Label>
            {viewConfig.packageName && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  fontSize: "11px",
                  fontFamily: "var(--font-mono)",
                  padding: "2px 8px",
                  borderRadius: "6px",
                  background: "rgba(168, 85, 247, 0.14)",
                  color: "#a855f7",
                }}
              >
                <PackageIcon size={12} />
                {viewConfig.packageName}
                {viewConfig.packageVersion ? `@${viewConfig.packageVersion}` : ""}
              </span>
            )}
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                fontSize: "11px",
                fontFamily: "var(--font-mono)",
                padding: "2px 8px",
                borderRadius: "6px",
                background: "rgba(16, 185, 129, 0.14)",
                color: "#10b981",
              }}
            >
              <VerifiedIcon size={12} />
              {stdBadgeLabel}
            </span>
          </Box>
          <Heading as="h4" style={{ fontSize: "17px", fontWeight: 800, margin: 0 }}>
            {title}
          </Heading>
          {rawPath && (
            <Text fontSize="11px" color="var(--color-fg-muted)" style={{ fontFamily: "var(--font-mono)" }}>
              {rawPath}
            </Text>
          )}
        </Box>

        <Box display="flex" gap={2} alignItems="center">
          <Button size="small" leadingVisual={CodeIcon} onClick={() => setShowRawSpec((prev) => !prev)}>
            {showRawSpec ? `Hide ${stdExt}` : `Inspect ${stdExt}`}
          </Button>
          <Button
            size="small"
            variant="primary"
            leadingVisual={PlayIcon}
            onClick={() => navigate(`/jobs/templates/${encodeURIComponent(slug)}`)}
          >
            Open in Study Studio →
          </Button>
        </Box>
      </Box>

      <Text fontSize="13px" color="var(--color-fg-default)" display="block" mb={3} style={{ lineHeight: 1.55 }}>
        {description}
      </Text>

      <Box
        display="grid"
        style={{
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: "12px",
        }}
      >
        <Box p={3} borderRadius="8px" bg="var(--color-canvas-subtle)" border="1px solid var(--color-border-subtle)">
          <Text fontSize="11px" color="var(--color-fg-muted)" fontWeight="bold" display="block" mb={1}>
            COMPATIBLE MODEL DOMAINS
          </Text>
          <Box display="flex" gap={1} flexWrap="wrap">
            {domains.map((d) => (
              <span
                key={d}
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  fontFamily: "var(--font-mono)",
                  textTransform: "uppercase",
                  padding: "2px 6px",
                  borderRadius: "4px",
                  background: "rgba(59, 130, 246, 0.14)",
                  color: "#3b82f6",
                }}
              >
                {d}
              </span>
            ))}
          </Box>
        </Box>

        <Box p={3} borderRadius="8px" bg="var(--color-canvas-subtle)" border="1px solid var(--color-border-subtle)">
          <Text fontSize="11px" color="var(--color-fg-muted)" fontWeight="bold" display="block" mb={1}>
            EXECUTION TARGETS & SOLVER
          </Text>
          <Box display="flex" gap={2} alignItems="center" flexWrap="wrap" fontSize="12px">
            {targets.includes("local-wasm") && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "#06b6d4" }}>
                <ZapIcon size={12} /> Local WASM
              </span>
            )}
            {targets.includes("hpc-cluster") && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "#f59e0b" }}>
                <ServerIcon size={12} /> Slurm HPC
              </span>
            )}
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--color-fg-muted)" }}>
              ({solver})
            </span>
          </Box>
        </Box>

        <Box p={3} borderRadius="8px" bg="var(--color-canvas-subtle)" border="1px solid var(--color-border-subtle)">
          <Text fontSize="11px" color="var(--color-fg-muted)" fontWeight="bold" display="block" mb={1}>
            PIPELINE STAGES ({steps.length})
          </Text>
          <Text fontSize="11px" color="var(--color-fg-default)">
            {steps.slice(0, 3).join(" → ")}
          </Text>
        </Box>
      </Box>

      {kpisRaw.length > 0 && (
        <Box mt={3} display="flex" alignItems="center" gap={2} flexWrap="wrap">
          <Text fontSize="11px" fontWeight="bold" color="var(--color-fg-muted)">
            Extracted Study KPIs:
          </Text>
          {kpisRaw.map((k: { label?: string; id?: string; unit?: string } | string, idx: number) => {
            const label = typeof k === "string" ? k : k?.label || k?.id || `KPI ${idx + 1}`;
            const unit = typeof k === "object" && k?.unit ? ` [${k.unit}]` : "";
            return (
              <span
                key={idx}
                style={{
                  fontSize: "11px",
                  fontFamily: "var(--font-mono)",
                  padding: "2px 7px",
                  borderRadius: "4px",
                  background: "rgba(16, 185, 129, 0.12)",
                  color: "#10b981",
                }}
              >
                <SlidersIcon size={10} /> {label}
                {unit}
              </span>
            );
          })}
        </Box>
      )}

      {showRawSpec && (
        <pre
          style={{
            marginTop: "12px",
            padding: "12px",
            borderRadius: "8px",
            background: "var(--color-canvas-subtle)",
            border: "1px solid var(--color-border-subtle)",
            fontSize: "11px",
            fontFamily: "var(--font-mono)",
            maxHeight: "260px",
            overflowY: "auto",
            whiteSpace: "pre-wrap",
          }}
        >
          {typeof viewConfig.rawStandardSource === "string" && viewConfig.rawStandardSource.trim()
            ? viewConfig.rawStandardSource
            : stdFormat === "ssp-ssv"
              ? `<?xml version="1.0" encoding="UTF-8"?>\n<ssv:ParameterSet xmlns:ssv="http://ssp-standard.org/SSP1/SystemStructureParameterValues"\n                  version="2.0"\n                  name="${slug}">\n  <!-- ${title} -->\n  <ssv:Parameters>\n    <ssv:Parameter name="nominal_param">\n      <ssv:Real value="1.0" />\n    </ssv:Parameter>\n  </ssv:Parameters>\n</ssv:ParameterSet>`
              : stdFormat === "dakota"
                ? `# Sandia Dakota 6.19 Study — ${title} (${slug})\nenvironment\n  tabular_data\n    tabular_data_file = '${slug}_results.dat'\n\nmethod\n  sampling\n    sample_type lhs\n    samples = 64\n    variance_based_decomp\n\nvariables\n  continuous_design = 2\n    descriptors 'p1' 'p2'\n\nresponses\n  response_functions = ${Math.max(1, kpisRaw.length)}\n  no_gradients\n  no_hessians`
                : `<?xml version="1.0" encoding="UTF-8"?>\n<sedML xmlns="http://sed-ml.org/sed-ml/level1/version4" level="1" version="4">\n  <!-- ${title} (${slug}) -->\n  <listOfModels>\n    <model id="model_primary" name="${title}" language="urn:sedml:language:${domains[0] || "modelica"}" source="${slug}.mo" />\n  </listOfModels>\n  <listOfSimulations>\n    <uniformTimeCourse id="sim_primary" initialTime="0.0" outputStartTime="0.0" outputEndTime="10.0" numberOfSteps="500">\n      <algorithm kisaoID="KISAO:0000019" />\n    </uniformTimeCourse>\n  </listOfSimulations>\n  <listOfTasks>\n    <task id="task_primary" modelReference="model_primary" simulationReference="sim_primary" />\n  </listOfTasks>\n</sedML>`}
        </pre>
      )}
    </Box>
  );
};

export default StudyTemplateViewer;
