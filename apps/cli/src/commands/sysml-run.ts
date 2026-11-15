// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  compileAssemblyScript,
  discoverImplementationForDefinition,
  inferKernelScheme,
  runTsKernel,
  runWasmKernel,
  type KernelResult,
} from "@modelscript/sdk";
import { coerceSysmlAttributes, evaluateSysmlDefinition, parseSysmlDefinitions } from "@modelscript/sysml2";
import * as fs from "node:fs";
import * as path from "node:path";
import type { CommandModule } from "yargs";

export interface SysmlRunArgs {
  file: string;
  def?: string;
  json?: boolean;
  timeout?: number;
}

function findPackageRoot(sysmlFilePath: string): string {
  const startDir = path.dirname(path.resolve(sysmlFilePath));
  let dir = startDir;
  for (let i = 0; i < 4; i++) {
    if (
      fs.existsSync(path.join(dir, "assembly")) ||
      fs.existsSync(path.join(dir, "data")) ||
      fs.existsSync(path.join(dir, "package.json")) ||
      fs.existsSync(path.join(dir, "modelscript.json"))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.basename(startDir) === "src" ? path.dirname(startDir) : startDir;
}

function collectTsFilesInDir(rootDir: string, subDir?: string): Record<string, string> {
  const files: Record<string, string> = {};
  const startDir = subDir ? path.join(rootDir, subDir) : rootDir;
  if (!fs.existsSync(startDir)) return files;

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(?:[cm]?ts|tsx|[cm]?js|jsx)$/i.test(entry.name)) {
        const rel = path.relative(rootDir, full).replace(/\\/g, "/");
        files[rel] = fs.readFileSync(full, "utf8");
      }
    }
  };
  walk(startDir);
  return files;
}

