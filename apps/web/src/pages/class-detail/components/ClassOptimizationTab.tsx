// SPDX-License-Identifier: AGPL-3.0-or-later

import { executeLspAction } from "@modelscript/editor/workbench/util/lsp-bridge";
import { PlayIcon, PulseIcon } from "@primer/octicons-react";
import { Button, Heading, Label, Text } from "@primer/react";
import React, { useMemo, useState } from "react";
import styledImport from "styled-components";
import type { ClassDetail } from "../types";

const styled: typeof styledImport =
  (styledImport as unknown as { default?: typeof styledImport }).default ?? styledImport;

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
`;

const ControlsCard = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 14px;
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px solid var(--ms-border, var(--color-border));
  background: var(--color-canvas-subtle, rgba(255, 255, 255, 0.02));
`;

const FieldGroup = styled.label`
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--color-text-muted);
`;

const SelectInput = styled.select`
  font-size: 12px;
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid var(--ms-border, var(--color-border));
  background: var(--ms-bg, var(--color-canvas-default));
  color: var(--color-text-primary);
  min-width: 210px;
`;

const NumberInput = styled.input`
  font-size: 12px;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid var(--ms-border, var(--color-border));
  background: var(--ms-bg, var(--color-canvas-default));
  color: var(--color-text-primary);
  width: 105px;
`;

const ResultCard = styled.div`
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  border-radius: 12px;
  border: 1px solid var(--ms-border, var(--color-border));
  background: var(--color-canvas-default, transparent);
`;

const KpiGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 10px;
`;

const KpiTile = styled.div`
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--ms-border, var(--color-border));
  background: var(--color-canvas-subtle, rgba(255, 255, 255, 0.02));
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;

  th,
  td {
    padding: 7px 10px;
    border-bottom: 1px solid var(--ms-border, var(--color-border));
    text-align: left;
  }

  th {
    color: var(--color-text-muted);
    font-weight: 600;
    font-family: inherit;
  }
