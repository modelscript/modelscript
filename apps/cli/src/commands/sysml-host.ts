// SPDX-License-Identifier: AGPL-3.0-or-later

import { readComtrade, readComtradeCff, type ComtradeRecord } from "@modelscript/comtrade";
import { parseP3743Package } from "@modelscript/exchange";
import { calculateBusFaultCurrents, parseOneLiner } from "@modelscript/oneliner";
import { parseOpenDss, solveDistributionPowerFlow, solveFaultStudy } from "@modelscript/opendss";
import {
  computeSimulationCoverage,
  extractEmtNetlist,
  extractEmtNetlistFromXml,
  parsePscx,
  runEmtSimulation,
  runFrequencyScan,
} from "@modelscript/pscad";
import {
  auditMod032DataCompleteness,
  calculateShortCircuit,
  parseDyr,
  parseRaw,
  parseSeq,
  simulatePsseTransient,
  solvePowerFlow,
  type PsseCase,
} from "@modelscript/psse";
import type {
  KernelBatchItemResult,
  KernelBatchTask,
  KernelDiagnostic,
  KernelHostHandlers,
  KernelInspectOptions,
  KernelInspectResult,
  KernelSimulateOptions,
  WaveformInput,
} from "@modelscript/sdk";
import fs from "node:fs";
import path from "node:path";

export interface RecordedHostArtifact {
  relPath: string;
  absPath: string;
  sizeBytes: number;
}

export interface CreateSysmlHostOptions {
  /** Optional array populated whenever a kernel calls `ctx.writeArtifact()`. */
  recordedArtifacts?: RecordedHostArtifact[];
  /** Optional fallback simulator for Modelica `.mo` files. */
  simulateModelica?: (modelPath: string, opts?: KernelSimulateOptions) => Promise<Record<string, WaveformInput>>;
  /** Progress listener forwarded to `ctx.progress()`. */
  onProgress?: (percent: number, message?: string) => void;
}

/**
 * Resolves `relPath` inside `rootDir`, rejecting directory-traversal escapes (`../` or external roots).
 */
