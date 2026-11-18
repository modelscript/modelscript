// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Siemens PTI `psspy` Automation Compatibility Layer for ModelScript.
 *
 * Provides a programmatic TypeScript API (`PsspySession`) and an in-memory Python
 * automation script runner (`executePythonPsspyScript`) matching the standard
 * `psspy` function signatures and return-code conventions (`ierr = 0` on success):
 *   - `psseinit`, `read`, `case`, `save`, `dyre_new`, `rdseq`
 *   - `fnsl` (Full Newton-Raphson), `fdns` (Fast Decoupled BX)
 *   - `dcsc` / `scmu` (IEC 60909 / ANSI C37 short-circuit fault study)
 *   - `accc` (N-1 AC contingency ranking)
 *   - `strt`, `run`, `dist_bus_fault`, `dist_clear_fault` (Dynamic transient stability + `.out` export)
 *   - `busdat`, `brndat`, `gendat` (Post-solution subsystem data retrieval)
 */

import { parseDyr } from "./parser/dyr-parser.js";
import { parseRaw } from "./parser/raw-parser.js";
import {
  isPsseSavBuffer,
  parsePsseOut,
  parsePsseSav,
  type PsseOutChannelData,
  serializePsseOut,
  serializePsseSav,
} from "./parser/sav-parser.js";
import { parseSeq } from "./parser/seq-parser.js";
import {
  analyzeN1Contingencies,
  calculateShortCircuit,
  type N1ContingencyAnalysisResult,
  type PowerFlowSolution,
  type PsseTransientResult,
  type ShortCircuitAnalysisResult,
  simulatePsseTransient,
  solvePowerFlow,
} from "./solver/ac-powerflow.js";
import type { PsseCase } from "./types.js";

/**
 * Stateful PSS/E `psspy` automation session.
 */
export class PsspySession {
  public maxBuses = 50000;
  public activeCase: PsseCase | null = null;
  public lastPowerFlow: PowerFlowSolution | null = null;
  public lastShortCircuit: ShortCircuitAnalysisResult | null = null;
  public lastContingency: N1ContingencyAnalysisResult | null = null;
  public lastTransient: PsseTransientResult | null = null;
  public virtualFiles = new Map<string, string | Uint8Array>();
  public messages: string[] = [];

  public getMessages(): string[] {
    return this.messages;
  }

  public getLastPowerFlow(): PowerFlowSolution | null {
    return this.lastPowerFlow;
  }

  public getLastTransient(): PsseTransientResult | null {
    return this.lastTransient;
  }

  // Dynamic simulation state staged between strt(), dist_bus_fault(), dist_clear_fault(), and run()
  private currentSimTime = 0.0;
  private activeFaultBus: number | undefined = undefined;
  private faultStartSec: number | undefined = undefined;
  private faultClearSec: number | undefined = undefined;
  private faultReactancePu = 0.02;
  private activeOutFile: string | undefined = undefined;

  constructor(files?: Record<string, string | Uint8Array>) {
    if (files) {
      for (const [k, v] of Object.entries(files)) {
        this.virtualFiles.set(k, v);
      }
    }
  }

  /**
   * Registers an in-memory file (`.raw`, `.dyr`, `.seq`, `.sav`, `.out`) for script access.
   */
  public registerFile(path: string, content: string | Uint8Array): void {
    this.virtualFiles.set(path, content);
  }

  /**
   * Retrieves a generated binary or text file from the virtual workspace.
   */
  public getFile(path: string): string | Uint8Array | undefined {
    return this.virtualFiles.get(path);
  }

  /**
   * Initializes the PSS/E working memory (`psspy.psseinit(buses)`).
   */
  public psseinit(buses = 50000): number {
    this.maxBuses = Math.max(100, buses);
    this.currentSimTime = 0.0;
    this.activeFaultBus = undefined;
    this.faultStartSec = undefined;
    this.faultClearSec = undefined;
    return 0;
  }