`;

export type OptimizationSolverOption =
  "auto" | "clp" | "cbc" | "ipopt" | "bonmin" | "couenne" | "highs" | "lbfgsb" | "de" | "cma-es" | "pso" | "pure-js";

interface SolveOutput {
  status: string;
  objectiveValue?: number;
  iterations?: number;
  nodesExplored?: number;
  solveTimeMs?: number;
  solverUsed?: string;
  variables?: Record<string, number>;
  duals?: Record<string, number>;
  variableSuffixes?: Record<string, { val?: number; rc?: number; lb?: number; ub?: number; status?: string }>;
  error?: string;
}

export interface ClassOptimizationTabProps {
  libraryName: string;
  version: string;
  className: string;
  cls: ClassDetail;
}

function detectOptimizationTarget(cls: ClassDetail): {
  dialect: "ampl" | "gams" | "cplex-lp";
  action: "ampl_solve" | "gams_solve" | "cplex_lp_solve";
  ext: string;
  isNl: boolean;
} {
  const kind = (cls.classKind || "").toLowerCase();
  const src = (cls.sourceFile || "").toLowerCase();
  if (kind === "gams_model" || src.endsWith(".gms")) {
    return { dialect: "gams", action: "gams_solve", ext: "gms", isNl: false };
  }
  if (kind === "cplex_lp" || src.endsWith(".lp")) {
    return { dialect: "cplex-lp", action: "cplex_lp_solve", ext: "lp", isNl: false };
  }
  return {
    dialect: "ampl",
    action: "ampl_solve",
    ext: kind === "nl_problem" || src.endsWith(".nl") ? "nl" : "mod",
    isNl: kind === "nl_problem" || src.endsWith(".nl"),
  };
}

export const ClassOptimizationTab: React.FC<ClassOptimizationTabProps> = ({ libraryName, version, className, cls }) => {
  const target = useMemo(() => detectOptimizationTarget(cls), [cls]);

  const [solver, setSolver] = useState<OptimizationSolverOption>("auto");
  const [presolve, setPresolve] = useState<boolean>(true);
  const [tolerance, setTolerance] = useState<number>(1e-6);
  const [maxIterations, setMaxIterations] = useState<number>(5000);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SolveOutput | null>(null);
  const [filterText, setFilterText] = useState("");

  const handleSolve = async () => {
    const sourceText = cls.sourceCode || "";
    if (!sourceText.trim()) {
      setError("No source code is available for this model.");
      return;
    }
    if (target.isNl) {
      setError(
        "Direct browser solving of standalone .nl files is not yet wired in the web worker; open the .mod, .gms, or .lp variant of this MINLPLib model.",
      );
      return;
    }

    setRunning(true);
    setError(null);
    try {
      const uri = `inmemory://ansatz/${libraryName}/${version}/${className}.${target.ext}`;
      const res = (await executeLspAction(target.action, target.dialect, uri, {
        documentText: sourceText,
        options: {
          solver,
          presolve,
          tolerance,
          maxIterations,
        },
      })) as SolveOutput | null;

      if (!res) {
        throw new Error("Optimization worker returned no result.");
      }
      if (res.error) {
        throw new Error(res.error);
      }
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  const varRows = useMemo(() => {
    if (!result) return [];
    const entries = Object.entries(result.variables ?? {});
    const q = filterText.trim().toLowerCase();
    return q ? entries.filter(([k]) => k.toLowerCase().includes(q)) : entries;
  }, [result, filterText]);

  return (
    <Container>
      <ControlsCard>
        <FieldGroup>
          <span>Solver / Algorithm (WASM, Pure-JS &amp; Metaheuristics)</span>
          <SelectInput
            value={solver}
            onChange={(e) => setSolver(e.target.value as OptimizationSolverOption)}
            aria-label="Optimization solver"
          >
            <option value="auto">Auto (Best WASM / Pure-JS)</option>
            <optgroup label="WASM / COIN-OR &amp; HiGHS">
              <option value="clp">CLP (COIN-OR LP)</option>
              <option value="cbc">CBC (COIN-OR MILP)</option>
              <option value="ipopt">IPOPT (COIN-OR NLP)</option>
              <option value="bonmin">Bonmin (MINLP)</option>
              <option value="couenne">Couenne (Global MINLP)</option>
              <option value="highs">HiGHS (LP / MILP)</option>
            </optgroup>
            <optgroup label="Pure-JS / Gradient">
              <option value="lbfgsb">L-BFGS-B (Quasi-Newton NLP)</option>
              <option value="pure-js">Pure-JS (Simplex / B&amp;B)</option>
            </optgroup>
            <optgroup label="Metaheuristics">
              <option value="de">Differential Evolution (Global)</option>
              <option value="cma-es">CMA-ES (Evolutionary)</option>
              <option value="pso">Particle Swarm (PSO)</option>
            </optgroup>
          </SelectInput>
        </FieldGroup>

        <FieldGroup>
          <span>Tolerance</span>
          <NumberInput
            type="number"
            step="1e-7"
            min="1e-12"
            value={tolerance}
            onChange={(e) => setTolerance(Number(e.target.value) || 1e-6)}
          />
        </FieldGroup>

        <FieldGroup>
          <span>Max Iterations</span>
          <NumberInput
            type="number"
            step="500"
            min="10"
            value={maxIterations}
            onChange={(e) => setMaxIterations(Math.max(10, Number(e.target.value) || 5000))}
          />
        </FieldGroup>

        <FieldGroup style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingBottom: 6, cursor: "pointer" }}>
          <input type="checkbox" checked={presolve} onChange={(e) => setPresolve(e.target.checked)} />
          <span>Presolve</span>
        </FieldGroup>

        <Button variant="primary" leadingVisual={PlayIcon} onClick={handleSolve} disabled={running}>
          {running ? "Solving…" : "Solve in Browser"}
        </Button>
      </ControlsCard>

      {error && (
        <ResultCard style={{ borderColor: "var(--color-danger-emphasis, #cf222e)" }}>
          <Text style={{ color: "var(--color-danger-fg, #cf222e)", fontSize: 13 }}>{error}</Text>
        </ResultCard>
      )}

      {!result && !error && (
        <ResultCard style={{ alignItems: "center", textAlign: "center", padding: "36px 20px" }}>
          <PulseIcon size={28} />
          <Heading as="h3" style={{ fontSize: 16, margin: 0 }}>
            Interactive Browser Optimization
          </Heading>
          <Text style={{ color: "var(--color-text-muted)", fontSize: 13, maxWidth: 540 }}>
            Select a WASM, pure-JS, or metaheuristic solver above and click <strong>Solve in Browser</strong> to
            instantiate and solve <code>{className}</code> directly in your browser&apos;s Web Worker.
          </Text>
        </ResultCard>
      )}

      {result && (
        <ResultCard>
          <div
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}
          >
            <Heading as="h3" style={{ fontSize: 15, margin: 0 }}>
              Optimization Solution
            </Heading>
            <Label variant={result.status === "optimal" || result.status === "feasible" ? "success" : "attention"}>
              {result.status}
            </Label>
          </div>

          <KpiGrid>
            <KpiTile>
              <Text style={{ fontSize: 11, color: "var(--color-text-muted)" }}>Objective Value</Text>
              <Text style={{ fontSize: 16, fontWeight: 700, fontFamily: "monospace" }}>
                {result.objectiveValue !== undefined && Number.isFinite(result.objectiveValue)
                  ? result.objectiveValue.toPrecision(8)
                  : "—"}
              </Text>
            </KpiTile>
            <KpiTile>
              <Text style={{ fontSize: 11, color: "var(--color-text-muted)" }}>Solver</Text>
              <Text style={{ fontSize: 14, fontWeight: 600 }}>{result.solverUsed || solver}</Text>
            </KpiTile>
            <KpiTile>
              <Text style={{ fontSize: 11, color: "var(--color-text-muted)" }}>Solve Time</Text>
              <Text style={{ fontSize: 14, fontWeight: 600 }}>
                {result.solveTimeMs !== undefined ? `${result.solveTimeMs} ms` : "—"}
              </Text>
            </KpiTile>
            <KpiTile>
              <Text style={{ fontSize: 11, color: "var(--color-text-muted)" }}>Iterations</Text>
              <Text style={{ fontSize: 14, fontWeight: 600 }}>
                {result.iterations ?? "—"}
                {result.nodesExplored !== undefined ? ` (${result.nodesExplored} nodes)` : ""}
              </Text>
            </KpiTile>
          </KpiGrid>

          {Object.keys(result.variables ?? {}).length > 0 && (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <Text style={{ fontSize: 13, fontWeight: 600 }}>
                  Decision Variables ({varRows.length} / {Object.keys(result.variables ?? {}).length})
                </Text>
                <NumberInput
                  type="text"
                  placeholder="Filter variables…"
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                  style={{ width: 200 }}
                />
              </div>
              <div style={{ maxHeight: 380, overflowY: "auto" }}>
                <Table>
                  <thead>
                    <tr>
                      <th>Variable</th>
                      <th>Primal Value</th>
                      {result.variableSuffixes && <th>Reduced Cost (.rc)</th>}
                      {result.variableSuffixes && <th>Status</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {varRows.slice(0, 250).map(([varName, val]) => {
                      const suf = result.variableSuffixes?.[varName];
                      return (
                        <tr key={varName}>
                          <td>{varName}</td>
                          <td>{Number.isFinite(val) ? val.toPrecision(7) : String(val)}</td>
                          {result.variableSuffixes && <td>{suf?.rc !== undefined ? suf.rc.toPrecision(5) : "—"}</td>}
                          {result.variableSuffixes && <td>{suf?.status ?? "—"}</td>}
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              </div>
            </>
          )}
        </ResultCard>
      )}
    </Container>
  );
};
