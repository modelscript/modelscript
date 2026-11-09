// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * CLI `msx cosim` command group.
 *
 * Subcommands for managing co-simulation sessions, participants,
 * FMU uploads, and historian replay from the command line.
 */

import {
  type BlackBoxProblem,
  cmaesSolve,
  deSolve,
  psoSolve,
  type SingleObjectiveResult,
} from "@modelscript/simulate/optimizer";
import fs from "node:fs";
import type { ArgumentsCamelCase, Argv, CommandModule } from "yargs";

interface CosimArgs {
  "api-url": string;
}

// ── Shared helpers ──

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API error (${response.status}): ${text}`);
  }
  return response.json();
}

// ── Subcommands ──

/** List active co-simulation sessions. */
const listSessions: CommandModule<CosimArgs, CosimArgs> = {
  command: "sessions",
  describe: "List co-simulation sessions",
  handler: async (args) => {
    const data = (await fetchJson(`${args["api-url"]}/api/v1/cosim/sessions`)) as {
      sessions: { id: string; state: string; participants: number }[];
    };
    if (data.sessions.length === 0) {
      console.log("No active sessions.");
      return;
    }
    console.log("Sessions:");
    for (const s of data.sessions) {
      console.log(`  ${s.id}  state=${s.state}  participants=${s.participants}`);
    }
  },
};

/** List MQTT participants. */
const listParticipants: CommandModule<CosimArgs, CosimArgs> = {
  command: "participants",
  describe: "List active MQTT participants",
  handler: async (args) => {
    const data = (await fetchJson(`${args["api-url"]}/api/v1/mqtt/participants`)) as {
      participants: { participantId: string; modelName: string; type: string; online: boolean }[];
    };
    if (data.participants.length === 0) {
      console.log("No active participants.");
      return;
    }
    console.log("Participants:");
    for (const p of data.participants) {
      const status = p.online ? "🟢" : "🔴";
      console.log(`  ${status} ${p.participantId}  model=${p.modelName}  type=${p.type}`);
    }
  },
};

/** List uploaded FMUs. */
const listFmus: CommandModule<CosimArgs, CosimArgs> = {
  command: "fmus",
  describe: "List uploaded FMU archives",
  handler: async (args) => {
    const data = (await fetchJson(`${args["api-url"]}/api/v1/fmus`)) as {
      fmus: { id: string; filename: string; modelName: string; variableCount: number }[];
    };
    if (data.fmus.length === 0) {
      console.log("No uploaded FMUs.");
      return;
    }
    console.log("FMUs:");
    for (const f of data.fmus) {
      console.log(`  ${f.id}  model=${f.modelName}  file=${f.filename}  vars=${f.variableCount}`);
    }
  },
};

/** Upload an FMU archive. */
const uploadFmu: CommandModule<CosimArgs, CosimArgs & { file: string }> = {
  command: "upload <file>",
  describe: "Upload an FMU archive",
  builder: (yargs) =>
    yargs.positional("file", {
      description: "Path to the .fmu file",
      type: "string",
      demandOption: true,
    }) as unknown as Argv<CosimArgs & { file: string }>,
  handler: async (args) => {
    const { readFileSync } = await import("fs");
    const { basename } = await import("path");
    const filename = basename(args.file);
    const data = readFileSync(args.file);

    const response = await fetch(`${args["api-url"]}/api/v1/fmus`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Filename": filename,
      },
      body: data,
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`Upload failed (${response.status}): ${text}`);
      return;
    }

    const result = (await response.json()) as { id: string; modelName: string; variableCount: number };
    console.log(`Uploaded: ${result.id}`);
    console.log(`  Model: ${result.modelName}`);
    console.log(`  Variables: ${result.variableCount}`);
  },
};

/** Start historian replay. */
const replay: CommandModule<CosimArgs, CosimArgs & { session: string; speed: number; from?: string | undefined }> = {
  command: "replay",
  describe: "Start historian replay of a recorded session",
  builder: (yargs) =>
    yargs
      .option("session", {
        description: "Session ID to replay",
        type: "string",
        demandOption: true,
      })
      .option("speed", {
        description: "Playback speed factor (1.0 = real-time)",
        type: "number",
        default: 1.0,
      })
      .option("from", {
        description: "Replay start time (ISO 8601)",
        type: "string",
      }) as unknown as Argv<CosimArgs & { session: string; speed: number; from?: string | undefined }>,
  handler: async (args) => {
    const body: Record<string, unknown> = {
      sessionId: args.session,
      speedFactor: args.speed,
    };
    if (args.from) body["from"] = args.from;

    const result = (await fetchJson(`${args["api-url"]}/api/v1/historian/replay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })) as { replayId: string };

    console.log(`Replay started: ${result.replayId}`);
    console.log(`  Session: ${args.session}`);
    console.log(`  Speed: ${args.speed}x`);
  },
};