export const SysmlRunCommand: CommandModule<object, SysmlRunArgs> = {
  command: "sysml-run <file>",
  describe: "Compile AssemblyScript/TypeScript kernels and verify SysML v2 definitions headlessly",
  builder: (yargs) =>
    yargs
      .positional("file", {
        type: "string",
        demandOption: true,
        describe: "Path to .sysml file",
      })
      .option("def", {
        type: "string",
        describe: "Specific SysML v2 definition name to run (runs all if omitted)",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "Emit machine-readable JSON results",
      })
      .option("timeout", {
        type: "number",
        default: 10000,
        describe: "Watchdog timeout in milliseconds per WASM kernel",
      }) as unknown as import("yargs").Argv<SysmlRunArgs>,
  async handler(argv) {
    const absFile = path.resolve(argv.file);
    const sysmlSource = fs.readFileSync(absFile, "utf8");
    const pkg = parseSysmlDefinitions(sysmlSource);
    const rootDir = findPackageRoot(absFile);
    const defs = argv.def ? pkg.definitions.filter((d) => d.name === argv.def) : pkg.definitions;

    if (defs.length === 0) {
      console.error(`No matching SysML v2 definitions found in ${argv.file}`);
      process.exitCode = 1;
      return;
    }

    const asFiles = collectTsFilesInDir(rootDir, "assembly");
    let allTsFiles: Record<string, string> | undefined;
    const results: Array<{ definition: string; result: KernelResult }> = [];
    let allOk = true;

    for (const def of defs) {
      const inputParameters = coerceSysmlAttributes(def.attributes);
      const referencedFiles: Array<{ fileName: string; content: string }> = [];
      const filePathPattern = /(?:^src\/|^\.\/|\.(?:mo|raw|dyr|seq|pscx|cfg|dat|csv|json|sysml|dss|olr)$)/i;

      for (const [k, v] of Object.entries(def.attributes)) {
        if (k === "implementation" || !filePathPattern.test(v)) continue;
        const candidate = path.resolve(rootDir, v.replace(/^\.\//, ""));
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          referencedFiles.push({ fileName: v, content: fs.readFileSync(candidate, "utf8") });
        }
      }

      const kernelInput = {
        definitionName: def.name,
        packageName: pkg.packageName,
        parameters: inputParameters,
        ...(referencedFiles.length > 0 ? { files: referencedFiles } : {}),
      };

      let resolvedImpl = def.implementation
        ? {
            ...def.implementation,
            scheme:
              def.implementation.scheme === "sysml"
                ? ("sysml" as const)
                : inferKernelScheme(def.implementation.modulePath, (allTsFiles ??= collectTsFilesInDir(rootDir))),
          }
        : discoverImplementationForDefinition(def.name, (allTsFiles ??= collectTsFilesInDir(rootDir)));

      let result: KernelResult;
      if (resolvedImpl?.scheme === "wasm") {
        let wasmBytes: Uint8Array;
        if (resolvedImpl.modulePath.endsWith(".ts")) {
          const compiled = await compileAssemblyScript(resolvedImpl.modulePath, asFiles, {
            optimize: true,
          });
          if (!compiled.ok || !compiled.wasmBytes) {
            throw new Error(
              `AssemblyScript compile failed for ${resolvedImpl.modulePath}:\n${compiled.diagnostics.join("\n")}`,
            );
          }
          wasmBytes = compiled.wasmBytes;
        } else {
          wasmBytes = new Uint8Array(
            fs.readFileSync(path.resolve(rootDir, resolvedImpl.modulePath.replace(/^\.\//, ""))),
          );
        }

        result = await runWasmKernel(wasmBytes, resolvedImpl.exportName, kernelInput, {
          timeoutMs: argv.timeout ?? 10_000,
          preemptible: true,
        });
      } else if (resolvedImpl?.scheme === "ts") {
        allTsFiles ??= collectTsFilesInDir(rootDir);
        result = await runTsKernel(resolvedImpl.modulePath, allTsFiles, resolvedImpl.exportName, kernelInput, {
          timeoutMs: argv.timeout ?? 10_000,
          preemptible: true,
          host: {
            readFile: (relPath: string) => {
              const candidate = path.resolve(rootDir, relPath.replace(/^\.\//, ""));
              if (!fs.existsSync(candidate)) {
                throw new Error(`File not found: ${relPath}`);
              }
              return fs.readFileSync(candidate, "utf8");
            },
            simulate: async (modelPath: string, opts) => {
              const candidate = path.resolve(rootDir, modelPath.replace(/^\.\//, ""));
              if (!fs.existsSync(candidate)) {
                throw new Error(`Model file not found: ${modelPath}`);
              }
              const source = fs.readFileSync(candidate, "utf8");
              const ext = path.extname(candidate).toLowerCase();

              if (ext === ".mo") {
                const { createRequire } = await import("node:module");
                const { Context } = await import("@modelscript/modelica/context");
                const { NodeFileSystem } = await import("../util/filesystem.js");
                const { createWasmParser } = await import("@modelscript/modelica/parser");
                const { simulateArenaAsync } = await import("@modelscript/simulate");
                const req = createRequire(import.meta.url);
                const { parser } = await createWasmParser(req.resolve("@modelscript/modelica/parser.wasm"));
                Context.registerParser(".mo", parser as unknown as Parameters<typeof Context.registerParser>[1]);
                const ctx = Context.createBatch(new NodeFileSystem());
                await ctx.addLibrary(candidate);
                const clsMatch = /\b(?:model|block|class)\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(source);
                const modelName = clsMatch?.[1] ?? path.basename(candidate, ".mo");
                const dae = ctx.flattenArena(modelName);
                if (!dae) throw new Error(`Failed to flatten Modelica model '${modelName}'`);
                const sim = await simulateArenaAsync(dae, {
                  stopTime: opts?.stopTime ?? 1.0,
                  step: opts?.stepSize ?? 0.01,
                });
                const waveforms: Record<string, { x: number[]; y: number[] }> = {};
                for (let i = 0; i < sim.states.length; i++) {
                  const varName = sim.states[i]!;
                  waveforms[varName] = { x: sim.t, y: sim.y.map((row) => row[i] ?? 0) };
                }
                return waveforms;
              }

              if (ext === ".raw") {
                const { parseRaw, solvePowerFlow } = await import("@modelscript/psse");
                const parsed = parseRaw(source);
                const sol = solvePowerFlow(parsed);
                const busNums = sol.buses.map((b) => b.busNumber);
                return {
                  vmPu: { x: busNums, y: sol.buses.map((b) => b.vm) },
                  vaDeg: { x: busNums, y: sol.buses.map((b) => b.va) },
                };
              }

              if (ext === ".pscx") {
                const { runEmtSimulationFromXmlAsync } = await import("@modelscript/pscad");
                const { result: emtRes } = await runEmtSimulationFromXmlAsync(source, {
                  durationSec: opts?.stopTime ?? 0.2,
                  timeStepSec: opts?.stepSize ?? 50e-6,
                });
                const tArr = Array.from(emtRes.time);
                const waveforms: Record<string, { x: number[]; y: number[] }> = {};
                for (const [bus, v] of emtRes.busVoltages.entries()) {
                  waveforms[`V_${bus}`] = { x: tArr, y: Array.from(v) };
                }
                for (const [br, cur] of emtRes.branchCurrents.entries()) {
                  waveforms[`I_${br}`] = { x: tArr, y: Array.from(cur) };
                }
                return waveforms;
              }

              if (ext === ".dss") {
                const { parseOpenDss, solveDistributionPowerFlow } = await import("@modelscript/opendss");
                const deck = parseOpenDss(source, candidate);
                const summary = solveDistributionPowerFlow(deck);
                const buses = Array.from(summary.buses.values());
                const indices = buses.map((_, idx) => idx);
                return {
                  vMagPu: { x: indices, y: buses.map((b) => b.vMagPu) },
                  vAngleDeg: { x: indices, y: buses.map((b) => b.vAngleDeg) },
                };
              }

              throw new Error(`Unsupported simulation model extension '${ext}' for '${modelPath}'.`);
            },
          },
        });
      } else {
        result = {
          ok: true,
          kernelId: def.name,
          parameters: inputParameters,
          summary: `Evaluated SysML v2 ${def.kind} '${def.name}'`,
          artifacts: [],
        };
      }

      if (def.constraintSpecs.length > 0) {
        const evalRes = evaluateSysmlDefinition(def, {
          ...inputParameters,
          ...(result.parameters ?? {}),
        });
        result.ok = result.ok && evalRes.passed;
        result.artifacts = [
          ...(result.artifacts ?? []),
          {
            kind: "compliance-matrix",
            id: `${def.name}-constraints`,
            title: `${def.name} Verification (minMargin=${evalRes.minMargin.toFixed(4)})`,
            columns: ["Check ID", "Constraint", "Status", "Margin", "Details"],
            rows: evalRes.checks.map((c) => [
              c.id,
              c.expression,
              c.vacuous ? "VACUOUS" : c.passed ? "PASS" : "FAIL",
              c.margin.toFixed(4),
              c.details,
            ]),
          },
        ];
      }

      if (!result.ok) allOk = false;
      results.push({ definition: def.name, result });
    }

    if (argv.json) {
      console.log(JSON.stringify({ packageName: pkg.packageName, ok: allOk, results }, null, 2));
    } else {
      for (const r of results) {
        console.log(
          `[${r.result.ok ? "PASS" : "FAIL"}] ${pkg.packageName}.${r.definition} — ${r.result.summary ?? ""}`,
        );
      }
    }

    if (!allOk) process.exitCode = 1;
  },
};