  /**
   * Reads a PSS/E `.raw` power flow text file (`psspy.read(numnam, ifile)`).
   * Accepts either a registered virtual file path or inline `.raw` content.
   */
  public read(_numnam: number, rawfile: string): number {
    const stored = this.virtualFiles.get(rawfile);
    const rawText =
      typeof stored === "string" ? stored : stored instanceof Uint8Array ? new TextDecoder().decode(stored) : rawfile;
    this.activeCase = parseRaw(rawText);
    this.lastPowerFlow = null;
    return 0;
  }

  /**
   * Loads a binary `.sav` saved case (`psspy.case(sfile)`).
   */
  public case(savfile: string | Uint8Array): number {
    const target = typeof savfile === "string" ? this.virtualFiles.get(savfile) : savfile;
    if (!target) return 1;
    if (target instanceof Uint8Array && isPsseSavBuffer(target)) {
      this.activeCase = parsePsseSav(target);
      this.lastPowerFlow = solvePowerFlow(this.activeCase);
      return 0;
    }
    if (typeof target === "string") {
      this.activeCase = parseRaw(target);
      this.lastPowerFlow = solvePowerFlow(this.activeCase);
      return 0;
    }
    return 2;
  }

  /**
   * Saves the active case to a binary `.sav` buffer (`psspy.save(sfile)`).
   */
  public save(savfile?: string): Uint8Array {
    if (!this.activeCase) {
      throw new Error("No active PSS/E case loaded in PsspySession.");
    }
    const bytes = serializePsseSav(this.activeCase);
    if (savfile) {
      this.virtualFiles.set(savfile, bytes);
    }
    return bytes;
  }

  /**
   * Reads a `.dyr` dynamic model data file and attaches it to the active case (`psspy.dyre_new(options, dyrfile)`).
   */
  public dyre_new(_options: number[] = [1, 1, 1, 1], dyrfile: string): number {
    if (!this.activeCase) return 1;
    const stored = this.virtualFiles.get(dyrfile);
    const dyrText =
      typeof stored === "string" ? stored : stored instanceof Uint8Array ? new TextDecoder().decode(stored) : dyrfile;
    this.activeCase.dyr = parseDyr(dyrText);
    return 0;
  }

  /**
   * Reads a `.seq` sequence data file and attaches it to the active case (`psspy.rdseq(seqfile)`).
   */
  public rdseq(seqfile: string): number {
    if (!this.activeCase) return 1;
    const stored = this.virtualFiles.get(seqfile);
    const seqText =
      typeof stored === "string" ? stored : stored instanceof Uint8Array ? new TextDecoder().decode(stored) : seqfile;
    this.activeCase.seq = parseSeq(seqText);
    return 0;
  }

  /**
   * Solves AC power flow using Full Newton-Raphson (`psspy.fnsl(options)`).
   */
  public fnsl(_options?: number[]): [number, PowerFlowSolution] {
    if (!this.activeCase) {
      throw new Error("No active PSS/E case loaded before fnsl().");
    }
    const sol = solvePowerFlow(this.activeCase, { algorithm: "newton_raphson" });
    this.lastPowerFlow = sol;
    this.syncBusVoltagesFromSolution(sol);
    return [sol.converged ? 0 : 1, sol];
  }

  /**
   * Solves AC power flow using Fast Decoupled BX (`psspy.fdns(options)`).
   */
  public fdns(_options?: number[]): [number, PowerFlowSolution] {
    if (!this.activeCase) {
      throw new Error("No active PSS/E case loaded before fdns().");
    }
    const sol = solvePowerFlow(this.activeCase, { algorithm: "fast_decoupled" });
    this.lastPowerFlow = sol;
    this.syncBusVoltagesFromSolution(sol);
    return [sol.converged ? 0 : 1, sol];
  }

  /**
   * Runs IEC 60909 / ANSI C37 symmetrical and unbalanced short-circuit analysis (`psspy.dcsc` / `psspy.scmu`).
   */
  public dcsc(_options?: number[]): [number, ShortCircuitAnalysisResult] {
    if (!this.activeCase) {
      throw new Error("No active PSS/E case loaded before dcsc().");
    }
    const res = calculateShortCircuit(this.activeCase, { seq: this.activeCase.seq });
    this.lastShortCircuit = res;
    return [0, res];
  }

  public scmu(options?: number[]): [number, ShortCircuitAnalysisResult] {
    return this.dcsc(options);
  }

