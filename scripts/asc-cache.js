// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Universal Transparent Compilation & WASM Cache for Test Suites.
 *
 * Speeds up monorepo test runs by caching compiled AssemblyScript parser WASM binaries
 * in .cache/asc-tests/. Uses three non-invasive integration layers:
 *  1. fs.writeFileSync hook: When parser.ts is written into a test scratch directory,
 *     restores parser.wasm from cache if a matching binary exists.
 *  2. fs.readFileSync hook: When a test reads parser.wasm, ensures the compiled binary
 *     is persisted to .cache/asc-tests/ for subsequent runs.
 *  3. childProcess.execFileSync hook: Intercepts direct asc CLI invocations.
 */

import cjsCp, * as cjsCpMod from "child_process";
import cjsFs, * as cjsFsMod from "fs";
import nodeCp, * as nodeCpMod from "node:child_process";
import crypto from "node:crypto";
import nodeFs, * as nodeFsMod from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "..");
const cacheDir = path.resolve(repoRoot, ".cache", "asc-tests");

try {
  nodeFs.mkdirSync(cacheDir, { recursive: true });
} catch {}

function hashDirectorySources(dir) {
  try {
    const entries = nodeFs.readdirSync(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    const hash = crypto.createHash("sha256");
    for (const ent of entries) {
      if (ent.isFile() && (ent.name.endsWith(".ts") || ent.name.endsWith(".json"))) {
        const filePath = path.join(dir, ent.name);
        hash.update(ent.name);
        hash.update(nodeFs.readFileSync(filePath));
      }
    }
    return hash.digest("hex");
  } catch {
    return null;
  }
}

// Layer 1 & 2: Filesystem hooks for auto-restoring and auto-saving WASM
function hookFs(fsTarget) {
  if (!fsTarget) return;

  const origWrite = fsTarget.writeFileSync;
  if (origWrite && !fsTarget._ascHookedWrite) {
    try {
      fsTarget.writeFileSync = function (file, ...args) {
        if (typeof file === "string") {
          try {
            nodeFs.mkdirSync(path.dirname(file), { recursive: true });
          } catch {}
        }
        const res = origWrite.apply(this, [file, ...args]);
        if (typeof file === "string" && (file.endsWith("parser.ts") || file.endsWith("/parser.ts"))) {
          const dir = path.dirname(file);
          const wasmDest = path.join(dir, "parser.wasm");
          if (!nodeFs.existsSync(wasmDest) || nodeFs.statSync(wasmDest).size === 0) {
            const key = hashDirectorySources(dir);
            if (key) {
              const cached = path.join(cacheDir, `${key}.wasm`);
              if (nodeFs.existsSync(cached) && nodeFs.statSync(cached).size > 0) {
                try {
                  nodeFs.copyFileSync(cached, wasmDest);
                } catch {}
              }
            }
          }
        }
        return res;
      };
      fsTarget._ascHookedWrite = true;
    } catch {}
  }

  const origRead = fsTarget.readFileSync;
  if (origRead && !fsTarget._ascHookedRead) {
    try {
      fsTarget.readFileSync = function (file, ...args) {
        const res = origRead.apply(this, [file, ...args]);
        if (
          typeof file === "string" &&
          file.endsWith(".wasm") &&
          (file.includes("scratch_build") || file.includes("scratch_"))
        ) {
          try {
            const dir = path.dirname(file);
            const key = hashDirectorySources(dir);
            if (key) {
              const cached = path.join(cacheDir, `${key}.wasm`);
              if (!nodeFs.existsSync(cached) || nodeFs.statSync(cached).size === 0) {
                nodeFs.copyFileSync(file, cached);
              }
            }
          } catch {}
        }
        return res;
      };
      fsTarget._ascHookedRead = true;
    } catch {}
  }
}

hookFs(nodeFs);
hookFs(nodeFsMod);
hookFs(cjsFs);
hookFs(cjsFsMod);

// Layer 3: Process execution hook
function isAscInvocation(cmd, args) {
  if (typeof cmd === "string") {
    if (cmd.endsWith("/asc") || cmd.endsWith("\\asc") || cmd === "asc") return true;
    if (cmd.includes(".bin/asc") || (cmd.includes("asc") && !cmd.includes("test"))) return true;
  }
  if (Array.isArray(args) && args.length > 0) {
    if (args[0] === "asc" || (typeof args[0] === "string" && args[0].endsWith("/asc"))) return true;
  }
  return false;
}

function hookCp(cpTarget) {
  if (!cpTarget) return;
  const origExec = cpTarget.execFileSync;
  if (!origExec || cpTarget._ascHookedExec) return;

  try {
    cpTarget.execFileSync = function (cmd, ...rest) {
      const args = Array.isArray(rest[0]) ? rest[0] : [];
      if (!isAscInvocation(cmd, args)) {
        return origExec.apply(this, [cmd, ...rest]);
      }

      let outWasm = null;
      const oIndex = args.indexOf("-o");
      if (oIndex !== -1 && args[oIndex + 1]) {
        outWasm = path.resolve(args[oIndex + 1]);
      }

      let entryFile = null;
      for (const arg of args) {
        if (typeof arg === "string" && !arg.startsWith("-") && (arg.endsWith(".ts") || arg.endsWith(".as"))) {
          entryFile = path.resolve(arg);
          break;
        }
      }

      if (outWasm && entryFile && nodeFs.existsSync(entryFile)) {
        const key = hashDirectorySources(path.dirname(entryFile));
        if (key) {
          const cached = path.join(cacheDir, `${key}.wasm`);
          if (nodeFs.existsSync(cached) && nodeFs.statSync(cached).size > 0) {
            try {
              nodeFs.mkdirSync(path.dirname(outWasm), { recursive: true });
              nodeFs.copyFileSync(cached, outWasm);
              return Buffer.from("");
            } catch {}
          }
        }
      }

      const res = origExec.apply(this, [cmd, ...rest]);
      if (outWasm && nodeFs.existsSync(outWasm) && entryFile) {
        const key = hashDirectorySources(path.dirname(entryFile));
        if (key) {
          const cached = path.join(cacheDir, `${key}.wasm`);
          try {
            nodeFs.copyFileSync(outWasm, cached);
          } catch {}
        }
      }
      return res;
    };
    cpTarget._ascHookedExec = true;
  } catch {}
}

hookCp(nodeCp);
hookCp(nodeCpMod);
hookCp(cjsCp);
hookCp(cjsCpMod);
