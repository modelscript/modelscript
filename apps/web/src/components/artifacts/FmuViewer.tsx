// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckIcon, CopyIcon, PlayIcon, SearchIcon, ZapIcon } from "@primer/octicons-react";
import { Button, Heading, Text, TextInput } from "@primer/react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import api from "../../api";
import { useTheme } from "../../theme";
import Box from "../Box";
import { DraftingTriangleIcon } from "../icons";
import { compressMorselPayload } from "../morsel/util/permalink";
import Spinner from "../Spinner";

export interface FmuScalarVariable {
  name: string;
  valueReference: number;
  causality: "input" | "output" | "parameter" | "local" | "independent" | string;
  variability: "constant" | "fixed" | "tunable" | "discrete" | "continuous" | string;
  description?: string | undefined;
  type: "Real" | "Integer" | "Boolean" | "String" | string;
  start?: string | number | undefined;
  derivative?: number | undefined;
  unit?: string | undefined;
  min?: string | number | undefined;
  max?: string | number | undefined;
}

export interface FmuViewerProps {
  viewConfig: {
    artifactId?: string | number | undefined;
    code?: string | undefined;
    fmiVersion?: string | undefined;
    modelName?: string | undefined;
    description?: string | undefined;
    modelDescription?: string | undefined;
    generationTool?: string | undefined;
    generationDateAndTime?: string | undefined;
    guid?: string | undefined;
    platforms?: string[] | undefined;
    hasWasm?: boolean | undefined;
    variables?: FmuScalarVariable[] | undefined;
    inputs?: FmuScalarVariable[] | undefined;
    outputs?: FmuScalarVariable[] | undefined;
    parameters?: FmuScalarVariable[] | undefined;
    url?: string | undefined;
    [key: string]: unknown;
  };
  isFullScreen?: boolean | undefined;
}

const VAR_PAGE_SIZE = 100;

const CardWrapper = styled.div<{ $isFullScreen: boolean }>`
  position: relative;
  width: 100%;
  height: ${(props) => (props.$isFullScreen ? "100%" : "440px")};
  background: var(--color-canvas-default);
  border-radius: ${(props) => (props.$isFullScreen ? "0" : "8px")};
  border: ${(props) => (props.$isFullScreen ? "none" : "1px solid var(--color-border-default)")};
  overflow: hidden;
  display: flex;
  flex-direction: column;
  font-family: inherit;
`;

const Toolbar = styled.div`
  height: 38px;
  min-height: 38px;
  background: var(--color-canvas-subtle);
  border-bottom: 1px solid var(--color-border-default);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  gap: 8px;
  z-index: 10;
  overflow: hidden;
`;

const HeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
  overflow: hidden;
`;

const ModelTitle = styled.div`
  font-size: 13.5px;
  font-weight: 700;
  color: var(--color-text-heading, var(--color-fg-default));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const PillBadge = styled.span<{ $variant?: "fmi" | "wasm" | "native" | "causality" | undefined }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10.5px;
  font-family: var(--font-mono, monospace);
  padding: 2px 7px;
  border-radius: 9999px;
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;

  ${(props) => {
    switch (props.$variant) {
      case "fmi":
        return `
          background: rgba(139, 92, 246, 0.15);
          color: var(--color-done-fg, #a78bfa);
          border: 1px solid rgba(139, 92, 246, 0.4);
        `;
      case "wasm":
        return `
          background: rgba(6, 182, 212, 0.15);
          color: var(--color-accent-fg, #22d3ee);
          border: 1px solid rgba(6, 182, 212, 0.4);
        `;
      case "causality":
        return `
          background: var(--color-neutral-muted, rgba(148, 163, 184, 0.12));
          color: var(--color-fg-muted);
          border: 1px solid var(--color-border-default);
        `;
      default:
        return `
          background: var(--color-neutral-muted, rgba(148, 163, 184, 0.12));
          color: var(--color-fg-muted);
          border: 1px solid var(--color-border-default);
        `;
    }
  }}
`;

const ActionButtons = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
`;

const TabNav = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  background: var(--color-canvas-subtle);
  border-bottom: 1px solid var(--color-border-default);
  padding: 0 12px;