  /**
   * Runs automated N-1 AC contingency screening (`psspy.accc`).
   */
  public accc(_tolerance = 1e-4): [number, N1ContingencyAnalysisResult] {
    if (!this.activeCase) {
      throw new Error("No active PSS/E case loaded before accc().");
    }
    const res = analyzeN1Contingencies(this.activeCase);
    this.lastContingency = res;
    return [0, res];
  }

  /**
   * Initializes dynamic simulation state and binds an optional `.out` channel file (`psspy.strt(options, outfile)`).
   */
  public strt(_options?: number[], outfile?: string): number {
    if (!this.activeCase) return 1;
    this.currentSimTime = 0.0;
    this.activeFaultBus = undefined;
    this.faultStartSec = undefined;
    this.faultClearSec = undefined;
    this.activeOutFile = outfile;
    return 0;
  }

  /**
   * Applies a three-phase bus fault at the current simulation timestamp (`psspy.dist_bus_fault(ibus, units, basekv, values)`).
   */
  public dist_bus_fault(ibus: number, _units = 1, _basekv = 0.0, values: [number, number] = [0.0, -2e9]): number {
    this.activeFaultBus = ibus;
    this.faultStartSec = this.currentSimTime;
    const bMag = Math.abs(values[1]);
    this.faultReactancePu = bMag > 1.0 ? Math.max(0.005, 100.0 / bMag) : 0.02;
    return 0;
  }

  /**
   * Clears an active bus fault at the current simulation timestamp (`psspy.dist_clear_fault(ifault)`).
   */
  public dist_clear_fault(_ifault = 1): number {
    this.faultClearSec = this.currentSimTime;
    return 0;
  }

  /**
   * Advances the dynamic simulation to `tpause` seconds (`psspy.run(option, tpause, nprt, nplt, crtplt)`).
   */
  public run(_option = 0, tpause = 5.0, _nprt = 1, _nplt = 1, _crtplt = 1): number {
    if (!this.activeCase) return 1;
    this.currentSimTime = Math.max(this.currentSimTime, tpause);
    if (this.currentSimTime <= 0) return 0;

    const faultStart = this.faultStartSec ?? 0.5;
    const faultClear =
      this.faultClearSec !== undefined && this.faultClearSec > faultStart ? this.faultClearSec : faultStart + 0.12;

    this.lastTransient = simulatePsseTransient(this.activeCase, {
      stopTime: this.currentSimTime,
      timeStep: 0.01,
      faultBus: this.activeFaultBus,
      faultStartSec: faultStart,
      faultClearSec: faultClear,
      faultSusceptancePu: 1.0 / Math.max(0.005, this.faultReactancePu),
    });

    if (this.activeOutFile) {
      const outBytes = serializePsseOut(this.lastTransient, this.activeCase.title1 || "PSS/E Dynamic Run");
      this.virtualFiles.set(this.activeOutFile, outBytes);
    }
    return 0;
  }

  /**
   * Reads a parsed `.out` channel object from the virtual workspace.
   */
  public readOutChannels(outfile: string): PsseOutChannelData | undefined {
    const raw = this.virtualFiles.get(outfile);
    if (!(raw instanceof Uint8Array)) return undefined;
    return parsePsseOut(raw);
  }

  /**
   * Retrieves solved bus quantities (`psspy.busdat(ibus, string)`).
   */
  public busdat(ibus: number, quantity: "BASE" | "PU" | "KV" | "ANGLED" | "ANGLER"): [number, number] {
    if (!this.activeCase) return [1, 0];
    const bus = this.activeCase.buses.get(ibus);
    if (!bus) return [1, 0];
    const pfBus = this.lastPowerFlow?.buses.find((b) => b.busNumber === ibus);
    const vm = pfBus ? pfBus.vm : bus.vm;
    const vaDeg = pfBus ? pfBus.va : bus.va;

    switch (quantity) {
      case "BASE":
        return [0, bus.baseKv];
      case "PU":
        return [0, vm];
      case "KV":
        return [0, vm * bus.baseKv];
      case "ANGLED":
        return [0, vaDeg];
      case "ANGLER":
        return [0, (vaDeg * Math.PI) / 180.0];
    }
  }

