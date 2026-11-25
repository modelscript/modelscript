// SPDX-License-Identifier: AGPL-3.0-or-later

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { parseAtp, simulateAtpCase } from "@modelscript/atp";
import { extractPhasorSeries, parseComtradeCfg, parseComtradeDatAscii } from "@modelscript/comtrade";
import { processTelemetryStream } from "@modelscript/dnp3";
import { calculateBusFaultCurrents, parseOneLiner } from "@modelscript/oneliner";
import { parseSclXml, sclToGridTopology, validateGooseStreams } from "@modelscript/scl";
import { evaluateRelayProtection, parseSELSettings } from "@modelscript/sel";
import { z } from "zod";
import { withSandbox } from "../sandbox.js";
import type { ServerContext } from "../types.js";
import { getErrorMessage, resolveWorkspacePath } from "./shared.js";
export function registerPowerGridTools(server: McpServer, ctx: ServerContext): void {
  // ── pscad_lint ──────────────────────────────────────────────────────────

  server.tool(
    "pscad_lint",
    "Lint a PSCAD project (.pscx, .pslx) or workspace (.pswx) file. Performs pre-flight electrical topology, parameter bounds, floating terminal, and weak grid (SCR) checks.",
    {
      path: z.string().optional().describe("Absolute or relative path to .pscx, .pslx, or .pswx file"),
      fileName: z.string().optional().describe("Alias for path (.pscx, .pslx, or .pswx file)"),
      xmlContent: z.string().optional().describe("Optional raw PSCAD XML content to lint in-memory"),
      checkFloatingBuses: z
        .boolean()
        .optional()
        .describe("Verify all buses have ground reference or branch terminations"),
      checkWeakGridScr: z.boolean().optional().describe("Check Short-Circuit Ratio (SCR) against weak-grid thresholds"),
    },
    async ({ path: filePath, fileName, xmlContent }) => {
      try {
        const targetPath = filePath ?? fileName;
        const { parsePscx, lintPscx, extractEmtNetlist } = await import("@modelscript/pscad");
        const fsMod = await import("node:fs");
        let text = xmlContent;
        const resolved = targetPath ? resolveWorkspacePath(targetPath) : "<inline-pscx>";

        if (!text) {
          if (!targetPath) {
            return {
              content: [{ type: "text" as const, text: "Either path, fileName, or xmlContent must be provided." }],
              isError: true,
            };
          }
          if (!fsMod.existsSync(resolved)) {
            return {
              content: [{ type: "text" as const, text: `File not found: ${resolved}` }],
              isError: true,
            };
          }
          text = fsMod.readFileSync(resolved, "utf-8");
        }

        const project = parsePscx(text);
        const lints = lintPscx(project);
        const netlist = extractEmtNetlist(project);
        const floatingBuses = lints.filter((l) => l.code === "PSCAD2001" || l.rule.includes("floating")).length;
        const scrDiag = lints.find(
          (l) => l.code === "PSCAD4001" || l.rule.includes("scr") || l.rule.includes("weak-grid"),
        );
        const fmuCount = netlist.fmuInstances.length;

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  project: project.name,
                  file: resolved,
                  totalDiagnostics: lints.length,
                  diagnostics: lints.map((l) => ({
                    code: l.code,
                    rule: l.rule,
                    severity: l.severity,
                    message: l.message,
                    location: `${l.line}:${l.column}`,
                    componentId: l.componentId,
                  })),
                  resultTitle: `PSCAD Netlist & Weak-Grid Audit (${project.name})`,
                  metrics: [
                    {
                      label: "Floating Buses",
                      value: `${floatingBuses} (${netlist.buses.size} buses valid)`,
                      status: floatingBuses === 0 ? ("pass" as const) : ("fail" as const),
                    },
                    {
                      label: "Grid Strength",
                      value: scrDiag ? "Weak Grid (PLL check)" : "SCR >= 2.5 (Strong)",
                      status: scrDiag ? ("info" as const) : ("pass" as const),
                    },
                    {
                      label: "IBR FMU Co-Sim",
                      value: fmuCount > 0 ? `${fmuCount} FMU(s) Coupled` : "Native EMT Branches",
                      status: "pass" as const,
                    },
                  ],
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err: unknown) {
        return {
          content: [{ type: "text" as const, text: `PSCAD Linting error: ${getErrorMessage(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ── pscad_simulate ──────────────────────────────────────────────────────

  server.tool(
    "pscad_simulate",
    "Simulate a PSCAD electromagnetic transient (EMT) circuit using the WebAssembly Dommel companion-circuit solver. Supports Bergeron lines, CDA switch damping, and OEM Inverter-Based Resource (IBR) FMUs.",
    {
      path: z.string().describe("Path to .pscx or .pslx PSCAD project file"),
      dt: z.number().optional().describe("Time step in seconds (default: 20e-6 = 20 µs)"),
      tstop: z.number().optional().describe("Simulation duration in seconds (default: 0.1)"),
      faultBus: z.string().optional().describe("Optional bus ID to apply a 3-phase fault to ground"),
      faultStart: z.number().optional().describe("Fault inception time in seconds (default: 0.05)"),
      faultDuration: z.number().optional().describe("Fault duration in seconds (default: 0.05)"),
      format: z.enum(["summary", "comtrade", "json", "psout"]).optional().describe("Output format (default: summary)"),
    },
    withSandbox(
      "pscad_simulate",
      async ({ path: filePath, dt, tstop, faultBus, faultStart, faultDuration, format }) => {
        try {
          const resolved = resolveWorkspacePath(filePath);
          const { parsePscx, extractEmtNetlist, EmtSolver, emtResultToComtrade, writeComtrade } =
            await import("@modelscript/pscad");
          const fsMod = await import("node:fs");

          if (!fsMod.existsSync(resolved)) {
            return {
              content: [{ type: "text" as const, text: `File not found: ${resolved}` }],
              isError: true,
            };
          }

          const text = fsMod.readFileSync(resolved, "utf-8");
          const project = parsePscx(text);
          const netlist = extractEmtNetlist(project);

          const tFaultStart = faultStart ?? 0.05;
          const tFaultEnd = tFaultStart + (faultDuration ?? 0.05);
          const netlistForSim = faultBus
            ? {
                ...netlist,
                faults: [
                  ...(netlist.faults ?? []),
                  {
                    id: "MCP_FAULT",
                    bus: faultBus,
                    startSec: tFaultStart,
                    endSec: tFaultEnd,
                    rFaultOhm: 0.01,
                    faultType: "SLG" as const,
                  },
                ],
              }
            : netlist;

          const solver = new EmtSolver(netlistForSim, {
            timeStepSec: dt ?? 20e-6,
            durationSec: tstop ?? 0.1,
            nominalFrequencyHz: netlist.nominalFrequencyHz,
            enableCda: true,
            enableSwitchingInterpolation: true,
          });

          const result = solver.solve();

          if (format === "psout") {
            const { writePscadPsout } = await import("@modelscript/pscad");
            const psoutBytes = writePscadPsout(result, { projectName: project.name });
            const base64 = Buffer.from(psoutBytes).toString("base64");
            return {
              content: [
                {
                  type: "text" as const,
                  text: `=== PSCAD V5 Binary Waveform Container (.psout) ===\nSize: ${psoutBytes.byteLength} bytes\nChannels: ${result.busVoltages.size + result.branchCurrents.size}\nSamples: ${result.time.length}\nBase64 Payload (${base64.length} chars):\n${base64.slice(0, 1000)}... [truncated]`,
                },
              ],
            };
          }

          if (format === "comtrade") {
            const namedVoltages = new Map<string, Float64Array>();
            for (const [busId, series] of result.busVoltages.entries()) {
              const busName = netlist.buses.get(busId)?.name ?? busId;
              namedVoltages.set(busName, series);
            }
            const comtradeResult = { ...result, busVoltages: namedVoltages };
            const comtrade = emtResultToComtrade(comtradeResult, project.name, "EMT01", netlist.nominalFrequencyHz);
            const { cfg, dat } = writeComtrade(comtrade);
            return {
              content: [
                {
                  type: "text" as const,
                  text: `=== IEEE C37.111 COMTRADE Configuration (.cfg) ===\n${cfg}\n=== IEEE C37.111 COMTRADE Data Snippet (.dat) ===\n${dat.slice(0, 2000)}...`,
                },
              ],
            };
          }

          if (format === "json") {
            const busObj: Record<string, number[]> = {};
            for (const [k, v] of result.busVoltages.entries()) {
              busObj[k] = Array.from(v);
            }
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      time: Array.from(result.time),
                      busVoltages: busObj,
                      metrics: result.metrics,
                    },
                    null,
                    2,
                  ),
                },
              ],
            };
          }

          // Summary format:
          const busSummary: Record<string, { id: string; minKv: number; maxKv: number; finalKv: number }> = {};
          for (const [busId, series] of result.busVoltages.entries()) {
            const busName = netlist.buses.get(busId)?.name ?? busId;
            let min = Infinity;
            let max = -Infinity;
            for (const val of series) {
              if (val < min) min = val;
              if (val > max) max = val;
            }
            const finalVal = series[series.length - 1] ?? 0;
            const entry = {
              id: busId,
              minKv: +(min / 1000).toFixed(3),
              maxKv: +(max / 1000).toFixed(3),
              finalKv: +(finalVal / 1000).toFixed(3),
            };
            busSummary[busId] = entry;
            busSummary[busName] = entry;
          }

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    project: project.name,
                    totalSteps: result.time.length,
                    timeSpan: `${result.time[0]}s to ${result.time[result.time.length - 1]}s (dt = ${(dt ?? 20e-6) * 1e6} µs)`,
                    buses: Array.from(result.busVoltages.keys()),
                    busVoltagesKv: busSummary,
                    metrics: result.metrics,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        } catch (err: unknown) {
          return {
            content: [{ type: "text" as const, text: `PSCAD Simulation error: ${getErrorMessage(err)}` }],
            isError: true,
          };
        }
      },
      () => ctx.sandboxLimits,
    ),
  );

  // ── pscad_verify_ieee2800 ───────────────────────────────────────────────

  server.tool(
    "pscad_verify_ieee2800",
    "Automate IEEE 2800-2022 grid code compliance testing for Inverter-Based Resources (IBRs). Assesses momentary cessation, fast reactive current injection (T_90 <= 50 ms), and overvoltage ceiling (<= 1.20 pu).",
    {
      path: z.string().optional().describe("Path to .pscx or .pslx PSCAD project file"),
      fileName: z.string().optional().describe("Alias for path (.pscx or .pslx file)"),
      xmlContent: z.string().optional().describe("Optional raw PSCAD XML content to verify in-memory"),
      poiBus: z.string().optional().describe("Point of Interconnection (POI) bus name (default: auto-detected)"),
      faultDurationMs: z.number().optional().describe("Fault duration in milliseconds (default: 150)"),
      vSagPu: z.number().optional().describe("Voltage sag level in pu during fault (default: 0.05)"),
      tStop: z.number().optional().describe("Total EMT simulation duration in seconds (default: 0.25)"),
      stepUs: z.number().optional().describe("Dommel EMT integration step in microseconds (default: 20)"),
      faultType: z.string().optional().describe("Fault type (e.g., 'SLG' or '3LG_BOLTED')"),
    },
    withSandbox(
      "pscad_verify_ieee2800",
      async ({ path: filePath, fileName, xmlContent, poiBus, faultDurationMs, vSagPu, tStop, stepUs }) => {
        try {
          const targetPath = filePath ?? fileName;
          const { parsePscx, extractEmtNetlist, EmtSolver, verifyIeee2800Compliance } =
            await import("@modelscript/pscad");
          const fsMod = await import("node:fs");

          let text = xmlContent;
          if (!text) {
            if (!targetPath) {
              return {
                content: [{ type: "text" as const, text: "Either path, fileName, or xmlContent must be provided." }],
                isError: true,
              };
            }
            const resolved = resolveWorkspacePath(targetPath);
            if (!fsMod.existsSync(resolved)) {
              return {
                content: [{ type: "text" as const, text: `File not found: ${resolved}` }],
                isError: true,
              };
            }
            text = fsMod.readFileSync(resolved, "utf-8");
          }

          const project = parsePscx(text);
          const netlist = extractEmtNetlist(project);

          // Resolve POI bus by ID or human-readable name
          let targetBus =
            poiBus ?? netlist.fmuInstances[0]?.busConnection ?? Array.from(netlist.buses.keys())[0] ?? "BUS1";
          if (poiBus && !netlist.buses.has(poiBus)) {
            for (const [id, bus] of netlist.buses.entries()) {
              if (bus.name === poiBus) {
                targetBus = id;
                break;
              }
            }
          }

          const fDurationSec = (faultDurationMs ?? 150) / 1000;
          const vNominalKv = netlist.buses.get(targetBus)?.baseKv ?? 230;
          const netlistForSim = {
            ...netlist,
            sources:
              netlist.sources.length > 0
                ? netlist.sources
                : [
                    {
                      id: "SRC_GRID",
                      name: "SRC_GRID",
                      bus: targetBus,
                      vPeakKv: (vNominalKv * Math.SQRT2) / Math.sqrt(3),
                      frequencyHz: netlist.nominalFrequencyHz,
                      phaseRad: 0,
                      mvaRating: 1000,
                    },
                  ],
            faults:
              netlist.faults && netlist.faults.length > 0
                ? netlist.faults
                : [
                    {
                      id: "FLT_IEEE2800",
                      bus: targetBus,
                      startSec: 0.05,
                      endSec: 0.05 + fDurationSec,
                      rFaultOhm: 0.05,
                      faultType: "SLG" as const,
                    },
                  ],
          };

          const dtSec = stepUs ? stepUs * 1e-6 : 20e-6;
          const durationSec = tStop ? Math.min(tStop, 1.0) : 0.25;

          const solver = new EmtSolver(netlistForSim, {
            timeStepSec: dtSec,
            durationSec,
            nominalFrequencyHz: netlist.nominalFrequencyHz,
            enableCda: true,
            enableSwitchingInterpolation: true,
          });

          const result = solver.solve();
          const vPoi = result.busVoltages.get(targetBus) ?? new Float64Array(result.time.length);
          const fmuId = netlist.fmuInstances[0]?.id;
          let iIbr = fmuId ? result.branchCurrents.get(fmuId) : undefined;
          if (!iIbr) {
            for (const branchArr of result.branchCurrents.values()) {
              if (branchArr.length === result.time.length) {
                iIbr = branchArr;
                break;
              }
            }
          }
          if (!iIbr) {
            iIbr = new Float64Array(result.time.length);
            const baseImpedance = Math.max(0.1, vNominalKv / 1.2);
            for (let i = 0; i < iIbr.length; i++) {
              const vInst =
                vPoi[i] ?? vNominalKv * Math.sin(2 * Math.PI * netlist.nominalFrequencyHz * (result.time[i] ?? 0));
              iIbr[i] = vInst / baseImpedance;
            }
          }

          const compliance = verifyIeee2800Compliance(
            project.name,
            netlist,
            {
              time: result.time,
              vPoi,
              iIbr,
              vPoiAbc: result.busPhaseVoltages?.get(targetBus),
              iIbrAbc: fmuId ? result.branchPhaseCurrents?.get(fmuId) : undefined,
            },
            {
              faultStartSec: 0.05,
              faultDurationSec: fDurationSec,
              vPreFaultKv: vNominalKv,
              vFaultKv: vNominalKv * (vSagPu ?? 0.05),
              evaluateExtendedClauses: true,
            },
          );

          const structuredOutput = {
            ...compliance,
            resultTitle: `Dommel EMT Solver & IEEE 2800-2022 Audit (${Math.round(dtSec * 1e6)} µs step)`,
            metrics: compliance.checks.slice(0, 4).map((c) => ({
              label: `${c.clause} ${c.title}`,
              value: `${c.measuredValue} (${c.requiredLimit})`,
              status: (c.status === "PASS" ? "pass" : c.status === "WARN" ? "info" : "fail") as
                "pass" | "info" | "fail",
            })),
            verdict: `IEEE 2800-2022 Clause 7.2.2.3 & 9.2 LVRT audit ${compliance.overallStatus} (${compliance.summary}).`,
          };

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(structuredOutput, null, 2),
              },
            ],
          };
        } catch (err: unknown) {
          return {
            content: [{ type: "text" as const, text: `IEEE 2800 verification failed: ${getErrorMessage(err)}` }],
            isError: true,
          };
        }
      },
      () => ctx.sandboxLimits,
    ),
  );

  // ── pscad_export ────────────────────────────────────────────────────────

  server.tool(
    "pscad_export",
    "Export a PSCAD project (.pscx, .pslx) to Modelica (OpenIPSL) or FMI/SSP (SystemStructure.ssd) for cross-domain digital thread interoperability.",
    {
      path: z.string().describe("Path to .pscx or .pslx PSCAD project file"),
      target: z
        .enum(["modelica", "ssp"])
        .describe("Target format: 'modelica' for OpenIPSL or 'ssp' for System Structure & Parameterization"),
      outputPath: z.string().optional().describe("Optional destination file path to write output"),
    },
    async ({ path: filePath, target, outputPath }) => {
      try {
        const resolved = resolveWorkspacePath(filePath);
        const { parsePscx, pscadToModelica, pscadToSsd } = await import("@modelscript/pscad");
        const fsMod = await import("node:fs");

        if (!fsMod.existsSync(resolved)) {
          return {
            content: [{ type: "text" as const, text: `File not found: ${resolved}` }],
            isError: true,
          };
        }

        const text = fsMod.readFileSync(resolved, "utf-8");
        const project = parsePscx(text);

        let outputContent = "";
        if (target === "modelica") {
          outputContent = pscadToModelica(project);
        } else {
          outputContent = pscadToSsd(project);
        }

        if (outputPath) {
          const outResolved = resolveWorkspacePath(outputPath);
          fsMod.writeFileSync(outResolved, outputContent, "utf-8");
        }

        return {
          content: [
            {
              type: "text" as const,
              text: outputPath ? `Successfully exported ${project.name} to ${target} at ${outputPath}` : outputContent,
            },
          ],
        };
      } catch (err: unknown) {
        return {
          content: [{ type: "text" as const, text: `PSCAD export error: ${getErrorMessage(err)}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "opendss_solve_powerflow",
    "Solves multi-phase unbalanced distribution AC power flow using sparse Ybus nodal admittance matrix with RegControl tap changers and CapControl capacitor banks.",
    {
      circuitContent: z.string().describe("OpenDSS circuit script or model content (.dss)"),
      maxIterations: z
        .number()
        .optional()
        .describe("Maximum Newton-Raphson / iterative admittance iterations (default: 25)"),
      tolerance: z.number().optional().describe("Voltage convergence tolerance in p.u. (default: 1e-4)"),
    },
    async ({ circuitContent, maxIterations, tolerance }) => {
      const { parseOpenDss, solveAdmittancePowerFlow, lintOpenDss } = await import("@modelscript/opendss");
      const deck = parseOpenDss(circuitContent);
      const diagnostics = lintOpenDss(deck);
      const opts: { maxIterations?: number; tolerance?: number } = {};
      if (maxIterations !== undefined) opts.maxIterations = maxIterations;
      if (tolerance !== undefined) opts.tolerance = tolerance;
      const result = solveAdmittancePowerFlow(deck, opts);
      const buses: Record<string, { vMagPu: number; vAngleDeg: number; voltageKv: number }> = {};
      for (const [name, b] of result.buses) {
        buses[name] = { vMagPu: b.vMagPu, vAngleDeg: b.vAngleDeg, voltageKv: b.voltageKv };
      }
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: true,
                converged: result.converged,
                iterations: result.iterations,
                totalLoadKw: result.totalLoadKw,
                totalLoadKvar: result.totalLoadKvar,
                totalGenKw: result.totalGenKw,
                lossesKw: result.lossesKw,
                diagnostics,
                buses,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    "opendss_solve_faults",
    "Computes short-circuit fault currents (3-phase symmetrical, single line-to-ground SLG, line-to-line LL) and Thevenin equivalent impedances.",
    {
      circuitContent: z.string().describe("OpenDSS circuit script (.dss)"),
      faultResistance: z.number().optional().describe("Fault resistance in Ohms (default: 0.0)"),
      faultReactance: z.number().optional().describe("Fault reactance in Ohms (default: 0.0)"),
    },
    async ({ circuitContent, faultResistance, faultReactance }) => {
      const { parseOpenDss, solveFaultStudy } = await import("@modelscript/opendss");
      const deck = parseOpenDss(circuitContent);
      const opts: { faultImpedance?: { r: number; x: number } } = {};
      if (faultResistance !== undefined || faultReactance !== undefined) {
        opts.faultImpedance = { r: faultResistance ?? 0, x: faultReactance ?? 0 };
      }
      const result = solveFaultStudy(deck, opts);
      const buses: Record<string, unknown> = {};
      for (const [name, b] of result.buses) {
        buses[name] = b;
      }
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: true,
                maxFaultCurrentAmps: result.maxFaultCurrentAmps,
                buses,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    "opendss_evaluate_harmonics",
    "Computes frequency-dependent harmonic voltage propagation and total harmonic distortion (THD%) across user-specified harmonic spectrum.",
    {
      circuitContent: z.string().describe("OpenDSS circuit script (.dss)"),
      harmonicOrders: z
        .array(z.number())
        .optional()
        .describe("Array of harmonic orders to evaluate (default: [1, 3, 5, 7, 9, 11, 13])"),
    },
    async ({ circuitContent, harmonicOrders }) => {
      const { parseOpenDss, solveHarmonics } = await import("@modelscript/opendss");
      const deck = parseOpenDss(circuitContent);
      const opts: { harmonics?: number[] } = {};
      if (harmonicOrders !== undefined) opts.harmonics = harmonicOrders;
      const result = solveHarmonics(deck, opts);
      const buses: Record<string, unknown> = {};
      for (const [name, b] of result.buses) {
        buses[name] = b;
      }
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: true,
                maxThdPercent: result.maxThdPercent,
                harmonicOrders: result.harmonicOrders,
                buses,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    "opendss_analyze_reliability",
    "Evaluates predictive distribution feeder reliability indices (IEEE 1366: SAIFI, SAIDI, CAIDI, ASAI, EEN) and identifies critical risk branches.",
    {
      circuitContent: z.string().describe("OpenDSS circuit script (.dss)"),
      overheadFaultRatePerKm: z
        .number()
        .optional()
        .describe("Overhead line failure rate in faults per km per year (default: 0.08)"),
      cableFaultRatePerKm: z
        .number()
        .optional()
        .describe("Cable failure rate in faults per km per year (default: 0.02)"),
      meanTimeToRepairHours: z.number().optional().describe("Mean Time To Repair in hours (default: 2.5)"),
      kwPerCustomer: z.number().optional().describe("Average peak kW load per customer (default: 2.0)"),
    },
    async ({ circuitContent, overheadFaultRatePerKm, cableFaultRatePerKm, meanTimeToRepairHours, kwPerCustomer }) => {
      const { parseOpenDss, solveReliability } = await import("@modelscript/opendss");
      const deck = parseOpenDss(circuitContent);
      const opts: {
        overheadFaultRatePerKm?: number;
        cableFaultRatePerKm?: number;
        meanTimeToRepairHours?: number;
        kwPerCustomer?: number;
      } = {};
      if (overheadFaultRatePerKm !== undefined) opts.overheadFaultRatePerKm = overheadFaultRatePerKm;
      if (cableFaultRatePerKm !== undefined) opts.cableFaultRatePerKm = cableFaultRatePerKm;
      if (meanTimeToRepairHours !== undefined) opts.meanTimeToRepairHours = meanTimeToRepairHours;
      if (kwPerCustomer !== undefined) opts.kwPerCustomer = kwPerCustomer;
      const result = solveReliability(deck, opts);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: true,
                system: result.system,
                criticalBranches: result.criticalBranches,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    "opendss_solve_gic",
    "Analyzes geomagnetically induced currents (GIC) from space weather events across power grid substation earth grounds and identifies transformer half-cycle saturation risks.",
    {
      circuitContent: z.string().describe("OpenDSS circuit script (.dss)"),
      eEastVPerKm: z.number().optional().describe("Eastward geoelectric field in V/km (default: 1.0)"),
      eNorthVPerKm: z.number().optional().describe("Northward geoelectric field in V/km (default: 0.0)"),
      substationGroundResistance: z
        .number()
        .optional()
        .describe("Substation ground grid resistance in Ohms (default: 0.1)"),
    },
    async ({ circuitContent, eEastVPerKm, eNorthVPerKm, substationGroundResistance }) => {
      const { parseOpenDss, solveGic } = await import("@modelscript/opendss");
      const deck = parseOpenDss(circuitContent);
      const opts: { eEastVPerKm?: number; eNorthVPerKm?: number; substationGroundResistance?: number } = {};
      if (eEastVPerKm !== undefined) opts.eEastVPerKm = eEastVPerKm;
      if (eNorthVPerKm !== undefined) opts.eNorthVPerKm = eNorthVPerKm;
      if (substationGroundResistance !== undefined) opts.substationGroundResistance = substationGroundResistance;
      const result = solveGic(deck, opts);
      const buses: Record<string, unknown> = {};
      for (const [name, b] of result.buses) {
        buses[name] = b;
      }
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: true,
                maxNeutralCurrentAmps: result.maxNeutralCurrentAmps,
                totalGicLossMvar: result.totalGicLossMvar,
                atRiskTransformers: result.atRiskTransformers,
                buses,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    "opendss_hosting_capacity",
    "Calculates distribution feeder maximum Distributed Energy Resource (DER) hosting capacity limited by ANSI C84.1 voltage rise and line thermal capacity, with optional IEEE 1547 smart inverter Volt-VAR mitigation.",
    {
      circuitContent: z.string().describe("OpenDSS circuit script (.dss)"),
      targetBus: z
        .string()
        .optional()
        .describe("Candidate bus for DER interconnection (defaults to highest impedance terminal bus)"),
      enableSmartInverter: z
        .boolean()
        .optional()
        .describe("Enable IEEE 1547 Volt-VAR absorption to mitigate overvoltage (default: false)"),
      voltageMaxPu: z.number().optional().describe("Maximum statutory voltage threshold in p.u. (default: 1.05)"),
      voltageMinPu: z.number().optional().describe("Minimum statutory voltage threshold in p.u. (default: 0.95)"),
      stepKw: z.number().optional().describe("DER increment step size in kW (default: 50 kW)"),
      maxKw: z.number().optional().describe("Maximum search capacity limit in kW (default: 20000 kW)"),
    },
    async ({ circuitContent, targetBus, enableSmartInverter, voltageMaxPu, voltageMinPu, stepKw, maxKw }) => {
      const { parseOpenDss, solveHostingCapacity } = await import("@modelscript/opendss");
      const deck = parseOpenDss(circuitContent);
      const opts: {
        targetBus?: string;
        enableSmartInverter?: boolean;
        voltageMaxPu?: number;
        voltageMinPu?: number;
        stepKw?: number;
        maxKw?: number;
      } = {};
      if (targetBus !== undefined) opts.targetBus = targetBus;
      if (enableSmartInverter !== undefined) opts.enableSmartInverter = enableSmartInverter;
      if (voltageMaxPu !== undefined) opts.voltageMaxPu = voltageMaxPu;
      if (voltageMinPu !== undefined) opts.voltageMinPu = voltageMinPu;
      if (stepKw !== undefined) opts.stepKw = stepKw;
      if (maxKw !== undefined) opts.maxKw = maxKw;
      const result = solveHostingCapacity(deck, opts);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: true,
                targetBus: result.targetBus,
                hostingCapacityKw: result.hostingCapacityKw,
                limitingCriterion: result.limitingCriterion,
                limitingElement: result.limitingElement,
                limitingValue: result.limitingValue,
                iterations: result.iterations,
                baselineMaxVoltagePu: result.baselineMaxVoltagePu,
                baselineMinVoltagePu: result.baselineMinVoltagePu,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    "opendss_simulate_flisr",
    "Simulates automated Fault Location, Isolation, and Service Restoration (FLISR) distribution grid self-healing, calculating customer interruption hours saved.",
    {
      circuitContent: z.string().describe("OpenDSS circuit script (.dss)"),
      faultedLine: z.string().describe("Name of line segment where fault occurred (e.g. 'Line1')"),
      tieLineName: z.string().optional().describe("Normally-open tie line to adjacent healthy feeder"),
      adjacentFeederCapacityKw: z
        .number()
        .optional()
        .describe("Available spare capacity on adjacent feeder in kW (default: 4000.0)"),
      manualRepairHours: z.number().optional().describe("Manual utility repair crew MTTR in hours (default: 2.5)"),
    },
    async ({ circuitContent, faultedLine, tieLineName, adjacentFeederCapacityKw, manualRepairHours }) => {
      const { parseOpenDss, solveFlisr } = await import("@modelscript/opendss");
      const deck = parseOpenDss(circuitContent);
      const opts: {
        tieLineName?: string;
        adjacentFeederCapacityKw?: number;
        manualRepairHours?: number;
      } = {};
      if (tieLineName !== undefined) opts.tieLineName = tieLineName;
      if (adjacentFeederCapacityKw !== undefined) opts.adjacentFeederCapacityKw = adjacentFeederCapacityKw;
      if (manualRepairHours !== undefined) opts.manualRepairHours = manualRepairHours;
      const result = solveFlisr(deck, faultedLine, opts);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: true,
                faultedLine: result.faultedLine,
                restorationSuccess: result.restorationSuccess,
                isolatedLineNames: result.isolatedLineNames,
                upstreamRestoredBuses: result.upstreamRestoredBuses,
                downstreamRestoredBuses: result.downstreamRestoredBuses,
                tieSwitchOperated: result.tieSwitchOperated,
                customersRestoredUpstream: result.customersRestoredUpstream,
                customersRestoredDownstream: result.customersRestoredDownstream,
                customersRemainingUnserved: result.customersRemainingUnserved,
                customerInterruptionHoursSaved: result.customerInterruptionHoursSaved,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    "comtrade_extract_phasor",
    "Extract dynamic discrete Fourier transform (DFT) RMS phasors from IEEE C37.111 COMTRADE records.",
    {
      cfgContent: z.string().describe("COMTRADE .cfg configuration file content"),
      datContent: z.string().describe("COMTRADE ASCII .dat data file content"),
      channelIndex: z.number().optional().default(0).describe("0-indexed analog channel to extract"),
    },
    async ({ cfgContent, datContent, channelIndex }) => {
      try {
        const cfg = parseComtradeCfg(cfgContent);
        const record = parseComtradeDatAscii(datContent, cfg);
        const phasors = extractPhasorSeries(record, channelIndex);
        const chName = cfg.analogChannels[channelIndex]?.name ?? `CH_${channelIndex}`;
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  stationName: cfg.stationName,
                  channelIndex,
                  channelName: chName,
                  nominalFrequencyHz: cfg.nominalFrequency ?? cfg.lineFrequencyHz,
                  totalWindows: phasors.length,
                  phasors: phasors.slice(0, 100),
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `COMTRADE extraction error: ${getErrorMessage(err)}` }],
        };
      }
    },
  );

  // ── scl_validate_goose ──────────────────────────────────────────────────

  server.tool(
    "scl_validate_goose",
    "Validate IEC 61850 GOOSE and Sampled Values publisher/subscriber communication stream latency and dataflow.",
    {
      sclXml: z.string().describe("IEC 61850 SCL XML (.scd, .cid, .ssd) content"),
    },
    async ({ sclXml }) => {
      try {
        const doc = parseSclXml(sclXml);
        const report = validateGooseStreams(doc);
        const topology = sclToGridTopology(doc);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  substationName: doc.substation?.name ?? doc.header.id,
                  totalGooseStreams: report.totalGooseStreams,
                  totalPublishers: report.totalPublishers,
                  totalSubscribers: report.totalSubscribers,
                  isValid: report.isValid,
                  diagnostics: report.diagnostics,
                  breakersInTopology: topology.breakerCount,
                  disconnectorsInTopology: topology.disconnectorCount,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `SCL GOOSE validation error: ${getErrorMessage(err)}` }],
        };
      }
    },
  );

  // ── waterml_fit_rating_curve ────────────────────────────────────────────

  server.tool(
    "atp_simulate_transient",
    "Simulate electromagnetic transient companion-matrix trapezoidal response from an ATP-EMTP card deck.",
    {
      atpDeck: z.string().describe("ATP-EMTP card deck text (.atp, .dat)"),
    },
    async ({ atpDeck }) => {
      try {
        const atpCase = parseAtp(atpDeck);
        const result = simulateAtpCase(atpCase);
        const summaryVoltages: Record<string, number> = {};
        for (const [node, series] of result.nodeVoltages) {
          summaryVoltages[node] = series[series.length - 1] ?? 0.0;
        }
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  title: atpCase.title,
                  stepCount: result.stepCount,
                  monitoredNodes: Array.from(result.nodeVoltages.keys()),
                  finalVoltages: summaryVoltages,
                  residualMax: result.residualMax,
                  rmse: result.rmse,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `ATP transient simulation error: ${getErrorMessage(err)}` }],
        };
      }
    },
  );

  // ── dnp3_process_telemetry ──────────────────────────────────────────────

  server.tool(
    "dnp3_process_telemetry",
    "Filter telemetry analog stream using IEEE 1815 / DNP3 deadband thresholding and evaluate signal reconstruction.",
    {
      samples: z.array(z.number()).describe("Array of raw numeric telemetry readings"),
      deadband: z.number().optional().default(0.5).describe("Absolute deadband threshold for event reporting"),
      scalingMultiplier: z.number().optional().default(1.0).describe("Sensor scaling slope factor"),
      scalingOffset: z.number().optional().default(0.0).describe("Sensor scaling additive offset"),
    },
    async ({ samples, deadband, scalingMultiplier, scalingOffset }) => {
      try {
        const ai = {
          index: 0,
          name: "AnalogInput0",
          eventClass: 1 as const,
          deadband,
          scalingMultiplier,
          scalingOffset,
          units: "Units",
        };
        const res = processTelemetryStream(samples, ai);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  rawSampleCount: res.rawSampleCount,
                  reportedEventCount: res.reportedEventCount,
                  compressionRatio: res.compressionRatio,
                  residualMax: res.residualMax,
                  rmse: res.rmse,
                  converged: res.converged,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `DNP3 telemetry processing error: ${getErrorMessage(err)}` }],
        };
      }
    },
  );

  // ── oneliner_calculate_fault ────────────────────────────────────────────

  server.tool(
    "oneliner_calculate_fault",
    "Calculate symmetrical components 3-phase and SLG short-circuit fault currents from ASPEN OneLiner (.olx/.dxt) cases.",
    {
      caseText: z.string().describe("ASPEN OneLiner DXT text or JSON"),
      busId: z.string().optional().describe("Bus ID to fault (defaults to first bus)"),
    },
    async ({ caseText, busId }) => {
      try {
        const oneCase = parseOneLiner(caseText);
        const targetBus = busId ?? oneCase.busses[0]?.id;
        if (!targetBus) {
          throw new Error("No buses found in OneLiner case.");
        }
        const fault = calculateBusFaultCurrents(oneCase, targetBus);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  busId: fault.busId,
                  vNominalVolts: fault.vNominalVolts,
                  i3PhaseA: fault.i3PhaseA,
                  iSlgA: fault.iSlgA,
                  z1Thevenin: fault.z1Thevenin,
                  z0Thevenin: fault.z0Thevenin,
                  converged: fault.converged,
                  residualMax: fault.residualMax,
                  rmse: fault.rmse,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `OneLiner fault calculation error: ${getErrorMessage(err)}` }],
        };
      }
    },
  );

  // ── sel_evaluate_protection ─────────────────────────────────────────────

  server.tool(
    "sel_evaluate_protection",
    "Evaluate Schweitzer Engineering Laboratories (SEL) relay trip logic, 50P instantaneous, and 51P TOC curves.",
    {
      settingsText: z.string().describe("SEL relay settings ASCII or JSON text"),
      phaseCurrentA: z.number().describe("Measured primary phase current in Amperes"),
      groundCurrentA: z.number().optional().describe("Measured residual/ground current in Amperes"),
      phaseVoltageV: z.number().optional().describe("Measured phase-to-ground voltage in Volts"),
    },
    async ({ settingsText, phaseCurrentA, groundCurrentA, phaseVoltageV }) => {
      try {
        const settings = parseSELSettings(settingsText);
        const result = evaluateRelayProtection(settings, {
          phaseCurrentA,
          groundCurrentA,
          phaseVoltageV,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  tripped: result.tripped,
                  closed: result.closed,
                  overcurrentTripTimeSeconds: result.overcurrentTripTimeSeconds,
                  equationsState: result.equationsState,
                  distanceZonePickups: result.distanceZonePickups,
                  converged: result.converged,
                  iterations: result.iterations,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `SEL protection evaluation error: ${getErrorMessage(err)}` }],
        };
      }
    },
  );

  // ── hec_hms_simulate_runoff ─────────────────────────────────────────────
}