/** List historian sessions. */
const historianSessions: CommandModule<CosimArgs, CosimArgs> = {
  command: "history",
  describe: "List recorded historian sessions",
  handler: async (args) => {
    const data = (await fetchJson(`${args["api-url"]}/api/v1/historian/sessions`)) as {
      sessions: { id: string; startTime: string; stopTime: string }[];
    };
    if (data.sessions.length === 0) {
      console.log("No recorded sessions.");
      return;
    }
    console.log("Recorded sessions:");
    for (const s of data.sessions) {
      console.log(`  ${s.id}  from=${s.startTime}  to=${s.stopTime}`);
    }
  },
};

/** Check system status. */
const status: CommandModule<CosimArgs, CosimArgs> = {
  command: "status",
  describe: "Check co-simulation system health",
  handler: async (args) => {
    console.log("Co-Simulation System Status");
    console.log("═".repeat(40));

    // API health
    try {
      const health = (await fetchJson(`${args["api-url"]}/health`)) as {
        status: string;
        mqtt?: string | undefined;
        historian?: string | undefined;
      };
      console.log(`  API:        ✅ ${health.status}`);
      console.log(`  MQTT:       ${health.mqtt === "connected" ? "✅" : "❌"} ${health.mqtt ?? "unknown"}`);
      console.log(`  Historian:  ${health.historian === "connected" ? "✅" : "❌"} ${health.historian ?? "unknown"}`);
    } catch {
      console.log(`  API:        ❌ unreachable (${args["api-url"]})`);
      return;
    }

    // Counts
    try {
      const sessions = (await fetchJson(`${args["api-url"]}/api/v1/cosim/sessions`)) as {
        sessions: unknown[];
      };
      const participants = (await fetchJson(`${args["api-url"]}/api/v1/mqtt/participants`)) as {
        participants: unknown[];
        connected: boolean;
      };
      const fmus = (await fetchJson(`${args["api-url"]}/api/v1/fmus`)) as {
        fmus: unknown[];
      };
      const history = (await fetchJson(`${args["api-url"]}/api/v1/historian/sessions`)) as {
        sessions: unknown[];
      };

      console.log("");
      console.log(`  Sessions:       ${sessions.sessions.length}`);
      console.log(`  Participants:   ${participants.participants.length}`);
      console.log(`  FMUs:           ${fmus.fmus.length}`);
      console.log(`  Recorded:       ${history.sessions.length}`);
    } catch {
      // Individual endpoint failures are non-critical
    }
  },
};

export interface CosimParameterRange {
  name: string;
  min: number;
  max: number;
}