  /**
   * Retrieves solved branch flow quantities (`psspy.brndat(ibus, jbus, ckt, string)`).
   */
  public brndat(ibus: number, jbus: number, ckt: string, quantity: "P" | "Q" | "MVA" | "PCTRTA"): [number, number] {
    if (!this.lastPowerFlow) return [1, 0];
    const cleanCkt = ckt.trim() || "1";
    const br = this.lastPowerFlow.branches.find(
      (b) =>
        ((b.fromBus === ibus && b.toBus === jbus) || (b.fromBus === jbus && b.toBus === ibus)) &&
        b.ckt.trim() === cleanCkt,
    );
    if (!br) return [2, 0];
    switch (quantity) {
      case "P":
        return [0, br.fromBus === ibus ? br.pFromMw : br.pToMw];
      case "Q":
        return [0, br.fromBus === ibus ? br.qFromMvar : br.qToMvar];
      case "MVA":
        return [0, br.mvaFlow];
      case "PCTRTA":
        return [0, br.loadingPercent ?? 0];
    }
  }

  /**
   * Retrieves solved generator output at a bus (`psspy.gendat(ibus, string)`).
   */
  public gendat(ibus: number, quantity: "P" | "Q" | "MVA"): [number, number] {
    if (!this.lastPowerFlow) return [1, 0];
    const pfBus = this.lastPowerFlow.buses.find((b) => b.busNumber === ibus);
    if (!pfBus) return [2, 0];
    switch (quantity) {
      case "P":
        return [0, pfBus.pgMw];
      case "Q":
        return [0, pfBus.qgMvar];
      case "MVA":
        return [0, Math.hypot(pfBus.pgMw, pfBus.qgMvar)];
    }
  }

  /**
   * Returns the number of buses in the active case (`psspy.abuscount(sid, flag)`).
   */
  public abuscount(_sid = -1, flag = 1): [number, number] {
    if (!this.activeCase) return [1, 0];
    const buses = Array.from(this.activeCase.buses.values());
    const filtered = flag === 1 ? buses.filter((b) => b.ide !== 4) : buses;
    return [0, filtered.length];
  }

  /**
   * Subsystem bus integer array retrieval (`psspy.abusint(sid, flag, string)`).
   */
  public abusint(_sid = -1, flag = 1, quantity: "NUMBER" | "TYPE" | "AREA" | "ZONE" | "OWNER"): [number, number[]] {
    if (!this.activeCase) return [1, []];
    const buses = Array.from(this.activeCase.buses.values()).filter((b) => (flag === 1 ? b.ide !== 4 : true));
    return [
      0,
      buses.map((b) => {
        switch (quantity) {
          case "NUMBER":
            return b.i;
          case "TYPE":
            return b.ide;
          case "AREA":
            return b.area;
          case "ZONE":
            return b.zone;
          case "OWNER":
            return b.owner;
        }
      }),
    ];
  }

  /**
   * Subsystem bus real array retrieval (`psspy.abusreal(sid, flag, string)`).
   */
  public abusreal(_sid = -1, flag = 1, quantity: "BASE" | "PU" | "KV" | "ANGLED" | "ANGLER"): [number, number[]] {
    if (!this.activeCase) return [1, []];
    const buses = Array.from(this.activeCase.buses.values()).filter((b) => (flag === 1 ? b.ide !== 4 : true));
    return [
      0,
      buses.map((b) => {
        const solved = this.lastPowerFlow?.buses.find((x) => x.busNumber === b.i);
        const vm = solved?.vm ?? b.vm;
        const va = solved?.va ?? b.va;
        switch (quantity) {
          case "BASE":
            return b.baseKv;
          case "PU":
            return vm;
          case "KV":
            return vm * b.baseKv;
          case "ANGLED":
            return va;
          case "ANGLER":
            return (va * Math.PI) / 180.0;
        }
      }),
    ];
  }

