// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CommandModule } from "yargs";
import { isSocketAlive, startDaemon, stopDaemon } from "../daemon/daemon-client.js";

interface DaemonArgs {
  action: "start" | "stop" | "status" | "restart";
}

export const Daemon: CommandModule<{}, DaemonArgs> = {
  command: "daemon <action>",
  describe: "Manage the background compiler daemon for instant compilation",
  builder: (yargs) => {
    return yargs.positional("action", {
      choices: ["start", "stop", "status", "restart"] as const,
      demandOption: true,
      description: "Daemon lifecycle action",
    });
  },
  handler: async (args) => {
    if (args.action === "status") {
      const status = await isSocketAlive();
      if (status.alive) {
        console.log(`[Daemon] Running (PID: ${status.pid}, uptime: ${status.uptime?.toFixed(1)}s)`);
      } else {
        console.log(`[Daemon] Not running`);
      }
    } else if (args.action === "start") {
      const status = await isSocketAlive();
      if (status.alive) {
        console.log(`[Daemon] Already running (PID: ${status.pid})`);
        return;
      }
      console.log("[Daemon] Starting background daemon...");
      const started = await startDaemon();
      if (started) {
        const newStatus = await isSocketAlive();
        console.log(`[Daemon] Started successfully (PID: ${newStatus.pid})`);
      } else {
        console.error("[Daemon] Failed to start background daemon.");
        process.exit(1);
      }
    } else if (args.action === "stop") {
      const stopped = await stopDaemon();
      if (stopped) {
        console.log("[Daemon] Stopped successfully.");
      } else {
        console.log("[Daemon] Daemon was not running.");
      }
    } else if (args.action === "restart") {
      await stopDaemon();
      await new Promise((r) => setTimeout(r, 200));
      const started = await startDaemon();
      if (started) {
        const newStatus = await isSocketAlive();
        console.log(`[Daemon] Restarted successfully (PID: ${newStatus.pid})`);
      } else {
        console.error("[Daemon] Failed to restart daemon.");
        process.exit(1);
      }
    }
  },
};