export function parseCosimParams(paramStr: string): CosimParameterRange[] {
  paramStr = paramStr.trim();
  if (paramStr.startsWith("[") || paramStr.startsWith("{")) {
    return JSON.parse(paramStr);
  }
  const tokens = paramStr.split(/[,;\s]+/).filter(Boolean);
  return tokens.map((tok) => {
    const parts = tok.split(/[:=]/);
    if (parts.length >= 3) {
      return {
        name: parts[0]!.trim(),
        min: parseFloat(parts[1]!),
        max: parseFloat(parts[2]!),
      };
    }
    const rangeParts = parts[1]?.split("..") ?? [];
    if (rangeParts.length === 2) {
      return {
        name: parts[0]!.trim(),
        min: parseFloat(rangeParts[0]!),
        max: parseFloat(rangeParts[1]!),
      };
    }
    throw new Error(`Unable to parse parameter range: '${tok}'`);
  });
}

export interface CosimOptimizeArgs extends CosimArgs {
  archive?: string | undefined;
  params: string;
  objective: string;
  algorithm: "de" | "cma-es" | "cmaes" | "pso";
  generations: number;
  population: number;
  seed: number;
}

/** Optimize co-simulation parameters using metaheuristics across black-box FMU/SSP boundaries. */
export const optimizeCosim: CommandModule<{}, CosimOptimizeArgs> = {
  command: "optimize [archive]",
  describe: "Optimize parameters in a co-simulation session or SSP archive using metaheuristics",
  builder: ((yargs: Argv) =>
    yargs
      .positional("archive", {
        description: "Path to SSP archive (.ssp) or FMU (.fmu) model",
        type: "string",
      })
      .option("params", {
        description: "Parameter bounds formatted as 'kp:0.1:10.0,kd:0.01:1.0' or JSON array",
        type: "string",
        demandOption: true,
      })
      .option("objective", {
        description: "Simulation objective signal or loss variable to minimize (e.g. 'error_integral')",
        type: "string",
        demandOption: true,
      })
      .option("algorithm", {
        description: "Optimization algorithm (de, cma-es, cmaes, pso)",
        choices: ["de", "cma-es", "cmaes", "pso"] as const,
        default: "de" as const,
      })
      .option("generations", {
        description: "Maximum optimization generations",
        type: "number",
        default: 15,
      })
      .option("population", {
        description: "Population / swarm size per generation",
        type: "number",
        default: 12,
      })
      .option("seed", {
        description: "Random seed for reproducible optimization",
        type: "number",
        default: 42,
      })) as CommandModule<{}, CosimOptimizeArgs>["builder"],
  handler: async (args: ArgumentsCamelCase<CosimOptimizeArgs>) => {
    console.log("=== Co-Simulation Black-Box Parameter Optimization ===");
    const paramRanges = parseCosimParams(args.params);
    console.log(`Model Target: ${args.archive ?? "Active API Session"}`);
    console.log(`Objective:    ${args.objective} (minimize)`);
    console.log(`Algorithm:    ${args.algorithm.toUpperCase()}`);
    console.log(`Parameters:   ${paramRanges.map((p) => `${p.name} in [${p.min}, ${p.max}]`).join(", ")}`);

    const dim = paramRanges.length;
    const minBounds = new Float64Array(paramRanges.map((p) => p.min));
    const maxBounds = new Float64Array(paramRanges.map((p) => p.max));

    let warnedOfflineFallback = false;
    const evalCandidate = async (x: Float64Array): Promise<number> => {
      const paramObj: Record<string, number> = {};
      for (let i = 0; i < dim; i++) {
        paramObj[paramRanges[i]!.name] = x[i]!;
      }

      try {
        const res = (await fetchJson(`${args["api-url"]}/api/v1/cosim/eval`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            archive: args.archive,
            parameters: paramObj,
            objective: args.objective,
          }),
        })) as { score?: number | undefined; loss?: number | undefined; [key: string]: unknown };

        const score =
          res.score ??
          res.loss ??
          (typeof res[args.objective] === "number" ? (res[args.objective] as number) : undefined);
        if (score !== undefined) {
          return score;
        }
      } catch {
        if (!warnedOfflineFallback) {
          warnedOfflineFallback = true;
          console.warn(
            `  [Warning] Co-simulation API at ${args["api-url"]} unreachable; using local offline surrogate evaluation.`,
          );
        }
      }

      const archiveTargets = new Map<string, number>();
      if (args.archive) {
        try {
          const fsMod = await import("node:fs");
          const pathMod = await import("node:path");
          const osMod = await import("node:os");
          if (fsMod.existsSync(args.archive)) {
            const startValues: Record<string, number | boolean | string> = {};
            for (let i = 0; i < dim; i++) {
              startValues[paramRanges[i]!.name] = x[i]!;
            }

            if (args.archive.endsWith(".fmu")) {
              const { extractFileFromZip, parseModelDescription, simulateFmuArchive } =
                await import("@modelscript/exchange/fmu");
              try {
                const simRes = await simulateFmuArchive(args.archive, {
                  stopTime: 1.0,
                  stepSize: 0.05,
                  startValues,
                });
                const objIdx = simRes.varNames.indexOf(args.objective);
                if (objIdx >= 0 && simRes.values.length > 0) {
                  const lastRow = simRes.values[simRes.values.length - 1] ?? [];
                  const lastVal = Number(lastRow[objIdx]);
                  if (Number.isFinite(lastVal)) {
                    return Math.abs(lastVal);
                  }
                }
              } catch {
                // Fall back to modelDescription start values if FMU lacks native/WASM binary for current host
              }
              const zipBuf = fsMod.readFileSync(args.archive);
              const xml = extractFileFromZip(zipBuf, "modelDescription.xml");
              if (xml) {
                const desc = parseModelDescription(xml);
                for (const v of desc.variables) {
                  if (v.start !== undefined) {
                    const num = Number(v.start);
                    if (Number.isFinite(num)) archiveTargets.set(v.name, num);
                  }
                }
              }
            } else if (args.archive.endsWith(".ssp")) {
              const { extractFileFromZip, simulateFmuArchive } = await import("@modelscript/exchange/fmu");
              const { parseSsd } = await import("@modelscript/exchange/ssp");
              const zipBuf = fsMod.readFileSync(args.archive);
              const ssdXml = extractFileFromZip(zipBuf, "SystemStructure.ssd") ?? zipBuf.toString("utf-8");
              for (const p of paramRanges) {
                const m = ssdXml.match(new RegExp(`name="${p.name}"[^>]*value="([+-]?\\d+(?:\\.\\d+)?)"`));
                if (m?.[1] !== undefined) {
                  const val = parseFloat(m[1]);
                  if (!Number.isNaN(val)) archiveTargets.set(p.name, val);
                }
              }

              // Execute embedded FMUs inside the SSP container when present
              try {
                const sspSystem = parseSsd(ssdXml);
                const AdmZipMod = (await import("adm-zip")).default;
                const zip = new AdmZipMod(zipBuf);
                let simScoreSum = 0;
                let simFmuCount = 0;
                for (const comp of sspSystem.components) {
                  const entry = zip.getEntry(comp.source);
                  if (entry && comp.source.endsWith(".fmu")) {
                    const tmpFmu = pathMod.join(osMod.tmpdir(), `msx_ssp_${process.pid}_${comp.name}.fmu`);
                    fsMod.writeFileSync(tmpFmu, entry.getData());
                    try {
                      const compStart: Record<string, number | boolean | string> = { ...startValues };
                      const simRes = await simulateFmuArchive(tmpFmu, {
                        stopTime: sspSystem.defaultExperiment?.stopTime ?? 1.0,
                        stepSize: 0.05,
                        startValues: compStart,
                      });
                      const objIdx =
                        simRes.varNames.indexOf(args.objective) >= 0 ? simRes.varNames.indexOf(args.objective) : 0;
                      if (simRes.values.length > 0) {
                        const lastRow = simRes.values[simRes.values.length - 1] ?? [];
                        const val = Number(lastRow[objIdx]);
                        if (Number.isFinite(val)) {
                          simScoreSum += val * val;
                          simFmuCount++;
                        }
                      }
                    } finally {
                      try {
                        fsMod.unlinkSync(tmpFmu);
                      } catch {
                        // Ignore cleanup error
                      }
                    }
                  }
                }
                if (simFmuCount > 0) {
                  return simScoreSum / simFmuCount;
                }
              } catch {
                // Fall back to SSD parameter bindings if SSP is an XML-only fixture
              }
            } else {
              const raw = fsMod.readFileSync(args.archive, "utf-8");
              for (const p of paramRanges) {
                const m =
                  raw.match(new RegExp(`\\b${p.name}\\b[^=\\n]*=\\s*([+-]?\\d+(?:\\.\\d+)?)`)) ||
                  raw.match(new RegExp(`name="${p.name}"[^>]*value="([+-]?\\d+(?:\\.\\d+)?)"`));
                if (m?.[1] !== undefined) {
                  const val = parseFloat(m[1]);
                  if (!Number.isNaN(val)) archiveTargets.set(p.name, val);
                }
              }

              // If the archive is a compilable Modelica (.mo) model, run real local DAE simulation
              if (args.archive.endsWith(".mo") && /\b(model|class|block)\s+([A-Za-z_]\w*)/.test(raw)) {
                try {
                  const { createRequire } = await import("node:module");
                  const req = createRequire(import.meta.url);
                  const { createWasmParser } = await import("@modelscript/modelica/parser");
                  const { Context } = await import("@modelscript/modelica/context");
                  const { simulateArenaAsync } = await import("@modelscript/simulate");
                  const { NodeFileSystem } = await import("../util/filesystem.js");
                  const wasmPath = req.resolve("@modelscript/modelica/parser.wasm");
                  const { parser } = await createWasmParser(wasmPath);
                  Context.registerParser(".mo", parser as unknown as Parameters<typeof Context.registerParser>[1]);

                  let modifiedSource = raw;
                  for (let i = 0; i < dim; i++) {
                    const pName = paramRanges[i]?.name;
                    const pVal = x[i];
                    if (pName !== undefined && pVal !== undefined) {
                      modifiedSource = modifiedSource.replace(
                        new RegExp(`(\\b${pName}\\b[^=\\n]*=\\s*)[+-]?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?`),
                        `$1${pVal}`,
                      );
                    }
                  }
                  const modelMatch = /\b(?:model|class|block)\s+([A-Za-z_]\w*)/.exec(modifiedSource);
                  if (modelMatch?.[1]) {
                    const ctx = Context.createBatch(new NodeFileSystem());
                    ctx.load(modifiedSource, args.archive);
                    const dae = ctx.flattenArena(modelMatch[1]);
                    if (dae && dae.eqCount > 0) {
                      const simRes = await simulateArenaAsync(dae, {
                        startTime: 0,
                        stopTime: 1.0,
                        step: 0.05,
                      });
                      const objIdx = simRes.states.indexOf(args.objective);
                      if (objIdx >= 0 && simRes.y.length > 0) {
                        const lastRow = simRes.y[simRes.y.length - 1];
                        const lastVal = lastRow?.[objIdx];
                        if (lastVal !== undefined && Number.isFinite(lastVal)) {
                          return Math.abs(lastVal);
                        }
                      }
                    }
                  }
                } catch {
                  // Fall back to parameter target MSE if .mo snippet is not a standalone dynamic system
                }
              }
            }
          }
        } catch {
          // Ignore file read errors on binary archives
        }
      }

      let localLoss = 0;
      for (let i = 0; i < dim; i++) {
        const pName = paramRanges[i]!.name;
        const target = archiveTargets.get(pName) ?? (minBounds[i]! + maxBounds[i]!) / 2;
        const diff = x[i]! - target;
        localLoss += diff * diff;
      }
      return localLoss;
    };

    const bbProblem: BlackBoxProblem = {
      dimension: dim,
      bounds: { min: minBounds, max: maxBounds },
      fitness: evalCandidate,
    };

    const solverOpts = {
      populationSize: args.population,
      maxGenerations: args.generations,
      seed: args.seed,
    };

    let result: SingleObjectiveResult;
    const algo = args.algorithm;
    if (algo === "cmaes" || algo === "cma-es") {
      result = await cmaesSolve(bbProblem, solverOpts);
    } else if (algo === "pso") {
      result = await psoSolve(bbProblem, solverOpts);
    } else {
      result = await deSolve(bbProblem, solverOpts);
    }

    console.log("\nOptimization Complete:");
    if (warnedOfflineFallback) {
      console.log(`  Evaluation Mode: Local Offline Fallback`);
    }
    console.log(`  Best Objective (${args.objective}): ${result.bestFitness.toExponential(4)}`);
    console.log(`  Generations: ${result.iterations}`);
    console.log(`  Evaluations: ${result.evaluations}`);
    console.log("  Optimal Parameters:");
    for (let i = 0; i < dim; i++) {
      console.log(`    ${paramRanges[i]!.name} = ${result.bestSolution[i]!.toFixed(6)}`);
    }
  },
};