  /**
   * Subsystem branch real array retrieval (`psspy.abrnreal(sid, owner, ties, flag, entry, string)`).
   */
  public abrnreal(
    _sid = -1,
    _owner = 1,
    _ties = 3,
    _flag = 1,
    _entry = 1,
    quantity: "P" | "Q" | "MVA" | "PCTRTA" | "RATEA",
  ): [number, number[]] {
    if (!this.activeCase) return [1, []];
    if (this.lastPowerFlow) {
      return [
        0,
        this.lastPowerFlow.branches.map((br) => {
          switch (quantity) {
            case "P":
              return br.pFromMw;
            case "Q":
              return br.qFromMvar;
            case "MVA":
              return br.mvaFlow;
            case "PCTRTA":
              return br.loadingPercent ?? 0;
            case "RATEA":
              return br.rateMva ?? 0;
          }
        }),
      ];
    }
    return [0, this.activeCase.branches.map((br) => (quantity === "RATEA" ? br.rateA : 0))];
  }

  /**
   * Subsystem machine real array retrieval (`psspy.amachreal(sid, flag, string)`).
   */
  public amachreal(
    _sid = -1,
    flag = 1,
    quantity: "PGEN" | "QGEN" | "PMAX" | "PMIN" | "QMAX" | "QMIN",
  ): [number, number[]] {
    if (!this.activeCase) return [1, []];
    const gens = this.activeCase.generators.filter((g) => (flag === 1 ? g.stat === 1 : true));
    return [
      0,
      gens.map((g) => {
        switch (quantity) {
          case "PGEN":
            return g.pg;
          case "QGEN":
            return g.qg;
          case "PMAX":
            return g.pt;
          case "PMIN":
            return g.pb;
          case "QMAX":
            return g.qt;
          case "QMIN":
            return g.qb;
        }
      }),
    ];
  }

  /**
   * Modifies bus data (`psspy.bus_chng_4(ibus, intgar, realar, name)`).
   */
  public bus_chng_4(ibus: number, intgar: number[] = [], realar: number[] = [], name?: string): number {
    if (!this.activeCase) return 1;
    const bus = this.activeCase.buses.get(ibus);
    if (!bus) return 2;
    if (intgar[0] !== undefined && intgar[0] >= 1 && intgar[0] <= 4) bus.ide = intgar[0];
    if (intgar[1] !== undefined && intgar[1] > 0) bus.area = intgar[1];
    if (intgar[2] !== undefined && intgar[2] > 0) bus.zone = intgar[2];
    if (intgar[3] !== undefined && intgar[3] > 0) bus.owner = intgar[3];
    if (realar[0] !== undefined && realar[0] > 0) bus.baseKv = realar[0];
    if (realar[1] !== undefined && realar[1] > 0) bus.vm = realar[1];
    if (realar[2] !== undefined) bus.va = realar[2];
    if (typeof name === "string" && name.trim().length > 0) bus.name = name.trim();
    return 0;
  }

  /**
   * Modifies load data (`psspy.load_chng_4(ibus, id, intgar, realar)`).
   */
  public load_chng_4(ibus: number, id = "1", intgar: number[] = [], realar: number[] = []): number {
    if (!this.activeCase) return 1;
    const cleanId = id.trim() || "1";
    const load = this.activeCase.loads.find((l) => l.i === ibus && (l.id.trim() || "1") === cleanId);
    if (!load) return 2;
    if (intgar[0] !== undefined) load.status = intgar[0] === 0 ? 0 : 1;
    if (realar[0] !== undefined) load.pl = realar[0];
    if (realar[1] !== undefined) load.ql = realar[1];
    if (realar[2] !== undefined) load.ip = realar[2];
    if (realar[3] !== undefined) load.iq = realar[3];
    if (realar[4] !== undefined) load.yp = realar[4];
    if (realar[5] !== undefined) load.yq = realar[5];
    return 0;
  }

  /**
   * Modifies machine/generator data (`psspy.machine_chng_2(ibus, id, intgar, realar)`).
   */
  public machine_chng_2(ibus: number, id = "1", intgar: number[] = [], realar: number[] = []): number {
    if (!this.activeCase) return 1;
    const cleanId = id.trim() || "1";
    const gen = this.activeCase.generators.find((g) => g.i === ibus && (g.id.trim() || "1") === cleanId);
    if (!gen) return 2;
    if (intgar[0] !== undefined) gen.stat = intgar[0] === 0 ? 0 : 1;
    if (realar[0] !== undefined) gen.pg = realar[0];
    if (realar[1] !== undefined) gen.qg = realar[1];
    if (realar[2] !== undefined) gen.qt = realar[2];
    if (realar[3] !== undefined) gen.qb = realar[3];
    if (realar[4] !== undefined && realar[4] > 0) gen.vs = realar[4];
    return 0;
  }

