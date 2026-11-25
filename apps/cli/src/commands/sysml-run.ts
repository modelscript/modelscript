// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  DdpPackager,
  type DdpArtifactDescriptor,
  type DdpFileEntry,
  type DdpManifest,
  type PowerFlowSnapshot,
} from "@modelscript/exchange";
import { parseOpenDss, solveDistributionPowerFlow } from "@modelscript/opendss";
import { extractEmtNetlist, extractPscadSteadyStateSnapshot, parsePscx } from "@modelscript/pscad";
import { parseDyr, parseRaw, pssePowerFlowToSnapshot, psseToEmtNetlist, solvePowerFlowAsync } from "@modelscript/psse";
import {
  compileAssemblyScript,
  discoverImplementationForDefinition,
  inferKernelScheme,
  runTsKernel,
  runWasmKernel,
  type KernelInput,
  type KernelResult,
  type KernelSimulateOptions,
  type WaveformInput,
} from "@modelscript/sdk";
import {
  coerceSysmlValue,
  evaluateSysmlAssumptions,
  evaluateSysmlDefinition,
  extractSysML2SeasonalSpec,
  parseSysmlDefinitions,
  resolveDefinitionInputs,
  resolveSysmlExecutionOrder,
  runSysML2SeasonalVerificationSweep,
  type SysmlDefinitionBlock,
} from "@modelscript/sysml2";
import { createHash, sign as cryptoSign } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { CommandModule } from "yargs";
import { createSysmlHostHandlers, resolveConfinedPath, type RecordedHostArtifact } from "./sysml-host.js";

export interface SysmlRunArgs {
  file: string;
  def?: string;
  json?: boolean;
  timeout?: number;
  param?: string[];
  seasonal?: boolean;
  variant?: string;
  bundle?: string;
  "sign-key"?: string;
  signKey?: string;
}

interface ExecutedDefinitionRecord {
  definition: string;
  skipped?: boolean;
  skipReason?: string;
  result: KernelResult;
}