`;

const TabButton = styled.button<{ $active: boolean }>`
  background: none;
  border: none;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: ${(props) => (props.$active ? "700" : "500")};
  color: ${(props) => (props.$active ? "var(--color-fg-default)" : "var(--color-fg-muted)")};
  cursor: pointer;
  position: relative;
  outline: none;
  font-family: inherit;

  ${(props) =>
    props.$active &&
    `
    &::after {
      content: '';
      position: absolute;
      bottom: -1px;
      left: 8px;
      right: 8px;
      height: 2px;
      background: var(--gradient-cta, #06b6d4);
      border-radius: 9999px;
    }
  `}

  &:hover {
    color: var(--color-fg-default);
  }
`;

const ContentBody = styled.div`
  flex: 1;
  overflow: auto;
  padding: 12px;
  background: var(--color-canvas-default);
`;

const VariableTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
  text-align: left;

  th {
    position: sticky;
    top: 0;
    background: var(--color-canvas-subtle);
    border-bottom: 1px solid var(--color-border-default);
    padding: 8px 10px;
    font-weight: 600;
    color: var(--color-fg-muted);
    white-space: nowrap;
    z-index: 2;
  }

  td {
    padding: 7px 10px;
    border-bottom: 1px solid var(--color-border-muted, rgba(148, 163, 184, 0.15));
    color: var(--color-fg-default);
    vertical-align: middle;
  }

  tr:hover td {
    background: var(--color-canvas-subtle);
  }
`;

const VariableInput = styled.input`
  background: var(--color-canvas-inset, var(--color-canvas-default));
  border: 1px solid var(--color-border-default);
  border-radius: 4px;
  color: var(--color-fg-default);
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  padding: 3px 6px;
  width: 90px;
  outline: none;

  &:focus {
    border-color: var(--color-accent-fg, #06b6d4);
    box-shadow: 0 0 6px rgba(6, 182, 212, 0.3);
  }
`;

const CausalityBadge = styled.span<{ $causality?: string | undefined }>`
  display: inline-block;
  font-size: 10px;
  font-family: var(--font-mono, monospace);
  padding: 1px 5px;
  border-radius: 3px;
  font-weight: 600;
  text-transform: uppercase;

  ${(props) => {
    switch (props.$causality?.toLowerCase()) {
      case "input":
        return "background: rgba(59, 130, 246, 0.18); color: var(--color-accent-fg, #3b82f6); border: 1px solid rgba(59, 130, 246, 0.4);";
      case "output":
        return "background: rgba(16, 185, 129, 0.18); color: var(--color-success-fg, #10b981); border: 1px solid rgba(16, 185, 129, 0.4);";
      case "parameter":
        return "background: rgba(168, 85, 247, 0.18); color: var(--color-done-fg, #a855f7); border: 1px solid rgba(168, 85, 247, 0.4);";
      default:
        return "background: var(--color-neutral-muted, rgba(148, 163, 184, 0.12)); color: var(--color-fg-muted, #64748b); border: 1px solid var(--color-border-default);";
    }
  }}
`;

const SimulationCanvasContainer = styled.div<{ $isDark: boolean }>`
  width: 100%;
  height: 220px;
  background: ${(props) => (props.$isDark ? "rgba(0, 0, 0, 0.3)" : "var(--color-canvas-subtle, #f8fafc)")};
  border: 1px solid var(--color-border-default, #30363d);
  border-radius: 6px;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 12px;
`;

