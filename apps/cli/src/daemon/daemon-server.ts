// SPDX-License-Identifier: AGPL-3.0-or-later

import { Context } from "@modelscript/modelica/context";
import { createWasmParser } from "@modelscript/modelica/parser";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import readline from "node:readline";
import { Compile } from "../commands/compile.js";
import { Instantiate } from "../commands/instantiate.js";
import { Lint } from "../commands/lint.js";
import { Simulate } from "../commands/simulate.js";
import { getSocketPath } from "./socket-path.js";

const require = createRequire(import.meta.url);
const modelicaWasmPath = require.resolve("@modelscript/modelica/parser.wasm");

// Pre-warm the WASM parser into memory
try {
  const { parser } = await createWasmParser(modelicaWasmPath);
  Context.registerParser(".mo", parser as unknown as Parameters<typeof Context.registerParser>[1]);
} catch (err) {
  console.error("[Daemon] Failed to pre-warm WASM parser:", err);
}

const socketPath = getSocketPath();

// Clean up stale socket file if it exists
if (fs.existsSync(socketPath)) {
  try {
    fs.unlinkSync(socketPath);
  } catch {
    // ignore
  }
}

const IDLE_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour
let idleTimer: NodeJS.Timeout;

function resetIdleTimer() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    console.log("[Daemon] Idle timeout reached. Shutting down.");
    shutdown();
  }, IDLE_TIMEOUT_MS);
}

const server = net.createServer((socket) => {
  resetIdleTimer();

  const rl = readline.createInterface({
    input: socket,
    crlfDelay: Infinity,
  });

  rl.on("line", async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    try {
      const msg = JSON.parse(trimmed);

      if (msg.type === "ping") {
        socket.write(JSON.stringify({ type: "pong", pid: process.pid, uptime: process.uptime() }) + "\n");
        return;
      }

      if (msg.type === "stop") {
        socket.write(JSON.stringify({ type: "stopping" }) + "\n");
        socket.end(() => {
          shutdown();
        });
        return;
      }

      if (msg.type === "run") {
        const { cwd, argv } = msg;
        const origCwd = process.cwd();
        if (cwd) {
          try {
            process.chdir(cwd);
          } catch {
            // ignore
          }
        }

        // Intercept stdout & stderr during handler execution
        const origStdoutWrite = process.stdout.write.bind(process.stdout);
        const origStderrWrite = process.stderr.write.bind(process.stderr);
        const origConsoleLog = console.log;
        const origConsoleError = console.error;

        process.stdout.write = ((chunk: unknown) => {
          socket.write(JSON.stringify({ type: "stdout", data: String(chunk) }) + "\n");
          return true;
        }) as unknown as typeof process.stdout.write;

        process.stderr.write = ((chunk: unknown) => {
          socket.write(JSON.stringify({ type: "stderr", data: String(chunk) }) + "\n");
          return true;
        }) as unknown as typeof process.stderr.write;

        console.log = (...args: unknown[]) => {
          socket.write(JSON.stringify({ type: "stdout", data: args.map(String).join(" ") + "\n" }) + "\n");
        };

        console.error = (...args: unknown[]) => {
          socket.write(JSON.stringify({ type: "stderr", data: args.map(String).join(" ") + "\n" }) + "\n");
        };

        let exitCode = 0;
        try {
          const cmd = argv[0];
          if (cmd === "compile" || cmd === "flatten") {
            const name = argv[1];
            const paths = argv.slice(2);
            await (Compile.handler as (args: unknown) => Promise<void> | void)({ name, paths, _: argv, $0: "msc" });
          } else if (cmd === "instantiate") {
            const name = argv[1];
            const paths = argv.slice(2);
            await (Instantiate.handler as (args: unknown) => Promise<void> | void)({ name, paths, _: argv, $0: "msc" });
          } else if (cmd === "simulate") {
            const name = argv[1];
            const paths = argv.slice(2);
            await (Simulate.handler as (args: unknown) => Promise<void> | void)({
              name,
              paths,
              _: argv,
              $0: "msc",
              solver: "cvode",
              engine: "arena",
            });
          } else if (cmd === "lint") {
            const paths = argv.slice(1);
            await (Lint.handler as (args: unknown) => Promise<void> | void)({
              path: paths[0],
              paths,
              _: argv,
              $0: "msc",
            });
          } else {
            // Fallback: command not directly supported in daemon runner
            socket.write(JSON.stringify({ type: "fallback" }) + "\n");
            return;
          }
        } catch (err: unknown) {
          exitCode = 1;
          socket.write(
            JSON.stringify({
              type: "stderr",
              data: (err instanceof Error ? (err.stack ?? err.message) : String(err)) + "\n",
            }) + "\n",
          );
        } finally {
          process.stdout.write = origStdoutWrite;
          process.stderr.write = origStderrWrite;
          console.log = origConsoleLog;
          console.error = origConsoleError;
          try {
            process.chdir(origCwd);
          } catch {
            // ignore
          }
          socket.write(JSON.stringify({ type: "exit", code: exitCode }) + "\n");
          socket.end();
        }
      }
    } catch (err) {
      console.error("[Daemon] Error parsing message:", err);
    }
  });
});

server.listen(socketPath, () => {
  console.log(`[Daemon] Server listening on ${socketPath} (PID: ${process.pid})`);
  resetIdleTimer();
});

function shutdown() {
  server.close(() => {
    if (fs.existsSync(socketPath)) {
      try {
        fs.unlinkSync(socketPath);
      } catch {
        // ignore
      }
    }
    process.exit(0);
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
process.on("exit", () => {
  if (fs.existsSync(socketPath)) {
    try {
      fs.unlinkSync(socketPath);
    } catch {
      // ignore
    }
  }
});