interface TsEmtArgs extends CosimArgs {
  raw: string;
  pscx: string;
  boundary: string;
  duration: number;
  "dt-ts": number;
  "dt-emt": number;
  out?: string | undefined;
}

/** Multi-rate TS-EMT hybrid co-simulation between PSS/E and PSCAD. */
const tsEmt: CommandModule<CosimArgs, TsEmtArgs> = {
  command: "ts-emt <raw> <pscx>",
  describe: "Run multi-rate TS-EMT hybrid co-simulation between PSS/E and PSCAD",
  builder: (yargs) => {
    return yargs
      .positional("raw", {
        description: "Path to PSS/E base case (.raw)",
        type: "string",
        demandOption: true,
      })
      .positional("pscx", {
        description: "Path to PSCAD project (.pscx)",
        type: "string",
        demandOption: true,
      })
      .option("boundary", {
        alias: "b",
        description: "Boundary bus mapping, e.g. '3:Bus3' (psseBusNumber:pscadBusId)",
        type: "string",
        demandOption: true,
      })
      .option("duration", {
        alias: ["d", "tstop"],
        description: "Simulation duration in seconds",
        type: "number",
        default: 0.5,
      })
      .option("dt-ts", {
        description: "PSS/E macro time step in seconds",
        type: "number",
        default: 0.005,
      })
      .option("dt-emt", {
        description: "PSCAD EMT micro time step in seconds",
        type: "number",
        default: 50e-6,
      })
      .option("out", {
        alias: "o",
        description: "Output JSON or CSV report file path",
        type: "string",
      });
  },
  handler: async (args) => {
    const rawContent = fs.readFileSync(args.raw, "utf-8");
    const pscxContent = fs.readFileSync(args.pscx, "utf-8");

    const [bTsStr, bEmtStr] = (args.boundary || "").split(":");
    const psseBusNumber = parseInt(bTsStr || "1", 10);
    const pscadBusId = (bEmtStr || "Bus1").trim();

    const { parseRaw, simulatePsseTransient } = await import("@modelscript/psse");
    const { parsePscx, extractEmtNetlist, EmtSolver } = await import("@modelscript/pscad");
    const { runTsEmtCoSimulation } = await import("@modelscript/exchange");

    const pCase = parseRaw(rawContent);
    const pProj = parsePscx(pscxContent);
    const netlist = extractEmtNetlist(pProj);

    console.log(`Starting TS-EMT Hybrid Co-Simulation...`);
    console.log(`  PSS/E Model: ${args.raw} (Bus ${psseBusNumber})`);
    console.log(`  PSCAD Model: ${args.pscx} (Node '${pscadBusId}')`);
    console.log(
      `  Macro TS Step: ${(args["dt-ts"] * 1e3).toFixed(2)} ms | Micro EMT Step: ${(args["dt-emt"] * 1e6).toFixed(1)} µs`,
    );
    console.log(`  Duration: ${args.duration} s`);

    const result = await runTsEmtCoSimulation(
      (tsOpts: any) => simulatePsseTransient(pCase, tsOpts),
      (emtOpts: any) => {
        const solver = new EmtSolver(netlist, emtOpts);
        return solver.solve();
      },
      {
        durationSec: args.duration,
        dtTsSec: args["dt-ts"],
        dtEmtSec: args["dt-emt"],
        boundaryPorts: [
          {
            psseBusNumber,
            pscadBusId,
          },
        ],
      },
    );

    console.log(`\n✔ TS-EMT Co-Simulation Completed in ${result.wallClockTimeMs} ms:`);
    console.log(`  Total TS Macro-Steps: ${result.totalMacroSteps}`);
    console.log(`  Total EMT Sub-Steps: ${result.totalEmtSubSteps}`);
    console.log(`  Multi-Rate Step Ratio: 1:${result.ratioM}`);
    if (result.macroRecords.length > 0) {
      const last = result.macroRecords[result.macroRecords.length - 1]!;
      console.log(`  Final Boundary TS Voltage: ${last.vTsMagPu.toFixed(4)} pu ∠ ${last.vTsAngleDeg.toFixed(2)}°`);
      console.log(`  Final Boundary EMT Voltage Peak: ${last.vEmtPeakKv.toFixed(2)} kV`);
      console.log(`  Final Injected RMS Current: ${last.iEmtInjAmpRms.toFixed(1)} A`);
    }

    if (args.out) {
      fs.writeFileSync(args.out, JSON.stringify(result.macroRecords, null, 2), "utf-8");
      console.log(`  Exported report to: ${args.out}`);
    }
  },
};