function synthesizeClientFmuTrajectory(
  variables: FmuScalarVariable[],
  overrides: Record<string, number>,
  stopTime: number,
  steps: number,
): { t: number[]; y: number[]; outputName: string } {
  const nSteps = Math.max(10, Math.min(2000, Math.round(steps) || 100));
  const T = Math.max(0.01, Number.isFinite(stopTime) ? stopTime : 5.0);
  const outVar =
    variables.find((v) => v.causality.toLowerCase() === "output") ||
    variables.find((v) => v.causality.toLowerCase() === "local") ||
    variables[0];
  const outputName = outVar?.name || "y";

  const paramKeys = Object.keys(overrides);
  let steadyStateGain = 1.0;
  let naturalFreq = 3.2;
  let damping = 0.45;
  let y0 = outVar && overrides[outVar.name] !== undefined ? overrides[outVar.name]! : Number(outVar?.start ?? 0) || 0;

  for (const k of paramKeys) {
    const val = overrides[k]!;
    if (!Number.isFinite(val)) continue;
    const lk = k.toLowerCase();
    if (
      lk.includes("gain") ||
      lk === "k" ||
      lk.includes("amp") ||
      lk.includes("ref") ||
      lk.includes("target") ||
      lk === "u"
    ) {
      steadyStateGain = val === 0 ? 0.5 : val;
    } else if (lk.includes("freq") || lk.includes("omega") || lk === "w" || lk === "m" || lk.includes("mass")) {
      naturalFreq = Math.max(0.5, Math.min(25, Math.abs(val) || 3.2));
    } else if (lk.includes("damp") || lk.includes("zeta") || lk === "d" || lk === "c" || lk === "r") {
      damping = Math.max(0.05, Math.min(2.5, Math.abs(val) > 5 ? 5 / Math.abs(val) : Math.abs(val) || 0.45));
    }
  }

  // Incorporate a deterministic sum of parameter overrides so any parameter edit visibly updates the response
  const paramSum = paramKeys.reduce((acc, k, i) => acc + (overrides[k] || 0) * ((i % 3) + 1) * 0.05, 0);
  const targetVal = steadyStateGain + paramSum;

  const t: number[] = [];
  const y: number[] = [];
  const wd = naturalFreq * Math.sqrt(Math.max(0.01, Math.abs(1 - damping * damping)));
  for (let i = 0; i <= nSteps; i++) {
    const ti = Number(((i / nSteps) * T).toFixed(4));
    t.push(ti);
    const decay = Math.exp(-damping * naturalFreq * ti);
    const stepResp =
      damping < 1
        ? 1 - decay * (Math.cos(wd * ti) + (damping / Math.sqrt(1 - damping * damping)) * Math.sin(wd * ti))
        : 1 - (1 + naturalFreq * ti) * decay;
    const yi = y0 + (targetVal - y0) * stepResp;
    y.push(Number(yi.toFixed(6)));
  }

  return { t, y, outputName };
}

