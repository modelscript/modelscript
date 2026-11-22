// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/kicad — Direct Linear-Memory `DAEBuilder` Lowering.
 *
 * Lowers a parsed KiCad `.kicad_sch` schematic directly into ModelScript's
 * zero-GC WebAssembly linear-memory `DAEBuilder` using Modified Nodal Analysis
 * (MNA) conservation equations for resistors, capacitors, inductors, and DC
 * voltage/current sources.
 */

import {
  BinOp,
  Causality,
  DAEBuilder,
  EqKind,
  ExprKind,
  StringInterner,
  Variability,
  VarType,
} from "@modelscript/runtime";
import { extractBoardParasitics } from "../parasitics.js";
import { extractSchematicNetlist, type SchematicNetlistResult } from "../schematic-netlist.js";
import type { KiCadBoard, KiCadDiagnostic, KiCadSchematic, KiCadSymbolInstance } from "../types.js";

export interface KiCadDaeOptions {
  /** Override ground net name (defaults to auto-detecting GND / 0 / VSS / AGND / DGND). */
  groundNet?: string;
}

export interface KiCadDaeResult {
  arena: DAEBuilder;
  interner: StringInterner;
  netlistResult: SchematicNetlistResult;
  groundNet: string;
  nodeCount: number;
  loweredComponentCount: number;
  diagnostics: KiCadDiagnostic[];
}

const SI_SUFFIX: Record<string, number> = {
  f: 1e-15,
  p: 1e-12,
  n: 1e-9,
  u: 1e-6,
  µ: 1e-6,
  m: 1e-3,
  k: 1e3,
  K: 1e3,
  M: 1e6,
  Meg: 1e6,
  MEG: 1e6,
  G: 1e9,
  T: 1e12,
};

/**
 * Parses engineering SI values commonly used in KiCad schematics
 * (e.g., `"10k"`, `"4.7k"`, `"100nF"`, `"10uH"`, `"5V"`, `"1Meg"`, `"4k7"`).
 */
export function parseEngineeringValue(raw: string): number | null {
  const cleaned = raw
    .trim()
    .replace(/[Ωω]|Ohm|ohm|Hz|V|A|F|H$/g, "")
    .trim();
  if (!cleaned) return null;

  // European shorthand like 4k7 or 2u2
  const euroMatch = /^(-?\d+)([fpnuµmkKMGT])(\d+)$/.exec(cleaned);
  if (euroMatch) {
    const scale = SI_SUFFIX[euroMatch[2]!] ?? 1;
    return Number.parseFloat(`${euroMatch[1]}.${euroMatch[3]}`) * scale;
  }

  const m = /^(-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*(Meg|MEG|[fpnuµmkKMGT])?/.exec(cleaned);
  if (!m) return null;
  const num = Number.parseFloat(m[1]!);
  if (!Number.isFinite(num)) return null;
  const scale = m[2] ? (SI_SUFFIX[m[2]] ?? 1) : 1;
  return num * scale;
}

function sanitizeIdent(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_]/g, "_");
}

function classifyDevice(sym: KiCadSymbolInstance): "R" | "C" | "L" | "V" | "I" | "D" | null {
  const sim = (sym.simDevice ?? "").toUpperCase();
  if (sim === "R" || sim === "C" || sim === "L" || sim === "V" || sim === "I" || sim === "D") return sim;
  if (sim === "VDC" || sim === "VSOURCE") return "V";
  if (sim === "IDC" || sim === "ISOURCE") return "I";

  const lib = sym.libId.toLowerCase();
  if (lib.endsWith(":r") || lib.includes("device:r_")) return "R";
  if (lib.endsWith(":c") || lib.includes("device:c_")) return "C";
  if (lib.endsWith(":l") || lib.includes("device:l_")) return "L";
  if (lib.endsWith(":d") || lib.includes("device:d_") || lib.includes("led")) return "D";
  if (lib.includes("vdc") || lib.includes("vsource")) return "V";
  if (lib.includes("idc") || lib.includes("isource")) return "I";

  const prefix = sym.refDes.charAt(0).toUpperCase();
  if (prefix === "R" || prefix === "C" || prefix === "L" || prefix === "V" || prefix === "I" || prefix === "D") {
    return prefix;
  }
  return null;
}

function detectGroundNet(nets: string[], override?: string): string {
  if (override) return override;
  const candidates = ["GND", "0", "VSS", "AGND", "DGND", "GNDD", "GNDA"];
  for (const c of candidates) {
    const match = nets.find((n) => n.toUpperCase() === c);
    if (match) return match;
  }
  return nets[0] ?? "GND";
}

/**
 * Lowers a parsed `KiCadSchematic` directly into a `DAEBuilder` arena using
 * Modified Nodal Analysis (MNA).
 */
