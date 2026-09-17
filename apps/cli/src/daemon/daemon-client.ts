// SPDX-License-Identifier: AGPL-3.0-or-later

import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { getSocketPath } from "./socket-path.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function isSocketAlive(timeoutMs = 300): Promise<{ alive: boolean; pid?: number; uptime?: number }> {
  const socketPath = getSocketPath();
  if (!fs.existsSync(socketPath)) {
    return Promise.resolve({ alive: false });
  }

  return new Promise((resolve) => {
    const socket = net.connect(socketPath);
    let resolved = false;

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        resolve({ alive: false });
      }
    }, timeoutMs);

    socket.on("connect", () => {
      socket.write(JSON.stringify({ type: "ping" }) + "\n");
    });

    const rl = readline.createInterface({ input: socket, crlfDelay: Infinity });
    rl.on("line", (line) => {
      try {
        const msg = JSON.parse(line.trim());
        if (msg.type === "pong") {
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            socket.end();
            resolve({ alive: true, pid: msg.pid, uptime: msg.uptime });
          }
        }
      } catch {
        // ignore
      }
    });

    socket.on("error", () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve({ alive: false });
      }
    });
  });
}

export async function startDaemon(): Promise<boolean> {
  const status = await isSocketAlive();
  if (status.alive) {
    return true;
  }

  const serverScript = path.resolve(__dirname, "daemon-server.js");
  const child = spawn(process.execPath, [serverScript], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=4096" },
  });
  child.unref();

  // Poll until socket is alive (up to 2 seconds)
  const start = Date.now();
  while (Date.now() - start < 2000) {
    await new Promise((r) => setTimeout(r, 50));
    const check = await isSocketAlive(100);
    if (check.alive) return true;
  }

  return false;
}

export function stopDaemon(): Promise<boolean> {
  const socketPath = getSocketPath();
  if (!fs.existsSync(socketPath)) return Promise.resolve(false);

  return new Promise((resolve) => {
    const socket = net.connect(socketPath);
    socket.on("connect", () => {
      socket.write(JSON.stringify({ type: "stop" }) + "\n");
    });
    socket.on("data", () => {
      socket.end();
      resolve(true);
    });
    socket.on("error", () => {
      resolve(false);
    });
  });
}

export function forwardToDaemon(argv: string[]): Promise<number | null> {
  const socketPath = getSocketPath();
  return new Promise((resolve) => {
    const socket = net.connect(socketPath);

    socket.on("connect", () => {
      const payload = JSON.stringify({
        type: "run",
        cwd: process.cwd(),
        argv,
      });
      socket.write(payload + "\n");
    });

    const rl = readline.createInterface({ input: socket, crlfDelay: Infinity });

    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const msg = JSON.parse(trimmed);
        if (msg.type === "stdout") {
          process.stdout.write(msg.data);
        } else if (msg.type === "stderr") {
          process.stderr.write(msg.data);
        } else if (msg.type === "exit") {
          resolve(msg.code ?? 0);
        } else if (msg.type === "fallback") {
          // Daemon cannot handle this command, fallback to local execution
          resolve(null);
        }
      } catch {
        process.stdout.write(line + "\n");
      }
    });

    socket.on("error", () => {
      // Failed to connect, fallback to in-process execution
      resolve(null);
    });
  });
}