  /**
   * Modifies AC branch data (`psspy.branch_chng_3(ibus, jbus, ckt, intgar, realar)`).
   */
  public branch_chng_3(ibus: number, jbus: number, ckt = "1", intgar: number[] = [], realar: number[] = []): number {
    if (!this.activeCase) return 1;
    const cleanCkt = ckt.trim() || "1";
    const br = this.activeCase.branches.find(
      (b) => ((b.i === ibus && b.j === jbus) || (b.i === jbus && b.j === ibus)) && (b.ckt.trim() || "1") === cleanCkt,
    );
    if (!br) return 2;
    if (intgar[0] !== undefined) br.st = intgar[0] === 0 ? 0 : 1;
    if (realar[0] !== undefined) br.r = realar[0];
    if (realar[1] !== undefined) br.x = realar[1];
    if (realar[2] !== undefined) br.b = realar[2];
    if (realar[3] !== undefined) br.rateA = realar[3];
    return 0;
  }

  private syncBusVoltagesFromSolution(sol: PowerFlowSolution): void {
    if (!this.activeCase) return;
    for (const bRes of sol.buses) {
      const bus = this.activeCase.buses.get(bRes.busNumber);
      if (bus) {
        bus.vm = bRes.vm;
        bus.va = bRes.va;
      }
    }
  }
}

/**
 * Default singleton `psspy` instance for direct imports.
 */
export const psspy = new PsspySession();

/**
 * Parses and executes a Python `psspy.*` automation script in-memory against a `PsspySession`.
 * Supports standard utility automation calls (`psspy.psseinit`, `psspy.read`, `psspy.case`,
 * `psspy.save`, `psspy.dyre_new`, `psspy.rdseq`, `psspy.fnsl`, `psspy.fdns`, `psspy.dcsc`,
 * `psspy.accc`, `psspy.strt`, `psspy.dist_bus_fault`, `psspy.dist_clear_fault`, `psspy.run`).
 */
/**
 * Generates a Python `psspy` module bridge for Pyodide / CPython-WASM runtimes
 * that delegates every `psspy.*` call directly to an attached JS `PsspySession`.
 */
export function generatePyodidePsspyBridgeCode(globalSessionVar = "__ms_psspy_session"): string {
  return `
import types, sys
_psspy = types.ModuleType("psspy")
def _wrap(name):
    def _fn(*args, **kwargs):
        fn = getattr(${globalSessionVar}, name, None)
        if fn is None:
            return 0
        return fn(*args)
    return _fn
for _api in [
    "psseinit", "read", "case", "save", "dyre_new", "rdseq",
    "fnsl", "fdns", "dcsc", "scmu", "accc", "strt",
    "dist_bus_fault", "dist_clear_fault", "run",
    "bus_chng_4", "load_chng_4", "machine_chng_2", "branch_chng_3",
]:
    setattr(_psspy, _api, _wrap(_api))
sys.modules["psspy"] = _psspy
`.trim();
}