export function lowerKiCadSchematicToDAE(sch: KiCadSchematic, options?: KiCadDaeOptions): KiCadDaeResult {
  const arena = new DAEBuilder();
  const interner = new StringInterner();
  const diagnostics: KiCadDiagnostic[] = [];
  const netlistResult = extractSchematicNetlist(sch);

  const netNames = netlistResult.netlist.nets.map((n) => n.id);
  const groundNet = detectGroundNet(netNames, options?.groundNet);

  const zeroExpr = arena.addRealLiteral(0.0);
  const nodeVarExpr = new Map<string, number>();
  const kclTerms = new Map<string, number[]>();

  // 1. Allocate node voltage variables
  for (const net of netNames) {
    const vName = `v_${sanitizeIdent(net)}`;
    const vNameId = interner.intern(vName);
    arena.addVariable(vNameId, VarType.Real, Variability.Continuous, Causality.Local, 0.0, 0);
    const vExpr = arena.addExpression(ExprKind.Name, vNameId);
    nodeVarExpr.set(net, vExpr);
    kclTerms.set(net, []);
  }

  // Reference ground equation: v_GND = 0.0
  const gndExpr = nodeVarExpr.get(groundNet);
  if (gndExpr !== undefined) {
    arena.addEquation(EqKind.Simple, gndExpr, zeroExpr);
  }

  const addKcl = (net: string, expr: number) => {
    if (net === groundNet) return;
    kclTerms.get(net)?.push(expr);
  };

  let loweredComponentCount = 0;

  // 2. Lower 2-pin electrical primitives
  for (const sym of sch.symbols) {
    if (sym.refDes.startsWith("#PWR") || sym.refDes.startsWith("#FLG") || sym.libId.startsWith("power:")) {
      continue;
    }
    const devKind = classifyDevice(sym);
    if (!devKind) continue;
    if (sym.pins.length < 2) {
      diagnostics.push({
        code: "K5002",
        severity: "warning",
        message: `Component '${sym.refDes}' has fewer than 2 resolved pins; skipping DAE lowering.`,
      });
      continue;
    }

    const netP = netlistResult.pinNetMap.get(`${sym.refDes}.${sym.pins[0]!.number}`);
    const netN = netlistResult.pinNetMap.get(`${sym.refDes}.${sym.pins[1]!.number}`);
    if (!netP || !netN) continue;

    const vP = nodeVarExpr.get(netP) ?? zeroExpr;
    const vN = nodeVarExpr.get(netN) ?? zeroExpr;
    const val = devKind === "D" ? 1e-14 : parseEngineeringValue(sym.value);
    if (val === null) {
      diagnostics.push({
        code: "K5003",
        severity: "warning",
        message: `Component '${sym.refDes}' has non-numeric value '${sym.value}'; skipping DAE lowering.`,
      });
      continue;
    }

    const id = sanitizeIdent(sym.refDes);
    const iNameId = interner.intern(`i_${id}`);
    arena.addVariable(iNameId, VarType.Real, Variability.Continuous, Causality.Local, 0.0, 0);
    const iExpr = arena.addExpression(ExprKind.Name, iNameId);
    const vDiff = arena.addBinaryExpr(BinOp.Sub, vP, vN);

    const pNameId = interner.intern(`${devKind}_${id}`);
    arena.addVariable(pNameId, VarType.Real, Variability.Parameter, Causality.Local, val, 0);
    const pExpr = arena.addExpression(ExprKind.Name, pNameId);

    switch (devKind) {
      case "R": {
        const rhs = arena.addBinaryExpr(BinOp.Mul, pExpr, iExpr);
        arena.addEquation(EqKind.Simple, vDiff, rhs);
        break;
      }
      case "C": {
        const vcNameId = interner.intern(`v_C_${id}`);
        arena.addVariable(vcNameId, VarType.Real, Variability.Continuous, Causality.Local, 0.0, 0);
        const vcExpr = arena.addExpression(ExprKind.Name, vcNameId);
        arena.addEquation(EqKind.Simple, vcExpr, vDiff);
        const derVc = arena.addCallExpr("der", [vcExpr]);
        arena.addEquation(EqKind.Simple, iExpr, arena.addBinaryExpr(BinOp.Mul, pExpr, derVc));
        break;
      }
      case "L": {
        const derI = arena.addCallExpr("der", [iExpr]);
        arena.addEquation(EqKind.Simple, vDiff, arena.addBinaryExpr(BinOp.Mul, pExpr, derI));
        break;
      }
      case "V": {
        arena.addEquation(EqKind.Simple, vDiff, pExpr);
        break;
      }
      case "I": {
        arena.addEquation(EqKind.Simple, iExpr, pExpr);
        break;
      }
      case "D": {
        // Shockley diode: i_D = Is * (exp(vDiff / 0.02585) - 1)
        const vtExpr = arena.addRealLiteral(0.02585);
        const expTerm = arena.addCallExpr("exp", [arena.addBinaryExpr(BinOp.Div, vDiff, vtExpr)]);
        const rhs = arena.addBinaryExpr(
          BinOp.Mul,
          pExpr,
          arena.addBinaryExpr(BinOp.Sub, expTerm, arena.addRealLiteral(1.0)),
        );
        arena.addEquation(EqKind.Simple, iExpr, rhs);
        break;
      }
    }

    // KCL: current leaves positive node, enters negative node
    addKcl(netP, iExpr);
    addKcl(netN, arena.addBinaryExpr(BinOp.Sub, zeroExpr, iExpr));
    loweredComponentCount++;
  }

  // 3. Emit KCL equations at every non-ground node
  for (const [net, terms] of kclTerms) {
    if (net === groundNet || terms.length === 0) continue;
    let sum = terms[0]!;
    for (let i = 1; i < terms.length; i++) {
      sum = arena.addBinaryExpr(BinOp.Add, sum, terms[i]!);
    }
    arena.addEquation(EqKind.Simple, sum, zeroExpr);
  }

  return {
    arena,
    interner,
    netlistResult,
    groundNet,
    nodeCount: netNames.length,
    loweredComponentCount,
    diagnostics,
  };
}

