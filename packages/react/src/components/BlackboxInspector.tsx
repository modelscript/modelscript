// SPDX-License-Identifier: AGPL-3.0-or-later

import { type WasmFmuRunner, EmulatorWorkerClient } from "@modelscript/exchange";
import { useMemo, useState } from "react";
import { useCWasmCompiler } from "../hooks/useCWasmCompiler.js";
import { StepResponseTestbench } from "./StepResponseTestbench.js";

export interface BlackboxVariable {
  name: string;
  causality?: "input" | "output" | "parameter" | "calculatedParameter" | "local" | "independent" | string | undefined;
  type?: "Real" | "Integer" | "Boolean" | "String" | "Enumeration" | string | undefined;
  unit?: string | undefined;
  start?: string | number | boolean | undefined;
  description?: string | undefined;
  valueReference?: number | undefined;
}

export interface BlackboxArchitectureBadge {
  os: string;
  arch: string;
  bits: number;
}

export interface BlackboxInspectorProps {
  modelName: string;
  format: "fmu" | "pe_dll" | "elf_so" | "macho_dylib" | "unknown";
  description?: string | undefined;
  fmiVersion?: string | undefined;
  guid?: string | undefined;
  architectures?: BlackboxArchitectureBadge[] | undefined;
  variables?: BlackboxVariable[] | undefined;
  exportedSymbols?: string[] | undefined;
  hasCoSimulation?: boolean | undefined;
  hasModelExchange?: boolean | undefined;
  hasTerminals?: boolean | undefined;
  hasCSource?: boolean | undefined;
  cSourceCode?: string | undefined;
  cFiles?: Record<string, string> | undefined;
  binaryBuffer?: Uint8Array | ArrayBuffer | undefined;
  onCompiledWasm?: ((runner: WasmFmuRunner, wasmBinary: Uint8Array) => void) | undefined;
  onEmulateInBrowser?: ((runner: WasmFmuRunner) => void) | undefined;
  onGenerateModelica?: () => void;
  onGeneratePscad?: () => void;
  onGenerateSimulink?: () => void;
  onGeneratePsse?: () => void;
  onOpenTestbench?: () => void;
  className?: string;
}