function expandPythonVariablesAndLoops(scriptText: string): string {
  const vars = new Map<string, string>();
  const outLines: string[] = [];
  const rawLines = scriptText.split(/\r?\n/);

  const substVars = (expr: string): string => {
    let result = expr;
    for (const [k, v] of vars) {
      result = result.replace(new RegExp(`\\b${k}\\b`, "g"), v);
    }
    return result;
  };

  let idx = 0;
  while (idx < rawLines.length) {
    const line = rawLines[idx]!;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      idx++;
      continue;
    }

    // Simple `for <var> in <list_or_range>:` loop expansion
    const forMatch = /^for\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+in\s+(.+):$/.exec(trimmed);
    if (forMatch) {
      const loopVar = forMatch[1]!;
      const iterExpr = substVars(forMatch[2]!.trim());
      const baseIndent = line.search(/\S/);
      const bodyLines: string[] = [];
      idx++;
      while (idx < rawLines.length) {
        const nextLine = rawLines[idx]!;
        const nextTrim = nextLine.trim();
        if (!nextTrim) {
          idx++;
          continue;
        }
        const nextIndent = nextLine.search(/\S/);
        if (nextIndent <= baseIndent) break;
        bodyLines.push(nextTrim);
        idx++;
      }

      let items: string[] = [];
      const rangeMatch = /^range\(\s*(-?\d+)\s*(?:,\s*(-?\d+)\s*(?:,\s*(-?\d+)\s*)?)?\)$/.exec(iterExpr);
      if (rangeMatch) {
        const start = rangeMatch[2] !== undefined ? Number(rangeMatch[1]) : 0;
        const stop = rangeMatch[2] !== undefined ? Number(rangeMatch[2]) : Number(rangeMatch[1]);
        const step = rangeMatch[3] !== undefined ? Number(rangeMatch[3]) : 1;
        if (step !== 0) {
          for (let v = start; step > 0 ? v < stop : v > stop; v += step) {
            items.push(String(v));
          }
        }
      } else if (iterExpr.startsWith("[") && iterExpr.endsWith("]")) {
        items = iterExpr
          .slice(1, -1)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      }

      for (const item of items) {
        for (const bodyLine of bodyLines) {
          outLines.push(bodyLine.replace(new RegExp(`\\b${loopVar}\\b`, "g"), item));
        }
      }
      continue;
    }

    // Simple scalar assignment `x = 123` or `fname = 'case.raw'`
    const assignMatch = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)$/.exec(trimmed);
    if (assignMatch && !trimmed.includes("psspy.")) {
      vars.set(assignMatch[1]!, substVars(assignMatch[2]!.trim()));
      idx++;
      continue;
    }

    outLines.push(substVars(trimmed));
    idx++;
  }
  return outLines.join("\n");
}

export function executePythonPsspyScript(
  scriptText: string,
  files?: Record<string, string | Uint8Array>,
): PsspySession {
  const session = new PsspySession(files);
  const expandedScript = expandPythonVariablesAndLoops(scriptText);
  const callRegex = /psspy\.([a-zA-Z0-9_]+)\s*\(([^)]*)\)/g;

  for (const match of expandedScript.matchAll(callRegex)) {
    const fnName = match[1]!;
    const rawArgs = match[2]!.trim();
    const args = parsePythonCallArgs(rawArgs);

    switch (fnName) {
      case "psseinit":
        session.psseinit(typeof args[0] === "number" ? args[0] : 50000);
        break;
      case "read":
        session.read(
          typeof args[0] === "number" ? args[0] : 0,
          typeof args[1] === "string" ? args[1] : String(args[0] ?? ""),
        );
        break;
      case "case":
        if (typeof args[0] === "string") session.case(args[0]);
        break;
      case "save":
        session.save(typeof args[0] === "string" ? args[0] : undefined);
        break;
      case "dyre_new": {
        const dyrFile = args.find((a): a is string => typeof a === "string");
        if (dyrFile) session.dyre_new([1, 1, 1, 1], dyrFile);
        break;
      }
      case "rdseq": {
        const seqFile = args.find((a): a is string => typeof a === "string");
        if (seqFile) session.rdseq(seqFile);
        break;
      }
      case "fnsl":
        session.fnsl();
        break;
      case "fdns":
        session.fdns();
        break;
      case "dcsc":
      case "scmu":
        session.dcsc();
        break;
      case "accc":
        session.accc();
        break;
      case "strt": {
        const outFile = args.find((a): a is string => typeof a === "string");
        session.strt([0, 0], outFile);
        break;
      }
      case "dist_bus_fault": {
        const ibus = typeof args[0] === "number" ? args[0] : 1;
        session.dist_bus_fault(ibus);
        break;
      }
      case "dist_clear_fault":
        session.dist_clear_fault();
        break;
      case "run": {
        // psspy.run(option, tpause, nprt, nplt, crtplt) or psspy.run(tpause=5.0)
        const numArgs = args.filter((a): a is number => typeof a === "number");
        const tpause = numArgs.length >= 2 ? numArgs[1]! : (numArgs[0] ?? 5.0);
        session.run(0, tpause);
        break;
      }
      case "bus_chng_4":
        if (typeof args[0] === "number") {
          session.bus_chng_4(
            args[0],
            Array.isArray(args[1]) ? args[1] : [],
            Array.isArray(args[2]) ? args[2] : [],
            typeof args[3] === "string" ? args[3] : undefined,
          );
        }
        break;
      case "load_chng_4":
        if (typeof args[0] === "number") {
          session.load_chng_4(
            args[0],
            typeof args[1] === "string" ? args[1] : "1",
            Array.isArray(args[2]) ? args[2] : [],
            Array.isArray(args[3]) ? args[3] : [],
          );
        }
        break;
      case "machine_chng_2":
        if (typeof args[0] === "number") {
          session.machine_chng_2(
            args[0],
            typeof args[1] === "string" ? args[1] : "1",
            Array.isArray(args[2]) ? args[2] : [],
            Array.isArray(args[3]) ? args[3] : [],
          );
        }
        break;
      case "branch_chng_3":
        if (typeof args[0] === "number" && typeof args[1] === "number") {
          session.branch_chng_3(
            args[0],
            args[1],
            typeof args[2] === "string" ? args[2] : "1",
            Array.isArray(args[3]) ? args[3] : [],
            Array.isArray(args[4]) ? args[4] : [],
          );
        }
        break;
    }
  }

  return session;
}