/**
 * Lowers a KiCad schematic coupled with layout-extracted PCB trace RLGC
 * parasitics (registering `R_trace_<net>`, `L_trace_<net>`, `C_trace_<net>`
 * parameters into the DAE arena for post-layout SI/PI verification).
 */
export function lowerKiCadSchematicWithParasitics(
  sch: KiCadSchematic,
  board: KiCadBoard,
  options?: KiCadDaeOptions,
): KiCadDaeResult & { parasiticNetCount: number } {
  const base = lowerKiCadSchematicToDAE(sch, options);
  const parasitics = extractBoardParasitics(board);
  let parasiticNetCount = 0;

  for (const [netName, summary] of Object.entries(parasitics.nets)) {
    if (netName === "__UNASSIGNED__") continue;
    const id = sanitizeIdent(netName);
    base.arena.addVariable(
      base.interner.intern(`R_trace_${id}`),
      VarType.Real,
      Variability.Parameter,
      Causality.Local,
      summary.totalResistanceOhm,
      0,
    );
    base.arena.addVariable(
      base.interner.intern(`L_trace_${id}`),
      VarType.Real,
      Variability.Parameter,
      Causality.Local,
      summary.totalInductanceNH * 1e-9,
      0,
    );
    base.arena.addVariable(
      base.interner.intern(`C_trace_${id}`),
      VarType.Real,
      Variability.Parameter,
      Causality.Local,
      summary.totalCapacitancePF * 1e-12,
      0,
    );
    parasiticNetCount++;
  }

  return { ...base, parasiticNetCount };
}

/**
 * Projects a parsed KiCad schematic into a standard Berkeley SPICE `.cir`
 * netlist suitable for `@modelscript/spice` solvers (.OP, .TRAN, .AC).
 */
export function exportKiCadSchematicToSpice(sch: KiCadSchematic, title = "KiCad Export"): string {
  const netRes = extractSchematicNetlist(sch);
  const netNames = netRes.netlist.nets.map((n) => n.id);
  const ground = detectGroundNet(netNames);
  const mapNet = (n: string) => (n === ground ? "0" : sanitizeIdent(n));

  const lines: string[] = [`* ${title} (generated by @modelscript/kicad)`];
  let hasDiode = false;

  for (const sym of sch.symbols) {
    if (sym.refDes.startsWith("#PWR") || sym.refDes.startsWith("#FLG") || sym.libId.startsWith("power:")) continue;
    const kind = classifyDevice(sym);
    if (!kind || sym.pins.length < 2) continue;
    const n1 = netRes.pinNetMap.get(`${sym.refDes}.${sym.pins[0]!.number}`);
    const n2 = netRes.pinNetMap.get(`${sym.refDes}.${sym.pins[1]!.number}`);
    if (!n1 || !n2) continue;

    if (kind === "D") {
      hasDiode = true;
      lines.push(`${sym.refDes} ${mapNet(n1)} ${mapNet(n2)} DDEFAULT`);
    } else if (kind === "V") {
      const val = parseEngineeringValue(sym.value) ?? 5;
      lines.push(`${sym.refDes} ${mapNet(n1)} ${mapNet(n2)} DC ${val}`);
    } else {
      lines.push(`${sym.refDes} ${mapNet(n1)} ${mapNet(n2)} ${sym.value || "1k"}`);
    }
  }
  if (hasDiode) {
    lines.push(`.MODEL DDEFAULT D(IS=1e-14 N=1.0)`);
  }
  lines.push(`.OP`);
  lines.push(`.END`);
  return lines.join("\n");
}