export function BlackboxInspector({
  modelName,
  format,
  description,
  fmiVersion,
  guid,
  architectures = [],
  variables = [],
  exportedSymbols = [],
  hasCoSimulation,
  hasModelExchange,
  hasTerminals,
  hasCSource,
  cSourceCode,
  cFiles,
  binaryBuffer,
  onCompiledWasm,
  onEmulateInBrowser,
  onGenerateModelica,
  onGeneratePscad,
  onGenerateSimulink,
  onGeneratePsse,
  onOpenTestbench,
  className,
}: BlackboxInspectorProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [causalityFilter, setCausalityFilter] = useState<string>("all");
  const [internalTestbenchOpen, setInternalTestbenchOpen] = useState(false);
  const [isEmulating, setIsEmulating] = useState(false);
  const [emulatedRunner, setEmulatedRunner] = useState<WasmFmuRunner | null>(null);
  const [emulateArch, setEmulateArch] = useState<string | null>(null);
  const [emulateError, setEmulateError] = useState<string | null>(null);

  const {
    compile,
    isCompiling,
    stage,
    progress,
    statusMessage,
    runner: wasmRunner,
    error: compileError,
  } = useCWasmCompiler({
    onSuccess: (res, runner) => {
      if (runner && onCompiledWasm) {
        onCompiledWasm(runner, res.wasmBinary);
      }
    },
  });

  const handleStartCompile = async () => {
    const sources = cSourceCode || cFiles;
    if (!sources || (typeof sources === "object" && Object.keys(sources).length === 0)) {
      return;
    }
    await compile({
      sources,
      modelIdentifier: modelName,
      optimizationLevel: "O2",
    });
  };

  const handleStartEmulation = async () => {
    if (!binaryBuffer) return;
    setIsEmulating(true);
    setEmulateError(null);
    try {
      const client = new EmulatorWorkerClient(binaryBuffer, {
        modelName,
        variables: variables.map((v) => ({
          name: v.name,
          valueReference: v.valueReference ?? 0,
          causality: v.causality,
          start: typeof v.start === "number" ? v.start : undefined,
        })),
        guid,
      });
      await client.start();
      setEmulatedRunner(client);
      setEmulateArch(`${client.architecture} (${client.abi})`);
      setInternalTestbenchOpen(true);
      if (onEmulateInBrowser) {
        onEmulateInBrowser(client);
      }
    } catch (err: any) {
      setEmulateError(err?.message || String(err));
    } finally {
      setIsEmulating(false);
    }
  };

  const filteredVars = useMemo(() => {
    return variables.filter((v) => {
      const matchSearch =
        v.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (v.description && v.description.toLowerCase().includes(searchTerm.toLowerCase()));
      const matchCausality =
        causalityFilter === "all" ||
        (causalityFilter === "parameter"
          ? v.causality === "parameter" || v.causality === "calculatedParameter"
          : v.causality === causalityFilter);
      return matchSearch && matchCausality;
    });
  }, [variables, searchTerm, causalityFilter]);

  const counts = useMemo(() => {
    return {
      inputs: variables.filter((v) => v.causality === "input").length,
      outputs: variables.filter((v) => v.causality === "output").length,
      parameters: variables.filter((v) => v.causality === "parameter" || v.causality === "calculatedParameter").length,
    };
  }, [variables]);

  return (
    <div
      className={className}
      style={{
        borderRadius: "10px",
        border: "1px solid var(--color-border-default, #334155)",
        backgroundColor: "var(--color-canvas-default, #0f172a)",
        color: "var(--color-fg-default, #f8fafc)",
        overflow: "hidden",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      {/* Header Bar */}
      <div
        style={{
          padding: "16px 20px",
          borderBottom: "1px solid var(--color-border-default, #334155)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "12px",
          background: "linear-gradient(180deg, rgba(30, 41, 59, 0.6) 0%, rgba(15, 23, 42, 0.6) 100%)",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
            <span style={{ fontSize: "18px", fontWeight: 700 }}>{modelName}</span>
            <span
              style={{
                fontSize: "11px",
                fontWeight: 700,
                padding: "2px 8px",
                borderRadius: "12px",
                backgroundColor: format === "fmu" ? "rgba(59, 130, 246, 0.2)" : "rgba(168, 85, 247, 0.2)",
                color: format === "fmu" ? "#60a5fa" : "#c084fc",
                border: "1px solid currentColor",
                textTransform: "uppercase",
              }}
            >
              {format === "fmu" ? `FMI ${fmiVersion ?? "2.0"}` : format.replace("_", " ")}
            </span>
            {hasCoSimulation && (
              <span
                style={{
                  fontSize: "10px",
                  padding: "2px 6px",
                  borderRadius: "4px",
                  backgroundColor: "rgba(16, 185, 129, 0.15)",
                  color: "#34d399",
                }}
              >
                Co-Simulation
              </span>
            )}
            {hasModelExchange && (
              <span
                style={{
                  fontSize: "10px",
                  padding: "2px 6px",
                  borderRadius: "4px",
                  backgroundColor: "rgba(245, 158, 11, 0.15)",
                  color: "#fbbf24",
                }}
              >
                Model Exchange
              </span>
            )}
            {hasTerminals && (
              <span
                style={{
                  fontSize: "10px",
                  padding: "2px 6px",
                  borderRadius: "4px",
                  backgroundColor: "rgba(236, 72, 153, 0.15)",
                  color: "#f472b6",
                }}
              >
                FMI-LS-TI (Acausal)
              </span>
            )}
            {(hasCSource || cSourceCode || cFiles) && (
              <span
                style={{
                  fontSize: "10px",
                  padding: "2px 6px",
                  borderRadius: "4px",
                  backgroundColor: "rgba(6, 182, 212, 0.15)",
                  color: "#22d3ee",
                  border: "1px solid rgba(6, 182, 212, 0.3)",
                }}
              >
                C-Source
              </span>
            )}
            {wasmRunner && (
              <span
                style={{
                  fontSize: "10px",
                  padding: "2px 6px",
                  borderRadius: "4px",
                  backgroundColor: "rgba(16, 185, 129, 0.2)",
                  color: "#34d399",
                  border: "1px solid rgba(16, 185, 129, 0.4)",
                  fontWeight: 600,
                }}
              >
                ✓ Wasm Ready
              </span>
            )}
            {emulatedRunner && (
              <span
                style={{
                  fontSize: "10px",
                  padding: "2px 6px",
                  borderRadius: "4px",
                  backgroundColor: "rgba(168, 85, 247, 0.2)",
                  color: "#c084fc",
                  border: "1px solid rgba(168, 85, 247, 0.4)",
                  fontWeight: 600,
                }}
              >
                ✓ Emulation Active ({emulateArch ?? "Hypervisor"})
              </span>
            )}
          </div>
          {description && (
            <div style={{ fontSize: "13px", color: "var(--color-fg-muted, #94a3b8)", maxWidth: "600px" }}>
              {description}
            </div>
          )}
          {guid && (
            <div style={{ fontSize: "11px", color: "#64748b", fontFamily: "monospace", marginTop: "2px" }}>
              GUID: {guid}
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
          {binaryBuffer && (
            <button
              onClick={handleStartEmulation}
              disabled={isEmulating}
              style={{
                backgroundColor: isEmulating ? "rgba(168, 85, 247, 0.3)" : "#7c3aed",
                color: "#ffffff",
                border: "none",
                borderRadius: "6px",
                padding: "8px 14px",
                fontSize: "13px",
                fontWeight: 600,
                cursor: isEmulating ? "wait" : "pointer",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                boxShadow: "0 0 10px rgba(124, 58, 237, 0.3)",
              }}
            >
              <span>{isEmulating ? "⏳" : "⚡"}</span>
              {isEmulating
                ? "Launching Hypervisor..."
                : emulatedRunner
                  ? "✓ Emulation Active"
                  : "⚡ Emulate in Browser (Zero Install)"}
            </button>
          )}

          {(hasCSource || cSourceCode || cFiles) && (
            <button
              onClick={handleStartCompile}
              disabled={isCompiling}
              style={{
                backgroundColor: isCompiling ? "rgba(6, 182, 212, 0.3)" : "#0891b2",
                color: "#ffffff",
                border: "none",
                borderRadius: "6px",
                padding: "8px 14px",
                fontSize: "13px",
                fontWeight: 600,
                cursor: isCompiling ? "wait" : "pointer",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                boxShadow: "0 0 10px rgba(6, 182, 212, 0.3)",
              }}
            >
              <span>{isCompiling ? "⏳" : "⚡"}</span>
              {isCompiling
                ? `Compiling (${Math.round(progress * 100)}%)...`
                : wasmRunner
                  ? "Recompile Wasm"
                  : "In-Browser Wasm Compile"}
            </button>
          )}

          <button
            onClick={() => {
              if (onOpenTestbench) {
                onOpenTestbench();
              } else {
                setInternalTestbenchOpen((prev) => !prev);
              }
            }}
            style={{
              backgroundColor: internalTestbenchOpen ? "#1e40af" : "#2563eb",
              color: "#ffffff",
              border: "none",
              borderRadius: "6px",
              padding: "8px 14px",
              fontSize: "13px",
              fontWeight: 600,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <span>⚡</span> {internalTestbenchOpen ? "Close Testbench" : "Step Testbench"}
          </button>
          {onGenerateModelica && (
            <button
              onClick={onGenerateModelica}
              style={{
                backgroundColor: "rgba(30, 41, 59, 0.8)",
                color: "#93c5fd",
                border: "1px solid #3b82f6",
                borderRadius: "6px",
                padding: "8px 12px",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              + Modelica (.mo)
            </button>
          )}
          {onGeneratePscad && (
            <button
              onClick={onGeneratePscad}
              style={{
                backgroundColor: "rgba(30, 41, 59, 0.8)",
                color: "#c084fc",
                border: "1px solid #a855f7",
                borderRadius: "6px",
                padding: "8px 12px",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              + PSCAD (.pscx)
            </button>
          )}
          {onGenerateSimulink && (
            <button
              onClick={onGenerateSimulink}
              style={{
                backgroundColor: "rgba(30, 41, 59, 0.8)",
                color: "#38bdf8",
                border: "1px solid #0284c7",
                borderRadius: "6px",
                padding: "8px 12px",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              + Simulink S-Function
            </button>
          )}
          {onGeneratePsse && (
            <button
              onClick={onGeneratePsse}
              style={{
                backgroundColor: "rgba(30, 41, 59, 0.8)",
                color: "#fb923c",
                border: "1px solid #ea580c",
                borderRadius: "6px",
                padding: "8px 12px",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              + PSS®E USRMDL
            </button>
          )}
        </div>
      </div>

      {/* C-to-Wasm Compilation Banner */}
      {(isCompiling || stage === "ready" || compileError) && (
        <div
          style={{
            padding: "10px 20px",
            backgroundColor: compileError
              ? "rgba(239, 68, 68, 0.15)"
              : stage === "ready"
                ? "rgba(16, 185, 129, 0.15)"
                : "rgba(6, 182, 212, 0.12)",
            borderBottom: "1px solid var(--color-border-default, #334155)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "10px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span
              style={{
                fontSize: "11px",
                fontWeight: 700,
                textTransform: "uppercase",
                padding: "2px 8px",
                borderRadius: "4px",
                backgroundColor: compileError ? "#ef4444" : stage === "ready" ? "#10b981" : "#06b6d4",
                color: "#ffffff",
              }}
            >
              {stage}
            </span>
            <span style={{ fontSize: "12px", color: "#e2e8f0" }}>
              {statusMessage || (compileError ? String(compileError) : "Ready")}
            </span>
          </div>

          {isCompiling && (
            <div
              style={{
                width: "140px",
                height: "6px",
                backgroundColor: "#334155",
                borderRadius: "3px",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${Math.round(progress * 100)}%`,
                  height: "100%",
                  backgroundColor: "#06b6d4",
                  transition: "width 0.2s ease",
                }}
              />
            </div>
          )}

          {stage === "ready" && !internalTestbenchOpen && (
            <button
              onClick={() => setInternalTestbenchOpen(true)}
              style={{
                backgroundColor: "#10b981",
                color: "#ffffff",
                border: "none",
                borderRadius: "4px",
                padding: "4px 10px",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              ⚡ Launch Interactive Testbench
            </button>
          )}
        </div>
      )}

      {/* Emulation Error Banner */}
      {emulateError && (
        <div
          style={{
            padding: "10px 20px",
            backgroundColor: "rgba(239, 68, 68, 0.15)",
            borderBottom: "1px solid rgba(239, 68, 68, 0.3)",
            color: "#fca5a5",
            fontSize: "13px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <span>⚠️</span>
          <span>
            <strong>Hypervisor Error:</strong> {emulateError}
          </span>
        </div>
      )}

      {/* Embedded Step Testbench Drawer */}
      {internalTestbenchOpen && (
        <div
          style={{
            borderBottom: "1px solid var(--color-border-default, #334155)",
            padding: "16px",
            backgroundColor: "#020617",
          }}
        >
          <StepResponseTestbench
            modelName={modelName}
            inputs={variables.filter((v) => v.causality === "input")}
            outputs={variables.filter((v) => v.causality === "output")}
            wasmRunner={wasmRunner ?? emulatedRunner ?? undefined}
          />
        </div>
      )}

      {/* Target Platforms Strip */}
      {architectures.length > 0 && (
        <div
          style={{
            padding: "8px 20px",
            backgroundColor: "rgba(30, 41, 59, 0.3)",
            borderBottom: "1px solid var(--color-border-default, #334155)",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            fontSize: "12px",
            color: "#94a3b8",
          }}
        >
          <span style={{ fontWeight: 600 }}>Supported Targets:</span>
          {architectures.map((arch, i) => (
            <span
              key={i}
              style={{
                padding: "2px 8px",
                borderRadius: "4px",
                backgroundColor: "rgba(51, 65, 85, 0.6)",
                color: "#e2e8f0",
                fontSize: "11px",
              }}
            >
              {arch.os} ({arch.arch}, {arch.bits}-bit)
            </span>
          ))}
        </div>
      )}

      {/* Filter and Search Bar */}
      {variables.length > 0 ? (
        <>
          <div
            style={{
              padding: "12px 20px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "12px",
              borderBottom: "1px solid var(--color-border-default, #334155)",
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", gap: "6px" }}>
              {[
                { key: "all", label: `All (${variables.length})` },
                { key: "input", label: `Inputs (${counts.inputs})` },
                { key: "output", label: `Outputs (${counts.outputs})` },
                { key: "parameter", label: `Parameters (${counts.parameters})` },
              ].map((filter) => (
                <button
                  key={filter.key}
                  onClick={() => setCausalityFilter(filter.key)}
                  style={{
                    backgroundColor: causalityFilter === filter.key ? "#3b82f6" : "rgba(30, 41, 59, 0.6)",
                    color: causalityFilter === filter.key ? "#ffffff" : "#94a3b8",
                    border: "none",
                    borderRadius: "4px",
                    padding: "4px 10px",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {filter.label}
                </button>
              ))}
            </div>

            <input
              type="text"
              placeholder="Filter ports & variables..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                padding: "6px 12px",
                borderRadius: "6px",
                border: "1px solid #334155",
                backgroundColor: "#0b132b",
                color: "#f8fafc",
                fontSize: "12px",
                width: "240px",
                outline: "none",
              }}
            />
          </div>

          {/* Variables Table */}
          <div style={{ overflowX: "auto", maxHeight: "400px" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px", textAlign: "left" }}>
              <thead>
                <tr
                  style={{
                    backgroundColor: "rgba(30, 41, 59, 0.5)",
                    borderBottom: "1px solid var(--color-border-default, #334155)",
                    color: "#94a3b8",
                  }}
                >
                  <th style={{ padding: "8px 16px" }}>VR</th>
                  <th style={{ padding: "8px 16px" }}>Port / Variable</th>
                  <th style={{ padding: "8px 16px" }}>Causality</th>
                  <th style={{ padding: "8px 16px" }}>Type</th>
                  <th style={{ padding: "8px 16px" }}>Unit</th>
                  <th style={{ padding: "8px 16px" }}>Start</th>
                  <th style={{ padding: "8px 16px" }}>Description</th>
                </tr>
              </thead>
              <tbody>
                {filteredVars.map((v, i) => (
                  <tr
                    key={i}
                    style={{
                      borderBottom: "1px solid rgba(51, 65, 85, 0.4)",
                      backgroundColor: i % 2 === 0 ? "transparent" : "rgba(255, 255, 255, 0.01)",
                    }}
                  >
                    <td style={{ padding: "8px 16px", color: "#64748b", fontFamily: "monospace" }}>
                      {v.valueReference ?? "-"}
                    </td>
                    <td style={{ padding: "8px 16px", fontWeight: 600, color: "#e2e8f0" }}>{v.name}</td>
                    <td style={{ padding: "8px 16px" }}>
                      <span
                        style={{
                          padding: "2px 6px",
                          borderRadius: "4px",
                          fontSize: "11px",
                          fontWeight: 600,
                          backgroundColor:
                            v.causality === "input"
                              ? "rgba(59, 130, 246, 0.15)"
                              : v.causality === "output"
                                ? "rgba(16, 185, 129, 0.15)"
                                : "rgba(168, 85, 247, 0.15)",
                          color: v.causality === "input" ? "#60a5fa" : v.causality === "output" ? "#34d399" : "#c084fc",
                        }}
                      >
                        {v.causality ?? "local"}
                      </span>
                    </td>
                    <td style={{ padding: "8px 16px", color: "#cbd5e1" }}>{v.type ?? "Real"}</td>
                    <td style={{ padding: "8px 16px", color: "#94a3b8" }}>{v.unit ?? "-"}</td>
                    <td style={{ padding: "8px 16px", color: "#94a3b8", fontFamily: "monospace" }}>
                      {v.start !== undefined ? String(v.start) : "-"}
                    </td>
                    <td style={{ padding: "8px 16px", color: "#94a3b8", maxWidth: "250px" }}>{v.description ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div style={{ padding: "24px", textAlign: "center", color: "#94a3b8" }}>
          {exportedSymbols.length > 0 ? (
            <div>
              <div style={{ fontSize: "14px", fontWeight: 600, marginBottom: "8px" }}>
                Native Dynamic Library Symbols ({exportedSymbols.length})
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", justifyContent: "center" }}>
                {exportedSymbols.map((sym, i) => (
                  <span
                    key={i}
                    style={{
                      fontFamily: "monospace",
                      fontSize: "11px",
                      padding: "3px 8px",
                      borderRadius: "4px",
                      backgroundColor: "rgba(51, 65, 85, 0.5)",
                      color: "#38bdf8",
                    }}
                  >
                    {sym}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <div>No FMI variables or export symbols discovered.</div>
          )}
        </div>
      )}
    </div>
  );
}
