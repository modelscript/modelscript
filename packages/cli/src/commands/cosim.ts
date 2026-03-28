// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * CLI `msc cosim` command group.
 *
 * Subcommands for managing co-simulation sessions, participants,
 * FMU uploads, and historian replay from the command line.
 */

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

// ── Main command ──

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export const Cosim: CommandModule<{}, CosimArgs> = {
  command: "cosim",
  describe: "Co-simulation management (sessions, participants, FMUs, replay)",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  builder: ((yargs: any) => {
    return yargs
      .option("api-url", {
        description: "ModelScript API base URL",
        type: "string",
        default: "http://localhost:3000",
      })
      .command(listSessions)
      .command(listParticipants)
      .command(listFmus)
      .command(uploadFmu)
      .command(replay)
      .command(historianSessions)
      .demandCommand(1, "Specify a cosim subcommand (sessions, participants, fmus, upload, replay, history)");
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  }) as CommandModule<{}, CosimArgs>["builder"],
  handler: () => {
    // Parent command — handled by subcommands
  },
};