export function resolveConfinedPath(rootDir: string, relPath: string): string {
  const rootResolved = path.resolve(rootDir);
  const abs = path.resolve(rootResolved, relPath);
  const rel = path.relative(rootResolved, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Path traversal rejected outside package root '${rootDir}': '${relPath}'.`);
  }
  return abs;
}

function normalizePosixRel(rootDir: string, absPath: string): string {
  return path.relative(path.resolve(rootDir), absPath).split(path.sep).join("/");
}

function loadPsseBundle(rootDir: string, modelPath: string, companions: readonly string[] = []): PsseCase {
  const rawAbs = resolveConfinedPath(rootDir, modelPath);
  const psseCase = parseRaw(fs.readFileSync(rawAbs, "utf8"));
  for (const comp of companions) {
    const ext = path.extname(comp).toLowerCase();
    const compAbs = resolveConfinedPath(rootDir, comp);
    const text = fs.readFileSync(compAbs, "utf8");
    if (ext === ".dyr") {
      const dyr = parseDyr(text);
      if (!psseCase.dyr) {
        psseCase.dyr = dyr;
      } else {
        psseCase.dyr.records.push(...dyr.records);
      }
    } else if (ext === ".seq") {
      psseCase.seq = parseSeq(text);
    }
  }
  return psseCase;
}

function inspectPsseBundle(rootDir: string, modelPath: string, opts?: KernelInspectOptions): KernelInspectResult {
  const psseCase = loadPsseBundle(rootDir, modelPath, opts?.companions);
  const mod032 = auditMod032DataCompleteness(psseCase);
  const diagnostics: KernelDiagnostic[] = mod032.findings.map((f) => ({
    severity: f.severity === "violation" ? "error" : f.severity === "warning" ? "warning" : "info",
    code: f.standard,
    message: `${f.element}: ${f.description}`,
  }));

  const allRawGenKeys = new Set<string>();
  const activeRawGenKeys = new Set<string>();
  for (const gen of psseCase.generators) {
    const key = `${gen.i}:${(gen.id || "1").trim() || "1"}`;
    allRawGenKeys.add(key);
    if (gen.stat !== 0) activeRawGenKeys.add(key);
  }
  const dyrRecords = psseCase.dyr?.records ?? [];
  const dyrKeys = new Set(dyrRecords.map((r) => `${r.ibus}:${(r.id || "1").trim() || "1"}`));
  let missingDyrCount = 0;
  for (const key of activeRawGenKeys) {
    if (!dyrKeys.has(key)) missingDyrCount++;
  }
  let orphanDyrCount = 0;
  for (const rec of dyrRecords) {
    const key = `${rec.ibus}:${(rec.id || "1").trim() || "1"}`;
    if (!allRawGenKeys.has(key)) orphanDyrCount++;
  }

  let converged = false;
  let poiFaultMva = 0;
  let minFaultMva = 0;
  let maxFaultMva = 0;
  let maxFaultBus = 0;
  try {
    const pf = solvePowerFlow(psseCase);
    converged = pf.converged;
    const sc = calculateShortCircuit(psseCase);
    const positiveBuses = sc.buses.filter((b) => Number.isFinite(b.sk3PhaseMva) && b.sk3PhaseMva > 0);
    const requestedBus = opts?.options?.["poiBus"] !== undefined ? Number(opts.options["poiBus"]) : undefined;
    const target =
      (requestedBus !== undefined ? positiveBuses.find((b) => b.busNumber === requestedBus) : undefined) ??
      positiveBuses.reduce<(typeof positiveBuses)[number] | undefined>(
        (best, b) => (!best || b.sk3PhaseMva < best.sk3PhaseMva ? b : best),
        undefined,
      );
    poiFaultMva = target?.sk3PhaseMva ?? 0;
    minFaultMva = positiveBuses.reduce((m, b) => Math.min(m, b.sk3PhaseMva), Infinity);
    maxFaultMva = positiveBuses.reduce((m, b) => Math.max(m, b.sk3PhaseMva), 0);
    if (!Number.isFinite(minFaultMva)) minFaultMva = 0;
    maxFaultBus = sc.maxFaultBus;
  } catch (err) {
    diagnostics.push({
      severity: "error",
      code: "PSSE-SOLVE",
      message: err instanceof Error ? err.message : String(err),
    });
  }

  return {
    format: "psse-raw",
    metrics: {
      busCount: psseCase.buses.size,
      genCount: psseCase.generators.length,
      activeGenCount: activeRawGenKeys.size,
      branchCount: psseCase.branches.length,
      dyrRecordCount: dyrRecords.length,
      missingDyrCount,
      orphanDyrCount,
      mod032Score: mod032.completenessScore,
      powerFlowConverged: converged,
      poiFaultMva,
      minFaultMva,
      maxFaultMva,
      maxFaultBus,
      ok: missingDyrCount === 0 && orphanDyrCount === 0 && converged,
    },
    summary: `PSS/E case: ${psseCase.buses.size} buses, ${activeRawGenKeys.size} active gens, missingDYR=${missingDyrCount}, orphanDYR=${orphanDyrCount}, MOD-032=${(mod032.completenessScore * 100).toFixed(0)}%, POI Ssc=${poiFaultMva.toFixed(1)} MVA`,
    diagnostics,
  };
}

function readComtradeBundle(rootDir: string, modelPath: string, companions: readonly string[] = []): ComtradeRecord {
  const abs = resolveConfinedPath(rootDir, modelPath);
  const ext = path.extname(abs).toLowerCase();
  if (ext === ".cff") {
    return readComtradeCff(fs.readFileSync(abs, "utf8"));
  }
  const cfgContent = fs.readFileSync(abs, "utf8");
  const datRel =
    companions.find((c) => path.extname(c).toLowerCase() === ".dat") ?? modelPath.replace(/\.cfg$/i, ".dat");
  const datAbs = resolveConfinedPath(rootDir, datRel);
  const buf = fs.readFileSync(datAbs);
  const isAscii = cfgContent.toUpperCase().includes("ASCII");
  return readComtrade(cfgContent, isAscii ? buf.toString("utf8") : new Uint8Array(buf));
}

function extractComtradeWaveforms(record: ComtradeRecord): Record<string, WaveformInput> {
  const rawTime = record.timeSec ?? record.timestamps;
  const nSamples = rawTime ? rawTime.length : 0;
  const time = rawTime ? Array.from(rawTime) : [];
  const analogs = record.config?.analogChannels ?? record.cfg?.analogChannels ?? [];
  const out: Record<string, WaveformInput> = {};
  if (record.analogData instanceof Map) {
    for (const [name, vals] of record.analogData.entries()) {
      const x = time.length === vals.length ? time : Array.from({ length: vals.length }, (_, i) => i);
      out[name] = { x, y: Array.from(vals) };
    }
  } else if (Array.isArray(record.analogData)) {
    for (let chIdx = 0; chIdx < record.analogData.length; chIdx++) {
      const chVals = record.analogData[chIdx] ?? [];
      const chName = analogs[chIdx]?.name || `ch_${chIdx + 1}`;
      const x = nSamples === chVals.length ? time : Array.from({ length: chVals.length }, (_, i) => i);
      out[chName] = { x, y: chVals };
    }
  }
  return out;
}

function inspectFileByExtension(
  rootDir: string,
  modelPath: string,
  options?: KernelInspectOptions,
): KernelInspectResult {
  const ext = path.extname(modelPath).toLowerCase();
  if (ext === ".raw") {
    return inspectPsseBundle(rootDir, modelPath, options);
  }
  const abs = resolveConfinedPath(rootDir, modelPath);
  const text = fs.readFileSync(abs, "utf8");

  if (ext === ".pscx" || ext === ".pslx") {
    const project = parsePscx(text, { headless: true });
    const netlist = extractEmtNetlist(project);
    const cov = computeSimulationCoverage(project, netlist);
    return {
      format: "pscad-pscx",
      metrics: {
        busCount: netlist.buses.size,
        branchCount: netlist.branches.length,
        transformerCount: netlist.transformers.length,
        converterCount: netlist.converterBridges?.length ?? 0,
        simulatable: cov.simulatable,
        lowered: cov.lowered,
        droppedCount: cov.dropped.length,
        coverageRatio: cov.ratio,
        ok: cov.ratio > 0,
      },
      summary: `PSCAD netlist: ${netlist.buses.size} buses, ${netlist.branches.length} branches, coverage=${(cov.ratio * 100).toFixed(1)}%`,
    };
  }

  if (ext === ".cfg" || ext === ".cff") {
    const rec = readComtradeBundle(rootDir, modelPath, options?.companions);
    const cfg = rec.config ?? rec.cfg;
    const waveforms = extractComtradeWaveforms(rec);
    const sampleCount = Object.values(waveforms)[0]?.x.length ?? 0;
    return {
      format: "ieee-comtrade",
      metrics: {
        stationName: cfg?.stationName ?? "",
        analogChannelCount: cfg?.analogChannels.length ?? Object.keys(waveforms).length,
        lineFrequencyHz: cfg?.lineFrequencyHz ?? 60,
        sampleCount,
        ok: sampleCount > 0,
      },
      summary: `COMTRADE '${cfg?.stationName ?? modelPath}': ${Object.keys(waveforms).length} analog channels, ${sampleCount} samples`,
    };
  }

  if (ext === ".dss") {
    const deck = parseOpenDss(text, modelPath);
    const pf = solveDistributionPowerFlow(deck);
    return {
      format: "opendss",
      metrics: {
        busCount: pf.buses.size,
        lineCount: deck.lines.size,
        converged: pf.converged,
        lossesKw: pf.lossesKw,
        totalLoadKw: pf.totalLoadKw,
        totalGenKw: pf.totalGenKw,
        ok: pf.converged,
      },
      summary: `OpenDSS '${deck.circuit?.name ?? modelPath}': ${pf.buses.size} buses, converged=${pf.converged}, losses=${pf.lossesKw.toFixed(2)} kW`,
    };
  }

  if (ext === ".olr" || ext === ".olx" || ext === ".dxt") {
    const olCase = parseOneLiner(text);
    const firstBusId = olCase.busses[0]?.id;
    const sc = firstBusId ? calculateBusFaultCurrents(olCase, firstBusId) : undefined;
    return {
      format: "aspen-oneliner",
      metrics: {
        busCount: olCase.busses.length,
        branchCount: olCase.branches.length,
        baseMva: olCase.baseMva,
        sample3PhFaultAmps: sc?.i3PhaseA ?? 0,
        ok: olCase.busses.length > 0,
      },
      summary: `OneLiner case: ${olCase.busses.length} buses, ${olCase.branches.length} branches`,
    };
  }

  if (ext === ".p3743" || ext === ".json") {
    const parsed = parseP3743Package(text);
    const pkg = parsed.pkg;
    return {
      format: "ieee-p3743",
      metrics: {
        busCount: pkg.buses.length,
        corridorCount: pkg.corridors.length,
        valid: parsed.validation.valid,
        issueCount: parsed.validation.errors.length,
        warningCount: parsed.validation.warnings.length,
        ok: parsed.validation.valid,
      },
      summary: `IEEE P3743 package: valid=${parsed.validation.valid}, corridors=${pkg.corridors.length}`,
    };
  }

  throw new Error(`Unsupported inspect() model format '${ext || "(none)"}' for '${modelPath}'.`);
}

function simulatePsseBundle(
  rootDir: string,
  modelPath: string,
  opts?: KernelSimulateOptions,
): Record<string, WaveformInput> {
  const psseCase = loadPsseBundle(rootDir, modelPath, opts?.companions);
  const mode = opts?.mode ?? "transient";
  if (mode === "powerflow") {
    const pf = solvePowerFlow(psseCase);
    const x = pf.buses.map((b) => b.busNumber);
    const vm = pf.buses.map((b) => b.vm);
    const va = pf.buses.map((b) => b.va);
    return {
      vmPu: { x, y: vm },
      vaDeg: { x, y: va },
      bus_vm_pu: { x, y: vm },
      bus_va_deg: { x, y: va },
      summary_converged: { x: [0], y: [pf.converged ? 1 : 0] },
    };
  }
  if (mode === "short-circuit") {
    const sc = calculateShortCircuit(psseCase);
    const x = sc.buses.map((b) => b.busNumber);
    return {
      bus_sk3_mva: { x, y: sc.buses.map((b) => b.sk3PhaseMva) },
      bus_ik3_ka: { x, y: sc.buses.map((b) => b.ik3PhaseKa) },
      bus_xr_ratio: { x, y: sc.buses.map((b) => b.xrRatio) },
    };
  }

  const firstFault = opts?.faults?.[0];
  const res = simulatePsseTransient(psseCase, {
    stopTime: opts?.stopTime ?? 2.0,
    timeStep: opts?.stepSize ?? 0.01,
    faultBus: firstFault?.bus !== undefined ? Number(firstFault.bus) : undefined,
    faultStartSec: firstFault?.tStart,
    faultClearSec:
      firstFault?.tStart !== undefined && firstFault?.duration !== undefined
        ? firstFault.tStart + firstFault.duration
        : undefined,
  });
  const waveforms: Record<string, WaveformInput> = {};
  for (const [k, vals] of Object.entries(res.variables)) {
    waveforms[k] = { x: res.t, y: vals };
  }
  return waveforms;
}

function simulatePscadFile(
  rootDir: string,
  modelPath: string,
  opts?: KernelSimulateOptions,
): Record<string, WaveformInput> {
  const abs = resolveConfinedPath(rootDir, modelPath);
  const netlist = extractEmtNetlistFromXml(fs.readFileSync(abs, "utf8"));
  const mode = opts?.mode ?? "transient";

  if (mode === "frequency-scan") {
    const busId = String(
      opts?.faults?.[0]?.bus ?? opts?.parameters?.["busId"] ?? Array.from(netlist.buses.keys())[0] ?? "B1",
    );
    const scan = runFrequencyScan(netlist, {
      busId,
      fMinHz: Number(opts?.parameters?.["fMinHz"] ?? 1),
      fMaxHz: Number(opts?.parameters?.["fMaxHz"] ?? 150),
      fStepHz: Number(opts?.parameters?.["fStepHz"] ?? 1),
      nominalFrequencyHz: Number(opts?.parameters?.["nominalFrequencyHz"] ?? netlist.nominalFrequencyHz ?? 60),
    });
    const x = scan.frequenciesHz;
    return {
      z_mag_ohm: { x, y: scan.zMagOhm },
      r_ohm: { x, y: scan.rOhm },
      x_ohm: { x, y: scan.xOhm },
      phase_deg: { x, y: scan.phaseDeg },
      has_ssci_risk: { x: [0], y: [scan.hasSsciRisk ? 1 : 0] },
      min_resistance_ohm: { x: [0], y: [scan.minResistanceOhm] },
      resonance_freqs_hz: {
        x: scan.resonancePoints.map((_, idx) => idx),
        y: scan.resonancePoints.map((r) => r.frequencyHz),
      },
    };
  }

  const emt = runEmtSimulation(netlist, {
    timeStepSec: opts?.stepSize ?? 50e-6,
    durationSec: opts?.stopTime ?? 0.05,
  });
  const x = Array.from(emt.time);
  const waveforms: Record<string, WaveformInput> = {};
  for (const [bus, vals] of emt.busVoltages.entries()) {
    const y = Array.from(vals);
    waveforms[`V_${bus}`] = { x, y };
    waveforms[`v_${bus}`] = { x, y };
  }
  for (const [br, cur] of emt.branchCurrents.entries()) {
    waveforms[`I_${br}`] = { x, y: Array.from(cur) };
  }
  for (const [bus, vals] of emt.vA.entries()) {
    waveforms[`vA_${bus}`] = { x, y: Array.from(vals) };
  }
  if (emt.controlSignals) {
    for (const [sig, vals] of emt.controlSignals.entries()) {
      waveforms[`ctrl_${sig}`] = { x, y: Array.from(vals) };
    }
  }
  return waveforms;
}

/**
 * Creates a generic, workspace-confined multi-engine `KernelHostHandlers` bridge for SysML v2 CLI execution.
 */
export function createSysmlHostHandlers(rootDir: string, options: CreateSysmlHostOptions = {}): KernelHostHandlers {
  const simulate = async (modelPath: string, opts?: KernelSimulateOptions): Promise<Record<string, WaveformInput>> => {
    const ext = path.extname(modelPath).toLowerCase();
    if (ext === ".mo") {
      if (!options.simulateModelica) {
        throw new Error(`No Modelica simulator registered for '${modelPath}'.`);
      }
      return await options.simulateModelica(modelPath, opts);
    }
    if (ext === ".raw") return simulatePsseBundle(rootDir, modelPath, opts);
    if (ext === ".pscx" || ext === ".pslx") return simulatePscadFile(rootDir, modelPath, opts);
    if (ext === ".cfg" || ext === ".cff") {
      return extractComtradeWaveforms(readComtradeBundle(rootDir, modelPath, opts?.companions));
    }
    if (ext === ".dss") {
      const deck = parseOpenDss(fs.readFileSync(resolveConfinedPath(rootDir, modelPath), "utf8"), modelPath);
      if (opts?.mode === "short-circuit") {
        const sc = solveFaultStudy(deck);
        const entries = Array.from(sc.buses.values());
        const x = entries.map((_, i) => i);
        return {
          bus_sc_mva: { x, y: entries.map((b) => b.shortCircuitMva) },
          bus_ifault3ph_a: { x, y: entries.map((b) => b.iFault3PhaseAmps) },
        };
      }
      const pf = solveDistributionPowerFlow(deck);
      const entries = Array.from(pf.buses.values());
      const x = entries.map((_, i) => i);
      const vMag = entries.map((b) => b.vMagPu);
      return {
        vMagPu: { x, y: vMag },
        vAngleDeg: { x, y: entries.map((b) => b.vAngleDeg) },
        bus_vm_pu: { x, y: entries.map((b) => b.voltagePu) },
        bus_vuf: { x, y: entries.map((b) => b.voltageUnbalanceFactor) },
      };
    }
    if (ext === ".olr" || ext === ".olx" || ext === ".dxt") {
      const olCase = parseOneLiner(fs.readFileSync(resolveConfinedPath(rootDir, modelPath), "utf8"));
      const x = olCase.busses.map((_, i) => i);
      const res = olCase.busses.map((b) => calculateBusFaultCurrents(olCase, b.id));
      return {
        bus_i3ph_a: { x, y: res.map((r) => r.i3PhaseA) },
        bus_islg_a: { x, y: res.map((r) => r.iSlgA) },
      };
    }
    throw new Error(`Unsupported simulate() model format '${ext || "(none)"}' for '${modelPath}'.`);
  };

  return {
    readFile: (relPath: string) => fs.readFileSync(resolveConfinedPath(rootDir, relPath), "utf8"),
    readBinary: (relPath: string) => new Uint8Array(fs.readFileSync(resolveConfinedPath(rootDir, relPath))),
    writeArtifact: (relPath: string, data: string | Uint8Array) => {
      const abs = resolveConfinedPath(rootDir, relPath);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      const buf = typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data);
      fs.writeFileSync(abs, buf);
      const normRel = normalizePosixRel(rootDir, abs);
      options.recordedArtifacts?.push({ relPath: normRel, absPath: abs, sizeBytes: buf.byteLength });
      return normRel;
    },
    inspect: (modelPath: string, opts?: KernelInspectOptions) => inspectFileByExtension(rootDir, modelPath, opts),
    simulate,
    runBatch: async (tasks: KernelBatchTask[], concurrency = 4): Promise<KernelBatchItemResult[]> => {
      const results: KernelBatchItemResult[] = new Array(tasks.length);
      let cursor = 0;
      const workerCount = Math.min(Math.max(1, Math.floor(concurrency)), Math.max(1, tasks.length));
      await Promise.all(
        Array.from({ length: workerCount }, async () => {
          while (cursor < tasks.length) {
            const idx = cursor++;
            const task = tasks[idx]!;
            const id = task.id ?? `task_${idx}`;
            try {
              const waveforms = await simulate(task.modelPath, task.options);
              results[idx] = { id, ok: true, waveforms };
            } catch (err) {
              results[idx] = { id, ok: false, error: err instanceof Error ? err.message : String(err) };
            }
          }
        }),
      );
      return results;
    },
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
  };
}