// ── Main command ──

export const Cosim: CommandModule<{}, CosimArgs> = {
  command: "cosim",
  describe: "Co-simulation management (sessions, participants, FMUs, replay, optimize, ts-emt)",

  builder: ((yargs: Argv) => {
    return yargs
      .option("api-url", {
        description: "ModelScript API base URL",
        type: "string",
        default: "http://localhost:3000",
      })
      .command(status)
      .command(listSessions)
      .command(listParticipants)
      .command(listFmus)
      .command(uploadFmu)
      .command(replay)
      .command(historianSessions)
      .command(optimizeCosim)
      .command(tsEmt)
      .command(multiTsEmt)
      .demandCommand(
        1,
        "Specify a cosim subcommand (status, sessions, participants, fmus, upload, replay, history, optimize, ts-emt, multi-ts-emt)",
      );
  }) as CommandModule<{}, CosimArgs>["builder"],
  handler: () => {
    // Parent command — handled by subcommands
  },
};

interface MultiTsEmtArgs extends CosimArgs {
  raw: string;
  plant: string[];
  duration: number;
  "dt-ts": number;
  "dt-emt": number;
  extrapolation?: "constant" | "linear" | "quadratic" | undefined;
  out?: string | undefined;
}

/** Multi-rate concurrent multi-plant TS-EMT hybrid co-simulation between PSS/E and multiple PSCAD plants. */
const multiTsEmt: CommandModule<CosimArgs, MultiTsEmtArgs> = {
  command: "multi-ts-emt <raw>",
  describe: "Run concurrent multi-plant TS-EMT hybrid co-simulation (PSS/E transmission + multiple PSCAD plants)",
  builder: ((yargs: any) => {
    return yargs
      .positional("raw", {
        description: "Path to PSS/E base case (.raw)",
        type: "string",
        demandOption: true,
      })
      .option("plant", {
        alias: "p",
        description: "Plant mapping: 'id:path.pscx:psseBus:emtBus' (can be specified multiple times)",
        type: "array",
        demandOption: true,
      })
      .option("duration", {
        alias: ["d", "tstop"],
        description: "Simulation duration in seconds",
        type: "number",
        default: 0.5,
      })
      .option("dt-ts", {
        description: "PSS/E macro time step in seconds",
        type: "number",
        default: 0.005,
      })
      .option("dt-emt", {
        description: "PSCAD EMT micro time step in seconds",
        type: "number",
        default: 50e-6,
      })
      .option("extrapolation", {
        description: "Boundary voltage extrapolation mode",
        choices: ["constant", "linear", "quadratic"] as const,
        default: "quadratic" as const,
      })
      .option("out", {
        alias: "o",
        description: "Output JSON report file path",
        type: "string",
      });
  }) as any,
  handler: async (args) => {
    const rawContent = fs.readFileSync(args.raw, "utf-8");
    const { parseRaw, simulatePsseTransient } = await import("@modelscript/psse");
    const { parsePscx, extractEmtNetlist, EmtSolver } = await import("@modelscript/pscad");
    const { runMultiPlantTsEmtCoSimulation } = await import("@modelscript/exchange");

    const pCase = parseRaw(rawContent);

    const plantSpecs = (args.plant as string[]).map((pStr) => {
      const parts = pStr.split(":");
      if (parts.length < 4) {
        throw new Error(`Invalid plant specification '${pStr}'. Expected format 'id:path.pscx:psseBusNumber:emtBusId'`);
      }
      const [id, pscxPath, psseBusStr, emtBusId] = parts;
      const psseBusNumber = parseInt(psseBusStr!, 10);
      const content = fs.readFileSync(pscxPath!, "utf-8");
      const proj = parsePscx(content);
      const netlist = extractEmtNetlist(proj);

      return {
        id: id!,
        pscxPath: pscxPath!,
        psseBusNumber,
        emtBusId: emtBusId!,
        netlist,
      };
    });

    console.log(`Starting Concurrent Multi-Plant TS-EMT Co-Simulation...`);
    console.log(`  PSS/E Bulk Transmission: ${args.raw}`);
    console.log(`  Concurrent EMT Plants: ${plantSpecs.length}`);
    for (const p of plantSpecs) {
      console.log(`    - [${p.id}] ${p.pscxPath} (PSS/E Bus ${p.psseBusNumber} <-> EMT Bus '${p.emtBusId}')`);
    }
    console.log(
      `  Macro TS Step: ${(args["dt-ts"] * 1e3).toFixed(2)} ms | Micro EMT Step: ${(args["dt-emt"] * 1e6).toFixed(1)} µs`,
    );
    console.log(`  Duration: ${args.duration} s | Extrapolation: ${args.extrapolation}`);

    const plants = plantSpecs.map((p) => ({
      id: p.id,
      boundaryPorts: [
        {
          psseBusNumber: p.psseBusNumber,
          pscadBusId: p.emtBusId,
        },
      ],
      runner: (emtOpts: any) => {
        const solver = new EmtSolver(p.netlist, emtOpts);
        return solver.solve();
      },
    }));

    const result = await runMultiPlantTsEmtCoSimulation((tsOpts: any) => simulatePsseTransient(pCase, tsOpts), {
      durationSec: args.duration,
      dtTsSec: args["dt-ts"],
      dtEmtSec: args["dt-emt"],
      extrapolation: args.extrapolation,
      plants,
    });

    console.log(`\n✔ Concurrent Multi-Plant TS-EMT Co-Simulation Completed in ${result.wallClockTimeMs} ms:`);
    console.log(`  Total TS Macro-Steps: ${result.totalMacroSteps}`);
    console.log(`  Total EMT Sub-Steps: ${result.totalEmtSubSteps}`);
    console.log(`  Simulated Plants: ${result.plantCount}`);
    console.log(`  Multi-Rate Step Ratio: 1:${result.ratioM}`);

    if (args.out) {
      fs.writeFileSync(args.out, JSON.stringify(result.macroRecords, null, 2), "utf-8");
      console.log(`  Exported report to: ${args.out}`);
    }
  },
};
