// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useEffect, useState } from "react";
import Box from "../../../components/Box";
import { useModelingPreferences } from "../../../ModelingPreferencesContext";
import { DetailSubtitle, DetailTitle, FormLabel, Header, SecondaryButton } from "../settingsStyles";

const STOP_TIME_PRESETS = [1, 5, 10, 60, 100] as const;
export const MAX_DEFAULT_STOP_TIME = 1e9;

// eslint-disable-next-line react-refresh/only-export-components
export function parseDefaultStopTimeDraft(draft: string): number | null {
  const trimmed = draft.trim();
  if (!trimmed) return null;
  const num = Number(trimmed);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.min(num, MAX_DEFAULT_STOP_TIME);
}

export const ModelingPreferencesTab: React.FC = () => {
  const {
    preferences: modelingPrefs,
    updatePreferences: updateModelingPrefs,
    resetPreferences: resetModelingPrefs,
  } = useModelingPreferences();

  const [stopTimeDraft, setStopTimeDraft] = useState<string>(() => String(modelingPrefs.defaultStopTime));

  useEffect(() => {
    setStopTimeDraft((curr) => {
      const parsed = parseDefaultStopTimeDraft(curr);
      if (parsed !== null && parsed === modelingPrefs.defaultStopTime) {
        return curr;
      }
      return String(modelingPrefs.defaultStopTime);
    });
  }, [modelingPrefs.defaultStopTime]);

  const indent = " ".repeat(modelingPrefs.tabSize || 2);
  const activeLineIndex = 4; // 0-indexed line 5 (`der(v) = ...`) as simulated cursor line for relative numbering
  const activeLineNumbers = modelingPrefs.lineNumbers || "on";
  const bracketColorize = Boolean(modelingPrefs.bracketPairColorization);

  const renderBracket = (char: string, depth: 0 | 1) => {
    const color = bracketColorize ? (depth === 0 ? "#f59e0b" : "#c084fc") : "var(--ms-text-1, #e6edf3)";
    return <span style={{ color, fontWeight: bracketColorize ? 700 : 400 }}>{char}</span>;
  };

  const previewLines: { lineNo: number; content: React.ReactNode }[] = [
    {
      lineNo: 1,
      content: (
        <>
          <span style={{ color: "#c084fc", fontWeight: 600 }}>model</span>{" "}
          <span style={{ color: "#38bdf8", fontWeight: 600 }}>DampedHarmonicOscillator</span>
        </>
      ),
    },
    {
      lineNo: 2,
      content: (
        <>
          {indent}
          <span style={{ color: "#c084fc" }}>parameter</span> <span style={{ color: "#38bdf8" }}>Real</span> k ={" "}
          <span style={{ color: "#34d399" }}>10.0</span>, c = <span style={{ color: "#34d399" }}>0.5</span>;
        </>
      ),
    },
    {
      lineNo: 3,
      content: (
        <>
          {indent}
          <span style={{ color: "#38bdf8" }}>Real</span> x{renderBracket("(", 0)}start ={" "}
          <span style={{ color: "#34d399" }}>1.0</span>, fixed = <span style={{ color: "#f472b6" }}>true</span>
          {renderBracket(")", 0)}, v{renderBracket("(", 0)}start = <span style={{ color: "#34d399" }}>0.0</span>
          {renderBracket(")", 0)};
        </>
      ),
    },
    {
      lineNo: 4,
      content: <span style={{ color: "#c084fc", fontWeight: 600 }}>equation</span>,
    },
    {
      lineNo: 5,
      content: (
        <>
          {indent}
          <span style={{ color: "#60a5fa" }}>der</span>
          {renderBracket("(", 0)}x{renderBracket(")", 0)} = v;{" "}
          <span style={{ color: "var(--ms-text-3, #8b949e)" }}>
            // StopTime={modelingPrefs.defaultStopTime}s ({modelingPrefs.defaultSolver.toUpperCase()})
          </span>
        </>
      ),
    },
    {
      lineNo: 6,
      content: (
        <>
          {indent}
          <span style={{ color: "#60a5fa" }}>der</span>
          {renderBracket("(", 0)}v{renderBracket(")", 0)} = -{renderBracket("(", 0)}k * x + {renderBracket("(", 1)}c * v
          {renderBracket(")", 1)}
          {renderBracket(")", 0)};
        </>
      ),
    },
    {
      lineNo: 7,
      content: (
        <>
          <span style={{ color: "#c084fc", fontWeight: 600 }}>end</span> DampedHarmonicOscillator;
        </>
      ),
    },
  ];

  return (
    <>
      <Header>Modeling &amp; Simulation Preferences</Header>
      <Box px={4} pb={4} style={{ overflowY: "auto" }}>
        <DetailSubtitle style={{ fontSize: "15px", lineHeight: "1.5", display: "block", marginBottom: "20px" }}>
          Configure the Monaco code editor, select the default ModelScript compiler flattener backend, and tune
          numerical simulation solver tolerances across Ansatz and Studio.
        </DetailSubtitle>

        {/* Monaco Editor Preferences */}
        <Box mb={4}>
          <DetailTitle style={{ fontWeight: "700", display: "block", marginBottom: "12px" }}>
            Code Editor (Monaco)
          </DetailTitle>
          <Box
            p={4}
            style={{
              border: "1px solid var(--color-border-default)",
              borderRadius: "10px",
              background: "var(--color-canvas-subtle, rgba(255,255,255,0.02))",
              display: "flex",
              flexDirection: "column",
              gap: "16px",
            }}
          >
            {/* Font Size */}
            <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
              <Box>
                <FormLabel style={{ margin: 0, display: "block" }}>Font Size</FormLabel>
                <DetailSubtitle>Editor text size in pixels</DetailSubtitle>
              </Box>
              <Box display="flex" gap={2} flexWrap="wrap" role="group" aria-label="Font Size">
                {[12, 14, 16, 18].map((size) => {
                  const selected = modelingPrefs.fontSize === size;
                  return (
                    <button
                      key={size}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => updateModelingPrefs({ fontSize: size, editorFontSize: size })}
                      style={{
                        padding: "6px 12px",
                        borderRadius: "6px",
                        border: selected
                          ? "2px solid var(--color-accent-purple, #a855f7)"
                          : "1px solid var(--color-border-default)",
                        background: selected ? "rgba(139, 92, 246, 0.15)" : "var(--color-canvas-default)",
                        color: "var(--color-text-primary)",
                        fontWeight: selected ? "700" : "500",
                        cursor: "pointer",
                        fontSize: "13px",
                      }}
                    >
                      {size}px
                    </button>
                  );
                })}
              </Box>
            </Box>

            {/* Tab Indentation */}
            <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
              <Box>
                <FormLabel style={{ margin: 0, display: "block" }}>Tab Indentation</FormLabel>
                <DetailSubtitle>Spaces per indentation level</DetailSubtitle>
              </Box>
              <Box display="flex" gap={2} flexWrap="wrap" role="group" aria-label="Tab Indentation">
                {[2, 4].map((spaces) => {
                  const selected = modelingPrefs.tabSize === spaces;
                  return (
                    <button
                      key={spaces}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => updateModelingPrefs({ tabSize: spaces, editorTabSize: spaces })}
                      style={{
                        padding: "6px 12px",
                        borderRadius: "6px",
                        border: selected
                          ? "2px solid var(--color-accent-purple, #a855f7)"
                          : "1px solid var(--color-border-default)",
                        background: selected ? "rgba(139, 92, 246, 0.15)" : "var(--color-canvas-default)",
                        color: "var(--color-text-primary)",
                        fontWeight: selected ? "700" : "500",
                        cursor: "pointer",
                        fontSize: "13px",
                      }}
                    >
                      {spaces} Spaces
                    </button>
                  );
                })}
              </Box>
            </Box>

            {/* Line Numbers Segmented Control */}
            <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
              <Box>
                <FormLabel style={{ margin: 0, display: "block" }}>Line Numbers</FormLabel>
                <DetailSubtitle>Gutter line numbering display mode in Monaco editor</DetailSubtitle>
              </Box>
              <Box display="flex" gap={2} flexWrap="wrap" role="group" aria-label="Line Numbers">
                {(
                  [
                    { id: "on", label: "On" },
                    { id: "off", label: "Off" },
                    { id: "relative", label: "Relative" },
                  ] as const
                ).map((mode) => {
                  const selected = activeLineNumbers === mode.id;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => updateModelingPrefs({ lineNumbers: mode.id, editorLineNumbers: mode.id })}
                      style={{
                        padding: "6px 12px",
                        borderRadius: "6px",
                        border: selected
                          ? "2px solid var(--color-accent-purple, #a855f7)"
                          : "1px solid var(--color-border-default)",
                        background: selected ? "rgba(139, 92, 246, 0.15)" : "var(--color-canvas-default)",
                        color: "var(--color-text-primary)",
                        fontWeight: selected ? "700" : "500",
                        cursor: "pointer",
                        fontSize: "13px",
                      }}
                    >
                      {mode.label}
                    </button>
                  );
                })}
              </Box>
            </Box>

            {/* Word Wrapping */}
            <Box display="flex" justifyContent="space-between" alignItems="center" gap={3}>
              <Box>
                <FormLabel htmlFor="modeling-word-wrap" style={{ margin: 0, display: "block" }}>
                  Word Wrapping
                </FormLabel>
                <DetailSubtitle>Wrap long equation lines automatically</DetailSubtitle>
              </Box>
              <input
                id="modeling-word-wrap"
                type="checkbox"
                role="switch"
                aria-checked={modelingPrefs.wordWrap === "on"}
                aria-label="Word Wrapping"
                checked={modelingPrefs.wordWrap === "on"}
                onChange={(e) => {
                  const mode = e.target.checked ? "on" : "off";
                  updateModelingPrefs({ wordWrap: mode, editorWordWrap: mode });
                }}
                style={{ width: "20px", height: "20px", cursor: "pointer", flexShrink: 0 }}
              />
            </Box>

            {/* Code Minimap */}
            <Box display="flex" justifyContent="space-between" alignItems="center" gap={3}>
              <Box>
                <FormLabel htmlFor="modeling-minimap" style={{ margin: 0, display: "block" }}>
                  Code Minimap
                </FormLabel>
                <DetailSubtitle>Show high-level code structure scroll preview</DetailSubtitle>
              </Box>
              <input
                id="modeling-minimap"
                type="checkbox"
                role="switch"
                aria-checked={modelingPrefs.minimapEnabled}
                aria-label="Code Minimap"
                checked={modelingPrefs.minimapEnabled}
                onChange={(e) =>
                  updateModelingPrefs({ minimapEnabled: e.target.checked, editorMinimap: e.target.checked })
                }
                style={{ width: "20px", height: "20px", cursor: "pointer", flexShrink: 0 }}
              />
            </Box>

            {/* Bracket Pair Colorization */}
            <Box display="flex" justifyContent="space-between" alignItems="center" gap={3}>
              <Box>
                <FormLabel htmlFor="modeling-bracket-colorization" style={{ margin: 0, display: "block" }}>
                  Bracket Pair Colorization
                </FormLabel>
                <DetailSubtitle>Colorize matching parentheses and curly braces</DetailSubtitle>
              </Box>
              <input
                id="modeling-bracket-colorization"
                type="checkbox"
                role="switch"
                aria-checked={modelingPrefs.bracketPairColorization}
                aria-label="Bracket Pair Colorization"
                checked={modelingPrefs.bracketPairColorization}
                onChange={(e) => updateModelingPrefs({ bracketPairColorization: e.target.checked })}
                style={{ width: "20px", height: "20px", cursor: "pointer", flexShrink: 0 }}
              />
            </Box>

            {/* Interactive Live Monaco Preview Snippet */}
            <Box
              mt={1}
              style={{
                border: "1px solid var(--color-border-default)",
                borderRadius: "8px",
                background: "var(--ms-bg-canvas, #0d1117)",
                color: "var(--ms-text-1, #e6edf3)",
                overflow: "hidden",
              }}
            >
              <Box
                px={3}
                py={2}
                display="flex"
                justifyContent="space-between"
                alignItems="center"
                flexWrap="wrap"
                gap={2}
                style={{
                  borderBottom: "1px solid var(--ms-border, #30363d)",
                  background: "var(--ms-bg-surface, #161b22)",
                  color: "var(--ms-text-1, #e6edf3)",
                  fontSize: "12px",
                }}
              >
                <span
                  style={{
                    fontWeight: 600,
                    fontFamily: "var(--font-mono, monospace)",
                    color: "var(--ms-text-1, #e6edf3)",
                  }}
                >
                  Live Monaco Preview — DampedHarmonicOscillator.mo
                </span>
                <span style={{ color: "var(--ms-text-3, #8b949e)" }}>
                  {modelingPrefs.fontSize}px • Tab:{modelingPrefs.tabSize} • Lines:{activeLineNumbers} • Wrap:
                  {modelingPrefs.wordWrap}
                </span>
              </Box>
              <Box
                p={3}
                display="flex"
                justifyContent="space-between"
                gap={2}
                style={{
                  fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
                  fontSize: `${modelingPrefs.fontSize}px`,
                  lineHeight: "1.55",
                  background: "var(--ms-bg-canvas, #0d1117)",
                  color: "var(--ms-text-1, #e6edf3)",
                  overflowX: modelingPrefs.wordWrap === "on" ? "hidden" : "auto",
                }}
              >
                <Box style={{ flex: 1, minWidth: 0 }}>
                  {previewLines.map((line, idx) => {
                    const displayLineNum =
                      activeLineNumbers === "relative"
                        ? idx === activeLineIndex
                          ? line.lineNo
                          : Math.abs(idx - activeLineIndex)
                        : line.lineNo;
                    return (
                      <div
                        key={line.lineNo}
                        style={{
                          display: "flex",
                          gap: "12px",
                          whiteSpace: modelingPrefs.wordWrap === "on" ? "pre-wrap" : "pre",
                          wordBreak: modelingPrefs.wordWrap === "on" ? "break-word" : "normal",
                          background: idx === activeLineIndex ? "rgba(139, 92, 246, 0.18)" : "transparent",
                          borderRadius: "4px",
                          padding: "0 4px",
                        }}
                      >
                        {activeLineNumbers !== "off" && (
                          <span
                            style={{
                              width: "24px",
                              textAlign: "right",
                              userSelect: "none",
                              color:
                                idx === activeLineIndex ? "var(--ms-text-1, #e6edf3)" : "var(--ms-text-3, #8b949e)",
                              fontWeight: idx === activeLineIndex ? 700 : 400,
                              flexShrink: 0,
                            }}
                          >
                            {displayLineNum}
                          </span>
                        )}
                        <span>{line.content}</span>
                      </div>
                    );
                  })}
                </Box>
                {modelingPrefs.minimapEnabled && (
                  <Box
                    aria-label="Minimap Preview"
                    style={{
                      width: "44px",
                      borderLeft: "1px solid var(--ms-border, #30363d)",
                      paddingLeft: "6px",
                      display: "flex",
                      flexDirection: "column",
                      gap: "4px",
                      opacity: 0.7,
                      flexShrink: 0,
                    }}
                  >
                    {[28, 36, 40, 20, 38, 34, 24].map((w, i) => (
                      <div
                        key={i}
                        style={{
                          height: "4px",
                          width: `${w}px`,
                          borderRadius: "2px",
                          background: i === activeLineIndex ? "#a855f7" : "var(--ms-text-3, #8b949e)",
                        }}
                      />
                    ))}
                  </Box>
                )}
              </Box>
            </Box>
          </Box>
        </Box>

        {/* ModelScript Compiler & Flattener */}
        <Box mb={4}>
          <DetailTitle style={{ fontWeight: "700", display: "block", marginBottom: "12px" }}>
            Compiler &amp; Flattener Architecture
          </DetailTitle>
          <Box
            display="grid"
            gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))"
            gap={3}
            role="group"
            aria-label="Compiler and Flattener Backend"
          >
            {[
              {
                backend: "hybrid" as const,
                title: "Hybrid (Recommended)",
                desc: "AssemblyScript WASM Kernel + TS AST Bridge with Salsa query caching.",
              },
              {
                backend: "wasm" as const,
                title: "Pure WASM Arena",
                desc: "Zero-allocation data-oriented struct-of-arrays in WebAssembly linear memory.",
              },
              {
                backend: "ts" as const,
                title: "TypeScript AST",
                desc: "Complete TypeScript flattener pipeline for maximum debugging transparency.",
              },
            ].map((b) => {
              const selected = modelingPrefs.flattenerBackend === b.backend;
              return (
                <button
                  key={b.backend}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => updateModelingPrefs({ flattenerBackend: b.backend })}
                  style={{
                    textAlign: "left",
                    padding: "12px",
                    border: selected
                      ? "2px solid var(--color-accent-purple, #a855f7)"
                      : "1px solid var(--color-border-default)",
                    borderRadius: "10px",
                    background: selected
                      ? "rgba(139, 92, 246, 0.12)"
                      : "var(--color-canvas-subtle, rgba(255,255,255,0.02))",
                    cursor: "pointer",
                  }}
                >
                  <span
                    style={{
                      fontSize: "14px",
                      fontWeight: "700",
                      display: "block",
                      color: "var(--color-text-primary)",
                    }}
                  >
                    {b.title}
                  </span>
                  <DetailSubtitle style={{ display: "block", marginTop: "4px" }}>{b.desc}</DetailSubtitle>
                </button>
              );
            })}
          </Box>
          <Box
            p={4}
            mt={3}
            style={{
              border: "1px solid var(--color-border-default)",
              borderRadius: "10px",
              background: "var(--color-canvas-subtle, rgba(255,255,255,0.02))",
              display: "flex",
              flexDirection: "column",
              gap: "16px",
            }}
          >
            <Box display="flex" justifyContent="space-between" alignItems="center" gap={3}>
              <Box>
                <FormLabel htmlFor="modeling-lint-on-type" style={{ margin: 0, display: "block" }}>
                  Lint on Type
                </FormLabel>
                <DetailSubtitle>Run real-time semantic and equation balance checks while editing</DetailSubtitle>
              </Box>
              <input
                id="modeling-lint-on-type"
                type="checkbox"
                role="switch"
                aria-checked={modelingPrefs.lintOnType}
                aria-label="Lint on Type"
                checked={modelingPrefs.lintOnType}
                onChange={(e) => updateModelingPrefs({ lintOnType: e.target.checked })}
                style={{ width: "20px", height: "20px", cursor: "pointer", flexShrink: 0 }}
              />
            </Box>

            <Box display="flex" justifyContent="space-between" alignItems="center" gap={3}>
              <Box>
                <FormLabel htmlFor="modeling-experimental-features" style={{ margin: 0, display: "block" }}>
                  Experimental Compiler Features
                </FormLabel>
                <DetailSubtitle>
                  Enable preview language extensions, e-graph rewriting, and WebGPU kernels
                </DetailSubtitle>
              </Box>
              <input
                id="modeling-experimental-features"
                type="checkbox"
                role="switch"
                aria-checked={modelingPrefs.enableExperimentalFeatures}
                aria-label="Experimental Compiler Features"
                checked={modelingPrefs.enableExperimentalFeatures}
                onChange={(e) => updateModelingPrefs({ enableExperimentalFeatures: e.target.checked })}
                style={{ width: "20px", height: "20px", cursor: "pointer", flexShrink: 0 }}
              />
            </Box>
          </Box>
        </Box>

        {/* Simulation & Numerical Solver Defaults */}
        <Box mb={4}>
          <DetailTitle style={{ fontWeight: "700", display: "block", marginBottom: "12px" }}>
            Simulation &amp; Solver Tolerances
          </DetailTitle>
          <Box
            p={4}
            style={{
              border: "1px solid var(--color-border-default)",
              borderRadius: "10px",
              background: "var(--color-canvas-subtle, rgba(255,255,255,0.02))",
              display: "flex",
              flexDirection: "column",
              gap: "16px",
            }}
          >
            {/* Default Solver */}
            <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
              <Box>
                <FormLabel style={{ margin: 0, display: "block" }}>Default Solver</FormLabel>
                <DetailSubtitle>Primary numerical integration algorithm for simulations</DetailSubtitle>
              </Box>
              <Box display="flex" gap={2} flexWrap="wrap" role="group" aria-label="Default Solver">
                {(
                  [
                    { id: "cvode", label: "CVODE" },
                    { id: "ida", label: "IDA" },
                    { id: "dopri5", label: "DOPRI5" },
                    { id: "rk4", label: "RK4" },
                  ] as const
                ).map((solver) => {
                  const selected = modelingPrefs.defaultSolver === solver.id;
                  return (
                    <button
                      key={solver.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => updateModelingPrefs({ defaultSolver: solver.id })}
                      style={{
                        padding: "6px 12px",
                        borderRadius: "6px",
                        border: selected
                          ? "2px solid var(--color-accent-purple, #a855f7)"
                          : "1px solid var(--color-border-default)",
                        background: selected ? "rgba(139, 92, 246, 0.15)" : "var(--color-canvas-default)",
                        color: "var(--color-text-primary)",
                        fontWeight: selected ? "700" : "500",
                        cursor: "pointer",
                        fontSize: "13px",
                      }}
                    >
                      {solver.label}
                    </button>
                  );
                })}
              </Box>
            </Box>

            {/* Default Stop Time (s) */}
            <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
              <Box>
                <FormLabel htmlFor="modeling-default-stop-time" style={{ margin: 0, display: "block" }}>
                  Default Stop Time (s)
                </FormLabel>
                <DetailSubtitle>Simulation horizon duration in seconds</DetailSubtitle>
              </Box>
              <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
                <Box
                  display="flex"
                  alignItems="center"
                  gap={2}
                  flexWrap="wrap"
                  role="group"
                  aria-label="Default Stop Time Presets"
                >
                  {STOP_TIME_PRESETS.map((sec) => {
                    const selected = modelingPrefs.defaultStopTime === sec;
                    return (
                      <button
                        key={sec}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => {
                          setStopTimeDraft(String(sec));
                          updateModelingPrefs({ defaultStopTime: sec });
                        }}
                        style={{
                          padding: "6px 10px",
                          borderRadius: "6px",
                          border: selected
                            ? "2px solid var(--color-accent-purple, #a855f7)"
                            : "1px solid var(--color-border-default)",
                          background: selected ? "rgba(139, 92, 246, 0.15)" : "var(--color-canvas-default)",
                          color: "var(--color-text-primary)",
                          fontWeight: selected ? "700" : "500",
                          cursor: "pointer",
                          fontSize: "13px",
                        }}
                      >
                        {sec}s
                      </button>
                    );
                  })}
                </Box>
                <input
                  id="modeling-default-stop-time"
                  type="number"
                  aria-label="Default Stop Time (s)"
                  min={0.001}
                  max={MAX_DEFAULT_STOP_TIME}
                  step="any"
                  value={stopTimeDraft}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setStopTimeDraft(raw);
                    const parsed = parseDefaultStopTimeDraft(raw);
                    if (parsed !== null) {
                      updateModelingPrefs({ defaultStopTime: parsed });
                    }
                  }}
                  onBlur={() => {
                    const parsed = parseDefaultStopTimeDraft(stopTimeDraft);
                    if (parsed !== null) {
                      if (parsed !== modelingPrefs.defaultStopTime) {
                        updateModelingPrefs({ defaultStopTime: parsed });
                      }
                      setStopTimeDraft(String(parsed));
                    } else {
                      setStopTimeDraft(String(modelingPrefs.defaultStopTime));
                    }
                  }}
                  style={{
                    width: "84px",
                    padding: "6px 8px",
                    borderRadius: "6px",
                    border: "1px solid var(--color-border-default)",
                    background: "var(--color-canvas-default)",
                    color: "var(--color-text-primary)",
                    fontSize: "13px",
                  }}
                />
              </Box>
            </Box>

            {/* Relative Tolerance */}
            <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
              <Box>
                <FormLabel style={{ margin: 0, display: "block" }}>Relative Tolerance (reltol)</FormLabel>
                <DetailSubtitle>Error tolerance for CVODE / IDA / RK45 integrators</DetailSubtitle>
              </Box>
              <Box display="flex" gap={2} flexWrap="wrap" role="group" aria-label="Relative Tolerance">
                {[1e-3, 1e-4, 1e-6].map((tol) => {
                  const activeTol = modelingPrefs.solverTolerance ?? modelingPrefs.defaultRelativeTolerance;
                  const selected = activeTol === tol;
                  return (
                    <button
                      key={tol}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => updateModelingPrefs({ solverTolerance: tol, defaultRelativeTolerance: tol })}
                      style={{
                        padding: "6px 12px",
                        borderRadius: "6px",
                        border: selected
                          ? "2px solid var(--color-accent-purple, #a855f7)"
                          : "1px solid var(--color-border-default)",
                        background: selected ? "rgba(139, 92, 246, 0.15)" : "var(--color-canvas-default)",
                        color: "var(--color-text-primary)",
                        fontWeight: selected ? "700" : "500",
                        cursor: "pointer",
                        fontSize: "13px",
                      }}
                    >
                      1e-{Math.round(-Math.log10(tol))}
                    </button>
                  );
                })}
              </Box>
            </Box>

            {/* Default Output Intervals */}
            <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
              <Box>
                <FormLabel style={{ margin: 0, display: "block" }}>Default Output Intervals</FormLabel>
                <DetailSubtitle>Simulation result sample steps (grid density)</DetailSubtitle>
              </Box>
              <Box display="flex" gap={2} flexWrap="wrap" role="group" aria-label="Default Output Intervals">
                {[500, 1000, 2000].map((intervals) => {
                  const selected = modelingPrefs.defaultNumberOfIntervals === intervals;
                  return (
                    <button
                      key={intervals}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => updateModelingPrefs({ defaultNumberOfIntervals: intervals })}
                      style={{
                        padding: "6px 12px",
                        borderRadius: "6px",
                        border: selected
                          ? "2px solid var(--color-accent-purple, #a855f7)"
                          : "1px solid var(--color-border-default)",
                        background: selected ? "rgba(139, 92, 246, 0.15)" : "var(--color-canvas-default)",
                        color: "var(--color-text-primary)",
                        fontWeight: selected ? "700" : "500",
                        cursor: "pointer",
                        fontSize: "13px",
                      }}
                    >
                      {intervals}
                    </button>
                  );
                })}
              </Box>
            </Box>

            {/* Diagram Auto-Layout */}
            <Box display="flex" justifyContent="space-between" alignItems="center" gap={3}>
              <Box>
                <FormLabel htmlFor="modeling-diagram-auto-layout" style={{ margin: 0, display: "block" }}>
                  Diagram Auto-Layout
                </FormLabel>
                <DetailSubtitle>Automatically route schematic connector lines</DetailSubtitle>
              </Box>
              <input
                id="modeling-diagram-auto-layout"
                type="checkbox"
                role="switch"
                aria-checked={modelingPrefs.diagramAutoLayout}
                aria-label="Diagram Auto-Layout"
                checked={modelingPrefs.diagramAutoLayout}
                onChange={(e) => updateModelingPrefs({ diagramAutoLayout: e.target.checked })}
                style={{ width: "20px", height: "20px", cursor: "pointer", flexShrink: 0 }}
              />
            </Box>
          </Box>
        </Box>

        <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2} mt={4}>
          <span style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>
            ✓ Preferences are automatically persisted to this browser.
          </span>
          <SecondaryButton type="button" onClick={resetModelingPrefs}>
            Reset to Defaults
          </SecondaryButton>
        </Box>
      </Box>
    </>
  );
};
