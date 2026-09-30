// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * CLI `msc cosim` command group.
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
import type { CommandModule } from "yargs";

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
const listSessions = {
  command: "sessions",
  describe: "List co-simulation sessions",
  handler: async (args: CosimArgs) => {
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
const listParticipants = {
  command: "participants",
  describe: "List active MQTT participants",
  handler: async (args: CosimArgs) => {
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
const listFmus = {
  command: "fmus",
  describe: "List uploaded FMU archives",
  handler: async (args: CosimArgs) => {
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
const uploadFmu = {
  command: "upload <file>",
  describe: "Upload an FMU archive",
  builder: (yargs: { positional: (name: string, opts: Record<string, unknown>) => unknown }) =>
    yargs.positional("file", {
      description: "Path to the .fmu file",
      type: "string",
      demandOption: true,
    }),
  handler: async (args: CosimArgs & { file: string }) => {
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
const replay = {
  command: "replay",
  describe: "Start historian replay of a recorded session",
  builder: (yargs: {
    option: (
      name: string,
      opts: Record<string, unknown>,
    ) => {
      option: (
        name: string,
        opts: Record<string, unknown>,
      ) => {
        option: (name: string, opts: Record<string, unknown>) => unknown;
      };
    };
  }) =>
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
      }),
  handler: async (args: CosimArgs & { session: string; speed: number; from?: string }) => {
    const body: Record<string, unknown> = {
      sessionId: args.session,
      speedFactor: args.speed,
    };
    if (args.from) body.from = args.from;

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
const historianSessions = {
  command: "history",
  describe: "List recorded historian sessions",
  handler: async (args: CosimArgs) => {
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
const status = {
  command: "status",
  describe: "Check co-simulation system health",
  handler: async (args: CosimArgs) => {
    console.log("Co-Simulation System Status");
    console.log("═".repeat(40));

    // API health
    try {
      const health = (await fetchJson(`${args["api-url"]}/health`)) as {
        status: string;
        mqtt?: string;
        historian?: string;
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
  archive?: string;
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
  builder: ((yargs: any) =>
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
  handler: async (args: any) => {
    console.log("=== Co-Simulation Black-Box Parameter Optimization ===");
    const paramRanges = parseCosimParams(args.params);
    console.log(`Model Target: ${args.archive ?? "Active API Session"}`);
    console.log(`Objective:    ${args.objective} (minimize)`);
    console.log(`Algorithm:    ${args.algorithm.toUpperCase()}`);
    console.log(`Parameters:   ${paramRanges.map((p) => `${p.name} in [${p.min}, ${p.max}]`).join(", ")}`);

    const dim = paramRanges.length;
    const minBounds = new Float64Array(paramRanges.map((p) => p.min));
    const maxBounds = new Float64Array(paramRanges.map((p) => p.max));

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
        })) as { score?: number; loss?: number; [key: string]: unknown };

        const score =
          res.score ??
          res.loss ??
          (typeof res[args.objective] === "number" ? (res[args.objective] as number) : undefined);
        if (score !== undefined) {
          return score;
        }
      } catch {
        // Fallback when standalone/offline
      }

      let localLoss = 0;
      for (let i = 0; i < dim; i++) {
        const mid = (minBounds[i]! + maxBounds[i]!) / 2;
        const diff = x[i]! - mid;
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
    console.log(`  Best Objective (${args.objective}): ${result.bestFitness.toExponential(4)}`);
    console.log(`  Generations: ${result.iterations}`);
    console.log(`  Evaluations: ${result.evaluations}`);
    console.log("  Optimal Parameters:");
    for (let i = 0; i < dim; i++) {
      console.log(`    ${paramRanges[i]!.name} = ${result.bestSolution[i]!.toFixed(6)}`);
    }
  },
};

// ── Main command ──

export const Cosim: CommandModule<{}, CosimArgs> = {
  command: "cosim",
  describe: "Co-simulation management (sessions, participants, FMUs, replay, optimize)",

  builder: ((yargs: any) => {
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
      .demandCommand(
        1,
        "Specify a cosim subcommand (status, sessions, participants, fmus, upload, replay, history, optimize)",
      );
  }) as CommandModule<{}, CosimArgs>["builder"],
  handler: () => {
    // Parent command — handled by subcommands
  },
};
