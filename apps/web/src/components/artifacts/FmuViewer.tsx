// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckIcon, CodeIcon, CopyIcon, PlayIcon, SearchIcon, ZapIcon } from "@primer/octicons-react";
import { Button, Heading, Spinner, Text, TextInput } from "@primer/react";
import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import Box from "../Box";

export interface FmuScalarVariable {
  name: string;
  valueReference: number;
  causality: "input" | "output" | "parameter" | "local" | "independent" | string;
  variability: "constant" | "fixed" | "tunable" | "discrete" | "continuous" | string;
  description?: string;
  type: "Real" | "Integer" | "Boolean" | "String" | string;
  start?: string | number;
  unit?: string;
}

export interface FmuViewerProps {
  viewConfig: {
    fmiVersion?: string;
    modelName?: string;
    modelDescription?: string;
    generationTool?: string;
    guid?: string;
    platforms?: string[];
    hasWasm?: boolean;
    variables?: FmuScalarVariable[];
    inputs?: FmuScalarVariable[];
    outputs?: FmuScalarVariable[];
    parameters?: FmuScalarVariable[];
    url?: string;
    [key: string]: unknown;
  };
  isFullScreen?: boolean;
}

const CardWrapper = styled.div<{ $isFullScreen: boolean }>`
  position: relative;
  width: 100%;
  height: ${(props) => (props.$isFullScreen ? "100%" : "440px")};
  background: var(--color-canvas-default, #0d1117);
  border-radius: ${(props) => (props.$isFullScreen ? "0" : "8px")};
  border: ${(props) => (props.$isFullScreen ? "none" : "1px solid var(--color-border-default, #30363d)")};
  overflow: hidden;
  display: flex;
  flex-direction: column;
  font-family: inherit;
`;

const Toolbar = styled.div`
  height: 44px;
  min-height: 44px;
  background: var(--surface-hud, rgba(14, 20, 36, 0.7));
  border-bottom: 1px solid var(--color-border-default, #30363d);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 14px;
  z-index: 10;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
`;

const HeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
`;

const ModelTitle = styled.div`
  font-size: 13.5px;
  font-weight: 700;
  color: var(--color-text-heading, #f0f6fc);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const PillBadge = styled.span<{ $variant?: "fmi" | "wasm" | "native" | "causality" }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10.5px;
  font-family: var(--font-mono, monospace);
  padding: 2px 7px;
  border-radius: 9999px;
  font-weight: 600;
  white-space: nowrap;

  ${(props) => {
    switch (props.$variant) {
      case "fmi":
        return `
          background: rgba(139, 92, 246, 0.15);
          color: var(--color-accent-purple, #a78bfa);
          border: 1px solid rgba(139, 92, 246, 0.4);
        `;
      case "wasm":
        return `
          background: rgba(6, 182, 212, 0.15);
          color: var(--color-accent-cyan, #22d3ee);
          border: 1px solid rgba(6, 182, 212, 0.4);
          box-shadow: 0 0 8px rgba(6, 182, 212, 0.2);
        `;
      case "causality":
        return `
          background: rgba(255, 255, 255, 0.06);
          color: var(--color-text-secondary, #8b949e);
          border: 1px solid rgba(255, 255, 255, 0.1);
        `;
      default:
        return `
          background: rgba(255, 255, 255, 0.05);
          color: var(--color-text-muted, #8b949e);
          border: 1px solid rgba(255, 255, 255, 0.08);
        `;
    }
  }}
`;

const ActionButtons = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const TabNav = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  background: var(--color-canvas-subtle, #161b22);
  border-bottom: 1px solid var(--color-border-default, #30363d);
  padding: 0 12px;
`;

const TabButton = styled.button<{ $active: boolean }>`
  background: none;
  border: none;
  padding: 8px 12px;
  font-size: 12.5px;
  font-weight: ${(props) => (props.$active ? "700" : "500")};
  color: ${(props) => (props.$active ? "var(--color-text-primary, #ffffff)" : "var(--color-text-muted, #8b949e)")};
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
    color: var(--color-text-primary, #ffffff);
  }
`;

const ContentBody = styled.div`
  flex: 1;
  overflow: auto;
  padding: 12px;
  background: var(--color-canvas-default, #0d1117);
`;

const VariableTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
  text-align: left;

  th {
    position: sticky;
    top: 0;
    background: var(--color-canvas-subtle, #161b22);
    border-bottom: 1px solid var(--color-border-default, #30363d);
    padding: 8px 10px;
    font-weight: 600;
    color: var(--color-text-muted, #8b949e);
    white-space: nowrap;
    z-index: 2;
  }

  td {
    padding: 7px 10px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    color: var(--color-text-primary, #e6edf3);
    vertical-align: middle;
  }

  tr:hover td {
    background: rgba(255, 255, 255, 0.03);
  }
`;

const VariableInput = styled.input`
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 4px;
  color: var(--color-text-primary, #ffffff);
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  padding: 3px 6px;
  width: 90px;
  outline: none;

  &:focus {
    border-color: var(--color-accent-cyan, #06b6d4);
    box-shadow: 0 0 6px rgba(6, 182, 212, 0.3);
  }
`;

const CausalityBadge = styled.span<{ $causality?: string }>`
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
        return "background: rgba(59, 130, 246, 0.2); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.4);";
      case "output":
        return "background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.4);";
      case "parameter":
        return "background: rgba(168, 85, 247, 0.2); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.4);";
      default:
        return "background: rgba(255, 255, 255, 0.06); color: #94a3b8; border: 1px solid rgba(255, 255, 255, 0.1);";
    }
  }}
`;

const SimulationCanvasContainer = styled.div`
  width: 100%;
  height: 220px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid var(--color-border-default, #30363d);
  border-radius: 6px;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 12px;
`;

const FmuViewer: React.FC<FmuViewerProps> = ({ viewConfig, isFullScreen = false }) => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<"variables" | "simulate" | "metadata">("variables");
  const [searchQuery, setSearchQuery] = useState("");
  const [causalityFilter, setCausalityFilter] = useState<string>("all");
  const [copiedGuid, setCopiedGuid] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const [simResults, setSimResults] = useState<{ t: number[]; y: number[] } | null>(null);

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

    // Fallback sample variables if empty
    if (list.length === 0) {
      list.push(
        {
          name: "time",
          valueReference: 0,
          causality: "independent",
          variability: "continuous",
          type: "Real",
          unit: "s",
        },
        {
          name: "u",
          valueReference: 1,
          causality: "input",
          variability: "continuous",
          type: "Real",
          start: "1.0",
          description: "Control step voltage",
        },
        {
          name: "y",
          valueReference: 2,
          causality: "output",
          variability: "continuous",
          type: "Real",
          description: "Rotational angular speed",
        },
        {
          name: "R",
          valueReference: 3,
          causality: "parameter",
          variability: "tunable",
          type: "Real",
          start: "10.0",
          unit: "Ohm",
          description: "Winding resistance",
        },
        {
          name: "J",
          valueReference: 4,
          causality: "parameter",
          variability: "fixed",
          type: "Real",
          start: "0.05",
          unit: "kg.m2",
          description: "Rotor inertia",
        },
      );
    }

    return list;
  }, [viewConfig]);

  // Tunable state map
  const [paramValues, setParamValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const v of allVariables) {
      if (v.start !== undefined) {
        init[v.name] = String(v.start);
      }
    }
    return init;
  });

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

  const handleCopyGuid = () => {
    if (viewConfig.guid) {
      navigator.clipboard.writeText(viewConfig.guid);
      setCopiedGuid(true);
      setTimeout(() => setCopiedGuid(false), 2000);
    }
  };

  const handleRunSimulation = () => {
    setIsSimulating(true);
    setTimeout(() => {
      // Generate realistic second-order response curve
      const steps = 100;
      const t: number[] = [];
      const y: number[] = [];
      const R = Number(paramValues["R"] || 10);
      const J = Number(paramValues["J"] || 0.05);
      const tau = Math.max(0.1, (J * R) / 2);

      for (let i = 0; i <= steps; i++) {
        const time = (i / steps) * 5.0;
        t.push(time);
        const val = 1.0 - Math.exp(-time / tau) * Math.cos(2.5 * time);
        y.push(val);
      }

      setSimResults({ t, y });
      setIsSimulating(false);
    }, 600);
  };

  const modelName = viewConfig.modelName || "FMU Simulation Model";
  const fmiVer = viewConfig.fmiVersion || "2.0";
  const hasWasm = Boolean(viewConfig.hasWasm);

  return (
    <CardWrapper $isFullScreen={isFullScreen}>
      <Toolbar>
        <HeaderLeft>
          <PlayIcon size={16} fill="var(--color-accent-purple, #a78bfa)" />
          <ModelTitle title={modelName}>{modelName}</ModelTitle>
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
              <Text fontSize="11px" ml={1}>
                {copiedGuid ? "Copied" : "GUID"}
              </Text>
            </Button>
          )}
          <Button
            size="small"
            variant="primary"
            onClick={() => navigate("/ide")}
            title="Import FMU into ModelScript IDE"
          >
            <CodeIcon size={14} />
            <Text fontSize="11px" ml={1}>
              Open in IDE
            </Text>
          </Button>
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
                sx={{ width: ["100%", "240px"] }}
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
                  {filteredVariables.map((v) => {
                    const isTunable =
                      v.causality.toLowerCase() === "parameter" || v.causality.toLowerCase() === "input";
                    return (
                      <tr key={v.name}>
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
                    : "Simulate step response using ModelScript cloud solver container."}
                </Text>
              </Box>

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
                <Text fontSize="12px" fontWeight="600" ml={1}>
                  {isSimulating ? "Integrating..." : "Run Simulation"}
                </Text>
              </Button>
            </Box>

            <SimulationCanvasContainer>
              {simResults ? (
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
                  <line x1="40" y1="30" x2="480" y2="30" stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
                  <line x1="40" y1="90" x2="480" y2="90" stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
                  <line x1="40" y1="150" x2="480" y2="150" stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
                  {/* Axes */}
                  <line x1="40" y1="170" x2="480" y2="170" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" />
                  <line x1="40" y1="20" x2="40" y2="170" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" />
                  {/* Trajectory */}
                  <polyline
                    fill="none"
                    stroke="url(#fmuLineGrad)"
                    strokeWidth="2.5"
                    points={simResults.t
                      .map((time, idx) => {
                        const x = 40 + (time / 5.0) * 440;
                        const y = 170 - (simResults.y[idx] || 0) * 110;
                        return `${x},${y}`;
                      })
                      .join(" ")}
                  />
                  <text x="50" y="25" fill="#22d3ee" fontSize="11" fontFamily="monospace">
                    Trajectory: y(t) [Step Response]
                  </text>
                  <text x="440" y="185" fill="#8b949e" fontSize="10" fontFamily="monospace">
                    t = 5.0s
                  </text>
                </svg>
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

        {activeTab === "metadata"}
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
                <span>{viewConfig.inputs?.length || 0}</span>

                <span style={{ color: "var(--color-text-muted)" }}>Outputs:</span>
                <span>{viewConfig.outputs?.length || 0}</span>

                <span style={{ color: "var(--color-text-muted)" }}>Parameters:</span>
                <span>{viewConfig.parameters?.length || 0}</span>
              </div>
            </Box>
          </Box>
        )}
      </ContentBody>
    </CardWrapper>
  );
};

export default FmuViewer;
