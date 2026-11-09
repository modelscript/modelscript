// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Siemens PTI PSS/E Interactive Batch & Macro (.idv) Command File Interpreter.
 *
 * Implements execution of legacy PSS/E .idv macro command sequences:
 * - Case I/O: CASE, READ/RDCH, SAVE, DYRE, RDSEQ
 * - Network modifications: OPEN/CLOSE branches, TRIP/RESTORE elements, CHNG (buses, lines, generators, loads)
 * - Load/generation scaling: SCALE
 * - Power flow execution: FNSL (Full Newton-Raphson), FDNS (Fast Decoupled), SOLV
 * - Short-circuit & Contingency: DCSC, SCMU, ACCC
 * - Dynamic simulation: STRT, RUN, DIST_BUS_FAULT, DIST_CLEAR_FAULT
 * - Reporting: LOFL (Load flow text summaries)
 */

import { PsspySession } from "../psspy-shim.js";
import type {
  N1ContingencyAnalysisResult,
  PowerFlowSolution,
  PsseTransientResult,
  ShortCircuitAnalysisResult,
} from "../solver/ac-powerflow.js";
import type { PsseCase } from "../types.js";

export interface IdvCommand {
  command: string;
  args: string[];
  rawLine: string;
  lineNo: number;
}

export interface IdvExecutionResult {
  success: boolean;
  commandsExecuted: number;
  totalCommands: number;
  logs: string[];
  errors: string[];
  session: PsspySession;
  activeCase: PsseCase | null;
  lastPowerFlow: PowerFlowSolution | null;
  lastTransient: PsseTransientResult | null;
  lastShortCircuit: ShortCircuitAnalysisResult | null;
  lastContingency: N1ContingencyAnalysisResult | null;
}

/**
 * Tokenizes a single line from an .idv file.
 */
function tokenizeIdvLine(line: string): string[] {
  let cleaned = line.trim();
  const slashIdx = cleaned.indexOf("/");
  if (slashIdx >= 0) {
    cleaned = cleaned.slice(0, slashIdx).trim();
  }
  if (!cleaned || cleaned.startsWith("@!") || cleaned.startsWith("/*") || cleaned.startsWith("#")) {
    return [];
  }

  const tokens: string[] = [];
  let current = "";
  let inQuotes = false;
  let quoteChar = "";

  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i]!;
    if ((ch === '"' || ch === "'") && (!inQuotes || ch === quoteChar)) {
      inQuotes = !inQuotes;
      quoteChar = inQuotes ? ch : "";
    } else if ((ch === "," || ch === "\t" || (!inQuotes && ch === " " && current.includes(","))) && !inQuotes) {
      if (current.trim().length > 0) {
        tokens.push(current.trim());
      }
      current = "";
    } else if (ch === " " && !inQuotes && tokens.length === 0 && current.length > 0) {
      // Space separated primary command (e.g. "OPEN BRANCH 101 TO 102")
      tokens.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim().length > 0) {
    tokens.push(current.trim());
  }

  return tokens.map((t) => t.replace(/^["']|["']$/g, "").trim());
}

/**
 * Parses an .idv script text into a sequence of executable IdvCommand objects.
 */
export function parseIdv(script: string): IdvCommand[] {
  const commands: IdvCommand[] = [];
  const lines = script.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]!;
    const tokens = tokenizeIdvLine(rawLine);
    if (tokens.length === 0) continue;

    let cmd = tokens[0]!.toUpperCase();
    if (cmd.startsWith("BAT_")) {
      cmd = cmd.substring(4);
    }

    commands.push({
      command: cmd,
      args: tokens.slice(1),
      rawLine,
      lineNo: i + 1,
    });
  }

  return commands;
}

/**
 * Executes a PSS/E .idv macro script sequentially against a PSS/E session or case.
 */
