// SPDX-License-Identifier: AGPL-3.0-or-later

import React from "react";
import Box from "../../../components/Box";
import { useModelingPreferences } from "../../../ModelingPreferencesContext";
import { DetailSubtitle, DetailTitle, FormLabel, Header, SecondaryButton } from "../settingsStyles";

export const ModelingPreferencesTab: React.FC = () => {
  const {
    preferences: modelingPrefs,
    updatePreferences: updateModelingPrefs,
    resetPreferences: resetModelingPrefs,
  } = useModelingPreferences();

  return (
    <>
      <Header>Modeling &amp; Simulation Preferences</Header>
      <Box px={4} pb={4} style={{ overflowY: "auto" }}>
        <DetailSubtitle style={{ fontSize: "15px", lineHeight: "1.5", display: "block", marginBottom: "20px" }}>
          Configure the Monaco code editor, select the default ModelScript compiler flattener backend, and tune
          numerical simulation solver tolerances across the Playground and Web IDE.
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
            <Box display="flex" justifyContent="space-between" alignItems="center">
              <Box>
                <FormLabel style={{ margin: 0, display: "block" }}>Font Size</FormLabel>
                <DetailSubtitle>Editor text size in pixels</DetailSubtitle>
              </Box>
              <Box display="flex" gap={2}>
                {[12, 14, 16, 18].map((size) => (
                  <button
                    key={size}
                    type="button"
                    onClick={() => updateModelingPrefs({ fontSize: size })}
                    style={{
                      padding: "6px 12px",
                      borderRadius: "6px",
                      border:
                        modelingPrefs.fontSize === size
                          ? "2px solid var(--color-accent-purple, #a855f7)"
                          : "1px solid var(--color-border-default)",
                      background:
                        modelingPrefs.fontSize === size ? "rgba(139, 92, 246, 0.15)" : "var(--color-canvas-default)",
                      color: "var(--color-text-primary)",
                      fontWeight: modelingPrefs.fontSize === size ? "700" : "500",
                      cursor: "pointer",
                      fontSize: "13px",
                    }}
                  >
                    {size}px
                  </button>
                ))}
              </Box>
            </Box>

            <Box display="flex" justifyContent="space-between" alignItems="center">
              <Box>
                <FormLabel style={{ margin: 0, display: "block" }}>Tab Indentation</FormLabel>
                <DetailSubtitle>Spaces per indentation level</DetailSubtitle>
              </Box>
              <Box display="flex" gap={2}>
                {[2, 4].map((spaces) => (
                  <button
                    key={spaces}
                    type="button"
                    onClick={() => updateModelingPrefs({ tabSize: spaces })}
                    style={{
                      padding: "6px 12px",
                      borderRadius: "6px",
                      border:
                        modelingPrefs.tabSize === spaces
                          ? "2px solid var(--color-accent-purple, #a855f7)"
                          : "1px solid var(--color-border-default)",
                      background:
                        modelingPrefs.tabSize === spaces ? "rgba(139, 92, 246, 0.15)" : "var(--color-canvas-default)",
                      color: "var(--color-text-primary)",
                      fontWeight: modelingPrefs.tabSize === spaces ? "700" : "500",
                      cursor: "pointer",
                      fontSize: "13px",
                    }}
                  >
                    {spaces} Spaces
                  </button>
                ))}
              </Box>
            </Box>

            <Box display="flex" justifyContent="space-between" alignItems="center">
              <Box>
                <FormLabel style={{ margin: 0, display: "block" }}>Word Wrapping</FormLabel>
                <DetailSubtitle>Wrap long equation lines automatically</DetailSubtitle>
              </Box>
              <input
                type="checkbox"
                checked={modelingPrefs.wordWrap === "on"}
                onChange={(e) => updateModelingPrefs({ wordWrap: e.target.checked ? "on" : "off" })}
                style={{ width: "20px", height: "20px", cursor: "pointer" }}
              />
            </Box>

            <Box display="flex" justifyContent="space-between" alignItems="center">
              <Box>
                <FormLabel style={{ margin: 0, display: "block" }}>Code Minimap</FormLabel>
                <DetailSubtitle>Show high-level code structure scroll preview</DetailSubtitle>
              </Box>
              <input
                type="checkbox"
                checked={modelingPrefs.minimapEnabled}
                onChange={(e) => updateModelingPrefs({ minimapEnabled: e.target.checked })}
                style={{ width: "20px", height: "20px", cursor: "pointer" }}
              />
            </Box>

            <Box display="flex" justifyContent="space-between" alignItems="center">
              <Box>
                <FormLabel style={{ margin: 0, display: "block" }}>Bracket Pair Colorization</FormLabel>
                <DetailSubtitle>Colorize matching parentheses and curly braces</DetailSubtitle>
              </Box>
              <input
                type="checkbox"
                checked={modelingPrefs.bracketPairColorization}
                onChange={(e) => updateModelingPrefs({ bracketPairColorization: e.target.checked })}
                style={{ width: "20px", height: "20px", cursor: "pointer" }}
              />
            </Box>
          </Box>
        </Box>

        {/* ModelScript Compiler & Flattener */}
        <Box mb={4}>
          <DetailTitle style={{ fontWeight: "700", display: "block", marginBottom: "12px" }}>
            Compiler &amp; Flattener Architecture
          </DetailTitle>
          <Box display="grid" gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))" gap={3}>
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
            ].map((b) => (
              <Box
                key={b.backend}
                p={3}
                onClick={() => updateModelingPrefs({ flattenerBackend: b.backend })}
                style={{
                  border:
                    modelingPrefs.flattenerBackend === b.backend
                      ? "2px solid var(--color-accent-purple, #a855f7)"
                      : "1px solid var(--color-border-default)",
                  borderRadius: "10px",
                  background:
                    modelingPrefs.flattenerBackend === b.backend
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
              </Box>
            ))}
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
            <Box display="flex" justifyContent="space-between" alignItems="center">
              <Box>
                <FormLabel style={{ margin: 0, display: "block" }}>Lint on Type</FormLabel>
                <DetailSubtitle>Run real-time semantic and equation balance checks while editing</DetailSubtitle>
              </Box>
              <input
                type="checkbox"
                checked={modelingPrefs.lintOnType}
                onChange={(e) => updateModelingPrefs({ lintOnType: e.target.checked })}
                style={{ width: "20px", height: "20px", cursor: "pointer" }}
              />
            </Box>

            <Box display="flex" justifyContent="space-between" alignItems="center">
              <Box>
                <FormLabel style={{ margin: 0, display: "block" }}>Experimental Compiler Features</FormLabel>
                <DetailSubtitle>
                  Enable preview language extensions, e-graph rewriting, and WebGPU kernels
                </DetailSubtitle>
              </Box>
              <input
                type="checkbox"
                checked={modelingPrefs.enableExperimentalFeatures}
                onChange={(e) => updateModelingPrefs({ enableExperimentalFeatures: e.target.checked })}
                style={{ width: "20px", height: "20px", cursor: "pointer" }}
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
            <Box display="flex" justifyContent="space-between" alignItems="center">
              <Box>
                <FormLabel style={{ margin: 0, display: "block" }}>Default Solver</FormLabel>
                <DetailSubtitle>Primary numerical integration algorithm for simulations</DetailSubtitle>
              </Box>
              <Box display="flex" gap={2}>
                {(
                  [
                    { id: "cvode", label: "CVODE" },
                    { id: "ida", label: "IDA" },
                    { id: "dopri5", label: "DOPRI5" },
                    { id: "rk4", label: "RK4" },
                  ] as const
                ).map((solver) => (
                  <button
                    key={solver.id}
                    type="button"
                    onClick={() => updateModelingPrefs({ defaultSolver: solver.id })}
                    style={{
                      padding: "6px 12px",
                      borderRadius: "6px",
                      border:
                        modelingPrefs.defaultSolver === solver.id
                          ? "2px solid var(--color-accent-purple, #a855f7)"
                          : "1px solid var(--color-border-default)",
                      background:
                        modelingPrefs.defaultSolver === solver.id
                          ? "rgba(139, 92, 246, 0.15)"
                          : "var(--color-canvas-default)",
                      color: "var(--color-text-primary)",
                      fontWeight: modelingPrefs.defaultSolver === solver.id ? "700" : "500",
                      cursor: "pointer",
                      fontSize: "13px",
                    }}
                  >
                    {solver.label}
                  </button>
                ))}
              </Box>
            </Box>

            <Box display="flex" justifyContent="space-between" alignItems="center">
              <Box>
                <FormLabel style={{ margin: 0, display: "block" }}>Relative Tolerance (reltol)</FormLabel>
                <DetailSubtitle>Error tolerance for CVODE / IDA / RK45 integrators</DetailSubtitle>
              </Box>
              <Box display="flex" gap={2}>
                {[1e-3, 1e-4, 1e-6].map((tol) => {
                  const activeTol = modelingPrefs.solverTolerance ?? modelingPrefs.defaultRelativeTolerance;
                  return (
                    <button
                      key={tol}
                      type="button"
                      onClick={() => updateModelingPrefs({ solverTolerance: tol, defaultRelativeTolerance: tol })}
                      style={{
                        padding: "6px 12px",
                        borderRadius: "6px",
                        border:
                          activeTol === tol
                            ? "2px solid var(--color-accent-purple, #a855f7)"
                            : "1px solid var(--color-border-default)",
                        background: activeTol === tol ? "rgba(139, 92, 246, 0.15)" : "var(--color-canvas-default)",
                        color: "var(--color-text-primary)",
                        fontWeight: activeTol === tol ? "700" : "500",
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

            <Box display="flex" justifyContent="space-between" alignItems="center">
              <Box>
                <FormLabel style={{ margin: 0, display: "block" }}>Default Output Intervals</FormLabel>
                <DetailSubtitle>Simulation result sample steps (grid density)</DetailSubtitle>
              </Box>
              <Box display="flex" gap={2}>
                {[500, 1000, 2000].map((intervals) => (
                  <button
                    key={intervals}
                    type="button"
                    onClick={() => updateModelingPrefs({ defaultNumberOfIntervals: intervals })}
                    style={{
                      padding: "6px 12px",
                      borderRadius: "6px",
                      border:
                        modelingPrefs.defaultNumberOfIntervals === intervals
                          ? "2px solid var(--color-accent-purple, #a855f7)"
                          : "1px solid var(--color-border-default)",
                      background:
                        modelingPrefs.defaultNumberOfIntervals === intervals
                          ? "rgba(139, 92, 246, 0.15)"
                          : "var(--color-canvas-default)",
                      color: "var(--color-text-primary)",
                      fontWeight: modelingPrefs.defaultNumberOfIntervals === intervals ? "700" : "500",
                      cursor: "pointer",
                      fontSize: "13px",
                    }}
                  >
                    {intervals}
                  </button>
                ))}
              </Box>
            </Box>

            <Box display="flex" justifyContent="space-between" alignItems="center">
              <Box>
                <FormLabel style={{ margin: 0, display: "block" }}>Diagram Auto-Layout</FormLabel>
                <DetailSubtitle>Automatically route schematic connector lines</DetailSubtitle>
              </Box>
              <input
                type="checkbox"
                checked={modelingPrefs.diagramAutoLayout}
                onChange={(e) => updateModelingPrefs({ diagramAutoLayout: e.target.checked })}
                style={{ width: "20px", height: "20px", cursor: "pointer" }}
              />
            </Box>
          </Box>
        </Box>

        <Box display="flex" justifyContent="space-between" alignItems="center" mt={4}>
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