function parsePythonCallArgs(rawArgs: string): Array<number | string | number[]> {
  if (!rawArgs) return [];
  const results: Array<number | string | number[]> = [];
  let i = 0;
  while (i < rawArgs.length) {
    while (i < rawArgs.length && /[\s,]/.test(rawArgs[i]!)) i++;
    if (i >= rawArgs.length) break;

    // Skip keyword prefix like `tpause=` or `outfile=`
    const kwMatch = rawArgs.slice(i).match(/^[a-zA-Z_][a-zA-Z0-9_]*\s*=\s*/);
    if (kwMatch) {
      i += kwMatch[0].length;
    }

    const ch = rawArgs[i]!;
    if (ch === "'" || ch === '"') {
      const quote = ch;
      i++;
      let s = "";
      while (i < rawArgs.length && rawArgs[i] !== quote) {
        s += rawArgs[i];
        i++;
      }
      i++; // closing quote
      results.push(s);
    } else if (ch === "[") {
      i++;
      let listStr = "";
      while (i < rawArgs.length && rawArgs[i] !== "]") {
        listStr += rawArgs[i];
        i++;
      }
      i++; // closing bracket
      const nums = listStr
        .split(",")
        .map((x) => Number(x.trim()))
        .filter((n) => !Number.isNaN(n));
      results.push(nums);
    } else {
      let tok = "";
      while (i < rawArgs.length && rawArgs[i] !== ",") {
        tok += rawArgs[i];
        i++;
      }
      const trimmed = tok.trim();
      const num = Number(trimmed);
      if (!Number.isNaN(num) && trimmed.length > 0) {
        results.push(num);
      } else if (trimmed.length > 0) {
        results.push(trimmed);
      }
    }
  }
  return results;
}

export interface PyodideRuntimeLike {
  globals: { set: (name: string, value: unknown) => void };
  runPythonAsync: (code: string) => Promise<unknown>;
}

/**
 * Executes a Python `psspy` automation script inside a Pyodide WASM CPython runtime
 * when supplied, or falls back seamlessly to `executePythonPsspyScript`.
 */
export async function executePyodidePsspyAsync(
  scriptText: string,
  files?: Record<string, string | Uint8Array>,
  pyodide?: PyodideRuntimeLike,
): Promise<PsspySession> {
  if (!pyodide) {
    return executePythonPsspyScript(scriptText, files);
  }
  const session = new PsspySession(files);
  pyodide.globals.set("__ms_psspy_session", session);
  await pyodide.runPythonAsync(generatePyodidePsspyBridgeCode("__ms_psspy_session"));
  await pyodide.runPythonAsync(scriptText);
  return session;
}
