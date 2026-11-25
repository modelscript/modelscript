// SPDX-License-Identifier: AGPL-3.0-or-later

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { computeAsm1ConversionRates, evaluateAsm1ProcessRates, parseAsmPlant } from "@modelscript/asm";
import { renderOlgaElevationProfileSvg, renderOlgaSchematicSvg } from "@modelscript/diagram/olga-diagram-builder";
import { parseHmsBasin, simulateSubbasinRunoff } from "@modelscript/hec-hms";
import {
  calibrateOlgaModel,
  evaluateFlowAssuranceGate,
  importBathymetrySurvey,
  lintOlgaModel,
  loadCheckpoint,
  parseObservationCsv,
  parseOlga,
  parseOlgaPpl,
  parseOlgaTplDataset,
  saveCheckpoint,
  serializeKeyDeck,
  serializeOpi,
  simulateDriftFlux,
  verifyFlowAssuranceLimits,
  type FlowAssuranceLimits,
  type OlgaCheckpointState,
  type TunableParameter,
} from "@modelscript/olga";
import { fitRatingCurve } from "@modelscript/waterml";
import fs from "node:fs";
import { z } from "zod";
import { withSandbox } from "../sandbox.js";
import type { ServerContext } from "../types.js";
import { getErrorMessage, resolveSourceOrWorkspaceFile, resolveWorkspacePath } from "./shared.js";
export function registerFluidsWaterTools(server: McpServer, ctx: ServerContext): void {
  // ── olga_simulate ───────────────────────────────────────────────────────

  server.tool(
    "olga_simulate",
    "Simulate transient multiphase flow, liquid accumulation, pressure drops, slugging, and pigging for an OLGA model (.opi, .key, .genkey).",
    {
      source: z.string().describe("OLGA model source content (.opi XML or .key keyword deck) or file path"),
      durationSeconds: z.number().optional().describe("Simulation duration in seconds [s]"),
      timeStepSeconds: z.number().optional().describe("Simulation time step in seconds [s]"),
      format: z.enum(["json", "csv"]).optional().describe("Output data format (default: json)"),
      restart: z.string().optional().describe("Path to .rst or .json checkpoint file to resume simulation from"),
      checkpointOut: z.string().optional().describe("Path to save final simulation state snapshot (.rst)"),
      checkpointInterval: z.number().optional().describe("Periodic checkpoint snapshot interval in seconds [s]"),
    },
    withSandbox(
      "olga_simulate",
      async ({ source, durationSeconds, timeStepSeconds, format, restart, checkpointOut, checkpointInterval }) => {
        try {
          const content = resolveSourceOrWorkspaceFile(source);
          const model = parseOlga(content);

          const resolvedRestart = restart ? resolveWorkspacePath(restart) : undefined;
          let initialCheckpoint: OlgaCheckpointState | undefined;
          if (resolvedRestart && fs.existsSync(resolvedRestart)) {
            initialCheckpoint = loadCheckpoint(resolvedRestart);
          }

          const resolvedCheckpointOut = checkpointOut ? resolveWorkspacePath(checkpointOut) : undefined;
          let lastCheckpoint: OlgaCheckpointState | undefined;
          const result = simulateDriftFlux(model, {
            durationSeconds: durationSeconds ?? Math.min(model.endTime - model.startTime, 3600),
            timeStepSeconds: timeStepSeconds ?? model.maxDt,
            initialCheckpoint,
            checkpointIntervalSeconds: checkpointInterval,
            onCheckpoint: (cp) => {
              lastCheckpoint = cp;
              if (resolvedCheckpointOut && checkpointInterval) {
                saveCheckpoint(cp, resolvedCheckpointOut);
              }
            },
          });

          if (resolvedCheckpointOut && lastCheckpoint) {
            saveCheckpoint(lastCheckpoint, resolvedCheckpointOut);
          }

          if (format === "csv") {
            const lines = [
              "time,inlet_pressure_bar,arrival_pressure_bar,arrival_temperature_c,arrival_holdup,peak_surge_m3,mean_slug_length_m",
            ];
            for (let i = 0; i < result.times.length; i++) {
              lines.push(
                [
                  (result.times[i] ?? 0).toFixed(1),
                  ((result.trends.inletPressure[i] ?? 0) / 1e5).toFixed(2),
                  ((result.trends.arrivalPressure[i] ?? 0) / 1e5).toFixed(2),
                  ((result.trends.arrivalTemperature[i] ?? 273.15) - 273.15).toFixed(2),
                  (result.trends.arrivalLiquidHoldup[i] ?? 0).toFixed(4),
                  result.trends.peakLiquidSurgeVolume.toFixed(2),
                  (result.trends.meanSlugLength?.[i] ?? 0).toFixed(2),
                ].join(","),
              );
            }
            return { content: [{ type: "text" as const, text: lines.join("\n") }] };
          }

          const lastProfile = result.profiles[result.profiles.length - 1];
          const summary = {
            title: model.title,
            stepsSimulated: result.times.length,
            peakLiquidSurgeVolumeM3: result.trends.peakLiquidSurgeVolume,
            arrivalPressureBar: (result.trends.arrivalPressure[result.trends.arrivalPressure.length - 1] ?? 0) / 1e5,
            arrivalTemperatureC:
              (result.trends.arrivalTemperature[result.trends.arrivalTemperature.length - 1] ?? 273.15) - 273.15,
            meanSlugLengthM: result.trends.meanSlugLength?.[result.trends.meanSlugLength.length - 1] ?? 0,
            slugFrequencyHz: result.trends.slugFrequency?.[result.trends.slugFrequency.length - 1] ?? 0,
            activePigs: lastProfile?.pigs ?? [],
            activeSlugs: lastProfile?.activeSlugs ?? [],
            checkpointSaved: checkpointOut ?? null,
            restartedFrom: restart
              ? { time: initialCheckpoint?.simulatedTime, cells: initialCheckpoint?.gridCells.length }
              : null,
          };

          return { content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }] };
        } catch (err: unknown) {
          return {
            content: [{ type: "text" as const, text: `OLGA simulation error: ${getErrorMessage(err)}` }],
            isError: true,
          };
        }
      },
      () => ctx.sandboxLimits,
    ),
  );

  // ── olga_lint ───────────────────────────────────────────────────────────

  server.tool(
    "olga_lint",
    "Run pre-flight multiphase flow assurance diagnostics (M7001–M7007: CFL stability, steep risers, severe slugging dips, pig stuck hazard) on an OLGA model.",
    {
      source: z.string().describe("OLGA model source content (.opi XML or .key keyword deck) or file path"),
    },
    async ({ source }) => {
      try {
        const content = resolveSourceOrWorkspaceFile(source);
        const model = parseOlga(content);
        const diagnostics = lintOlgaModel(model);
        return { content: [{ type: "text" as const, text: JSON.stringify(diagnostics, null, 2) }] };
      } catch (err: unknown) {
        return {
          content: [{ type: "text" as const, text: `OLGA lint error: ${getErrorMessage(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ── olga_verify ─────────────────────────────────────────────────────────

  server.tool(
    "olga_verify",
    "Formally verify multiphase simulation against flow assurance limits (MAOP, hydrate subcooling margin, and slug catcher capacity).",
    {
      source: z.string().describe("OLGA model source content or file path"),
      maopBar: z.number().optional().describe("Maximum Allowable Operating Pressure in bar (default: 250)"),
      hydrateMarginK: z.number().optional().describe("Required hydrate subcooling safety margin in K (default: 3.0)"),
      slugCatcherCapacityM3: z
        .number()
        .optional()
        .describe("Slug catcher maximum liquid surge capacity in m³ (default: 150)"),
      minGasVelocityMs: z.number().optional().describe("Minimum gas turndown velocity in m/s (default: 0.5)"),
    },
    withSandbox(
      "olga_verify",
      async ({ source, maopBar, hydrateMarginK, slugCatcherCapacityM3, minGasVelocityMs }) => {
        try {
          const content = resolveSourceOrWorkspaceFile(source);
          const model = parseOlga(content);
          const limits: FlowAssuranceLimits = {
            maop: (maopBar ?? 250) * 1e5,
            hydrateMarginKelvin: hydrateMarginK ?? 3.0,
            slugCatcherLiquidCapacity: slugCatcherCapacityM3 ?? 150.0,
            minGasVelocity: minGasVelocityMs ?? 0.5,
          };
          const result = verifyFlowAssuranceLimits(model, limits);
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (err: unknown) {
          return {
            content: [{ type: "text" as const, text: `OLGA verification error: ${getErrorMessage(err)}` }],
            isError: true,
          };
        }
      },
      () => ctx.sandboxLimits,
    ),
  );

  // ── olga_diagram ────────────────────────────────────────────────────────

  server.tool(
    "olga_diagram",
    "Generate standalone SVG diagrams for an OLGA flowline: topological P&ID schematic or pipeline elevation bathymetry Z(X) with holdup heatmaps and active slugs/pigs.",
    {
      source: z.string().describe("OLGA model source content or file path"),
      view: z
        .enum(["profile", "schematic"])
        .optional()
        .describe("View type: 'profile' (bathymetry Z(X)) or 'schematic' (P&ID)"),
    },
    async ({ source, view }) => {
      try {
        const content = resolveSourceOrWorkspaceFile(source);
        const model = parseOlga(content);
        let svg: string;
        if (view === "schematic") {
          svg = renderOlgaSchematicSvg(model);
        } else {
          const simResult = simulateDriftFlux(model, {
            durationSeconds: Math.min(model.endTime - model.startTime, 60),
            timeStepSeconds: 1.0,
          });
          svg = renderOlgaElevationProfileSvg(model, simResult);
        }
        return { content: [{ type: "text" as const, text: svg }] };
      } catch (err: unknown) {
        return {
          content: [{ type: "text" as const, text: `OLGA diagram error: ${getErrorMessage(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ── olga_parse_tpl ────────────────────────────────────────────────────────
  server.tool(
    "olga_parse_tpl",
    "Parse an OLGA simulation trend plot (.tpl) file or content into structured time-series dataset with variable catalog, units, and channel statistics.",
    {
      source: z.string().describe("OLGA .tpl trend content or file path"),
      includeData: z
        .boolean()
        .optional()
        .describe("Whether to include the full raw numerical data array (defaults to false for compact summary)"),
    },
    async ({ source, includeData }) => {
      try {
        const content = resolveSourceOrWorkspaceFile(source);
        const dataset = parseOlgaTplDataset(content);
        const variablesWithStats = dataset.variables.map((v, idx) => {
          const vals = dataset.data[idx] || [];
          let minVal = Infinity;
          let maxVal = -Infinity;
          let sum = 0;
          for (const val of vals) {
            if (val < minVal) minVal = val;
            if (val > maxVal) maxVal = val;
            sum += val;
          }
          const mean = vals.length > 0 ? sum / vals.length : 0;
          return {
            id: v.id,
            name: v.name,
            variable: v.variable,
            branch: v.branch,
            sectionIndex: v.sectionIndex,
            unit: v.unit,
            count: vals.length,
            min: isFinite(minVal) ? minVal : null,
            max: isFinite(maxVal) ? maxVal : null,
            mean: isFinite(mean) ? mean : null,
            sampleStart: vals.slice(0, 3),
            sampleEnd: vals.slice(-3),
          };
        });

        const result: Record<string, unknown> = {
          title: dataset.title,
          caseName: dataset.caseName,
          timestepsCount: dataset.times.length,
          timeSpan: {
            start: dataset.times[0] ?? 0,
            end: dataset.times[dataset.times.length - 1] ?? 0,
          },
          channelsCount: dataset.variables.length,
          variables: variablesWithStats,
        };

        if (includeData) {
          result["times"] = dataset.times;
          result["data"] = dataset.data;
        }

        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err: unknown) {
        return {
          content: [{ type: "text" as const, text: `OLGA .tpl parsing error: ${getErrorMessage(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ── olga_parse_ppl ────────────────────────────────────────────────────────
  server.tool(
    "olga_parse_ppl",
    "Parse an OLGA spatial profile plot (.ppl) file or content into structured spatial snapshots along pipeline coordinate X with flow regimes and critical extrema.",
    {
      source: z.string().describe("OLGA .ppl profile content or file path"),
      snapshotIndex: z
        .number()
        .optional()
        .describe("Optional index of specific time snapshot to return in full detail"),
    },
    async ({ source, snapshotIndex }) => {
      try {
        const content = resolveSourceOrWorkspaceFile(source);
        const dataset = parseOlgaPpl(content);
        const snapshotSummaries = dataset.snapshots.map((s, idx) => {
          const xSpan = {
            start: s.x[0] ?? 0,
            end: s.x[s.x.length - 1] ?? 0,
            sectionsCount: s.x.length,
          };
          const variableExtrema: Record<string, { min: number; max: number }> = {};
          for (const [varName, arr] of Object.entries(s.variables)) {
            let minVal = Infinity;
            let maxVal = -Infinity;
            for (const v of arr) {
              if (v < minVal) minVal = v;
              if (v > maxVal) maxVal = v;
            }
            variableExtrema[varName] = {
              min: isFinite(minVal) ? minVal : 0,
              max: isFinite(maxVal) ? maxVal : 0,
            };
          }
          return {
            index: idx,
            time: s.time,
            xSpan,
            variableExtrema,
            flowRegimesObserved: s.flowRegimes ? Array.from(new Set(s.flowRegimes)) : [],
          };
        });

        const response: Record<string, unknown> = {
          title: dataset.title,
          branch: dataset.branch,
          snapshotsCount: dataset.snapshots.length,
          variables: dataset.variables,
          snapshots: snapshotSummaries,
        };

        if (snapshotIndex !== undefined && dataset.snapshots[snapshotIndex]) {
          response["detailedSnapshot"] = dataset.snapshots[snapshotIndex];
        }

        return { content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }] };
      } catch (err: unknown) {
        return {
          content: [{ type: "text" as const, text: `OLGA .ppl parsing error: ${getErrorMessage(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ── olga_tune ────────────────────────────────────────────────────────────

  server.tool(
    "olga_tune",
    "Calibrate OLGA flowline model parameters (roughness, choke Cd, heat transfer, well PI) using autonomous Nelder-Mead simplex history matching against telemetry CSV observations.",
    {
      source: z.string().describe("OLGA model source content (.opi XML or .key keyword deck) or file path"),
      observations: z
        .string()
        .describe(
          "Field telemetry observation CSV content or file path with headers TIME, PT_INLET, PT_ARRIVAL, TM_ARRIVAL, QLT",
        ),
      parameters: z
        .array(z.enum(["roughness", "heat-transfer", "choke-cd", "well-rate"]))
        .optional()
        .describe("List of parameters to calibrate (default: roughness, choke-cd, heat-transfer)"),
      maxEvaluations: z.number().optional().describe("Maximum optimization evaluations (default: 100)"),
      outPath: z.string().optional().describe("Optional file path to write calibrated model (.opi or .key)"),
      reportPath: z.string().optional().describe("Optional file path to write Markdown calibration report"),
    },
    async ({ source, observations, parameters, maxEvaluations, outPath, reportPath }) => {
      try {
        const content = resolveSourceOrWorkspaceFile(source);
        const obsText = resolveSourceOrWorkspaceFile(observations);
        const model = parseOlga(content);
        const obsData = parseObservationCsv(obsText);
        const result = calibrateOlgaModel(model, obsData, {
          parameters: parameters as TunableParameter[] | undefined,
          maxEvaluations: maxEvaluations ?? 100,
        });

        const resolvedOutPath = outPath ? resolveWorkspacePath(outPath) : undefined;
        if (resolvedOutPath) {
          let serialized: string;
          if (resolvedOutPath.endsWith(".opi")) {
            serialized = serializeOpi(result.calibratedModel);
          } else {
            serialized = serializeKeyDeck(result.calibratedModel);
          }
          fs.writeFileSync(resolvedOutPath, serialized, "utf-8");
        }

        const resolvedReportPath = reportPath ? resolveWorkspacePath(reportPath) : undefined;
        if (resolvedReportPath) {
          fs.writeFileSync(resolvedReportPath, result.markdownReport, "utf-8");
        }

        const summary = {
          success: result.success,
          evaluations: result.evaluations,
          initialObjective: result.initialObjective,
          finalObjective: result.finalObjective,
          improvementPercent: result.improvementPercent,
          calibratedParameters: result.calibratedParameters,
          metrics: result.metrics,
          markdownReport: result.markdownReport,
          savedModelPath: outPath ?? null,
          savedReportPath: reportPath ?? null,
        };

        return { content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }] };
      } catch (err: unknown) {
        return {
          content: [{ type: "text" as const, text: `OLGA history matching error: ${getErrorMessage(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ── olga_gate ────────────────────────────────────────────────────────────

  server.tool(
    "olga_gate",
    "Evaluate an automated Flow Assurance CI/CD Safety Gate check on an OLGA model for pull requests and operational envelope verification.",
    {
      source: z.string().describe("OLGA model source content or file path"),
      maxSurgeM3: z.number().optional().describe("Maximum allowable topside slug catcher surge volume in m³ [m³]"),
      minHydrateMarginK: z
        .number()
        .optional()
        .describe("Minimum required hydrate avoidance subcooling margin in Kelvin [K]"),
      maxWaxMm: z.number().optional().describe("Maximum allowable wax deposition layer thickness in mm [mm]"),
      maxCorrosionMmPerYear: z
        .number()
        .optional()
        .describe("Maximum allowable sweet CO2 corrosion rate in mm/year [mm/yr]"),
      maopBar: z.number().optional().describe("Maximum Allowable Operating Pressure limit in bar [bar]"),
      minGasVel: z.number().optional().describe("Minimum gas turndown velocity in m/s [m/s]"),
      durationSeconds: z.number().optional().describe("Simulation evaluation duration in seconds [s]"),
      reportPath: z.string().optional().describe("Optional path to save Markdown summary report"),
    },
    async ({
      source,
      maxSurgeM3,
      minHydrateMarginK,
      maxWaxMm,
      maxCorrosionMmPerYear,
      maopBar,
      minGasVel,
      durationSeconds,
      reportPath,
    }) => {
      try {
        const content = resolveSourceOrWorkspaceFile(source);
        const model = parseOlga(content);
        const result = evaluateFlowAssuranceGate(model, {
          maxSurgeM3,
          minHydrateMarginK,
          maxWaxThicknessMm: maxWaxMm,
          maxCorrosionRateMmPerYear: maxCorrosionMmPerYear,
          maxPressureBar: maopBar,
          minGasVelocity: minGasVel,
          durationSeconds,
        });

        const resolvedReportPath = reportPath ? resolveWorkspacePath(reportPath) : undefined;
        if (resolvedReportPath) {
          fs.writeFileSync(resolvedReportPath, result.markdownReport, "utf-8");
        }

        const summary = {
          passed: result.passed,
          verdict: result.passed ? "APPROVED (PASSED)" : "BLOCKED (FAILED)",
          checks: result.checks,
          markdownReport: result.markdownReport,
          savedReportPath: reportPath ?? null,
        };

        return { content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }] };
      } catch (err: unknown) {
        return {
          content: [{ type: "text" as const, text: `OLGA gate evaluation error: ${getErrorMessage(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ── olga_survey ──────────────────────────────────────────────────────────

  server.tool(
    "olga_survey",
    "Ingest 3D seabed bathymetry survey coordinates (CSV with Easting,Northing,Depth or KP,Elevation) and discretize into adaptive curvature-aware OLGA pipe segments.",
    {
      source: z.string().describe("Survey CSV content or file path"),
      defaultDiameter: z.number().optional().describe("Default pipe internal diameter in meters [m] (default: 0.3048)"),
      targetCellLength: z
        .number()
        .optional()
        .describe("Target cell length for curvature discretization in meters [m] (default: 50.0)"),
      outPath: z.string().optional().describe("Optional path to save discretized <Pipe> XML snippet"),
    },
    async ({ source, defaultDiameter, targetCellLength, outPath }) => {
      try {
        const content = resolveSourceOrWorkspaceFile(source);
        const surveyResult = importBathymetrySurvey(content, {
          defaultDiameter: defaultDiameter ?? 0.3048,
          targetCellLength: targetCellLength ?? 50.0,
        });

        const resolvedOutPath = outPath ? resolveWorkspacePath(outPath) : undefined;
        if (resolvedOutPath) {
          fs.writeFileSync(resolvedOutPath, surveyResult.opiXmlSnippet, "utf-8");
        }

        const summary = {
          totalLengthM: surveyResult.totalLengthM,
          minElevationM: surveyResult.minElevationM,
          maxElevationM: surveyResult.maxElevationM,
          maxDoglegSeverityDegPer30m: surveyResult.maxDoglegSeverity,
          discretizedPipesCount: surveyResult.pipes.length,
          opiXmlSnippet: surveyResult.opiXmlSnippet,
          savedXmlPath: outPath ?? null,
        };

        return { content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }] };
      } catch (err: unknown) {
        return {
          content: [{ type: "text" as const, text: `OLGA survey ingestion error: ${getErrorMessage(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // Water Utilities: US EPA EPANET & SWMM Modeling & Analysis Tools
  // ─────────────────────────────────────────────────────────────────────────────

  server.tool(
    "epanet_solve_hydraulics",
    "Solves steady-state or extended period hydraulics for a US EPA EPANET water distribution network (.inp).",
    {
      networkContent: z.string().describe("EPANET network deck (.inp)"),
      extendedPeriod: z
        .boolean()
        .optional()
        .describe("Whether to run Extended Period Simulation (EPS). Default: false"),
      durationHours: z.number().optional().describe("EPS simulation duration in hours (e.g. 24, 48, 72)"),
      demandModel: z
        .enum(["DDA", "PDD"])
        .optional()
        .describe("Demand model: 'DDA' (Demand-Driven) or 'PDD' (Pressure-Dependent)"),
    },
    async ({ networkContent, extendedPeriod, durationHours, demandModel }) => {
      const { parseInp, solveHydraulics, solveExtendedPeriod } = await import("@modelscript/epanet");
      const net = parseInp(networkContent);
      if (extendedPeriod) {
        const epsRes = solveExtendedPeriod(net, {
          durationHours: durationHours ?? net.options.durationHours ?? 24,
          pdd: demandModel === "PDD" ? { enabled: true } : undefined,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  mode: "EPS",
                  stepsCount: epsRes.steps.length,
                  totalEnergyKwh: Math.round(epsRes.totalEnergyKwh * 100) / 100,
                  minSystemPressure: Math.round(epsRes.minSystemPressure * 100) / 100,
                  maxSystemPressure: Math.round(epsRes.maxSystemPressure * 100) / 100,
                  criticalJunctions: epsRes.criticalJunctions,
                  finalStep: {
                    timeHours: epsRes.steps[epsRes.steps.length - 1]?.timeHours,
                    tankLevels: Object.fromEntries(epsRes.steps[epsRes.steps.length - 1]?.tankLevels ?? new Map()),
                  },
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      const hydRes = solveHydraulics(net, {
        pdd: demandModel === "PDD" ? { enabled: true } : undefined,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: true,
                mode: "STEADY_STATE",
                converged: hydRes.converged,
                iterations: hydRes.iterations,
                maxFlowChange: hydRes.maxFlowChange,
                nodePressures: Object.fromEntries(hydRes.nodePressures),
                linkFlows: Object.fromEntries(hydRes.linkFlows),
                linkVelocities: Object.fromEntries(hydRes.linkVelocities),
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
    "epanet_fire_flow_analysis",
    "Performs fire flow capacity analysis at a municipal hydrant node, evaluating available GPM at 20 psi residual pressure.",
    {
      networkContent: z.string().describe("EPANET network deck (.inp)"),
      targetHydrantNode: z.string().describe("Target junction/hydrant ID (e.g. 'J-101')"),
      requiredFireFlowLps: z.number().optional().describe("Required fire flow in L/s (default: 63.09 L/s = 1000 GPM)"),
      minResidualPressureM: z
        .number()
        .optional()
        .describe("Minimum residual pressure head in meters (default: 14.06m = 20 psi)"),
    },
    async ({ networkContent, targetHydrantNode, requiredFireFlowLps, minResidualPressureM }) => {
      const { parseInp, solveHydraulics } = await import("@modelscript/epanet");
      const net = parseInp(networkContent);
      const reqFlow = requiredFireFlowLps ?? 63.09;
      const minP = minResidualPressureM ?? 14.06;

      const baseHyd = solveHydraulics(net);
      const basePressure = baseHyd.nodePressures.get(targetHydrantNode) ?? 0.0;

      const fireDemands = new Map<string, number>();
      for (const j of net.junctions) {
        if (j.id.toLowerCase() === targetHydrantNode.toLowerCase()) {
          fireDemands.set(j.id.toLowerCase(), j.demand + reqFlow);
        }
      }
      const fireHyd = solveHydraulics(net, { demandOverrides: fireDemands });
      const residualP = fireHyd.nodePressures.get(targetHydrantNode) ?? 0.0;

      const flowGpm = reqFlow * 15.8503;
      let nfpaClass = "Class C (Red, <500 GPM)";
      if (flowGpm >= 1500) nfpaClass = "Class AA (Light Blue, >=1500 GPM)";
      else if (flowGpm >= 1000) nfpaClass = "Class A (Green, 1000-1499 GPM)";
      else if (flowGpm >= 500) nfpaClass = "Class B (Orange, 500-999 GPM)";

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: true,
                targetNode: targetHydrantNode,
                testFireFlowLps: reqFlow,
                testFireFlowGpm: Math.round(flowGpm),
                baselinePressureM: Math.round(basePressure * 100) / 100,
                residualPressureM: Math.round(residualP * 100) / 100,
                minRequiredResidualM: minP,
                compliant: residualP >= minP,
                nfpaClass,
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
    "epanet_outage_contingency",
    "Simulates N-1 pipe break isolation and unsupplied customer demand under Pressure-Dependent Demand (PDD).",
    {
      networkContent: z.string().describe("EPANET network deck (.inp)"),
      isolatedPipeId: z.string().describe("Pipe ID isolated due to rupture/break (e.g. 'P-1')"),
    },
    async ({ networkContent, isolatedPipeId }) => {
      const { parseInp, solvePddHydraulics } = await import("@modelscript/epanet");
      const net = parseInp(networkContent);
      const linkOverrides = new Map<string, "OPEN" | "CLOSED">();
      linkOverrides.set(isolatedPipeId.toLowerCase(), "CLOSED");

      const result = solvePddHydraulics(
        net,
        { enabled: true, pMin: 0.0, pReq: 20.0, exponent: 0.5 },
        { linkStatusOverrides: linkOverrides },
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: true,
                isolatedPipe: isolatedPipeId,
                requiredDemandLps: result.requiredDemandLps,
                deliveredDemandLps: result.deliveredDemandLps,
                unsuppliedDemandLps: result.unsuppliedDemandLps,
                satisfactionRatio: Math.round(result.satisfactionRatio * 1000) / 1000,
                unservedNodes: result.unservedNodes,
                isolatedNodes: result.isolatedNodes,
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
    "epanet_screen_contingencies_webgpu",
    "Parallelizes thousands of N-1 pipe break isolations and hydrant fire flow capacity tests simultaneously using WebGPU compute shaders with CPU SIMD fallback.",
    {
      networkContent: z.string().describe("EPANET network deck (.inp)"),
      screeningMode: z
        .enum(["ALL_N1_OUTAGES", "ALL_FIRE_HYDRANTS", "COMBINED"])
        .optional()
        .describe("Screening mode: ALL_N1_OUTAGES, ALL_FIRE_HYDRANTS, or COMBINED (default: COMBINED)"),
      minResidualPressureM: z
        .number()
        .optional()
        .describe(
          "Minimum residual pressure head required at consumer junctions in meters (default: 14.06 m = 20 psi)",
        ),
      maxVelocityMps: z.number().optional().describe("Maximum pipe velocity limit in m/s (default: 2.5 m/s)"),
      fireFlowDrawLps: z
        .number()
        .optional()
        .describe("Standard hydrant fire test draw in L/s (default: 63.09 L/s = 1,000 gpm)"),
      preferCpu: z.boolean().optional().describe("Whether to force CPU execution (default: true for headless server)"),
    },
    async ({
      networkContent,
      screeningMode = "COMBINED",
      minResidualPressureM = 14.06,
      maxVelocityMps = 2.5,
      fireFlowDrawLps = 63.09,
      preferCpu = true,
    }) => {
      const { parseInp, extractEpanetScreeningModel } = await import("@modelscript/epanet");
      const { calculateWaterNetworkSensitivities, WebGpuWaterScreener } = await import("@modelscript/simulate");

      const net = parseInp(networkContent);
      const model = extractEpanetScreeningModel(net);
      const sens = calculateWaterNetworkSensitivities(model.nodes, model.pipes);
      const screener = await WebGpuWaterScreener.create(null);

      const opts = {
        minResidualPressureM,
        maxVelocityMps,
        fireFlowDrawLps,
        preferCpu,
      };

      let outageResult = null;
      let fireResult = null;

      if (screeningMode === "ALL_N1_OUTAGES" || screeningMode === "COMBINED") {
        outageResult = await screener.screenAllPipeOutages(sens, opts);
      }

      if (screeningMode === "ALL_FIRE_HYDRANTS" || screeningMode === "COMBINED") {
        fireResult = await screener.screenAllFireHydrants(sens, opts);
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: true,
                backend: preferCpu ? "cpu-simd" : "webgpu",
                screeningMode,
                nodesMonitored: sens.nodeCount,
                pipesMonitored: sens.pipeCount,
                totalEvaluations: (outageResult?.totalEvaluations ?? 0) + (fireResult?.totalEvaluations ?? 0),
                totalExecutionTimeMs:
                  Math.round(((outageResult?.executionTimeMs ?? 0) + (fireResult?.executionTimeMs ?? 0)) * 100) / 100,
                outageContingencies: outageResult
                  ? {
                      pipesEvaluated: outageResult.scenariosEvaluated,
                      vulnerablePipesCount: outageResult.vulnerableScenariosCount,
                      topCriticalPipes: outageResult.topCriticalPipes,
                    }
                  : undefined,
                fireFlowScreening: fireResult
                  ? {
                      hydrantsEvaluated: fireResult.scenariosEvaluated,
                      deficientHydrantsCount: fireResult.vulnerableScenariosCount,
                      fireFlowCapacities: fireResult.fireFlowCapacities,
                    }
                  : undefined,
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
    "epanet_water_hammer_surge",
    "Simulates acoustic pressure wave propagation, Joukowsky surge spikes, column separation (DVCM), and 4-quadrant pump trip dynamics via the Method of Characteristics (MOC).",
    {
      pipeLengthM: z.number().describe("Pipeline length in meters (e.g. 1200.0)"),
      pipeDiameterM: z.number().describe("Internal pipe diameter in meters (e.g. 0.6)"),
      initialFlowM3s: z.number().describe("Initial steady flow rate in m^3/s (e.g. 0.5)"),
      closureTimeSeconds: z.number().describe("Valve closure duration or pump coastdown time in seconds (e.g. 0.5)"),
      waveSpeedMps: z.number().optional().describe("Acoustic wave speed in m/s (default: 1200.0)"),
      initialHeadUpstreamM: z.number().optional().describe("Initial upstream head in meters (default: 80.0)"),
      initialHeadDownstreamM: z.number().optional().describe("Initial downstream head in meters (default: 70.0)"),
      eventType: z
        .enum(["VALVE_CLOSURE", "PUMP_TRIP"])
        .optional()
        .describe("Transient event type (default: VALVE_CLOSURE)"),
      enableDvcm: z
        .boolean()
        .optional()
        .describe("Enable Discrete Vapor Cavity Model (DVCM) column separation tracking (default: true)"),
      pumpInertiaKgM2: z.number().optional().describe("Pump + motor polar moment of inertia in kg*m^2 for pump trip"),
      hasCheckValve: z
        .boolean()
        .optional()
        .describe("Whether non-return check valve is present on pump discharge (default: true)"),
    },
    async ({
      pipeLengthM,
      pipeDiameterM,
      initialFlowM3s,
      closureTimeSeconds,
      waveSpeedMps,
      initialHeadUpstreamM,
      initialHeadDownstreamM,
      eventType,
      enableDvcm,
      pumpInertiaKgM2,
      hasCheckValve,
    }) => {
      const { solveWaterHammerMoc } = await import("@modelscript/epanet");
      const pipe = {
        id: "SURGE_PIPE",
        lengthM: pipeLengthM,
        diameterM: pipeDiameterM,
        waveSpeedMps: waveSpeedMps ?? 1200.0,
      };
      const initial = {
        flowM3s: initialFlowM3s,
        headUpstreamM: initialHeadUpstreamM ?? 80.0,
        headDownstreamM: initialHeadDownstreamM ?? 70.0,
      };
      const type = eventType ?? "VALVE_CLOSURE";
      const event: Parameters<typeof solveWaterHammerMoc>[2] = {
        type,
        durationSeconds: closureTimeSeconds,
      };
      if (type === "PUMP_TRIP" && pumpInertiaKgM2 !== undefined) {
        event.pumpCoastdown = {
          specificSpeedType: "RADIAL",
          momentOfInertiaKgM2: pumpInertiaKgM2,
          ratedSpeedRpm: 1750.0,
          ratedFlowM3s: Math.abs(initialFlowM3s),
          ratedHeadM: Math.max(10.0, Math.abs((initialHeadDownstreamM ?? 70.0) - (initialHeadUpstreamM ?? 80.0))),
          hasCheckValve: hasCheckValve ?? true,
        };
      }
      const res = solveWaterHammerMoc(pipe, initial, event, {
        enableDvcmCavitation: enableDvcm ?? true,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: true,
                joukowskySurgeM: Math.round(res.joukowskySurgeM * 10) / 10,
                maxHeadM: Math.round(res.maxHeadM * 10) / 10,
                minHeadM: Math.round(res.minHeadM * 10) / 10,
                maxPressurePsi: Math.round(res.maxPressurePsi * 10) / 10,
                minPressurePsi: Math.round(res.minPressurePsi * 10) / 10,
                cavitationOccurred: res.cavitationOccurred,
                cavitationCollapseOccurred: res.cavitationCollapseOccurred ?? false,
                maxCavityVolumeM3: res.maxCavityVolumeM3 ? Math.round(res.maxCavityVolumeM3 * 1000) / 1000 : undefined,
                maxCollapseSurgeM: res.maxCollapseSurgeM ? Math.round(res.maxCollapseSurgeM * 10) / 10 : undefined,
                checkValveSlamHeadM: res.checkValveSlamHeadM
                  ? Math.round(res.checkValveSlamHeadM * 10) / 10
                  : undefined,
                maxReverseFlowM3s: res.maxReverseFlowM3s ? Math.round(res.maxReverseFlowM3s * 1000) / 1000 : undefined,
                waveTravelTimeSeconds: Math.round(res.waveTravelTimeSeconds * 100) / 100,
                fundamentalPeriodSeconds: Math.round(res.fundamentalPeriodSeconds * 100) / 100,
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
    "water_audit_awwa_m36",
    "Performs standard AWWA M36 Water Audit calculating CARL, UARL, Infrastructure Leakage Index (ILI), and non-revenue water financial losses.",
    {
      networkContent: z.string().describe("EPANET network deck (.inp)"),
      systemInputVolumeM3Year: z.number().describe("Annual System Input Volume (SIV) in m^3/year"),
      billedMeteredM3Year: z.number().describe("Annual billed metered consumption in m^3/year"),
      serviceConnectionsCount: z.number().optional().describe("Number of active customer service connections (Nc)"),
      unitCostProductionPerM3: z
        .number()
        .optional()
        .describe("Variable cost of water production ($/m^3, default: 0.45)"),
      retailWaterRatePerM3: z
        .number()
        .optional()
        .describe("Retail tariff rate for apparent loss valuation ($/m^3, default: 1.85)"),
    },
    async ({
      networkContent,
      systemInputVolumeM3Year,
      billedMeteredM3Year,
      serviceConnectionsCount,
      unitCostProductionPerM3,
      retailWaterRatePerM3,
    }) => {
      const { parseInp, performAwwaM36WaterAudit } = await import("@modelscript/epanet");
      const net = parseInp(networkContent);
      const audit = performAwwaM36WaterAudit(net, {
        systemInputVolumeM3Year,
        billedMeteredM3Year,
        serviceConnectionsCount,
        unitCostProductionPerM3,
        retailWaterRatePerM3,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: true,
                systemInputVolumeM3: audit.systemInputVolumeM3Year,
                authorizedConsumptionM3: audit.authorizedConsumptionM3Year,
                waterLossesM3: audit.waterLossesM3Year,
                realLossesM3: audit.realLossesM3Year,
                apparentLossesM3: audit.apparentLossesM3Year,
                nonRevenueWaterPct: audit.nonRevenueWaterPct,
                carlM3: audit.carlM3Year,
                uarlM3: audit.uarlM3Year,
                ili: audit.ili,
                performanceBand: audit.performanceBand,
                financialLossUsd: audit.financialImpact.totalAnnualLossUsd,
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
    "epanet_optimize_cip",
    "Optimizes multi-year Capital Improvement Planning (CIP) pipe replacement and upsizing to maximize hydraulic performance under strict budget constraints.",
    {
      networkContent: z.string().describe("EPANET network deck (.inp)"),
      budgetUsd: z.number().describe("Capital improvement project budget constraint in USD (e.g. 500000)"),
      targetMinPressureM: z
        .number()
        .optional()
        .describe("Target minimum network service pressure in meters (default: 25.0)"),
      candidatePipeIds: z
        .array(z.string())
        .optional()
        .describe("Optional candidate pipe IDs for replacement (default: all pipes)"),
      unitCostPerMeterPerMm: z.number().optional().describe("Unit cost in $/m/mm diameter (default: 0.85)"),
      availableDiametersMm: z
        .array(z.number())
        .optional()
        .describe("Available commercial pipe diameters in mm (default: [200, 250, 300, 350, 400, 500, 600])"),
    },
    async ({
      networkContent,
      budgetUsd,
      targetMinPressureM = 25.0,
      candidatePipeIds,
      unitCostPerMeterPerMm = 0.85,
      availableDiametersMm = [200, 250, 300, 350, 400, 500, 600],
    }) => {
      const { parseInp, solveHydraulics } = await import("@modelscript/epanet");
      const net = parseInp(networkContent);

      // 1. Solve baseline hydraulics
      const baseSol = solveHydraulics(net);
      let baseMinP = Infinity;
      let baseMinNode = "";
      for (const [nid, p] of baseSol.nodePressures) {
        if (p < baseMinP) {
          baseMinP = p;
          baseMinNode = nid;
        }
      }

      // 2. Rank candidate pipes by head loss gradient (hf/L)
      const eligiblePipes = net.pipes.filter((p) => !candidatePipeIds || candidatePipeIds.includes(p.id));
      const sortedCandidates = [...eligiblePipes].sort((a, b) => {
        const flowA = Math.abs(baseSol.linkFlows.get(a.id) ?? 0);
        const flowB = Math.abs(baseSol.linkFlows.get(b.id) ?? 0);
        const hfGradA = Math.pow(flowA / Math.max(1, a.roughness), 1.852) / Math.pow(a.diameter, 4.87);
        const hfGradB = Math.pow(flowB / Math.max(1, b.roughness), 1.852) / Math.pow(b.diameter, 4.87);
        return hfGradB - hfGradA;
      });

      // 3. Greedy selection under budget
      let remainingBudget = budgetUsd;
      let totalCapex = 0;
      const replacedPipes: {
        pipeId: string;
        oldDiameterMm: number;
        newDiameterMm: number;
        lengthM: number;
        costUsd: number;
        headlossReductionM: number;
      }[] = [];

      const sortedDiameters = [...availableDiametersMm].sort((a, b) => a - b);

      for (const p of sortedCandidates) {
        const nextDiams = sortedDiameters.filter((d) => d > p.diameter);
        if (nextDiams.length === 0) continue;

        let bestNewDiam = 0;
        let bestCost = 0;

        for (const candidateDiam of nextDiams) {
          const cost = p.length * candidateDiam * unitCostPerMeterPerMm;
          if (cost <= remainingBudget) {
            bestNewDiam = candidateDiam;
            bestCost = cost;
          }
        }

        if (bestNewDiam > 0) {
          const oldDiam = p.diameter;
          p.diameter = bestNewDiam;
          p.roughness = Math.max(p.roughness, 130);

          remainingBudget -= bestCost;
          totalCapex += bestCost;

          replacedPipes.push({
            pipeId: p.id,
            oldDiameterMm: oldDiam,
            newDiameterMm: bestNewDiam,
            lengthM: p.length,
            costUsd: Math.round(bestCost),
            headlossReductionM: 0,
          });
        }
      }

      // 4. Re-solve optimized network
      const optSol = solveHydraulics(net);
      let optMinP = Infinity;
      let optMinNode = "";
      for (const [nid, p] of optSol.nodePressures) {
        if (p < optMinP) {
          optMinP = p;
          optMinNode = nid;
        }
      }

      for (const rep of replacedPipes) {
        const pObj = net.pipes.find((p) => p.id === rep.pipeId);
        if (!pObj) continue;
        const baseFlow = Math.abs(baseSol.linkFlows.get(rep.pipeId) ?? 1);
        const optFlow = Math.abs(optSol.linkFlows.get(rep.pipeId) ?? 1);
        const baseHf =
          (10.67 * pObj.length * Math.pow(baseFlow / 1000 / 100, 1.852)) / Math.pow(rep.oldDiameterMm / 1000, 4.87);
        const optHf =
          (10.67 * pObj.length * Math.pow(optFlow / 1000 / 130, 1.852)) / Math.pow(rep.newDiameterMm / 1000, 4.87);
        rep.headlossReductionM = Math.max(0, Math.round((baseHf - optHf) * 10) / 10);
      }

      const pImprovement = optMinP - baseMinP;

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: true,
                budgetUsd,
                totalCapexUsd: Math.round(totalCapex),
                remainingBudgetUsd: Math.round(remainingBudget),
                baselineMinPressureM: Math.round(baseMinP * 10) / 10,
                baselineCriticalNode: baseMinNode,
                optimizedMinPressureM: Math.round(optMinP * 10) / 10,
                optimizedCriticalNode: optMinNode,
                pressureImprovementM: Math.round(pImprovement * 10) / 10,
                targetMet: optMinP >= targetMinPressureM,
                replacedPipeCount: replacedPipes.length,
                replacedPipes,
                summary: `Capital Improvement Plan: Replaced ${replacedPipes.length} pipe(s) utilizing $${Math.round(totalCapex).toLocaleString()} of $${budgetUsd.toLocaleString()} budget. Minimum network pressure increased from ${baseMinP.toFixed(1)}m to ${optMinP.toFixed(1)}m (+${pImprovement.toFixed(1)}m improvement).`,
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
    "epanet_calibrate_scada",
    "Calibrates EPANET pipe Hazen-Williams roughness C-factors against real-world SCADA telemetry pressure observations.",
    {
      networkContent: z.string().describe("EPANET network deck (.inp)"),
      observations: z
        .array(
          z.object({
            nodeId: z.string().describe("Observed node ID"),
            observedPressureM: z.number().describe("Telemetry pressure in meters"),
            weight: z.number().optional().describe("Observation weight (default: 1.0)"),
          }),
        )
        .describe("SCADA telemetry pressure observations"),
      calibratedPipeIds: z.array(z.string()).optional().describe("Optional list of pipe IDs to tune (default: all)"),
      maxIterations: z.number().optional().describe("Maximum calibration iterations (default: 15)"),
    },
    async ({ networkContent, observations, calibratedPipeIds, maxIterations = 15 }) => {
      const { parseInp, solveHydraulics } = await import("@modelscript/epanet");
      const net = parseInp(networkContent);

      const computeRmse = (solPressures: Map<string, number>) => {
        let sumSq = 0;
        let count = 0;
        for (const obs of observations) {
          const simP = solPressures.get(obs.nodeId);
          if (simP !== undefined) {
            const err = simP - obs.observedPressureM;
            sumSq += err * err * (obs.weight ?? 1.0);
            count += obs.weight ?? 1.0;
          }
        }
        return count > 0 ? Math.sqrt(sumSq / count) : 0;
      };

      const initialSol = solveHydraulics(net);
      const initialRmse = computeRmse(initialSol.nodePressures);

      const targetPipes = net.pipes.filter((p) => !calibratedPipeIds || calibratedPipeIds.includes(p.id));
      const initialRoughnessMap = new Map<string, number>();
      for (const p of targetPipes) {
        initialRoughnessMap.set(p.id, p.roughness);
      }

      // Iterative sensitivity tuning
      let currentRmse = initialRmse;
      const alpha = 0.25;

      for (let iter = 0; iter < maxIterations; iter++) {
        const curSol = solveHydraulics(net);
        let avgRelDiff = 0;
        let validObs = 0;
        for (const obs of observations) {
          const simP = curSol.nodePressures.get(obs.nodeId);
          if (simP !== undefined && obs.observedPressureM > 0.1) {
            avgRelDiff += (simP - obs.observedPressureM) / obs.observedPressureM;
            validObs++;
          }
        }
        if (validObs === 0) break;
        avgRelDiff /= validObs;

        for (const p of targetPipes) {
          const factor = 1.0 - alpha * avgRelDiff;
          p.roughness = Math.max(50.0, Math.min(150.0, p.roughness * factor));
        }

        const nextSol = solveHydraulics(net);
        const nextRmse = computeRmse(nextSol.nodePressures);
        if (nextRmse < currentRmse) {
          currentRmse = nextRmse;
        } else {
          for (const p of targetPipes) {
            const initR = initialRoughnessMap.get(p.id) ?? p.roughness;
            p.roughness = Math.max(50.0, Math.min(150.0, (p.roughness + initR) / 2.0));
          }
          break;
        }
      }

      const finalSol = solveHydraulics(net);
      const finalRmse = computeRmse(finalSol.nodePressures);

      const calibratedPipes = targetPipes.map((p) => {
        const initR = initialRoughnessMap.get(p.id) ?? p.roughness;
        return {
          pipeId: p.id,
          initialRoughness: Math.round(initR * 10) / 10,
          calibratedRoughness: Math.round(p.roughness * 10) / 10,
          percentChange: Math.round(((p.roughness - initR) / initR) * 1000) / 10,
        };
      });

      const observationErrors = observations.map((obs) => {
        const sim = finalSol.nodePressures.get(obs.nodeId) ?? 0;
        return {
          nodeId: obs.nodeId,
          observedM: obs.observedPressureM,
          simulatedM: Math.round(sim * 10) / 10,
          residualM: Math.round((sim - obs.observedPressureM) * 10) / 10,
        };
      });

      const rmseReductionPct = initialRmse > 0 ? Math.max(0, ((initialRmse - finalRmse) / initialRmse) * 100) : 0;

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: true,
                initialRmseM: Math.round(initialRmse * 100) / 100,
                calibratedRmseM: Math.round(finalRmse * 100) / 100,
                rmseReductionPct: Math.round(rmseReductionPct * 10) / 10,
                calibratedPipeCount: calibratedPipes.length,
                calibratedPipes,
                observationErrors,
                summary: `SCADA Telemetry Calibration: Pressure RMSE reduced from ${initialRmse.toFixed(2)}m to ${finalRmse.toFixed(2)}m (${rmseReductionPct.toFixed(1)}% error reduction) across ${calibratedPipes.length} pipe(s).`,
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
    "epanet_gis_to_model",
    "Ingests municipal GIS pipe centerlines, junction assets, and digital elevation models (DEM) from GeoJSON / ASCII grids into a complete, ready-to-solve EPANET network (.inp).",
    {
      pipesGeoJson: z.string().describe("GeoJSON string containing pipe polyline features"),
      nodesGeoJson: z
        .string()
        .optional()
        .describe("Optional GeoJSON string containing point assets (junctions, reservoirs, tanks)"),
      demAsciiGrid: z
        .string()
        .optional()
        .describe("Optional Esri/USGS ASCII digital elevation model grid string (.asc, .grd)"),
      snapToleranceM: z.number().optional().describe("Topological node snap tolerance in meters (default: 1.5m)"),
      defaultDiameterMm: z.number().optional().describe("Default pipe diameter in mm (default: 200mm)"),
      defaultRoughness: z.number().optional().describe("Default Hazen-Williams C-factor (default: 120)"),
      defaultDemandLps: z.number().optional().describe("Default base demand in L/s (default: 0.0)"),
      networkTitle: z.string().optional().describe("Optional network title"),
    },
    async ({
      pipesGeoJson,
      nodesGeoJson,
      demAsciiGrid,
      snapToleranceM,
      defaultDiameterMm,
      defaultRoughness,
      defaultDemandLps,
      networkTitle,
    }) => {
      const { buildEpanetFromGis, serializeInp } = await import("@modelscript/epanet");
      const network = buildEpanetFromGis({
        pipesGeoJson,
        nodesGeoJson,
        dem: demAsciiGrid,
        snapToleranceM,
        defaultDiameterMm,
        defaultRoughness,
        defaultDemandLps,
        networkTitle,
      });

      const inpContent = serializeInp(network);
      let totalLengthM = 0;
      for (const p of network.pipes) {
        totalLengthM += p.length;
      }

      let minElev = Infinity;
      let maxElev = -Infinity;
      for (const j of network.junctions) {
        if (j.elevation < minElev) minElev = j.elevation;
        if (j.elevation > maxElev) maxElev = j.elevation;
      }
      if (minElev === Infinity) minElev = 0;
      if (maxElev === -Infinity) maxElev = 0;

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: true,
                title: network.title,
                summary: {
                  junctionsCount: network.junctions.length,
                  reservoirsCount: network.reservoirs.length,
                  tanksCount: network.tanks.length,
                  pipesCount: network.pipes.length,
                  totalPipeLengthM: Math.round(totalLengthM * 10) / 10,
                  elevationRangeM: { min: minElev, max: maxElev },
                },
                inpContent,
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
    "swmm_flood_routing",
    "Simulates 1D Saint-Venant dynamic wave routing in an urban stormwater or combined sewer network (.inp), reporting peak flows and flooding.",
    {
      deckContent: z.string().describe("SWMM network deck content (.inp)"),
      durationSeconds: z.number().optional().describe("Simulation duration in seconds (default: 300)"),
      rainfallIntensityMmPerHr: z
        .number()
        .optional()
        .describe("Design storm rainfall intensity in mm/hr (default: 45)"),
    },
    async ({ deckContent, durationSeconds, rainfallIntensityMmPerHr }) => {
      const { parseSwmm, solveSwmmDynamicWave } = await import("@modelscript/swmm");
      const deck = parseSwmm(deckContent);
      const res = solveSwmmDynamicWave(deck, {
        durationSeconds: durationSeconds ?? 300,
        rainfallIntensityMmPerHr: rainfallIntensityMmPerHr ?? 45,
      });

      const floodedNodes: { nodeId: string; overflowM3s: number }[] = [];
      for (const [nodeId, nRes] of res.nodes) {
        if (nRes.overflow > 0) {
          floodedNodes.push({ nodeId, overflowM3s: nRes.overflow });
        }
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: true,
                isFlooding: res.isFlooding,
                totalInflowM3s: Math.round(res.totalInflow * 1000) / 1000,
                totalOutflowM3s: Math.round(res.totalOutflow * 1000) / 1000,
                surchargedConduitsCount: res.surchargedConduits.length,
                surchargedConduits: res.surchargedConduits,
                floodedNodesCount: floodedNodes.length,
                floodedNodes,
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
    "swmm_simulate_rtc",
    "Simulates Real-Time Control (RTC) gate/weir/pump modulation for urban Combined Sewer Overflow (CSO) mitigation.",
    {
      deckContent: z.string().describe("SWMM network deck content (.inp)"),
      linkId: z.string().describe("Controllable link ID (e.g. 'GATE_1')"),
      linkType: z.enum(["PUMP", "WEIR", "ORIFICE"]).describe("Type of hydraulic control element"),
      actionSetting: z.number().describe("Setting ratio (0.0 = fully closed, 1.0 = fully open)"),
      triggerNodeId: z.string().describe("Sensor monitoring node ID (e.g. 'JUNCTION_5')"),
      operator: z.enum([">", ">=", "<", "<=", "="]).describe("Relational operator"),
      thresholdDepth: z.number().describe("Depth trigger threshold in meters"),
      durationSeconds: z.number().optional().describe("Simulation duration in seconds (default: 300)"),
    },
    async ({
      deckContent,
      linkId,
      linkType,
      actionSetting,
      triggerNodeId,
      operator,
      thresholdDepth,
      durationSeconds,
    }) => {
      const { parseSwmm, simulateSwmmRtc } = await import("@modelscript/swmm");
      const deck = parseSwmm(deckContent);
      const rule = {
        id: "RTC_RULE_1",
        linkId,
        linkType,
        actionSetting,
        nodeId: triggerNodeId,
        operator,
        thresholdDepth,
      };

      const result = simulateSwmmRtc(deck, [rule], {
        durationSeconds: durationSeconds ?? 300,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: true,
                activeRulesCount: result.activeRulesCount,
                rulesTriggeredCount: result.ruleExecutions.length,
                csoSpillVolumeM3: Math.round(result.csoSpillVolumeM3 * 10) / 10,
                baselineSpillVolumeM3: Math.round(result.baselineSpillVolumeM3 * 10) / 10,
                spillReductionPct: Math.round(result.spillReductionPct * 10) / 10,
                executions: result.ruleExecutions,
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
    "swmm_gis_to_model",
    "Ingests municipal GIS stormwater/wastewater conduits, manholes, catchment polygon boundaries, and DEM rasters from GeoJSON / ASCII grids into a complete SWMM network (.inp).",
    {
      conduitsGeoJson: z.string().describe("GeoJSON string containing conduit polyline features"),
      manholesGeoJson: z
        .string()
        .optional()
        .describe("Optional GeoJSON string containing manhole and outfall point features"),
      subcatchmentsGeoJson: z
        .string()
        .optional()
        .describe("Optional GeoJSON string containing catchment polygon boundaries"),
      demAsciiGrid: z
        .string()
        .optional()
        .describe("Optional Esri/USGS ASCII digital elevation model grid string (.asc, .grd)"),
      snapToleranceM: z.number().optional().describe("Topological manhole snap tolerance in meters (default: 2.0m)"),
      defaultDiameterM: z.number().optional().describe("Default conduit diameter in meters (default: 0.6m)"),
      defaultManningN: z.number().optional().describe("Default Manning's roughness n (default: 0.013)"),
      defaultManholeDepthM: z.number().optional().describe("Default manhole depth in meters (default: 2.5m)"),
      defaultImpervPct: z
        .number()
        .optional()
        .describe("Default subcatchment imperviousness percentage (default: 40.0%)"),
      title: z.string().optional().describe("Optional SWMM model title"),
    },
    async ({
      conduitsGeoJson,
      manholesGeoJson,
      subcatchmentsGeoJson,
      demAsciiGrid,
      snapToleranceM,
      defaultDiameterM,
      defaultManningN,
      defaultManholeDepthM,
      defaultImpervPct,
      title,
    }) => {
      const { buildSwmmFromGis, serializeSwmm } = await import("@modelscript/swmm");
      const deck = buildSwmmFromGis({
        conduitsGeoJson,
        manholesGeoJson,
        subcatchmentsGeoJson,
        dem: demAsciiGrid,
        snapToleranceM,
        defaultDiameterM,
        defaultManningN,
        defaultManholeDepthM,
        defaultImpervPct,
        title,
      });

      const inpContent = serializeSwmm(deck);
      let totalConduitLengthM = 0;
      for (const [, c] of deck.conduits) {
        totalConduitLengthM += c.length;
      }

      let totalCatchmentAreaHa = 0;
      for (const [, sc] of deck.subcatchments) {
        totalCatchmentAreaHa += sc.area;
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: true,
                title: deck.title,
                summary: {
                  junctionsCount: deck.junctions.size,
                  outfallsCount: deck.outfalls.size,
                  conduitsCount: deck.conduits.size,
                  subcatchmentsCount: deck.subcatchments.size,
                  totalConduitLengthM: Math.round(totalConduitLengthM * 10) / 10,
                  totalCatchmentAreaHa: Math.round(totalCatchmentAreaHa * 100) / 100,
                },
                inpContent,
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
    "epanet_convert_watergems",
    "Extracts water distribution and surge models directly from Bentley WaterGEMS / HAMMER (.wtg.sqlite) or InfoWater databases into native EPANET AST and .inp deck.",
    {
      databaseFilePath: z.string().optional().describe("Absolute file path to .wtg.sqlite or .json database"),
      tablesJson: z.string().optional().describe("In-memory JSON string representing database table rows"),
      flowUnits: z.enum(["GPM", "LPS", "MGD", "CMS"]).optional().describe("Target flow units (default: GPM)"),
    },
    async ({ databaseFilePath, tablesJson, flowUnits }) => {
      const { parseWaterGemsDatabase, serializeInp } = await import("@modelscript/epanet");
      const input = databaseFilePath ? databaseFilePath : JSON.parse(tablesJson ?? "{}");
      const network = parseWaterGemsDatabase(input, {
        flowUnits: (flowUnits as NonNullable<Parameters<typeof parseWaterGemsDatabase>[1]>["flowUnits"]) ?? "GPM",
      });
      const inpContent = serializeInp(network);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: true,
                title: network.title,
                summary: {
                  junctionsCount: network.junctions.length,
                  reservoirsCount: network.reservoirs.length,
                  tanksCount: network.tanks.length,
                  pipesCount: network.pipes.length,
                  pumpsCount: network.pumps.length,
                  valvesCount: network.valves.length,
                  curvesCount: network.curves.length,
                  patternsCount: network.patterns.length,
                },
                inpContent,
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
    "swmm_convert_infoworks",
    "Extracts collection system models directly from Autodesk / Innovyze InfoWorks ICM database tables into a native SWMM network AST and .inp deck.",
    {
      databaseFilePath: z.string().optional().describe("Absolute file path to InfoWorks SQLite database"),
      tablesJson: z.string().optional().describe("In-memory JSON string representing InfoWorks table rows"),
    },
    async ({ databaseFilePath, tablesJson }) => {
      const { parseInfoWorksDatabase, serializeSwmm } = await import("@modelscript/swmm");
      const input = databaseFilePath ? databaseFilePath : JSON.parse(tablesJson ?? "{}");
      const deck = parseInfoWorksDatabase(input);
      const inpContent = serializeSwmm(deck);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: true,
                title: deck.title,
                summary: {
                  junctionsCount: deck.junctions.size,
                  outfallsCount: deck.outfalls.size,
                  conduitsCount: deck.conduits.size,
                  subcatchmentsCount: deck.subcatchments.size,
                  weirsCount: deck.weirs.size,
                  pumpsCount: deck.pumps.size,
                },
                inpContent,
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
    "swmm_inundation_2d",
    "Simulates 2D shallow water surface inundation and street overland flooding coupled dynamically to 1D SWMM surcharged manholes (InfoWorks ICM Parity).",
    {
      deckContent: z.string().describe("SWMM input deck (.inp) string"),
      durationSeconds: z.number().optional().describe("Simulation duration in seconds (default: 300)"),
      rainfallIntensityMmPerHr: z
        .number()
        .optional()
        .describe("Direct overland rainfall intensity in mm/hr (default: 45)"),
      gridCols: z.number().optional().describe("Overland mesh grid columns (default: 8)"),
      gridRows: z.number().optional().describe("Overland mesh grid rows (default: 8)"),
      cellSpacingM: z.number().optional().describe("Mesh grid spacing in meters (default: 15.0)"),
    },
    async ({ deckContent, durationSeconds, rainfallIntensityMmPerHr, gridCols, gridRows, cellSpacingM }) => {
      const { createRegularGrid2DMesh, parseSwmm, solveSwmmCoupled1D2D } = await import("@modelscript/swmm");
      const deck = parseSwmm(deckContent);
      const cols = gridCols ?? 8;
      const rows = gridRows ?? 8;
      const dx = cellSpacingM ?? 15.0;
      const mesh = createRegularGrid2DMesh(cols, rows, dx, dx);

      const res = solveSwmmCoupled1D2D(deck, mesh, {
        simulationDurationSeconds: durationSeconds ?? 300.0,
        rainfallIntensityMmPerHr: rainfallIntensityMmPerHr ?? 45.0,
      });

      const floodedCells: { cellId: number; maxDepthM: number; maxVelocityMps: number; maxHazardRating: number }[] = [];
      for (const [cellId, summary] of res.cells) {
        if (summary.isFlooded) {
          floodedCells.push({
            cellId,
            maxDepthM: Math.round(summary.maxDepthM * 100) / 100,
            maxVelocityMps: Math.round(summary.maxVelocityMps * 100) / 100,
            maxHazardRating: Math.round(summary.maxHazardRating * 100) / 100,
          });
        }
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: true,
                peakFloodedAreaM2: Math.round(res.peakFloodedAreaM2 * 10) / 10,
                peakSurfaceVolumeM3: Math.round(res.peakSurfaceVolumeM3 * 10) / 10,
                cumulativeSpillVolumeM3: Math.round(res.cumulativeSpillVolumeM3 * 10) / 10,
                cumulativeDrainVolumeM3: Math.round(res.cumulativeDrainVolumeM3 * 10) / 10,
                massConservationErrorPct: Math.round(res.massConservationErrorPct * 100) / 100,
                floodedCellsCount: floodedCells.length,
                floodedCells,
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
    "waterml_fit_rating_curve",
    "Fit a non-linear stage-discharge power-law rating curve Q = a * (h - h0)^b from hydrologic stage/discharge pairs.",
    {
      observations: z
        .array(
          z.object({
            stageM: z.number().describe("Stage / water surface elevation (m)"),
            dischargeM3S: z.number().describe("Discharge flow rate (m³/s)"),
          }),
        )
        .describe("Observed stage and discharge pairs"),
    },
    async ({ observations }) => {
      try {
        const fit = fitRatingCurve(observations);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  equation: fit.equation,
                  formula: `Q = ${fit.equation.a.toFixed(4)} * (h - ${fit.equation.h0.toFixed(4)})^${fit.equation.b.toFixed(4)}`,
                  residualMax: fit.residualMax,
                  rmse: fit.rmse,
                  converged: fit.converged,
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
          content: [{ type: "text" as const, text: `WaterML rating curve fit error: ${getErrorMessage(err)}` }],
        };
      }
    },
  );

  // ── atp_simulate_transient ──────────────────────────────────────────────

  server.tool(
    "hec_hms_simulate_runoff",
    "Simulate SCS Runoff Curve Number (CN) excess precipitation and unit hydrograph outflow from HEC-HMS basin models.",
    {
      basinText: z.string().describe("HEC-HMS basin (.basin) file text"),
      precipitationMm: z.number().optional().default(50.0).describe("Total storm precipitation depth in mm"),
      durationHours: z.number().optional().default(24.0).describe("Storm duration in hours"),
    },
    async ({ basinText, precipitationMm, durationHours }) => {
      try {
        const model = parseHmsBasin(basinText);
        const sub = model.subbasins.values().next().value;
        if (!sub) {
          throw new Error("No subbasins found in HEC-HMS model.");
        }
        const hydrograph = simulateSubbasinRunoff(sub, {
          precipitationTotal: precipitationMm,
          durationHours,
          unitSystem: model.unitSystem,
        });
        let peakQ = 0;
        let peakT = 0;
        let totalVol = 0;
        for (const pt of hydrograph) {
          if (pt.flow > peakQ) {
            peakQ = pt.flow;
            peakT = pt.timeHours;
          }
          totalVol += pt.flow * 3600 * 0.25;
        }
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  basinName: model.name,
                  subbasinName: sub.name,
                  unitSystem: model.unitSystem,
                  peakDischargeM3s: peakQ,
                  timeToPeakHours: peakT,
                  totalVolumeM3: totalVol,
                  pointsCount: hydrograph.length,
                  hydrographSample: hydrograph.slice(0, 50),
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
          content: [{ type: "text" as const, text: `HEC-HMS runoff simulation error: ${getErrorMessage(err)}` }],
        };
      }
    },
  );

  // ── asm_evaluate_biokinetics ────────────────────────────────────────────

  server.tool(
    "asm_evaluate_biokinetics",
    "Evaluate IWA Activated Sludge Model (ASM1) biological process rates and net substrate/biomass conversion rates.",
    {
      concentrations: z
        .record(z.string(), z.number())
        .optional()
        .describe("Component concentrations in g COD/m³ or g N/m³ (e.g. S_S, X_BH, S_O, S_NO, S_NH)"),
      plantText: z.string().optional().describe("Optional .asm/.bsm plant model description"),
    },
    async ({ concentrations, plantText }) => {
      try {
        let concs = concentrations ?? {};
        let plantName = "Default_BSM1";
        if (plantText) {
          const plant = parseAsmPlant(plantText);
          plantName = plant.name;
          if (!concentrations) {
            concs = plant.influentConcentrations;
          }
        }
        const processRates = evaluateAsm1ProcessRates(concs);
        const conversionRates = computeAsm1ConversionRates(concs);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  plantName,
                  processRates: {
                    aerobicHeterotrophGrowth: processRates[0],
                    anoxicDenitrification: processRates[1],
                    aerobicAutotrophGrowth: processRates[2],
                    heterotrophDecay: processRates[3],
                    autotrophDecay: processRates[4],
                    ammonification: processRates[5],
                    hydrolysisSubstrate: processRates[6],
                    hydrolysisOrganicN: processRates[7],
                  },
                  conversionRates,
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
          content: [{ type: "text" as const, text: `ASM biokinetics evaluation error: ${getErrorMessage(err)}` }],
        };
      }
    },
  );

  // ── workspace_lint ──────────────────────────────────────────────────────────
}