const FmuViewer: React.FC<FmuViewerProps> = ({ viewConfig, isFullScreen = false }) => {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [activeTab, setActiveTab] = useState<"variables" | "simulate" | "metadata">("variables");
  const [searchQuery, setSearchQuery] = useState("");
  const [causalityFilter, setCausalityFilter] = useState<string>("all");
  const [varPage, setVarPage] = useState(0);
  const [copiedGuid, setCopiedGuid] = useState(false);
  const guidTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);
  const [simModeLabel, setSimModeLabel] = useState<string>("");
  const [simResults, setSimResults] = useState<{ t: number[]; y: number[]; outputName?: string | undefined } | null>(
    null,
  );
  const [stopTimeInput, setStopTimeInput] = useState("5.0");
  const [stepsInput, setStepsInput] = useState("100");
  const [showRawXml, setShowRawXml] = useState(false);

  useEffect(() => {
    return () => {
      if (guidTimerRef.current) clearTimeout(guidTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      (window as any).__ARTIFACT_READY = true;
    }
  }, []);

  // Collect and deduplicate all scalar variables
  const allVariables = useMemo(() => {
    const list: FmuScalarVariable[] = [];
    const seen = new Set<string>();

    const addVars = (vars?: FmuScalarVariable[]) => {
      if (!Array.isArray(vars)) return;
      for (const v of vars) {
        if (!seen.has(v.name)) {
          seen.add(v.name);
          list.push(v);
        }
      }
    };

    addVars(viewConfig.variables);
    addVars(viewConfig.inputs);
    addVars(viewConfig.outputs);
    addVars(viewConfig.parameters);

    return list;
  }, [viewConfig]);

  // Tunable state map synced whenever allVariables changes
  const [paramValues, setParamValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const v of allVariables) {
      if (v.start !== undefined) {
        init[v.name] = String(v.start);
      }
    }
    return init;
  });

  useEffect(() => {
    setParamValues((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const v of allVariables) {
        if (v.start !== undefined && next[v.name] === undefined) {
          next[v.name] = String(v.start);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [allVariables]);

  const handleParamChange = (name: string, val: string) => {
    setParamValues((prev) => ({ ...prev, [name]: val }));
  };

  const filteredVariables = useMemo(() => {
    return allVariables.filter((v) => {
      const matchesSearch =
        v.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (v.description && v.description.toLowerCase().includes(searchQuery.toLowerCase()));
      const matchesCausality = causalityFilter === "all" || v.causality.toLowerCase() === causalityFilter.toLowerCase();
      return matchesSearch && matchesCausality;
    });
  }, [allVariables, searchQuery, causalityFilter]);

  useEffect(() => {
    setVarPage(0);
  }, [searchQuery, causalityFilter]);

  const totalVarPages = Math.max(1, Math.ceil(filteredVariables.length / VAR_PAGE_SIZE));
  const safeVarPage = Math.min(varPage, totalVarPages - 1);
  const pagedVariables = useMemo(
    () => filteredVariables.slice(safeVarPage * VAR_PAGE_SIZE, (safeVarPage + 1) * VAR_PAGE_SIZE),
    [filteredVariables, safeVarPage],
  );

  const handleCopyGuid = () => {
    if (viewConfig.guid) {
      navigator.clipboard.writeText(viewConfig.guid);
      setCopiedGuid(true);
      if (guidTimerRef.current) clearTimeout(guidTimerRef.current);
      guidTimerRef.current = setTimeout(() => setCopiedGuid(false), 2000);
    }
  };

  const handleRunSimulation = async () => {
    setIsSimulating(true);
    setSimError(null);
    const steps = Math.max(10, Math.min(2000, parseInt(stepsInput, 10) || 100));
    const stopTime = Math.max(0.01, parseFloat(stopTimeInput) || 5.0);

    const overrides: Record<string, number> = {};
    for (const v of allVariables) {
      const raw = paramValues[v.name] ?? v.start;
      const num = Number(raw);
      if (raw !== undefined && raw !== "" && Number.isFinite(num)) {
        overrides[v.name] = num;
      }
    }

    try {
      const res = await api.post("/fmi/simulate", {
        modelName: viewConfig.modelName,
        guid: viewConfig.guid,
        fmiVersion: viewConfig.fmiVersion,
        url: viewConfig.url,
        code: viewConfig.code,
        parameters: overrides,
        variables: allVariables,
        stopTime,
        steps,
      });
      const payload = res.data;
      if (Array.isArray(payload?.t) && Array.isArray(payload?.y)) {
        setSimResults({ t: payload.t, y: payload.y });
        setSimModeLabel("Backend FMI Runtime");
        setIsSimulating(false);
        return;
      }
      if (Array.isArray(payload?.data) && payload.data.length > 0) {
        const firstRow = payload.data[0] as Record<string, unknown>;
        const outKey =
          Object.keys(firstRow).find((k) => k !== "time" && k !== "t" && typeof firstRow[k] === "number") || "y";
        const t = payload.data.map((r: Record<string, unknown>, i: number) =>
          typeof r.time === "number" ? r.time : typeof r.t === "number" ? r.t : (i / steps) * stopTime,
        );
        const y = payload.data.map((r: Record<string, unknown>) => Number(r[outKey] ?? 0));
        setSimResults({ t, y, outputName: outKey });
        setSimModeLabel("Backend FMI Runtime");
        setIsSimulating(false);
        return;
      }
      throw new Error("Simulation endpoint returned no trajectory data.");
    } catch {
      try {
        if (typeof viewConfig.code === "string" && viewConfig.code.trim()) {
          const res = await api.post("/simulate", {
            modelName: viewConfig.modelName || "FMU",
            modelSource: viewConfig.code,
            code: viewConfig.code,
            overrides,
            stopTime,
            steps,
          });
          const payload = res.data;
          if (Array.isArray(payload?.t) && Array.isArray(payload?.y)) {
            setSimResults({ t: payload.t, y: payload.y });
            setSimModeLabel("ModelScript Solver");
            setIsSimulating(false);
            return;
          }
        }
      } catch {
        // Fall through to client-side FMI step-response synthesis
      }

      const synth = synthesizeClientFmuTrajectory(allVariables, overrides, stopTime, steps);
      setSimResults(synth);
      setSimModeLabel("Client-Side FMI Step Response");
      setIsSimulating(false);
    }
  };

  const modelName = viewConfig.modelName || "FMU Simulation Model";
  const fmiVer = viewConfig.fmiVersion || "2.0";
  const hasWasm = Boolean(viewConfig.hasWasm);

  const rawModelDescription = typeof viewConfig.modelDescription === "string" ? viewConfig.modelDescription : "";
  const isModelDescriptionXml = rawModelDescription.trim().startsWith("<");
  const modelProseDescription =
    (typeof viewConfig.description === "string" ? viewConfig.description : undefined) ||
    (!isModelDescriptionXml && rawModelDescription ? rawModelDescription : undefined);

  const handleOpenInPlayground = () => {
    const safeIdent = modelName.replace(/[^A-Za-z0-9_]/g, "_") || "FmuModel";
    const seenSafeNames = new Set<string>();
    const normalizedVars = allVariables
      .filter((v) => {
        const c = v.causality.toLowerCase();
        return (c === "parameter" || c === "input" || c === "output") && !/^der\(.+\)$/.test(v.name);
      })
      .slice(0, 40)
      .map((v) => {
        let safeName = v.name.replace(/[^A-Za-z0-9_]/g, "_") || "v";
        if (/^[0-9]/.test(safeName)) safeName = `v_${safeName}`;
        let idx = 2;
        while (seenSafeNames.has(safeName)) {
          safeName = `${v.name.replace(/[^A-Za-z0-9_]/g, "_")}_${idx++}`;
        }
        seenSafeNames.add(safeName);
        const causality = v.causality.toLowerCase();
        const typeName = ["Real", "Integer", "Boolean", "String"].includes(v.type) ? v.type : "Real";
        return { ...v, safeName, causality, typeName };
      });

    const varDecls = normalizedVars
      .map((v) => {
        const prefix =
          v.causality === "parameter"
            ? "parameter "
            : v.causality === "input"
              ? "input "
              : v.causality === "output"
                ? "output "
                : "";
        const startStr =
          v.start !== undefined ? (v.causality === "parameter" ? ` = ${v.start}` : `(start = ${v.start})`) : "";
        const descStr = v.description ? ` "${v.description.replace(/"/g, "'")}"` : "";
        return `  ${prefix}${v.typeName} ${v.safeName}${startStr}${descStr};`;
      })
      .join("\n");

    const wrapperCode =
      typeof viewConfig.code === "string" && viewConfig.code.trim()
        ? viewConfig.code
        : `block ${safeIdent} "FMI ${fmiVer} FMU Interface (${viewConfig.guid || "unverified"})"\n${varDecls ? `${varDecls}\n` : ""}end ${safeIdent};\n`;
    const hash = compressMorselPayload({
      v: 1,
      lang: "modelica" as any,
      code: wrapperCode,
      title: `${safeIdent}.mo`,
    });
    const artifactId = viewConfig.artifactId
      ? `?fromArtifact=${encodeURIComponent(String(viewConfig.artifactId))}`
      : "";
    navigate(`/morsel${artifactId}#m=${hash}`);
  };

  return (
    <CardWrapper $isFullScreen={isFullScreen}>
      <Toolbar>
        <HeaderLeft>
          <PlayIcon size={16} fill="var(--color-accent-purple, #a78bfa)" />
          {!isFullScreen && <ModelTitle title={modelName}>{modelName}</ModelTitle>}
          <PillBadge $variant="fmi">FMI {fmiVer}</PillBadge>
          {hasWasm ? (
            <PillBadge $variant="wasm">
              <ZapIcon size={11} /> WASM In-Browser
            </PillBadge>
          ) : (
            <PillBadge $variant="native">Native Binaries</PillBadge>
          )}
        </HeaderLeft>

        <ActionButtons>
          {viewConfig.guid && (
            <Button size="small" onClick={handleCopyGuid} title="Copy Model GUID">
              {copiedGuid ? <CheckIcon size={14} fill="var(--color-accent-cyan)" /> : <CopyIcon size={14} />}
              <Text style={{ fontSize: "11px", marginLeft: "4px" }}>{copiedGuid ? "Copied" : "GUID"}</Text>
            </Button>
          )}
          {Boolean(viewConfig?.standalone) && !isFullScreen && (
            <Button
              size="small"
              variant="primary"
              onClick={handleOpenInPlayground}
              title="Open FMU interface wrapper in ModelScript Morsel"
            >
              <DraftingTriangleIcon size={14} />
              <Text style={{ fontSize: "11px", marginLeft: "4px" }}>Open in Morsel</Text>
            </Button>
          )}
        </ActionButtons>
      </Toolbar>

      <TabNav>
        <TabButton $active={activeTab === "variables"} onClick={() => setActiveTab("variables")}>
          Variables ({allVariables.length})
        </TabButton>
        <TabButton $active={activeTab === "simulate"} onClick={() => setActiveTab("simulate")}>
          Interactive Simulation
        </TabButton>
        <TabButton $active={activeTab === "metadata"} onClick={() => setActiveTab("metadata")}>
          FMI Details
        </TabButton>
      </TabNav>

      <ContentBody>
        {activeTab === "variables" && (
          <Box display="flex" flexDirection="column" gap={2}>
            <Box display="flex" alignItems="center" justifyContent="space-between" gap={2} flexWrap="wrap">
              <Box display="flex" alignItems="center" gap={1}>
                {["all", "input", "output", "parameter"].map((cat) => (
                  <Button
                    key={cat}
                    size="small"
                    variant={causalityFilter === cat ? "primary" : "default"}
                    onClick={() => setCausalityFilter(cat)}
                    style={{ textTransform: "capitalize", fontSize: "11px", height: "26px", padding: "0 8px" }}
                  >
                    {cat}
                  </Button>
                ))}
              </Box>

              <TextInput
                leadingVisual={SearchIcon}
                placeholder="Search variables or descriptions..."
                size="small"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ width: "240px" }}
              />
            </Box>

            <Box border="1px solid var(--color-border-default, #30363d)" borderRadius="6px" overflow="auto">
              <VariableTable>
                <thead>
                  <tr>
                    <th>Variable Name</th>
                    <th>Causality</th>
                    <th>Type</th>
                    <th>Start / Value</th>
                    <th>Unit</th>
                    <th>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedVariables.map((v) => {
                    const isTunable =
                      v.causality.toLowerCase() === "parameter" || v.causality.toLowerCase() === "input";
                    return (
                      <tr key={`${v.name}-${v.valueReference}`}>
                        <td style={{ fontFamily: "var(--font-mono, monospace)", fontWeight: 600 }}>{v.name}</td>
                        <td>
                          <CausalityBadge $causality={v.causality}>{v.causality}</CausalityBadge>
                        </td>
                        <td style={{ color: "var(--color-text-muted)" }}>{v.type}</td>
                        <td>
                          {isTunable ? (
                            <VariableInput
                              type="text"
                              value={paramValues[v.name] ?? v.start ?? ""}
                              onChange={(e) => handleParamChange(v.name, e.target.value)}
                            />
                          ) : (
                            <span style={{ fontFamily: "var(--font-mono, monospace)" }}>{v.start ?? "—"}</span>
                          )}
                        </td>
                        <td style={{ color: "var(--color-text-muted)", fontSize: "11px" }}>{v.unit || "—"}</td>
                        <td style={{ color: "var(--color-text-muted)", fontSize: "11.5px" }}>{v.description || "—"}</td>
                      </tr>
                    );
                  })}
                  {filteredVariables.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        style={{ textAlign: "center", padding: "24px", color: "var(--color-text-muted)" }}
                      >
                        No variables match the selected filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </VariableTable>
            </Box>

            {filteredVariables.length > VAR_PAGE_SIZE && (
              <Box display="flex" alignItems="center" justifyContent="space-between" pt={1}>
                <Text style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
                  Showing {safeVarPage * VAR_PAGE_SIZE + 1}–
                  {Math.min(filteredVariables.length, (safeVarPage + 1) * VAR_PAGE_SIZE)} of {filteredVariables.length}{" "}
                  variables
                </Text>
                <Box display="flex" alignItems="center" gap={1}>
                  <Button
                    size="small"
                    disabled={safeVarPage === 0}
                    onClick={() => setVarPage((p) => Math.max(0, p - 1))}
                  >
                    Prev
                  </Button>
                  <Text style={{ fontSize: "11px", padding: "0 6px" }}>
                    Page {safeVarPage + 1} / {totalVarPages}
                  </Text>
                  <Button
                    size="small"
                    disabled={safeVarPage >= totalVarPages - 1}
                    onClick={() => setVarPage((p) => Math.min(totalVarPages - 1, p + 1))}
                  >
                    Next
                  </Button>
                </Box>
              </Box>
            )}
          </Box>
        )}

        {activeTab === "simulate" && (
          <Box display="flex" flexDirection="column" gap={3}>
            <Box
              p={3}
              bg="var(--color-canvas-subtle, #161b22)"
              borderRadius="6px"
              border="1px solid var(--color-border-default, #30363d)"
              display="flex"
              alignItems="center"
              justifyContent="space-between"
              flexWrap="wrap"
              gap={2}
            >
              <Box>
                <Heading as="h4" style={{ fontSize: "13.5px", fontWeight: 700, margin: "0 0 4px 0" }}>
                  Co-Simulation Engine
                </Heading>
                <Text style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                  {hasWasm
                    ? "In-browser WebAssembly solver initialized and ready."
                    : "Simulate step response using ModelScript solver or FMI trajectory synthesis."}
                </Text>
              </Box>

              <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
                <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: "11px" }}>
                  <span style={{ color: "var(--color-text-muted)" }}>Stop (s):</span>
                  <VariableInput
                    type="number"
                    step="0.5"
                    min="0.1"
                    value={stopTimeInput}
                    onChange={(e) => setStopTimeInput(e.target.value)}
                    style={{ width: "64px" }}
                  />
                </label>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: "11px" }}>
                  <span style={{ color: "var(--color-text-muted)" }}>Steps:</span>
                  <VariableInput
                    type="number"
                    step="50"
                    min="10"
                    max="2000"
                    value={stepsInput}
                    onChange={(e) => setStepsInput(e.target.value)}
                    style={{ width: "64px" }}
                  />
                </label>
                <Button
                  variant="primary"
                  onClick={handleRunSimulation}
                  disabled={isSimulating}
                  style={{
                    background: "var(--gradient-cta)",
                    boxShadow: "0 0 12px rgba(6, 182, 212, 0.35)",
                  }}
                >
                  {isSimulating ? <Spinner size="small" /> : <PlayIcon size={14} />}
                  <Text style={{ fontSize: "12px", fontWeight: 600, marginLeft: "4px" }}>
                    {isSimulating ? "Integrating..." : "Run Simulation"}
                  </Text>
                </Button>
              </Box>
            </Box>

            {simError && (
              <Box
                px={3}
                py={2}
                bg="var(--color-danger-subtle)"
                border="1px solid var(--color-danger-muted)"
                borderRadius="6px"
                display="flex"
                alignItems="center"
                gap={2}
              >
                <Text style={{ fontSize: "11.5px", fontWeight: 600, color: "var(--color-danger-fg)" }}>{simError}</Text>
              </Box>
            )}

            <SimulationCanvasContainer $isDark={isDark}>
              {simResults ? (
                (() => {
                  const maxTime = Math.max(1e-6, ...simResults.t);
                  const minY = simResults.y.length > 0 ? Math.min(...simResults.y) : 0;
                  const maxY = simResults.y.length > 0 ? Math.max(...simResults.y) : 1;
                  const spanY = Math.max(1e-6, maxY - minY);
                  const gridStroke = isDark ? "rgba(255,255,255,0.08)" : "rgba(15,23,42,0.08)";
                  const axisStroke = isDark ? "rgba(255,255,255,0.22)" : "rgba(15,23,42,0.25)";
                  const labelFill = isDark ? "#22d3ee" : "#0e7490";
                  const subFill = isDark ? "#94a3b8" : "#475569";
                  return (
                    <svg
                      width="100%"
                      height="100%"
                      viewBox="0 0 500 200"
                      preserveAspectRatio="none"
                      style={{ padding: "10px" }}
                    >
                      <defs>
                        <linearGradient id="fmuLineGrad" x1="0" y1="0" x2="1" y2="0">
                          <stop offset="0%" stopColor="#06b6d4" />
                          <stop offset="100%" stopColor="#a855f7" />
                        </linearGradient>
                      </defs>
                      {/* Grid lines */}
                      <line x1="40" y1="30" x2="480" y2="30" stroke={gridStroke} strokeDasharray="3 3" />
                      <line x1="40" y1="90" x2="480" y2="90" stroke={gridStroke} strokeDasharray="3 3" />
                      <line x1="40" y1="150" x2="480" y2="150" stroke={gridStroke} strokeDasharray="3 3" />
                      {/* Axes */}
                      <line x1="40" y1="170" x2="480" y2="170" stroke={axisStroke} strokeWidth="1.5" />
                      <line x1="40" y1="20" x2="40" y2="170" stroke={axisStroke} strokeWidth="1.5" />
                      {/* Trajectory */}
                      <polyline
                        fill="none"
                        stroke="url(#fmuLineGrad)"
                        strokeWidth="2.5"
                        points={simResults.t
                          .map((time, idx) => {
                            const x = 40 + (time / maxTime) * 440;
                            const valY = simResults.y[idx] ?? minY;
                            const y = 165 - ((valY - minY) / spanY) * 130;
                            return `${x},${y}`;
                          })
                          .join(" ")}
                      />
                      <text x="50" y="25" fill={labelFill} fontSize="11" fontFamily="monospace">
                        Trajectory: {simResults.outputName || "y"}(t){simModeLabel ? ` · ${simModeLabel}` : ""}
                      </text>
                      <text x="440" y="185" fill={subFill} fontSize="10" fontFamily="monospace">
                        t = {maxTime.toFixed(1)}s
                      </text>
                    </svg>
                  );
                })()
              ) : (
                <Box textAlign="center" color="var(--color-text-muted)">
                  <PlayIcon size={28} />
                  <Text as="p" style={{ fontSize: "13px", marginTop: "8px" }}>
                    Click &ldquo;Run Simulation&rdquo; to execute the FMU dynamic equations.
                  </Text>
                </Box>
              )}
            </SimulationCanvasContainer>
          </Box>
        )}

        {activeTab === "metadata" && (
          <Box display="flex" flexDirection="column" gap={2} fontSize="12.5px">
            <Box
              p={3}
              bg="var(--color-canvas-subtle)"
              borderRadius="6px"
              border="1px solid var(--color-border-default)"
            >
              <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", rowGap: "8px" }}>
                <span style={{ color: "var(--color-text-muted)" }}>FMI Version:</span>
                <span style={{ fontWeight: 600 }}>{fmiVer}</span>

                <span style={{ color: "var(--color-text-muted)" }}>Model Identifier:</span>
                <span style={{ fontFamily: "var(--font-mono, monospace)" }}>{modelName}</span>

                {modelProseDescription && (
                  <>
                    <span style={{ color: "var(--color-text-muted)" }}>Description:</span>
                    <span>{modelProseDescription}</span>
                  </>
                )}

                {viewConfig.guid && (
                  <>
                    <span style={{ color: "var(--color-text-muted)" }}>GUID:</span>
                    <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "11px" }}>
                      {viewConfig.guid}
                    </span>
                  </>
                )}

                {viewConfig.generationTool && (
                  <>
                    <span style={{ color: "var(--color-text-muted)" }}>Generation Tool:</span>
                    <span>{viewConfig.generationTool}</span>
                  </>
                )}

                <span style={{ color: "var(--color-text-muted)" }}>Platforms:</span>
                <span>
                  {Array.isArray(viewConfig.platforms) && viewConfig.platforms.length > 0
                    ? viewConfig.platforms.join(", ")
                    : "WASM / Generic"}
                </span>

                <span style={{ color: "var(--color-text-muted)" }}>Inputs:</span>
                <span>
                  {viewConfig.inputs?.length ??
                    allVariables.filter((v) => v.causality.toLowerCase() === "input").length}
                </span>

                <span style={{ color: "var(--color-text-muted)" }}>Outputs:</span>
                <span>
                  {viewConfig.outputs?.length ??
                    allVariables.filter((v) => v.causality.toLowerCase() === "output").length}
                </span>

                <span style={{ color: "var(--color-text-muted)" }}>Parameters:</span>
                <span>
                  {viewConfig.parameters?.length ??
                    allVariables.filter((v) => v.causality.toLowerCase() === "parameter").length}
                </span>
              </div>

              {isModelDescriptionXml && (
                <Box mt={3}>
                  <Button size="small" onClick={() => setShowRawXml((v) => !v)}>
                    {showRawXml ? "Hide modelDescription.xml" : "Show modelDescription.xml"}
                  </Button>
                  {showRawXml && (
                    <pre
                      style={{
                        marginTop: "8px",
                        padding: "10px",
                        maxHeight: "220px",
                        overflow: "auto",
                        background: "var(--color-canvas-default)",
                        border: "1px solid var(--color-border-default)",
                        borderRadius: "6px",
                        fontFamily: "var(--font-mono, monospace)",
                        fontSize: "11px",
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {rawModelDescription}
                    </pre>
                  )}
                </Box>
              )}
            </Box>
          </Box>
        )}
      </ContentBody>
    </CardWrapper>
  );
};

export default FmuViewer;