export function executeIdv(
  script: string,
  session?: PsspySession,
  options?: {
    virtualFiles?: Record<string, string | Uint8Array> | undefined;
    initialCase?: PsseCase | undefined;
  },
): IdvExecutionResult {
  const sess = session ?? new PsspySession(options?.virtualFiles);
  if (options?.initialCase) {
    sess.activeCase = options.initialCase;
  }

  const commands = parseIdv(script);
  const logs: string[] = [];
  const errors: string[] = [];
  let executedCount = 0;

  for (const item of commands) {
    const { command, args, rawLine, lineNo } = item;
    try {
      switch (command) {
        case "CASE": {
          const file = args[0] || "";
          const ierr = sess.case(file);
          if (ierr !== 0) {
            errors.push(`[Line ${lineNo}] Failed to load case '${file}' (ierr=${ierr})`);
          } else {
            logs.push(`[Line ${lineNo}] Loaded case file '${file}' successfully.`);
          }
          break;
        }

        case "READ":
        case "RDCH": {
          const rawFile = args.length > 1 ? args[1]! : args[0] || "";
          const ierr = sess.read(0, rawFile);
          if (ierr !== 0) {
            errors.push(`[Line ${lineNo}] Failed to read RAW file '${rawFile}' (ierr=${ierr})`);
          } else {
            logs.push(`[Line ${lineNo}] Read RAW power flow base case '${rawFile}'.`);
          }
          break;
        }

        case "SAVE": {
          const savFile = args[0] || "saved.sav";
          sess.save(savFile);
          logs.push(`[Line ${lineNo}] Saved active case to '${savFile}'.`);
          break;
        }

        case "DYRE":
        case "DYRE_NEW": {
          const dyrFile = args[0] || "";
          const ierr = sess.dyre_new([1, 1, 1, 1], dyrFile);
          if (ierr !== 0) {
            errors.push(`[Line ${lineNo}] Failed to read DYR dynamics file '${dyrFile}' (ierr=${ierr})`);
          } else {
            logs.push(`[Line ${lineNo}] Loaded dynamic models from '${dyrFile}'.`);
          }
          break;
        }

        case "RDSEQ":
        case "SEQR": {
          const seqFile = args[0] || "";
          const ierr = sess.rdseq(seqFile);
          if (ierr !== 0) {
            errors.push(`[Line ${lineNo}] Failed to read SEQ sequence file '${seqFile}' (ierr=${ierr})`);
          } else {
            logs.push(`[Line ${lineNo}] Loaded sequence data from '${seqFile}'.`);
          }
          break;
        }

        case "FNSL":
        case "FNSI":
        case "SOLV":
        case "SOLVE": {
          const [ierr, sol] = sess.fnsl();
          if (ierr !== 0 || !sol.converged) {
            errors.push(`[Line ${lineNo}] Full Newton-Raphson did not converge (iterations=${sol.iterations}).`);
          } else {
            logs.push(
              `[Line ${lineNo}] FNSL converged in ${sol.iterations} iterations. Total Gen: ${sol.totalGenMw.toFixed(1)} MW, Total Load: ${sol.totalLoadMw.toFixed(1)} MW.`,
            );
          }
          break;
        }

        case "FDNS": {
          const [ierr, sol] = sess.fdns();
          if (ierr !== 0 || !sol.converged) {
            errors.push(`[Line ${lineNo}] Fast Decoupled power flow did not converge.`);
          } else {
            logs.push(`[Line ${lineNo}] FDNS converged in ${sol.iterations} iterations.`);
          }
          break;
        }

        case "OPEN": {
          // OPEN, <fromBus>, <toBus>, <ckt> OR OPEN BRANCH <fromBus> <toBus> <ckt>
          const parsed = parseBranchArgs(args);
          if (!parsed || !sess.activeCase) {
            errors.push(`[Line ${lineNo}] Invalid OPEN branch syntax: "${rawLine}"`);
          } else {
            const found = setBranchStatus(sess.activeCase, parsed.fromBus, parsed.toBus, parsed.ckt, 0);
            if (found) {
              logs.push(`[Line ${lineNo}] Opened branch ${parsed.fromBus} -> ${parsed.toBus} (ckt '${parsed.ckt}').`);
            } else {
              errors.push(
                `[Line ${lineNo}] Branch ${parsed.fromBus} -> ${parsed.toBus} (ckt '${parsed.ckt}') not found.`,
              );
            }
          }
          break;
        }

        case "CLOS":
        case "CLOSE":
        case "RESTORE": {
          // CLOS, <fromBus>, <toBus>, <ckt>
          const parsed = parseBranchArgs(args);
          if (!parsed || !sess.activeCase) {
            errors.push(`[Line ${lineNo}] Invalid CLOSE branch syntax: "${rawLine}"`);
          } else {
            const found = setBranchStatus(sess.activeCase, parsed.fromBus, parsed.toBus, parsed.ckt, 1);
            if (found) {
              logs.push(`[Line ${lineNo}] Closed branch ${parsed.fromBus} -> ${parsed.toBus} (ckt '${parsed.ckt}').`);
            } else {
              errors.push(
                `[Line ${lineNo}] Branch ${parsed.fromBus} -> ${parsed.toBus} (ckt '${parsed.ckt}') not found.`,
              );
            }
          }
          break;
        }

        case "CHNG":
        case "MODI":
        case "SET": {
          // CHNG, BUS|BRANCH|LOAD|GEN, <identifiers...>, <param>, <val>...
          if (!sess.activeCase) {
            errors.push(`[Line ${lineNo}] No active case loaded before CHNG command.`);
          } else {
            const res = applyElementChange(sess.activeCase, args);
            if (res.success) {
              logs.push(`[Line ${lineNo}] ${res.message}`);
            } else {
              errors.push(`[Line ${lineNo}] ${res.message}`);
            }
          }
          break;
        }

        case "SCALE": {
          // SCALE, LOAD|GEN, <factor>
          if (!sess.activeCase) {
            errors.push(`[Line ${lineNo}] No active case loaded before SCALE command.`);
          } else {
            const target = (args[0] || "LOAD").toUpperCase();
            const factor = parseFloat(args[1] || "1.0");
            if (isNaN(factor)) {
              errors.push(`[Line ${lineNo}] Invalid scale factor: '${args[1]}'`);
            } else if (target === "LOAD") {
              for (const load of sess.activeCase.loads) {
                load.pl *= factor;
                load.ql *= factor;
              }
              logs.push(`[Line ${lineNo}] Scaled all system loads by factor ${factor}.`);
            } else if (target === "GEN") {
              for (const gen of sess.activeCase.generators) {
                gen.pg *= factor;
              }
              logs.push(`[Line ${lineNo}] Scaled all system generation by factor ${factor}.`);
            }
          }
          break;
        }

        case "STRT": {
          const outFile = args[0] || "dynamic_run.out";
          sess.strt(undefined, outFile);
          logs.push(`[Line ${lineNo}] Initialized dynamic simulation with output channel '${outFile}'.`);
          break;
        }

        case "RUN": {
          const tpause = parseFloat(args[0] || "1.0");
          sess.run(0, tpause);
          logs.push(`[Line ${lineNo}] Advanced dynamic simulation to t = ${tpause}s.`);
          break;
        }

        case "DIST_BUS_FAULT": {
          const ibus = parseInt(args[0] || "0", 10);
          sess.dist_bus_fault(ibus);
          logs.push(`[Line ${lineNo}] Applied 3-phase short-circuit fault at bus ${ibus}.`);
          break;
        }

        case "DIST_CLEAR_FAULT": {
          sess.dist_clear_fault();
          logs.push(`[Line ${lineNo}] Cleared dynamic bus fault.`);
          break;
        }

        case "DCSC":
        case "SCMU": {
          const [ierr, sc] = sess.dcsc();
          logs.push(`[Line ${lineNo}] Short-circuit calculation complete (ierr=${ierr}, buses=${sc.buses.length}).`);
          break;
        }

        case "ACCC": {
          const [ierr, accc] = sess.accc();
          logs.push(
            `[Line ${lineNo}] N-1 contingency screening complete (ierr=${ierr}, evaluated=${accc.totalContingencies}, violations=${accc.violationCount}).`,
          );
          break;
        }

        case "LOFL": {
          if (sess.lastPowerFlow) {
            logs.push(`[Line ${lineNo}] --- Load Flow Summary ---`);
            logs.push(
              `Total Gen: ${sess.lastPowerFlow.totalGenMw.toFixed(1)} MW, Total Load: ${sess.lastPowerFlow.totalLoadMw.toFixed(1)} MW, Total Loss: ${sess.lastPowerFlow.totalLossMw.toFixed(1)} MW`,
            );
          } else {
            logs.push(`[Line ${lineNo}] No solved load flow in memory.`);
          }
          break;
        }

        default: {
          logs.push(`[Line ${lineNo}] Executed command '${command}'.`);
          break;
        }
      }
      executedCount++;
    } catch (err: unknown) {
      errors.push(`[Line ${lineNo}] Error executing '${rawLine}': ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    success: errors.length === 0,
    commandsExecuted: executedCount,
    totalCommands: commands.length,
    logs,
    errors,
    session: sess,
    activeCase: sess.activeCase,
    lastPowerFlow: sess.lastPowerFlow,
    lastTransient: sess.lastTransient,
    lastShortCircuit: sess.lastShortCircuit,
    lastContingency: sess.lastContingency,
  };
}

/**
 * Parses branch connection arguments from tokens like:
 * - ["101", "102", "1"]
 * - ["BRANCH", "101", "102", "1"]
 * - ["BRANCH", "101", "TO", "102", "CKT", "1"]
 */
function parseBranchArgs(args: string[]): { fromBus: number; toBus: number; ckt: string } | null {
  const filtered = args.filter((a) => {
    const u = a.toUpperCase();
    return u !== "BRANCH" && u !== "TO" && u !== "CKT";
  });

  if (filtered.length >= 2) {
    const fromBus = parseInt(filtered[0]!, 10);
    const toBus = parseInt(filtered[1]!, 10);
    const ckt = filtered[2] || "1";
    if (!isNaN(fromBus) && !isNaN(toBus)) {
      return { fromBus, toBus, ckt };
    }
  }
  return null;
}

/**
 * Sets branch in-service status (st = 1 or 0).
 */
function setBranchStatus(c: PsseCase, fromBus: number, toBus: number, ckt: string, st: number): boolean {
  let found = false;
  for (const br of c.branches) {
    if (
      ((br.i === fromBus && br.j === toBus) || (br.i === toBus && br.j === fromBus)) &&
      (br.ckt.trim() === ckt.trim() || ckt === "*" || !ckt)
    ) {
      br.st = st;
      found = true;
    }
  }
  return found;
}

/**
 * Applies a parameter change to a case element (BUS, BRANCH, LOAD, GEN).
 */
function applyElementChange(c: PsseCase, args: string[]): { success: boolean; message: string } {
  if (args.length < 3) {
    return { success: false, message: `Invalid CHNG arguments: ${args.join(", ")}` };
  }

  const kind = args[0]!.toUpperCase();

  if (kind === "BUS") {
    const busNum = parseInt(args[1]!, 10);
    const bus = c.buses.get(busNum);
    if (!bus) return { success: false, message: `Bus ${busNum} not found in case.` };

    for (let i = 2; i < args.length - 1; i += 2) {
      const param = args[i]!.toUpperCase();
      const val = parseFloat(args[i + 1]!);
      if (param === "VM") bus.vm = val;
      else if (param === "VA") bus.va = val;
      else if (param === "BASEKV") bus.baseKv = val;
      else if (param === "IDE" || param === "TYPE") bus.ide = Math.round(val);
    }
    return { success: true, message: `Modified Bus ${busNum} parameters.` };
  }

  if (kind === "BRANCH") {
    const fromBus = parseInt(args[1]!, 10);
    const toBus = parseInt(args[2]!, 10);
    const ckt = args[3] || "1";
    const br = c.branches.find(
      (b) => ((b.i === fromBus && b.j === toBus) || (b.i === toBus && b.j === fromBus)) && b.ckt.trim() === ckt.trim(),
    );
    if (!br) return { success: false, message: `Branch ${fromBus}->${toBus} (ckt '${ckt}') not found.` };

    const startIdx = isNaN(parseFloat(args[3]!)) ? 4 : 3;
    for (let i = startIdx; i < args.length - 1; i += 2) {
      const param = args[i]!.toUpperCase();
      const val = parseFloat(args[i + 1]!);
      if (param === "R") br.r = val;
      else if (param === "X") br.x = val;
      else if (param === "B") br.b = val;
      else if (param === "RATEA") br.rateA = val;
      else if (param === "RATEB") br.rateB = val;
      else if (param === "RATEC") br.rateC = val;
      else if (param === "ST" || param === "STATUS") br.st = Math.round(val);
    }
    return { success: true, message: `Modified Branch ${fromBus}->${toBus} (${ckt}).` };
  }

  if (kind === "LOAD") {
    const busNum = parseInt(args[1]!, 10);
    const id = args[2] || "1";
    const load = c.loads.find((l) => l.i === busNum && l.id.trim() === id.trim());
    if (!load) return { success: false, message: `Load at bus ${busNum} (id '${id}') not found.` };

    for (let i = 3; i < args.length - 1; i += 2) {
      const param = args[i]!.toUpperCase();
      const val = parseFloat(args[i + 1]!);
      if (param === "PL") load.pl = val;
      else if (param === "QL") load.ql = val;
      else if (param === "STATUS") load.status = Math.round(val);
    }
    return {
      success: true,
      message: `Modified Load at bus ${busNum} (id '${id}'): PL=${load.pl}MW, QL=${load.ql}Mvar.`,
    };
  }

  if (kind === "GEN" || kind === "GENERATOR") {
    const busNum = parseInt(args[1]!, 10);
    const id = args[2] || "1";
    const gen = c.generators.find((g) => g.i === busNum && g.id.trim() === id.trim());
    if (!gen) return { success: false, message: `Generator at bus ${busNum} (id '${id}') not found.` };

    for (let i = 3; i < args.length - 1; i += 2) {
      const param = args[i]!.toUpperCase();
      const val = parseFloat(args[i + 1]!);
      if (param === "PG") gen.pg = val;
      else if (param === "QG") gen.qg = val;
      else if (param === "QT") gen.qt = val;
      else if (param === "QB") gen.qb = val;
      else if (param === "VS") gen.vs = val;
      else if (param === "PT") gen.pt = val;
      else if (param === "PB") gen.pb = val;
      else if (param === "STAT") gen.stat = Math.round(val);
    }
    return {
      success: true,
      message: `Modified Generator at bus ${busNum} (id '${id}'): PG=${gen.pg}MW, QG=${gen.qg}Mvar.`,
    };
  }

  return { success: false, message: `Unsupported CHNG element type '${kind}'.` };
}