function findPackageRoot(sysmlFilePath: string): string {
  const startDir = path.dirname(path.resolve(sysmlFilePath));
  let dir = startDir;
  for (let i = 0; i < 4; i++) {
    if (
      fs.existsSync(path.join(dir, "assembly")) ||
      fs.existsSync(path.join(dir, "data")) ||
      fs.existsSync(path.join(dir, "modelscript.yaml"))
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

function parseParamOverrides(rawParams?: string[]): Record<string, number | boolean | string> {
  const out: Record<string, number | boolean | string> = {};
  for (const item of rawParams ?? []) {
    const eqIdx = item.indexOf("=");
    if (eqIdx <= 0) {
      throw new Error(`Invalid --param value '${item}': expected 'name=value' or 'DefName.name=value'.`);
    }
    const key = item.slice(0, eqIdx).trim();
    const val = coerceSysmlValue(item.slice(eqIdx + 1));
    out[key] = val;
  }
  return out;
}

function selectDefinitionsForExecution(
  definitions: readonly SysmlDefinitionBlock[],
  targetDefName?: string,
): SysmlDefinitionBlock[] {
  const ordered = resolveSysmlExecutionOrder(definitions);
  if (!targetDefName) return ordered;
  const byName = new Map(ordered.map((d) => [d.name, d]));
  if (!byName.has(targetDefName)) return [];

  const required = new Set<string>();
  const stack = [targetDefName];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (required.has(cur)) continue;
    required.add(cur);
    const def = byName.get(cur);
    for (const dep of def?.dependsOn ?? []) {
      stack.push(dep);
    }
  }
  return ordered.filter((d) => required.has(d.name));
}

async function simulateModelicaFile(
  rootDir: string,
  modelPath: string,
  opts?: KernelSimulateOptions,
): Promise<Record<string, WaveformInput>> {
  const candidate = resolveConfinedPath(rootDir, modelPath.replace(/^\.\//, ""));
  if (!fs.existsSync(candidate)) {
    throw new Error(`Model file not found: ${modelPath}`);
  }
  const source = fs.readFileSync(candidate, "utf8");
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
  const waveforms: Record<string, WaveformInput> = {};
  for (let i = 0; i < sim.states.length; i++) {
    const varName = sim.states[i]!;
    waveforms[varName] = { x: sim.t, y: sim.y.map((row) => row[i] ?? 0) };
  }
  return waveforms;
}

function sha256Hex(data: Uint8Array | string): string {
  const buf = typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data);
  return createHash("sha256").update(buf).digest("hex");
}

function writeProvenanceDdpBundle(options: {
  bundlePath: string;
  signKeyPath?: string | undefined;
  packageName: string;
  sysmlAbsPath: string;
  sysmlSource: string;
  rootDir: string;
  referencedRelPaths: ReadonlySet<string>;
  recordedArtifacts: readonly RecordedHostArtifact[];
  allOk: boolean;
  paramOverrides: Record<string, number | boolean | string>;
  results: readonly ExecutedDefinitionRecord[];
}): void {
  const files: DdpFileEntry[] = [];
  const manifest: DdpManifest = {
    ddpVersion: "1.0",
    packageId: `urn:modelscript:${options.packageName || "sysml-run"}`,
    title: `${options.packageName || "SysML"} Verification Evidence Bundle`,
    version: "1.0.0",
    createdAt: new Date().toISOString(),
    artifacts: {
      requirements: [],
      behavior: [],
      parameters: [],
      documentation: [],
    },
    relations: [],
    properties: {
      allOk: options.allOk,
      overrides: options.paramOverrides,
    },
  };

  const seenPaths = new Set<string>();
  const addEntry = (
    containerPath: string,
    data: Uint8Array | string,
    id: string,
    domainOverride?: Exclude<DdpArtifactDescriptor["domain"], "other">,
  ) => {
    const clean = containerPath.replace(/\\/g, "/").replace(/^\/+/, "");
    if (seenPaths.has(clean)) return;
    seenPaths.add(clean);
    const meta = DdpPackager.inferArtifactMetadata(clean);
    const domain = domainOverride ?? (meta.domain === "other" ? "documentation" : meta.domain);
    const byteLen = typeof data === "string" ? Buffer.byteLength(data, "utf8") : data.byteLength;
    const descriptor: DdpArtifactDescriptor = {
      id,
      path: clean,
      contentType: meta.contentType,
      domain,
      format: meta.format,
      checksum: `sha256:${sha256Hex(data)}`,
      sizeBytes: byteLen,
    };
    const bucket = (manifest.artifacts[domain] ??= []);
    bucket.push(descriptor);
    files.push({ path: clean, data, contentType: meta.contentType });
  };

  const sysmlName = path.basename(options.sysmlAbsPath);
  const reqContainerPath = `requirements/${sysmlName}`;
  addEntry(reqContainerPath, options.sysmlSource, "sysml-specification", "requirements");

  for (const rel of options.referencedRelPaths) {
    const safeAbs = resolveConfinedPath(options.rootDir, rel);
    if (!fs.existsSync(safeAbs) || !fs.statSync(safeAbs).isFile()) continue;
    const data = new Uint8Array(fs.readFileSync(safeAbs));
    const ext = path.extname(rel).toLowerCase();
    const isModel = /\.(?:raw|dyr|seq|pscx|pslx|mo|dss|olr|dxt|fmu|ssp)$/i.test(ext);
    const prefix = isModel ? "behavior" : "parameters";
    const normRel = rel.replace(/^\.\//, "");
    addEntry(`${prefix}/${normRel}`, data, `input:${normRel}`, isModel ? "behavior" : "parameters");
  }

  for (const art of options.recordedArtifacts) {
    if (!fs.existsSync(art.absPath)) continue;
    addEntry(
      `artifacts/${art.relPath}`,
      new Uint8Array(fs.readFileSync(art.absPath)),
      `artifact:${art.relPath}`,
      "documentation",
    );
  }

  const reportPayload = {
    packageName: options.packageName,
    ok: options.allOk,
    generatedAt: new Date().toISOString(),
    overrides: options.paramOverrides,
    results: options.results,
  };
  const reportJson = JSON.stringify(reportPayload, null, 2);
  addEntry("reports/verification-report.json", reportJson, "verification-report", "documentation");

  manifest.relations?.push({
    id: "rel-verify-sysml",
    relationType: "verifies",
    source: "reports/verification-report.json",
    target: reqContainerPath,
    status: options.allOk ? "passed" : "failed",
  });

  if (options.signKeyPath) {
    const keyPem = fs.readFileSync(path.resolve(options.signKeyPath), "utf8");
    const reportSha256 = sha256Hex(reportJson);
    const sig = cryptoSign(null, Buffer.from(reportSha256, "utf8"), keyPem);
    const attestation = JSON.stringify(
      {
        algorithm: "Ed25519",
        target: "reports/verification-report.json",
        reportSha256,
        signatureBase64: sig.toString("base64"),
        signedAt: new Date().toISOString(),
      },
      null,
      2,
    );
    addEntry("reports/attestation.json", attestation, "ed25519-attestation", "documentation");
    if (manifest.properties) {
      manifest.properties["signed"] = true;
      manifest.properties["reportSha256"] = reportSha256;
    }
  }

  const zipBytes = DdpPackager.buildDdp({ manifest, files });
  const absOut = path.resolve(options.bundlePath);
  fs.mkdirSync(path.dirname(absOut), { recursive: true });
  fs.writeFileSync(absOut, zipBytes);
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
        describe: "Specific SysML v2 definition name to run (includes upstream dependencies; runs all if omitted)",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "Emit machine-readable JSON results",
      })
      .option("timeout", {
        type: "number",
        default: 10000,
        describe: "Watchdog timeout in milliseconds per kernel",
      })
      .option("param", {
        type: "string",
        array: true,
        describe: "Override SysML attribute inputs (e.g. --param GridStrengthGate.ibrRatedMw=350)",
      })
      .option("seasonal", {
        type: "boolean",
        default: false,
        describe: "Execute SysML v2 seasonal variation / multi-tool powerflow verification sweep",
      })
      .option("variant", {
        type: "string",
        describe: "Filter seasonal sweep to a specific SysML v2 variant name (e.g. SummerPeak)",
      })
      .option("bundle", {
        type: "string",
        describe: "Write a PSI 21 Digital Data Package (.ddp.zip) provenance bundle to this path",
      })
      .option("sign-key", {
        type: "string",
        describe: "Optional Ed25519 private key PEM file used to sign the DDP verification report",
      }) as unknown as import("yargs").Argv<SysmlRunArgs>,
  async handler(argv) {
    const absFile = path.resolve(argv.file);
    const sysmlSource = fs.readFileSync(absFile, "utf8");
    const pkg = parseSysmlDefinitions(sysmlSource);
    const rootDir = findPackageRoot(absFile);
    const defs = selectDefinitionsForExecution(pkg.definitions, argv.def);
    const seasonalSpec = extractSysML2SeasonalSpec(sysmlSource);

    if (argv.seasonal || argv.variant || (defs.length === 0 && seasonalSpec.variants.length > 0)) {
      const matrix = await runSysML2SeasonalVerificationSweep(sysmlSource, async (variant) => {
        if (argv.variant && variant.name.toLowerCase() !== argv.variant.toLowerCase()) {
          return { metrics: { skippedVariant: true } };
        }
        const rawRel = typeof variant.attributes["rawFile"] === "string" ? variant.attributes["rawFile"] : undefined;
        const dyrRel = typeof variant.attributes["dyrFile"] === "string" ? variant.attributes["dyrFile"] : undefined;
        const pscxRel = typeof variant.attributes["pscxFile"] === "string" ? variant.attributes["pscxFile"] : undefined;
        const dssRel = typeof variant.attributes["dssFile"] === "string" ? variant.attributes["dssFile"] : undefined;

        let baseline: PowerFlowSnapshot | undefined;
        const comparators: PowerFlowSnapshot[] = [];
        const metrics: Record<string, number | boolean | string> = {};

        if (rawRel) {
          const rawAbs = resolveConfinedPath(rootDir, rawRel);
          const psseCase = parseRaw(fs.readFileSync(rawAbs, "utf8"));
          if (dyrRel) {
            psseCase.dyr = parseDyr(fs.readFileSync(resolveConfinedPath(rootDir, dyrRel), "utf8"));
          }
          const pf = await solvePowerFlowAsync(psseCase);
          baseline = pssePowerFlowToSnapshot(psseCase, pf, variant.name);
          const vms = baseline.buses.map((b) => b.vmPu);
          if (vms.length > 0) {
            metrics["minVmPu"] = Math.min(...vms);
            metrics["maxVmPu"] = Math.max(...vms);
          }
          metrics["convergedPowerFlow"] = pf.converged;

          if (pscxRel) {
            const pscxAbs = resolveConfinedPath(rootDir, pscxRel);
            const emt = extractEmtNetlist(parsePscx(fs.readFileSync(pscxAbs, "utf8")));
            comparators.push(
              extractPscadSteadyStateSnapshot(emt, {
                solver: `pscad:${path.basename(pscxRel)}`,
                nominalFrequencyHz: baseline.frequencyHz,
              }),
            );
          } else {
            comparators.push(
              extractPscadSteadyStateSnapshot(psseToEmtNetlist(psseCase, { dyrCase: psseCase.dyr }), {
                solver: "pscad (projected)",
                nominalFrequencyHz: baseline.frequencyHz,
              }),
            );
          }
        }

        if (dssRel) {
          const dssSol = solveDistributionPowerFlow(
            parseOpenDss(fs.readFileSync(resolveConfinedPath(rootDir, dssRel), "utf8")),
          );
          comparators.push({
            solver: `opendss:${path.basename(dssRel)}`,
            converged: dssSol.converged,
            frequencyHz: baseline?.frequencyHz ?? 60,
            sbaseMva: baseline?.sbaseMva ?? 100,
            buses: Array.from(dssSol.buses.entries()).map(([busId, b]) => ({
              busId,
              vmPu: b.vMagPu,
              vaDeg: b.vAngleDeg,
            })),
            branches: [],
          });
        }

        return {
          baseline,
          comparators,
          comparisonOptions: { vmTolerancePu: 0.01, vaToleranceDeg: 3.0 },
          metrics,
        };
      });

      const filteredVariants = argv.variant
        ? matrix.variants.filter((v) => v.name.toLowerCase() === argv.variant!.toLowerCase())
        : matrix.variants;
      const outMatrix = {
        ...matrix,
        variants: filteredVariants,
        totalVariants: filteredVariants.length,
        passedVariants: filteredVariants.filter((v) => v.allSatisfied).length,
        overallPassed: filteredVariants.every((v) => v.allSatisfied),
      };

      if (argv.bundle) {
        const seasonalReportRel = "reports/seasonal-matrix.json";
        const seasonalReportAbs = resolveConfinedPath(rootDir, seasonalReportRel);
        fs.mkdirSync(path.dirname(seasonalReportAbs), { recursive: true });
        const seasonalJson = JSON.stringify(outMatrix, null, 2);
        fs.writeFileSync(seasonalReportAbs, seasonalJson, "utf8");
        const seasonalResults: ExecutedDefinitionRecord[] = outMatrix.variants.map((v) => ({
          definition: v.name,
          skipped: false,
          result: {
            ok: v.allSatisfied,
            kernelId: v.name,
            parameters: v.metrics,
            summary: v.powerFlowComparison?.summaryText ?? `${v.name}: ${v.allSatisfied ? "PASS" : "FAIL"}`,
            artifacts: [],
          },
        }));
        writeProvenanceDdpBundle({
          bundlePath: argv.bundle,
          signKeyPath: argv.signKey ?? argv["sign-key"],
          packageName: outMatrix.packageName ?? pkg.packageName,
          sysmlAbsPath: absFile,
          sysmlSource,
          rootDir,
          referencedRelPaths: new Set<string>(),
          recordedArtifacts: [
            { relPath: seasonalReportRel, absPath: seasonalReportAbs, sizeBytes: Buffer.byteLength(seasonalJson) },
          ],
          allOk: outMatrix.overallPassed,
          paramOverrides: parseParamOverrides(argv.param),
          results: seasonalResults,
        });
      }

      if (argv.json) {
        console.log(
          JSON.stringify(
            {
              ...outMatrix,
              ...(argv.bundle ? { bundle: path.resolve(argv.bundle) } : {}),
            },
            null,
            2,
          ),
        );
      } else {
        for (const v of outMatrix.variants) {
          const tag = v.allSatisfied ? "PASS" : "FAIL";
          const pfInfo = v.powerFlowComparison ? ` | ${v.powerFlowComparison.summaryText}` : "";
          console.log(
            `[${tag}] ${outMatrix.packageName ?? "Seasonal"}.${v.name} (${v.verification.results.filter((r) => r.satisfied).length}/${v.verification.results.length} reqs)${pfInfo}`,
          );
        }
        if (argv.bundle) {
          console.log(`[DDP] Wrote seasonal provenance bundle: ${path.resolve(argv.bundle)}`);
        }
      }
      if (!outMatrix.overallPassed) process.exitCode = 1;
      return;
    }

    if (defs.length === 0) {
      console.error(`No matching SysML v2 definitions found in ${argv.file}`);
      process.exitCode = 1;
      return;
    }

    const paramOverrides = parseParamOverrides(argv.param);
    const asFiles = collectTsFilesInDir(rootDir, "assembly");
    let allTsFiles: Record<string, string> | undefined;
    const results: ExecutedDefinitionRecord[] = [];
    const upstreamEnv: Record<string, number | boolean | string> = {};
    const upstreamByDef: Record<string, Record<string, number | string | boolean>> = {};
    const referencedInputFiles = new Set<string>();
    const recordedArtifacts: RecordedHostArtifact[] = [];
    const hostHandlers = createSysmlHostHandlers(rootDir, {
      recordedArtifacts,
      simulateModelica: (modelPath, opts) => simulateModelicaFile(rootDir, modelPath, opts),
    });
    let allOk = true;

    for (const def of defs) {
      const inputParameters = resolveDefinitionInputs(def, upstreamEnv, paramOverrides);
      const assumeEval = evaluateSysmlAssumptions(def, { ...upstreamEnv, ...inputParameters });

      if (!assumeEval.active) {
        const evalRes = evaluateSysmlDefinition(def, { ...upstreamEnv, ...inputParameters });
        upstreamEnv[`${def.name}.skipped`] = true;
        upstreamByDef[def.name] = { skipped: true };
        results.push({
          definition: def.name,
          skipped: true,
          skipReason: assumeEval.details,
          result: {
            ok: true,
            kernelId: def.name,
            parameters: { ...inputParameters, skipped: true },
            summary: `Skipped — ${assumeEval.details}`,
            artifacts:
              evalRes.checks.length > 0
                ? [
                    {
                      kind: "compliance-matrix",
                      id: `${def.name}-constraints`,
                      title: `${def.name} Verification (VACUOUS)`,
                      columns: ["Check ID", "Constraint", "Status", "Margin", "Details"],
                      rows: evalRes.checks.map((c) => [c.id, c.expression, "VACUOUS", c.margin.toFixed(4), c.details]),
                    },
                  ]
                : [],
          },
        });
        continue;
      }

      const referencedFiles: Array<{ fileName: string; content: string }> = [];
      const filePathPattern =
        /(?:^src\/|^\.\/|\.(?:mo|raw|dyr|seq|pscx|pslx|cfg|cff|dat|txt|csv|json|sysml|dss|olr|dxt)$)/i;

      for (const [k, rawVal] of Object.entries(inputParameters)) {
        if (k === "implementation" || typeof rawVal !== "string" || !filePathPattern.test(rawVal)) continue;
        try {
          const candidate = resolveConfinedPath(rootDir, rawVal.replace(/^\.\//, ""));
          if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            referencedInputFiles.add(rawVal);
            referencedFiles.push({ fileName: rawVal, content: fs.readFileSync(candidate, "utf8") });
          }
        } catch {
          // Ignore non-path string values
        }
      }

      const kernelInput: KernelInput = {
        definitionName: def.name,
        packageName: pkg.packageName,
        parameters: inputParameters,
        ...(referencedFiles.length > 0 ? { files: referencedFiles } : {}),
        ...(Object.keys(upstreamByDef).length > 0 ? { upstream: { ...upstreamByDef } } : {}),
      };

      const resolvedImpl = def.implementation
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
            fs.readFileSync(resolveConfinedPath(rootDir, resolvedImpl.modulePath.replace(/^\.\//, ""))),
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
          host: hostHandlers,
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

      const combinedOutputs: Record<string, number | boolean | string> = {
        ...inputParameters,
        ...(result.parameters ?? {}),
      };
      upstreamByDef[def.name] = { ...combinedOutputs, skipped: false };
      upstreamEnv[`${def.name}.skipped`] = false;
      for (const [k, v] of Object.entries(combinedOutputs)) {
        upstreamEnv[`${def.name}.${k}`] = v;
      }

      if (def.constraintSpecs.length > 0) {
        const evalRes = evaluateSysmlDefinition(def, {
          ...upstreamEnv,
          ...combinedOutputs,
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
      results.push({ definition: def.name, skipped: false, result });
    }

    if (argv.bundle) {
      writeProvenanceDdpBundle({
        bundlePath: argv.bundle,
        signKeyPath: argv.signKey ?? argv["sign-key"],
        packageName: pkg.packageName,
        sysmlAbsPath: absFile,
        sysmlSource,
        rootDir,
        referencedRelPaths: referencedInputFiles,
        recordedArtifacts,
        allOk,
        paramOverrides,
        results,
      });
    }

    if (argv.json) {
      console.log(
        JSON.stringify(
          {
            packageName: pkg.packageName,
            ok: allOk,
            ...(argv.bundle ? { bundle: path.resolve(argv.bundle) } : {}),
            results,
          },
          null,
          2,
        ),
      );
    } else {
      for (const r of results) {
        const tag = r.skipped ? "SKIP" : r.result.ok ? "PASS" : "FAIL";
        console.log(`[${tag}] ${pkg.packageName}.${r.definition} — ${r.result.summary ?? ""}`);
      }
      if (argv.bundle) {
        console.log(`[DDP] Wrote provenance bundle: ${path.resolve(argv.bundle)}`);
      }
    }

    if (!allOk) process.exitCode = 1;
  },
};
