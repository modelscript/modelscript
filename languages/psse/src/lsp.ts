// SPDX-License-Identifier: AGPL-3.0-or-later

import { lowerPsseToDae } from "./dae/psse-to-dae.js";
import { PsseErrorCode } from "./errors.js";
import { lintPsse } from "./lints/index.js";
import { extractPowerFlowNetlist, serializePowerFlowNetlist } from "./netlist/powerflow-netlist.js";
import { DYR_MODEL_SCHEMAS, isLikelyDyrContent, parseDyr } from "./parser/dyr-parser.js";
import { parseRaw, writeRaw } from "./parser/raw-parser.js";
import { psseToModelica } from "./projections/psse-to-modelica.js";
import { psseToEmtNetlist } from "./projections/psse-to-pscad.js";
import {
  analyzeN1Contingencies,
  calculateShortCircuit,
  formatPowerFlowReport,
  simulatePsseTransient,
  solvePowerFlow,
} from "./solver/ac-powerflow.js";
import type { PsseCase, SourceSpan } from "./types.js";
import type { PsseWorkspaceIndex } from "./workspace-index.js";

export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export interface LspLocation {
  uri: string;
  range: LspRange;
}

export interface LspCompletionItem {
  label: string;
  kind: number;
  detail?: string | undefined;
  documentation?: string | undefined;
  insertText?: string | undefined;
}

export enum LspSymbolKind {
  File = 1,
  Module = 2,
  Namespace = 3,
  Package = 4,
  Class = 5,
  Method = 6,
  Property = 7,
  Field = 8,
  Constructor = 9,
  Enum = 10,
  Interface = 11,
  Function = 12,
  Variable = 13,
  Constant = 14,
  String = 15,
  Number = 16,
  Boolean = 17,
  Array = 18,
  Object = 19,
  Key = 20,
  Null = 21,
  EnumMember = 22,
  Struct = 23,
  Event = 24,
  Operator = 25,
  TypeParameter = 26,
}

export interface LspDocumentSymbol {
  name: string;
  detail?: string | undefined;
  kind: LspSymbolKind;
  range: LspRange;
  selectionRange: LspRange;
  children?: LspDocumentSymbol[] | undefined;
}

export interface LspDiagnostic {
  range: LspRange;
  severity: 1 | 2 | 3 | 4; // 1 = Error, 2 = Warning, 3 = Information, 4 = Hint
  code: string;
  source: string;
  message: string;
}

export interface LspHover {
  contents: {
    kind: "markdown" | "plaintext";
    value: string;
  };
  range?: LspRange | undefined;
}

const DEFAULT_RANGE: LspRange = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 1 },
};

function spanToRange(span: SourceSpan | undefined, lines: string[], extraLines = 0): LspRange {
  if (!span) return DEFAULT_RANGE;
  const startLine = Math.max(0, span.line - 1);
  const endLine = Math.min(Math.max(0, lines.length - 1), startLine + extraLines);
  const startCol = Math.max(0, span.column - 1);
  const endCol = Math.max(startCol + 1, lines[endLine]?.length ?? 1);
  return {
    start: { line: startLine, character: startCol },
    end: { line: endLine, character: endCol },
  };
}

/**
 * Validates a PSS/E RAW power flow deck or DYR dynamic data file and returns diagnostics.
 */
export function validatePsse(content: string, uri: string = "model.raw"): LspDiagnostic[] {
  try {
    const lines = content.split(/\r?\n/);
    if (uri.toLowerCase().endsWith(".dyr") || isLikelyDyrContent(content)) {
      const dyr = parseDyr(content);
      const diags: LspDiagnostic[] = [];
      for (const rec of dyr.records) {
        const schema = DYR_MODEL_SCHEMAS[rec.model];
        if (schema && rec.con.length < schema.params.length) {
          diags.push({
            range: spanToRange(rec.span, lines),
            severity: 2,
            code: "P5001",
            source: "modelscript-psse",
            message: `Dynamic model '${rec.model}' at Bus ${rec.ibus} specifies ${rec.con.length} CON parameters, expected ${schema.params.length}.`,
          });
        }
        if (rec.category === "generator" && (rec.namedParams["H"] ?? 1) <= 0) {
          diags.push({
            range: spanToRange(rec.span, lines),
            severity: 1,
            code: PsseErrorCode.ZERO_INERTIA_DYNAMIC_BUS.code,
            source: "modelscript-psse",
            message: PsseErrorCode.ZERO_INERTIA_DYNAMIC_BUS.message(rec.ibus),
          });
        }
        if (rec.category === "generator" && (rec.namedParams["H"] ?? 1) < 0) {
          diags.push({
            range: spanToRange(rec.span, lines),
            severity: 1,
            code: "P5002",
            source: "modelscript-psse",
            message: `Generator dynamic model '${rec.model}' at Bus ${rec.ibus} has negative inertia constant H = ${rec.namedParams["H"]}.`,
          });
        }
      }
      return diags;
    }

    const psseCase = parseRaw(content);
    const diags = lintPsse(psseCase);

    return diags.map((d) => {
      const lineNum = Math.max(0, (d.line ?? 1) - 1);
      const colNum = Math.max(0, (d.column ?? 1) - 1);
      const lineLen = lines[lineNum]?.length ?? 1;

      return {
        range: {
          start: { line: lineNum, character: colNum },
          end: { line: lineNum, character: Math.max(colNum + 1, lineLen) },
        },
        severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
        code: d.code,
        source: "modelscript-psse",
        message: d.message,
      };
    });
  } catch (err: unknown) {
    return [
      {
        range: DEFAULT_RANGE,
        severity: 1,
        code: "P1001",
        source: "modelscript-psse",
        message: `Failed to parse PSS/E base case: ${err instanceof Error ? err.message : String(err)}`,
      },
    ];
  }
}

/**
 * Extracts document symbols for buses, loads, generators, branches, transformers, or `.dyr` dynamic models.
 */
export function getPsseDocumentSymbols(content: string, uri: string = "model.raw"): LspDocumentSymbol[] {
  try {
    const lines = content.split(/\r?\n/);
    const docRange: LspRange = {
      start: { line: 0, character: 0 },
      end: { line: Math.max(0, lines.length - 1), character: lines[lines.length - 1]?.length ?? 1 },
    };

    if (uri.toLowerCase().endsWith(".dyr") || isLikelyDyrContent(content)) {
      const dyr = parseDyr(content);
      const children: LspDocumentSymbol[] = dyr.records.map((rec) => {
        const r = spanToRange(rec.span, lines);
        const paramSummary = Object.entries(rec.namedParams)
          .slice(0, 4)
          .map(([k, v]) => `${k}=${v}`)
          .join(", ");
        return {
          name: `${rec.model} @ Bus ${rec.ibus} [${rec.id}]`,
          detail: `${rec.category.toUpperCase()} | ${paramSummary || `${rec.con.length} CONs`}`,
          kind:
            rec.category === "generator"
              ? LspSymbolKind.Class
              : rec.category === "exciter"
                ? LspSymbolKind.Interface
                : LspSymbolKind.Function,
          range: r,
          selectionRange: r,
        };
      });
      return [
        {
          name: `PSS/E Dynamic Data (${dyr.records.length} models)`,
          detail: `Gens: ${dyr.generatorsByBusId.size} | Exciters: ${dyr.excitersByBusId.size} | Govs: ${dyr.governorsByBusId.size}`,
          kind: LspSymbolKind.Package,
          range: docRange,
          selectionRange: children[0]?.selectionRange ?? DEFAULT_RANGE,
          children,
        },
      ];
    }

    const psseCase = parseRaw(content);
    const children: LspDocumentSymbol[] = [];

    // Buses
    for (const [busNum, bus] of psseCase.buses) {
      const r = spanToRange(bus.span, lines);
      children.push({
        name: `Bus ${busNum} (${bus.name})`,
        detail: `Type: ${bus.ide === 3 ? "Slack" : bus.ide === 2 ? "PV" : "PQ"} | Base: ${bus.baseKv} kV | V: ${bus.vm.toFixed(3)} p.u.`,
        kind: LspSymbolKind.Interface,
        range: r,
        selectionRange: r,
      });
    }

    // Loads
    for (const load of psseCase.loads) {
      const r = spanToRange(load.span, lines);
      children.push({
        name: `Load Bus ${load.i} [${load.id.trim()}]`,
        detail: `P: ${load.pl.toFixed(1)} MW | Q: ${load.ql.toFixed(1)} Mvar`,
        kind: LspSymbolKind.Variable,
        range: r,
        selectionRange: r,
      });
    }

    // Generators
    for (const gen of psseCase.generators) {
      const r = spanToRange(gen.span, lines);
      children.push({
        name: `Gen Bus ${gen.i} [${gen.id.trim()}]`,
        detail: `Pg: ${gen.pg.toFixed(1)} MW | Qg: ${gen.qg.toFixed(1)} Mvar | Vset: ${gen.vs.toFixed(3)} p.u.`,
        kind: LspSymbolKind.Class,
        range: r,
        selectionRange: r,
      });
    }

    // Branches / Lines
    for (const br of psseCase.branches) {
      const r = spanToRange(br.span, lines);
      children.push({
        name: `Line ${br.i} -> ${br.j} [${br.ckt.trim()}]`,
        detail: `R: ${br.r.toFixed(4)} | X: ${br.x.toFixed(4)} | RateA: ${br.rateA} MVA`,
        kind: LspSymbolKind.Property,
        range: r,
        selectionRange: r,
      });
    }

    // Transformers
    for (const xf of psseCase.transformers) {
      const r = spanToRange(xf.span, lines, xf.k !== 0 ? 4 : 3);
      children.push({
        name: `Xfmr ${xf.i} -> ${xf.j}${xf.k !== 0 ? ` -> ${xf.k}` : ""} [${xf.ckt.trim()}]`,
        detail: `Ratio: ${xf.windv1.toFixed(3)} / ${xf.windv2.toFixed(3)} | Sbase: ${xf.sbase12} MVA`,
        kind: LspSymbolKind.Constructor,
        range: r,
        selectionRange: r,
      });
    }

    const headerRange = spanToRange(psseCase.header.span, lines);

    return [
      {
        name: psseCase.title1 || `PSS/E Grid (Rev ${psseCase.header.rev})`,
        detail: `Base MVA: ${psseCase.header.sbase} | Buses: ${psseCase.buses.size} | Gens: ${psseCase.generators.length} | Lines: ${psseCase.branches.length}`,
        kind: LspSymbolKind.Package,
        range: docRange,
        selectionRange: headerRange,
        children: children.length > 0 ? children : undefined,
      },
    ];
  } catch {
    return [];
  }
}

/**
 * Determines which 0-based comma-separated column index corresponds to `character` on `line`.
 */
function getColumnIndexAtCursor(line: string, character: number): number {
  let inQuote = false;
  let quoteChar = "";
  let colIdx = 0;
  const limit = Math.min(character, line.length);
  for (let i = 0; i < limit; i++) {
    const ch = line[i]!;
    if (!inQuote && ch === "/") break;
    if (ch === "'" || ch === '"') {
      if (!inQuote) {
        inQuote = true;
        quoteChar = ch;
      } else if (ch === quoteChar) {
        inQuote = false;
      }
      continue;
    }
    if (!inQuote && ch === ",") {
      colIdx++;
    }
  }
  return colIdx;
}

const BUS_FIELD_DOCS: readonly string[] = [
  "I — Bus number (1 to 999997)",
  "NAME — Alphanumeric bus identifier (up to 12 chars)",
  "BASKV — Bus base voltage in kV",
  "IDE — Bus type code (1 = PQ Load, 2 = PV Generator, 3 = Swing/Slack, 4 = Isolated)",
  "AREA — Area number",
  "ZONE — Loss zone number",
  "OWNER — Owner number",
  "VM — Bus voltage magnitude in p.u.",
  "VA — Bus voltage phase angle in degrees",
  "NVHI — Normal high voltage limit (p.u.)",
  "NVLO — Normal low voltage limit (p.u.)",
  "EVHI — Emergency high voltage limit (p.u.)",
  "EVLO — Emergency low voltage limit (p.u.)",
];

const LOAD_FIELD_DOCS: readonly string[] = [
  "I — Bus number where load is connected",
  "ID — Two-character load circuit identifier",
  "STATUS — Load in-service status (1 = in-service, 0 = out-of-service)",
  "AREA — Area number",
  "ZONE — Zone number",
  "PL — Constant power active load (MW)",
  "QL — Constant power reactive load (Mvar)",
  "IP — Constant current active load (MW at 1.0 p.u. V)",
  "IQ — Constant current reactive load (Mvar at 1.0 p.u. V)",
  "YP — Constant admittance active load (MW at 1.0 p.u. V)",
  "YQ — Constant admittance reactive load (Mvar at 1.0 p.u. V)",
  "OWNER — Owner number",
  "SCALE — Load scaling flag",
  "INTRPT — Interruptible load flag",
];

const GEN_FIELD_DOCS: readonly string[] = [
  "I — Generator terminal bus number",
  "ID — Machine circuit identifier",
  "PG — Active power output (MW)",
  "QG — Reactive power output (Mvar)",
  "QT — Maximum reactive power limit Qmax (Mvar)",
  "QB — Minimum reactive power limit Qmin (Mvar)",
  "VS — Regulated voltage setpoint (p.u.)",
  "IREG — Remote regulated bus number (0 = terminal bus)",
  "MBASE — Machine MVA base (MVA)",
  "ZR — Machine armature resistance R_a (p.u. on MBASE)",
  "ZX — Machine unsaturated subtransient/transient reactance X'_d (p.u. on MBASE)",
  "RT — Step-up transformer resistance (p.u.)",
  "XT — Step-up transformer reactance (p.u.)",
  "GTAP — Step-up transformer off-nominal turns ratio",
  "STAT — Machine status (1 = online, 0 = offline)",
  "RMPCT — Percent of total Mvar required to hold voltage at bus",
  "PT — Maximum active power output Pmax (MW)",
  "PB — Minimum active power output Pmin (MW)",
];

const BRANCH_FIELD_DOCS: readonly string[] = [
  "I — Branch FROM bus number",
  "J — Branch TO bus number",
  "CKT — Parallel circuit identifier",
  "R — Positive-sequence series resistance (p.u.)",
  "X — Positive-sequence series reactance (p.u.)",
  "B — Total line charging susceptance (p.u.)",
  "RATEA — Normal thermal rating Rate A (MVA)",
  "RATEB — Emergency thermal rating Rate B (MVA)",
  "RATEC — Contingency thermal rating Rate C (MVA)",
  "GI — Line shunt conductance at FROM bus (p.u.)",
  "BI — Line shunt susceptance at FROM bus (p.u.)",
  "GJ — Line shunt conductance at TO bus (p.u.)",
  "BJ — Line shunt susceptance at TO bus (p.u.)",
  "ST — Branch status (1 = closed/in-service, 0 = open)",
  "MET — Metered end flag (1 = FROM bus, 2 = TO bus)",
  "LEN — Line length",
];

const HEADER_FIELD_DOCS: readonly string[] = [
  "IC — Case change code (0 = base case, 1 = add data to working case)",
  "SBASE — System MVA base (typically 100.0 MVA)",
  "REV — PSS/E Raw Data File format revision number (e.g. 33, 34, 35)",
  "XFRRAT — Transformer rating units code (0 = MVA, >0 = current)",
  "NXFRAT — Non-transformer branch rating units code (0 = MVA, >0 = current)",
  "BASFRQ — System nominal base frequency in Hz (60.0 or 50.0 Hz)",
];

const FIXED_SHUNT_FIELD_DOCS: readonly string[] = [
  "I — Bus number where fixed shunt is connected",
  "ID — Two-character shunt circuit identifier",
  "STATUS — Shunt status (1 = in-service, 0 = out-of-service)",
  "GL — Active shunt conductance to ground in MW at V = 1.0 p.u.",
  "BL — Reactive shunt susceptance in Mvar at V = 1.0 p.u. (+ = capacitor, - = reactor)",
];

const XFMR_LINE_FIELD_DOCS: readonly (readonly string[])[] = [
  [
    "I — Winding 1 bus number",
    "J — Winding 2 bus number",
    "K — Winding 3 bus number (0 for two-winding transformer)",
    "CKT — Circuit identifier",
    "CW — Winding data I/O code (1 = off-nominal turns ratio in p.u. of bus base kV, 2 = winding voltage in kV)",
    "CZ — Impedance data I/O code (1 = p.u. on system MVA base, 2 = p.u. on winding MVA base, 3 = load loss in W & |Z|)",
    "CM — Magnetizing admittance I/O code (1 = p.u. on system base, 2 = no-load loss in W & exciting current)",
    "MAG1 — Magnetizing conductance G_m (p.u. or W)",
    "MAG2 — Magnetizing susceptance B_m (p.u. or p.u. current)",
    "NMETR — Non-metered end code (1 = winding 1, 2 = winding 2)",
    "NAME — Alphanumeric transformer name",
    "STAT — Transformer status (1 = in-service, 0 = out-of-service)",
  ],
  [
    "R1-2 — Winding 1 to 2 leakage resistance (p.u.)",
    "X1-2 — Winding 1 to 2 leakage reactance (p.u.)",
    "SBASE1-2 — Winding 1 to 2 MVA base (MVA)",
    "R2-3 — Winding 2 to 3 leakage resistance (p.u., 3-winding only)",
    "X2-3 — Winding 2 to 3 leakage reactance (p.u., 3-winding only)",
    "SBASE2-3 — Winding 2 to 3 MVA base (MVA, 3-winding only)",
    "R3-1 — Winding 3 to 1 leakage resistance (p.u., 3-winding only)",
    "X3-1 — Winding 3 to 1 leakage reactance (p.u., 3-winding only)",
    "SBASE3-1 — Winding 3 to 1 MVA base (MVA, 3-winding only)",
    "VMSTAR — Star-point bus voltage magnitude (p.u., 3-winding only)",
    "ANSTAR — Star-point bus voltage angle (deg, 3-winding only)",
  ],
  [
    "WINDV1 — Winding 1 off-nominal turns ratio (p.u. or kV)",
    "NOMV1 — Winding 1 nominal voltage in kV (0.0 = bus base kV)",
    "ANG1 — Winding 1 phase shift angle in degrees",
    "RATA1 — Winding 1 normal thermal rating Rate A (MVA)",
    "RATB1 — Winding 1 emergency thermal rating Rate B (MVA)",
    "RATC1 — Winding 1 contingency thermal rating Rate C (MVA)",
    "COD1 — Winding 1 tap/phase control mode (0 = fixed, 1 = voltage control, 2 = Mvar control, 3 = MW phase shifter)",
    "CONT1 — Controlled bus number for Winding 1 tap changer",
    "RMA1 — Upper tap ratio / phase shift limit",
    "RMI1 — Lower tap ratio / phase shift limit",
    "VMA1 — Upper regulated voltage / flow band limit",
    "VMI1 — Lower regulated voltage / flow band limit",
    "NTP1 — Number of tap positions (e.g. 33)",
    "TAB1 — Transformer impedance correction table number",
    "CR1 — Load drop compensation resistance (p.u.)",
    "CX1 — Load drop compensation reactance (p.u.)",
  ],
  [
    "WINDV2 — Winding 2 off-nominal turns ratio (p.u. or kV)",
    "NOMV2 — Winding 2 nominal voltage in kV (0.0 = bus base kV)",
  ],
  [
    "WINDV3 — Winding 3 off-nominal turns ratio (p.u. or kV)",
    "NOMV3 — Winding 3 nominal voltage in kV (0.0 = bus base kV)",
    "ANG3 — Winding 3 phase shift angle in degrees",
    "RATA3 — Winding 3 normal thermal rating Rate A (MVA)",
    "RATB3 — Winding 3 emergency thermal rating Rate B (MVA)",
    "RATC3 — Winding 3 contingency thermal rating Rate C (MVA)",
  ],
];

const AREA_FIELD_DOCS: readonly string[] = [
  "I — Area number (1 to 9999)",
  "ISW — Area slack bus number for area interchange control",
  "PDES — Desired net area interchange export in MW",
  "PTOL — Area interchange tolerance bandwidth in MW",
  "ARNAME — Alphanumeric area name",
];

const SW_SHUNT_FIELD_DOCS: readonly string[] = [
  "I — Bus number where switched shunt is connected",
  "MODSW — Control mode (0 = locked, 1 = discrete V, 2 = continuous V, 3 = reactive power)",
  "ADJM — Adjustment method (0 = sequential, 1 =nearest combination)",
  "STAT — Switched shunt status (1 = in-service, 0 = out-of-service)",
  "VSWHI — Controlled voltage upper band limit (p.u.)",
  "VSWLO — Controlled voltage lower band limit (p.u.)",
  "SWREM — Remotely regulated bus number (0 = local bus)",
  "RMPCT — Percent of total Mvar required to hold voltage at bus",
  "RMIDNT — Regulated element name",
  "BINIT — Initial switched shunt susceptance in Mvar at V = 1.0 p.u.",
  "N1 — Number of steps in switched shunt block 1",
  "B1 — Susceptance per step in block 1 (Mvar)",
];

function getSpaceSeparatedTokenIndexAtCursor(line: string, character: number): number {
  const limit = Math.min(character, line.length);
  let idx = 0;
  let inToken = false;
  let inQuote = false;
  let quoteChar = "";
  for (let i = 0; i < limit; i++) {
    const ch = line[i]!;
    if (inQuote) {
      if (ch === quoteChar) inQuote = false;
      continue;
    }
    if (ch === "'" || ch === '"') {
      if (!inToken) {
        inToken = true;
      }
      inQuote = true;
      quoteChar = ch;
      continue;
    }
    if (ch === "," || ch === " " || ch === "\t") {
      if (inToken) {
        idx++;
        inToken = false;
      }
    } else {
      inToken = true;
    }
  }
  return idx;
}

/**
 * Contextual, section- and field-aware hover documentation for PSS/E `.raw` and `.dyr` records.
 */
export function getPsseHover(
  content: string,
  position: LspPosition,
  uri: string = "model.raw",
  workspaceIndex?: PsseWorkspaceIndex,
): LspHover | undefined {
  try {
    const lines = content.split(/\r?\n/);
    const line = lines[position.line] ?? "";
    const targetLine1 = position.line + 1;

    // 0. Check if this is a .dyr dynamic model file
    if (uri.toLowerCase().endsWith(".dyr") || isLikelyDyrContent(content)) {
      const dyr = parseDyr(content);
      const companionRaw = workspaceIndex?.findCompanionRaw(uri)?.psseCase;
      for (const rec of dyr.records) {
        if (rec.span?.line === targetLine1) {
          const schema = DYR_MODEL_SCHEMAS[rec.model];
          const tokIdx = getSpaceSeparatedTokenIndexAtCursor(line, position.character);
          const activeConIdx = tokIdx >= 3 ? tokIdx - 3 : -1;
          const paramLines: string[] = [];
          if (schema) {
            for (let i = 0; i < schema.params.length && i < rec.con.length; i++) {
              const p = schema.params[i]!;
              const marker = i === activeConIdx ? " **(Active)**" : "";
              paramLines.push(`- **\`${p.name}\`** (${p.description}): \`${rec.con[i]}\` ${p.unit}${marker}`);
            }
          } else {
            for (let i = 0; i < rec.con.length; i++) {
              const marker = i === activeConIdx ? " **(Active)**" : "";
              paramLines.push(`- **\`CON(${i + 1})\`**: \`${rec.con[i]}\`${marker}`);
            }
          }
          const activeParam =
            activeConIdx >= 0 && schema?.params[activeConIdx]
              ? `\n\n**Active Parameter (\`CON(${activeConIdx + 1})\`)**: \`${schema.params[activeConIdx]!.name}\` = \`${rec.con[activeConIdx]}\` ${schema.params[activeConIdx]!.unit} — ${schema.params[activeConIdx]!.description}`
              : "";
          const rawBus = companionRaw?.buses.get(rec.ibus);
          const rawGen = companionRaw?.generators.find((g) => g.i === rec.ibus && g.id.trim() === rec.id.trim());
          const rawContext = rawBus
            ? `\n- **Connected \`.raw\` Bus**: \`${rec.ibus}\` (${rawBus.name}, ${rawBus.baseKv} kV)${rawGen ? ` — Gen \`${rawGen.id.trim()}\`: $P_g = ${rawGen.pg.toFixed(1)}$ MW, $M_{\\text{base}} = ${rawGen.mbase}$ MVA` : ""}`
            : "";
          return {
            contents: {
              kind: "markdown",
              value: `### PSS/E Dynamic Model \`${rec.model}\` — ${schema?.title ?? rec.category.toUpperCase()}\n- **Bus (\`IBUS\`)**: \`${rec.ibus}\` | **Machine ID**: \`${rec.id}\`${rawContext}\n${schema ? `\n_${schema.description}_\n\n` : "\n"}${paramLines.join("\n")}${activeParam}`,
            },
            range: spanToRange(rec.span, lines),
          };
        }
      }
      return undefined;
    }

    const psseCase = parseRaw(content);
    const companionDyr = psseCase.dyr ?? workspaceIndex?.findCompanionDyr(uri)?.dyr;
    const colIdx = getColumnIndexAtCursor(line, position.character);

    // 1. Header line
    if (psseCase.header.span?.line === targetLine1) {
      const fieldDoc = HEADER_FIELD_DOCS[colIdx] ? `\n\n**Active Field**: \`${HEADER_FIELD_DOCS[colIdx]}\`` : "";
      return {
        contents: {
          kind: "markdown",
          value: `### PSS/E Case Identification Header\n- **System MVA Base (\`SBASE\`)**: ${psseCase.header.sbase} MVA\n- **Format Revision (\`REV\`)**: v${psseCase.header.rev}\n- **Base Frequency (\`BASFRQ\`)**: ${psseCase.header.basfrq} Hz\n- **Title 1**: ${psseCase.title1 || "N/A"}\n- **Title 2**: ${psseCase.title2 || "N/A"}${fieldDoc}`,
        },
        range: spanToRange(psseCase.header.span, lines),
      };
    }

    // 2. Exact match on Bus Data record
    for (const [busNum, bus] of psseCase.buses) {
      if (bus.span?.line === targetLine1) {
        const typeStr =
          bus.ide === 3
            ? "Swing / Slack (3)"
            : bus.ide === 2
              ? "PV Generator (2)"
              : bus.ide === 4
                ? "Isolated (4)"
                : "PQ Load (1)";
        const fieldDoc = BUS_FIELD_DOCS[colIdx] ? `\n\n**Active Field**: \`${BUS_FIELD_DOCS[colIdx]}\`` : "";
        const dyrModels = companionDyr?.records.filter((r) => r.ibus === busNum) ?? [];
        const dyrDoc =
          dyrModels.length > 0
            ? `\n- **Dynamic Models (\`.dyr\`)**: ${dyrModels.map((r) => `\`${r.model}\` (${r.category})`).join(", ")}`
            : "";
        return {
          contents: {
            kind: "markdown",
            value: `### PSS/E Bus \`${busNum}\` (${bus.name})\n- **Type**: \`${typeStr}\`\n- **Base Voltage**: ${bus.baseKv} kV\n- **Voltage Magnitude**: ${bus.vm.toFixed(4)} p.u. (${(bus.vm * bus.baseKv).toFixed(2)} kV)\n- **Voltage Angle**: ${bus.va.toFixed(2)}°\n- **Normal / Emergency Limits**: [${(bus.nvlo ?? 0.95).toFixed(2)}, ${(bus.nvhi ?? 1.05).toFixed(2)}] / [${(bus.evlo ?? 0.9).toFixed(2)}, ${(bus.evhi ?? 1.1).toFixed(2)}] p.u.\n- **Area / Zone / Owner**: ${bus.area} / ${bus.zone} / ${bus.owner}${dyrDoc}${fieldDoc}`,
          },
          range: spanToRange(bus.span, lines),
        };
      }
    }

    // 3. Exact match on Load Data record
    for (const load of psseCase.loads) {
      if (load.span?.line === targetLine1) {
        const bus = psseCase.buses.get(load.i);
        const fieldDoc = LOAD_FIELD_DOCS[colIdx] ? `\n\n**Active Field**: \`${LOAD_FIELD_DOCS[colIdx]}\`` : "";
        return {
          contents: {
            kind: "markdown",
            value: `### PSS/E Load \`${load.id.trim()}\` at Bus \`${load.i}\` (${bus?.name ?? "Unknown"})\n- **Status**: ${load.status === 1 ? "In-Service (1)" : "Out-of-Service (0)"}\n- **Constant Power (P / Q)**: ${load.pl.toFixed(2)} MW / ${load.ql.toFixed(2)} Mvar\n- **Constant Current (IP / IQ)**: ${load.ip.toFixed(2)} MW / ${load.iq.toFixed(2)} Mvar\n- **Constant Admittance (YP / YQ)**: ${load.yp.toFixed(2)} MW / ${load.yq.toFixed(2)} Mvar${fieldDoc}`,
          },
          range: spanToRange(load.span, lines),
        };
      }
    }

    // 4. Exact match on Fixed Shunt Data record
    for (const shunt of psseCase.fixedShunts) {
      if (shunt.span?.line === targetLine1) {
        const bus = psseCase.buses.get(shunt.i);
        const fieldDoc = FIXED_SHUNT_FIELD_DOCS[colIdx]
          ? `\n\n**Active Field**: \`${FIXED_SHUNT_FIELD_DOCS[colIdx]}\``
          : "";
        return {
          contents: {
            kind: "markdown",
            value: `### PSS/E Fixed Shunt \`${shunt.id.trim()}\` at Bus \`${shunt.i}\` (${bus?.name ?? "Unknown"})\n- **Status**: ${shunt.status === 1 ? "In-Service (1)" : "Out-of-Service (0)"}\n- **Active Conductance (\`GL\`)**: ${shunt.gl.toFixed(2)} MW\n- **Reactive Susceptance (\`BL\`)**: ${shunt.bl.toFixed(2)} Mvar (${shunt.bl >= 0 ? "Capacitor Bank" : "Shunt Reactor"})${fieldDoc}`,
          },
          range: spanToRange(shunt.span, lines),
        };
      }
    }

    // 5. Exact match on Generator Data record
    for (const gen of psseCase.generators) {
      if (gen.span?.line === targetLine1) {
        const bus = psseCase.buses.get(gen.i);
        const fieldDoc = GEN_FIELD_DOCS[colIdx] ? `\n\n**Active Field**: \`${GEN_FIELD_DOCS[colIdx]}\`` : "";
        const key = `${gen.i}_${gen.id.trim() || "1"}`;
        const genDyr = companionDyr?.generatorsByBusId.get(key) ?? companionDyr?.generatorsByBusId.get(String(gen.i));
        const excDyr = companionDyr?.excitersByBusId.get(key) ?? companionDyr?.excitersByBusId.get(String(gen.i));
        const govDyr = companionDyr?.governorsByBusId.get(key) ?? companionDyr?.governorsByBusId.get(String(gen.i));
        const pssDyr = companionDyr?.stabilizersByBusId.get(key) ?? companionDyr?.stabilizersByBusId.get(String(gen.i));
        const dyrParts = [
          genDyr ? `Gen: \`${genDyr.model}\` ($H=${genDyr.namedParams["H"] ?? "?"}$s)` : "",
          excDyr ? `AVR: \`${excDyr.model}\`` : "",
          govDyr ? `Gov: \`${govDyr.model}\`` : "",
          pssDyr ? `PSS: \`${pssDyr.model}\`` : "",
        ].filter(Boolean);
        const dyrDoc = dyrParts.length > 0 ? `\n- **Dynamic Stack (\`.dyr\`)**: ${dyrParts.join(" | ")}` : "";
        return {
          contents: {
            kind: "markdown",
            value: `### PSS/E Synchronous Generator \`${gen.id.trim()}\` at Bus \`${gen.i}\` (${bus?.name ?? "Unknown"})\n- **Status**: ${gen.stat === 1 ? "Online (1)" : "Offline (0)"}\n- **Scheduled Output**: ${gen.pg.toFixed(2)} MW, ${gen.qg.toFixed(2)} Mvar\n- **Reactive Limits**: [${gen.qb.toFixed(1)}, ${gen.qt.toFixed(1)}] Mvar\n- **Active Limits**: [${gen.pb.toFixed(1)}, ${gen.pt.toFixed(1)}] MW\n- **Voltage Setpoint (\`VS\`)**: ${gen.vs.toFixed(4)} p.u.\n- **Machine Base & Transient Impedance**: ${gen.mbase} MVA, $Z = ${gen.zr} + j${gen.zx}$ p.u.${dyrDoc}${fieldDoc}`,
          },
          range: spanToRange(gen.span, lines),
        };
      }
    }

    // 6. Exact match on Branch Data record
    for (const br of psseCase.branches) {
      if (br.span?.line === targetLine1) {
        const fromBus = psseCase.buses.get(br.i);
        const toBus = psseCase.buses.get(br.j);
        const zMag = Math.sqrt(br.r * br.r + br.x * br.x);
        const xrRatio = br.r > 0 ? (br.x / br.r).toFixed(2) : "∞";
        const fieldDoc = BRANCH_FIELD_DOCS[colIdx] ? `\n\n**Active Field**: \`${BRANCH_FIELD_DOCS[colIdx]}\`` : "";
        return {
          contents: {
            kind: "markdown",
            value: `### PSS/E AC Transmission Branch \`${br.i}\` (${fromBus?.name ?? "?"}) → \`${br.j}\` (${toBus?.name ?? "?"}) [Ckt \`${br.ckt.trim()}\`]\n- **Status**: ${br.st === 1 ? "Closed / In-Service (1)" : "Open (0)"}\n- **Series Impedance**: $R = ${br.r.toFixed(5)}$, $X = ${br.x.toFixed(5)}$ p.u. ($|Z| = ${zMag.toFixed(5)}$ p.u., $X/R = ${xrRatio}$)\n- **Line Charging (\`B\`)**: ${br.b.toFixed(5)} p.u.\n- **Thermal Ratings (A / B / C)**: ${br.rateA} / ${br.rateB} / ${br.rateC} MVA${fieldDoc}`,
          },
          range: spanToRange(br.span, lines),
        };
      }
    }

    // 7. Exact match on Transformer Data record (4 or 5 lines)
    for (const xf of psseCase.transformers) {
      const nLines = xf.k !== 0 ? 5 : 4;
      if (xf.span && targetLine1 >= xf.span.line && targetLine1 < xf.span.line + nLines) {
        const subLineIdx = targetLine1 - xf.span.line;
        const xfFieldList = XFMR_LINE_FIELD_DOCS[subLineIdx];
        const fieldDoc = xfFieldList?.[colIdx]
          ? `\n\n**Active Field (Line ${subLineIdx + 1})**: \`${xfFieldList[colIdx]}\``
          : "";
        const fromBus = psseCase.buses.get(xf.i);
        const toBus = psseCase.buses.get(xf.j);
        return {
          contents: {
            kind: "markdown",
            value: `### PSS/E Transformer \`${xf.i}\` (${fromBus?.name ?? "?"}) → \`${xf.j}\` (${toBus?.name ?? "?"}) [Ckt \`${xf.ckt.trim()}\`]\n- **Status**: ${xf.stat === 1 ? "In-Service (1)" : "Out-of-Service (0)"}\n- **Leakage Impedance**: $R_{12} = ${xf.r12.toFixed(5)}$, $X_{12} = ${xf.x12.toFixed(5)}$ p.u. on ${xf.sbase12} MVA\n- **Off-Nominal Tap Ratio**: ${xf.windv1.toFixed(4)} : ${xf.windv2.toFixed(4)} (Phase Shift: ${xf.ang1.toFixed(2)}°)\n- **Ratings (A / B / C)**: ${xf.rata1} / ${xf.ratb1} / ${xf.ratc1} MVA${fieldDoc}`,
          },
          range: spanToRange(xf.span, lines, nLines - 1),
        };
      }
    }

    // 8. Exact match on Area Interchange record
    for (const area of psseCase.areas) {
      if (area.span?.line === targetLine1) {
        const fieldDoc = AREA_FIELD_DOCS[colIdx] ? `\n\n**Active Field**: \`${AREA_FIELD_DOCS[colIdx]}\`` : "";
        return {
          contents: {
            kind: "markdown",
            value: `### PSS/E Area \`${area.i}\` (${area.arname})\n- **Area Slack Bus (\`ISW\`)**: Bus \`${area.isw}\`\n- **Desired Net Export (\`PDES\`)**: ${area.pdes.toFixed(1)} MW (±${area.ptol.toFixed(1)} MW)${fieldDoc}`,
          },
          range: spanToRange(area.span, lines),
        };
      }
    }

    // 9. Exact match on Switched Shunt record
    for (const sw of psseCase.switchedShunts) {
      if (sw.span?.line === targetLine1) {
        const bus = psseCase.buses.get(sw.i);
        const fieldDoc = SW_SHUNT_FIELD_DOCS[colIdx] ? `\n\n**Active Field**: \`${SW_SHUNT_FIELD_DOCS[colIdx]}\`` : "";
        return {
          contents: {
            kind: "markdown",
            value: `### PSS/E Switched Shunt at Bus \`${sw.i}\` (${bus?.name ?? "Unknown"})\n- **Status**: ${sw.stat === 1 ? "In-Service (1)" : "Out-of-Service (0)"} | **Mode (\`MODSW\`)**: ${sw.modsw}\n- **Voltage Band**: [${sw.vswlo.toFixed(3)}, ${sw.vswhi.toFixed(3)}] p.u.\n- **Initial Susceptance (\`BINIT\`)**: ${sw.binit.toFixed(2)} Mvar${fieldDoc}`,
          },
          range: spanToRange(sw.span, lines),
        };
      }
    }

    // Fallback: match quoted bus name on line
    for (const [busNum, bus] of psseCase.buses) {
      if (bus.name && line.includes(bus.name)) {
        const typeStr = bus.ide === 3 ? "Swing / Slack" : bus.ide === 2 ? "PV Generator" : "PQ Load";
        return {
          contents: {
            kind: "markdown",
            value: `### PSS/E Bus \`${busNum}\` (${bus.name})\n- **Type**: \`${typeStr}\`\n- **Base Voltage**: ${bus.baseKv} kV\n- **Voltage Mag**: ${bus.vm.toFixed(4)} p.u.\n- **Voltage Angle**: ${bus.va.toFixed(2)}°`,
          },
        };
      }
    }

    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Helper that resolves which bus number is referenced at `(line, character)` in a `.raw` file.
 */
function resolveTargetBusAtPosition(psseCase: PsseCase, lines: string[], position: LspPosition): number | undefined {
  const targetLine1 = position.line + 1;
  const line = lines[position.line] ?? "";
  const colIdx = getColumnIndexAtCursor(line, position.character);

  for (const [busNum, bus] of psseCase.buses) {
    if (bus.span?.line === targetLine1) return busNum;
  }
  for (const load of psseCase.loads) {
    if (load.span?.line === targetLine1) return load.i;
  }
  for (const shunt of psseCase.fixedShunts) {
    if (shunt.span?.line === targetLine1) return shunt.i;
  }
  for (const gen of psseCase.generators) {
    if (gen.span?.line === targetLine1) {
      if (colIdx === 7 && gen.ireg > 0) return gen.ireg;
      return gen.i;
    }
  }
  for (const br of psseCase.branches) {
    if (br.span?.line === targetLine1) {
      return colIdx === 1 ? Math.abs(br.j) : br.i;
    }
  }
  for (const xf of psseCase.transformers) {
    const nLines = xf.k !== 0 ? 5 : 4;
    if (xf.span && targetLine1 >= xf.span.line && targetLine1 < xf.span.line + nLines) {
      if (targetLine1 === xf.span.line) {
        if (colIdx === 1) return xf.j;
        if (colIdx === 2 && xf.k !== 0) return xf.k;
      }
      return xf.i;
    }
  }
  for (const sw of psseCase.switchedShunts) {
    if (sw.span?.line === targetLine1) return sw.i;
  }
  return undefined;
}

/**
 * Resolves Go-to-Definition for bus references in Loads, Shunts, Generators, Branches, Transformers,
 * and cross-file jumps between `.raw` and companion `.dyr` files.
 */
export function getPsseDefinition(
  content: string,
  position: LspPosition,
  uri: string = "model.raw",
  workspaceIndex?: PsseWorkspaceIndex,
): LspLocation | undefined {
  try {
    const lines = content.split(/\r?\n/);
    const targetLine1 = position.line + 1;

    // Cross-file jump from .dyr record -> companion .raw Bus declaration
    if (uri.toLowerCase().endsWith(".dyr") || isLikelyDyrContent(content)) {
      const dyr = parseDyr(content);
      const rec = dyr.records.find((r) => r.span?.line === targetLine1);
      if (!rec) return undefined;
      const companion = workspaceIndex?.findCompanionRaw(uri);
      if (companion) {
        const bus = companion.psseCase.buses.get(rec.ibus);
        if (bus?.span) {
          return {
            uri: companion.uri,
            range: {
              start: { line: Math.max(0, bus.span.line - 1), character: 0 },
              end: { line: Math.max(0, bus.span.line - 1), character: 40 },
            },
          };
        }
      }
      return undefined;
    }

    const psseCase = parseRaw(content);
    const line = lines[position.line] ?? "";
    const colIdx = getColumnIndexAtCursor(line, position.character);

    // Cross-file jump from .raw Generator ID (column 1) -> companion .dyr generator model
    if (colIdx === 1 && workspaceIndex) {
      const gen = psseCase.generators.find((g) => g.span?.line === targetLine1);
      if (gen) {
        const companionDyr = workspaceIndex.findCompanionDyr(uri);
        const dyrRec =
          companionDyr?.dyr.generatorsByBusId.get(`${gen.i}_${gen.id.trim() || "1"}`) ??
          companionDyr?.dyr.generatorsByBusId.get(String(gen.i));
        if (companionDyr && dyrRec?.span) {
          return {
            uri: companionDyr.uri,
            range: {
              start: { line: Math.max(0, dyrRec.span.line - 1), character: 0 },
              end: { line: Math.max(0, dyrRec.span.line - 1), character: 60 },
            },
          };
        }
      }
    }

    const busNum = resolveTargetBusAtPosition(psseCase, lines, position);
    if (busNum === undefined) return undefined;
    const bus = psseCase.buses.get(busNum);
    if (!bus?.span) return undefined;
    return {
      uri,
      range: spanToRange(bus.span, lines),
    };
  } catch {
    return undefined;
  }
}

/**
 * Finds all references (Bus declaration + Loads, Shunts, Generators, Branches, Transformers, and companion `.dyr` records) for a Bus.
 */
export function getPsseReferences(
  content: string,
  position: LspPosition,
  uri: string = "model.raw",
  workspaceIndex?: PsseWorkspaceIndex,
): LspLocation[] {
  try {
    const lines = content.split(/\r?\n/);
    const isDyr = uri.toLowerCase().endsWith(".dyr") || isLikelyDyrContent(content);

    let busNum: number | undefined;
    let rawCase: PsseCase | undefined;
    let rawUri = uri;

    if (isDyr) {
      const dyr = parseDyr(content);
      const targetLine1 = position.line + 1;
      const rec = dyr.records.find((r) => r.span?.line === targetLine1);
      if (!rec) return [];
      busNum = rec.ibus;
      const locations: LspLocation[] = [];
      for (const r of dyr.records) {
        if (r.ibus === busNum && r.span) {
          locations.push({ uri, range: spanToRange(r.span, lines) });
        }
      }
      const companionRaw = workspaceIndex?.findCompanionRaw(uri);
      if (companionRaw) {
        const cBus = companionRaw.psseCase.buses.get(busNum);
        if (cBus?.span) {
          const lineIdx = Math.max(0, cBus.span.line - 1);
          locations.unshift({
            uri: companionRaw.uri,
            range: { start: { line: lineIdx, character: 0 }, end: { line: lineIdx, character: 60 } },
          });
        }
      }
      return locations;
    }

    rawCase = parseRaw(content);
    busNum = resolveTargetBusAtPosition(rawCase, lines, position);
    if (busNum === undefined) return [];

    const locations: LspLocation[] = [];
    const bus = rawCase.buses.get(busNum);
    if (bus?.span) {
      locations.push({ uri: rawUri, range: spanToRange(bus.span, lines) });
    }
    for (const load of rawCase.loads) {
      if (load.i === busNum && load.span) {
        locations.push({ uri: rawUri, range: spanToRange(load.span, lines) });
      }
    }
    for (const shunt of rawCase.fixedShunts) {
      if (shunt.i === busNum && shunt.span) {
        locations.push({ uri: rawUri, range: spanToRange(shunt.span, lines) });
      }
    }
    for (const gen of rawCase.generators) {
      if ((gen.i === busNum || gen.ireg === busNum) && gen.span) {
        locations.push({ uri: rawUri, range: spanToRange(gen.span, lines) });
      }
    }
    for (const br of rawCase.branches) {
      if ((br.i === busNum || Math.abs(br.j) === busNum) && br.span) {
        locations.push({ uri: rawUri, range: spanToRange(br.span, lines) });
      }
    }
    for (const xf of rawCase.transformers) {
      if ((xf.i === busNum || xf.j === busNum || xf.k === busNum) && xf.span) {
        locations.push({ uri: rawUri, range: spanToRange(xf.span, lines, xf.k !== 0 ? 4 : 3) });
      }
    }
    for (const sw of rawCase.switchedShunts) {
      if (sw.i === busNum && sw.span) {
        locations.push({ uri: rawUri, range: spanToRange(sw.span, lines) });
      }
    }

    // Include cross-file references in companion .dyr file when workspaceIndex is provided
    const companionDyr = workspaceIndex?.findCompanionDyr(uri);
    if (companionDyr) {
      for (const r of companionDyr.dyr.records) {
        if (r.ibus === busNum && r.span) {
          const lineIdx = Math.max(0, r.span.line - 1);
          locations.push({
            uri: companionDyr.uri,
            range: { start: { line: lineIdx, character: 0 }, end: { line: lineIdx, character: 60 } },
          });
        }
      }
    }

    return locations;
  } catch {
    return [];
  }
}

/**
 * Provides context-aware completions for PSS/E `.raw` bus numbers, section terminators, and `.dyr` dynamic models.
 */
export function getPsseCompletions(
  content: string,
  _position: LspPosition,
  uri: string = "model.raw",
): LspCompletionItem[] {
  const items: LspCompletionItem[] = [];

  // 1. Dynamic model completions for .dyr files (also helpful in general PSS/E editing)
  for (const schema of Object.values(DYR_MODEL_SCHEMAS)) {
    const paramNames = schema.params.map((p) => p.name).join(", ");
    items.push({
      label: schema.model,
      kind: 7, // Class
      detail: `${schema.title} (${schema.category})`,
      documentation: `${schema.description}\nParameters: ${paramNames}`,
      insertText: `'${schema.model}'`,
    });
  }

  if (uri.toLowerCase().endsWith(".dyr") || isLikelyDyrContent(content)) {
    return items;
  }

  // 2. Bus completions from current .raw file
  try {
    const psseCase = parseRaw(content);
    for (const [busNum, bus] of psseCase.buses) {
      const role = bus.ide === 3 ? "Slack" : bus.ide === 2 ? "PV" : "PQ";
      items.push({
        label: String(busNum),
        kind: 12, // Value
        detail: `Bus ${busNum} — ${bus.name} (${bus.baseKv} kV, ${role})`,
        documentation: `Bus ${busNum} ('${bus.name}'), Base ${bus.baseKv} kV, V = ${bus.vm.toFixed(4)} p.u. ∠ ${bus.va.toFixed(2)}°`,
        insertText: String(busNum),
      });
    }
  } catch {}

  // 3. Standard PSS/E v33 section terminators
  const sectionTerminators = [
    "0 / END OF BUS DATA, BEGIN LOAD DATA",
    "0 / END OF LOAD DATA, BEGIN FIXED SHUNT DATA",
    "0 / END OF FIXED SHUNT DATA, BEGIN GENERATOR DATA",
    "0 / END OF GENERATOR DATA, BEGIN BRANCH DATA",
    "0 / END OF BRANCH DATA, BEGIN TRANSFORMER DATA",
    "0 / END OF TRANSFORMER DATA, BEGIN AREA DATA",
    "0 / END OF AREA DATA, BEGIN TWO-TERMINAL DC DATA",
    "0 / END OF TWO-TERMINAL DC DATA, BEGIN VSC DC LINE DATA",
    "0 / END OF VSC DC LINE DATA, BEGIN SWITCHED SHUNT DATA",
    "0 / END OF SWITCHED SHUNT DATA",
  ];
  for (const sentinel of sectionTerminators) {
    items.push({
      label: sentinel,
      kind: 14, // Keyword
      detail: "PSS/E Section Delimiter",
      insertText: sentinel,
    });
  }

  return items;
}

export interface LspInlayHint {
  position: LspPosition;
  label: string;
  kind?: 1 | 2 | undefined; // 1 = Type, 2 = Parameter
  paddingLeft?: boolean | undefined;
  paddingRight?: boolean | undefined;
}

export interface LspTextEdit {
  range: LspRange;
  newText: string;
}

export interface LspWorkspaceEdit {
  changes: Record<string, LspTextEdit[]>;
}

export interface LspCodeAction {
  title: string;
  kind: string;
  diagnostics?: LspDiagnostic[] | undefined;
  isPreferred?: boolean | undefined;
  edit: LspWorkspaceEdit;
}

/**
 * Generates inline parameter hints for PSS/E `.raw` and `.dyr` files so engineers
 * can read dense positional CSV/space-separated records without counting columns.
 */
export function getPsseInlayHints(content: string, uri: string = "model.raw"): LspInlayHint[] {
  const hints: LspInlayHint[] = [];
  try {
    const lines = content.split(/\r?\n/);
    if (uri.toLowerCase().endsWith(".dyr") || isLikelyDyrContent(content)) {
      const dyr = parseDyr(content);
      for (const rec of dyr.records) {
        if (!rec.span) continue;
        const schema = DYR_MODEL_SCHEMAS[rec.model];
        if (!schema) continue;
        const lineIdx = Math.max(0, rec.span.line - 1);
        const lineText = lines[lineIdx] ?? "";
        const summaryParts: string[] = [];
        const maxHints = Math.min(4, schema.params.length, rec.con.length);
        for (let i = 0; i < maxHints; i++) {
          summaryParts.push(`${schema.params[i]!.name}=${rec.con[i]}`);
        }
        if (summaryParts.length > 0) {
          hints.push({
            position: { line: lineIdx, character: lineText.length },
            label: `  /* ${summaryParts.join(", ")} */`,
            kind: 2,
            paddingLeft: true,
          });
        }
      }
      return hints;
    }

    const psseCase = parseRaw(content);
    for (const [, bus] of psseCase.buses) {
      if (!bus.span) continue;
      const lineIdx = Math.max(0, bus.span.line - 1);
      const lineText = lines[lineIdx] ?? "";
      const role = bus.ide === 3 ? "Slack" : bus.ide === 2 ? "PV" : bus.ide === 4 ? "Iso" : "PQ";
      hints.push({
        position: { line: lineIdx, character: lineText.length },
        label: `  /* ${bus.baseKv}kV ${role} V=${bus.vm.toFixed(3)}pu ∠${bus.va.toFixed(1)}° */`,
        kind: 2,
        paddingLeft: true,
      });
    }
    for (const g of psseCase.generators) {
      if (!g.span) continue;
      const lineIdx = Math.max(0, g.span.line - 1);
      const lineText = lines[lineIdx] ?? "";
      hints.push({
        position: { line: lineIdx, character: lineText.length },
        label: `  /* Pg=${g.pg.toFixed(1)}MW Qg=${g.qg.toFixed(1)}Mvar Vs=${g.vs.toFixed(3)}pu */`,
        kind: 2,
        paddingLeft: true,
      });
    }
    for (const l of psseCase.loads) {
      if (!l.span) continue;
      const lineIdx = Math.max(0, l.span.line - 1);
      const lineText = lines[lineIdx] ?? "";
      hints.push({
        position: { line: lineIdx, character: lineText.length },
        label: `  /* Pl=${l.pl.toFixed(1)}MW Ql=${l.ql.toFixed(1)}Mvar */`,
        kind: 2,
        paddingLeft: true,
      });
    }
    for (const br of psseCase.branches) {
      if (!br.span) continue;
      const lineIdx = Math.max(0, br.span.line - 1);
      const lineText = lines[lineIdx] ?? "";
      hints.push({
        position: { line: lineIdx, character: lineText.length },
        label: `  /* X=${br.x.toFixed(4)}pu RateA=${br.rateA}MVA */`,
        kind: 2,
        paddingLeft: true,
      });
    }
  } catch {}
  return hints;
}

/**
 * Atomic Bus Renumbering (F2 Rename Symbol) across `.raw` (Bus, Load, Shunt, Generator I/IREG,
 * Branch I/J, Transformer I/J/K/CONT1, Switched Shunt, HVDC) and companion `.dyr` (`IBUS`).
 */
export function getPsseRenameEdits(
  content: string,
  position: LspPosition,
  newName: string,
  uri: string = "model.raw",
  workspaceIndex?: PsseWorkspaceIndex,
): LspWorkspaceEdit | undefined {
  const newBusNum = Number.parseInt(newName.trim(), 10);
  if (!Number.isFinite(newBusNum) || newBusNum <= 0 || newBusNum > 999997) {
    return undefined;
  }

  try {
    const lines = content.split(/\r?\n/);
    const psseCase = parseRaw(content);
    const oldBusNum = resolveTargetBusAtPosition(psseCase, lines, position);
    if (oldBusNum === undefined || oldBusNum === newBusNum) return undefined;
    if (psseCase.buses.has(newBusNum)) return undefined;

    const bus = psseCase.buses.get(oldBusNum);
    if (bus) {
      psseCase.buses.delete(oldBusNum);
      bus.i = newBusNum;
      psseCase.buses.set(newBusNum, bus);
    }
    for (const l of psseCase.loads) {
      if (l.i === oldBusNum) l.i = newBusNum;
    }
    for (const s of psseCase.fixedShunts) {
      if (s.i === oldBusNum) s.i = newBusNum;
    }
    for (const g of psseCase.generators) {
      if (g.i === oldBusNum) g.i = newBusNum;
      if (g.ireg === oldBusNum) g.ireg = newBusNum;
    }
    for (const br of psseCase.branches) {
      if (br.i === oldBusNum) br.i = newBusNum;
      if (Math.abs(br.j) === oldBusNum) br.j = br.j < 0 ? -newBusNum : newBusNum;
    }
    for (const xf of psseCase.transformers) {
      if (xf.i === oldBusNum) xf.i = newBusNum;
      if (xf.j === oldBusNum) xf.j = newBusNum;
      if (xf.k === oldBusNum) xf.k = newBusNum;
      if (xf.cont1 === oldBusNum) xf.cont1 = newBusNum;
    }
    for (const area of psseCase.areas) {
      if (area.isw === oldBusNum) area.isw = newBusNum;
    }
    for (const dc of psseCase.twoTerminalDc) {
      if (dc.ipr === oldBusNum) dc.ipr = newBusNum;
      if (dc.ipi === oldBusNum) dc.ipi = newBusNum;
    }
    for (const vsc of psseCase.vscDc) {
      if (vsc.ibus1 === oldBusNum) vsc.ibus1 = newBusNum;
      if (vsc.ibus2 === oldBusNum) vsc.ibus2 = newBusNum;
    }
    for (const sw of psseCase.switchedShunts) {
      if (sw.i === oldBusNum) sw.i = newBusNum;
      if (sw.swrem === oldBusNum) sw.swrem = newBusNum;
    }

    const updatedRaw = writeRaw(psseCase);
    const changes: Record<string, LspTextEdit[]> = {
      [uri]: [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: Math.max(0, lines.length - 1), character: lines[lines.length - 1]?.length ?? 0 },
          },
          newText: updatedRaw,
        },
      ],
    };

    const companionDyr = workspaceIndex?.findCompanionDyr(uri);
    if (companionDyr) {
      for (const rec of companionDyr.dyr.records) {
        if (rec.ibus === oldBusNum) {
          const updatedLines: string[] = [];
          for (const r of companionDyr.dyr.records) {
            const ibus = r.ibus === oldBusNum ? newBusNum : r.ibus;
            const paddedModel = `'${r.model.padEnd(6, " ")}'`;
            const conStr = r.con.map((v) => Number(v.toPrecision(6)).toString()).join(" ");
            updatedLines.push(`${ibus} ${paddedModel} ${r.id} ${conStr} /`);
          }
          changes[companionDyr.uri] = [
            {
              range: {
                start: { line: 0, character: 0 },
                end: { line: 99999, character: 0 },
              },
              newText: updatedLines.join("\n") + "\n",
            },
          ];
          break;
        }
      }
    }

    return { changes };
  } catch {
    return undefined;
  }
}

/**
 * Provides deterministic Quick Fix Code Actions for PSS/E diagnostics (`P2001`, `P2002`, `P3001`, `P3002`, `P4003`, `P5001`).
 */
export function getPsseCodeActions(
  content: string,
  _range: LspRange,
  diagnostics: LspDiagnostic[],
  uri: string = "model.raw",
): LspCodeAction[] {
  const actions: LspCodeAction[] = [];
  const lines = content.split(/\r?\n/);
  const fullDocRange: LspRange = {
    start: { line: 0, character: 0 },
    end: { line: Math.max(0, lines.length - 1), character: lines[lines.length - 1]?.length ?? 0 },
  };

  for (const diag of diagnostics) {
    try {
      if (diag.code === "P2001") {
        // Bus is disconnected: mark as Isolated (IDE = 4)
        const m = diag.message.match(/Bus\s+'?(\d+)'?/i);
        const busId = m ? parseInt(m[1]!, 10) : NaN;
        if (Number.isFinite(busId)) {
          const psseCase = parseRaw(content);
          const bus = psseCase.buses.get(busId);
          if (bus && bus.ide !== 4) {
            bus.ide = 4;
            actions.push({
              title: `Set Bus ${busId} type to Isolated (IDE = 4)`,
              kind: "quickfix",
              diagnostics: [diag],
              isPreferred: true,
              edit: {
                changes: {
                  [uri]: [{ range: fullDocRange, newText: writeRaw(psseCase) }],
                },
              },
            });
          }
        }
      } else if (diag.code === "P2002") {
        // Missing Slack bus: promote first PV or PQ bus to Slack (IDE = 3)
        const psseCase = parseRaw(content);
        const candidate =
          Array.from(psseCase.buses.values()).find((b) => b.ide === 2) ?? Array.from(psseCase.buses.values())[0];
        if (candidate) {
          candidate.ide = 3;
          actions.push({
            title: `Promote Bus ${candidate.i} (${candidate.name}) to Swing/Slack Bus (IDE = 3)`,
            kind: "quickfix",
            diagnostics: [diag],
            isPreferred: true,
            edit: {
              changes: {
                [uri]: [{ range: fullDocRange, newText: writeRaw(psseCase) }],
              },
            },
          });
        }
      } else if (diag.code === "P3001") {
        // Inverted Qmin / Qmax limits on generator
        const psseCase = parseRaw(content);
        let fixed = false;
        for (const g of psseCase.generators) {
          if (g.qb > g.qt) {
            const tmp = g.qb;
            g.qb = g.qt;
            g.qt = tmp;
            fixed = true;
          }
        }
        if (fixed) {
          actions.push({
            title: "Swap inverted generator reactive limits (Qmin / Qmax)",
            kind: "quickfix",
            diagnostics: [diag],
            isPreferred: true,
            edit: {
              changes: {
                [uri]: [{ range: fullDocRange, newText: writeRaw(psseCase) }],
              },
            },
          });
        }
      } else if (diag.code === "P3002") {
        // Inverted Pmin / Pmax limits on generator
        const psseCase = parseRaw(content);
        let fixed = false;
        for (const g of psseCase.generators) {
          if (g.pb > g.pt) {
            const tmp = g.pb;
            g.pb = g.pt;
            g.pt = tmp;
            fixed = true;
          }
        }
        if (fixed) {
          actions.push({
            title: "Swap inverted generator active power limits (Pmin / Pmax)",
            kind: "quickfix",
            diagnostics: [diag],
            isPreferred: true,
            edit: {
              changes: {
                [uri]: [{ range: fullDocRange, newText: writeRaw(psseCase) }],
              },
            },
          });
        }
      } else if (diag.code === "P4003") {
        // Off-nominal tap ratio out of [0.8, 1.2] range: clamp to 1.000
        const psseCase = parseRaw(content);
        let fixed = false;
        for (const xf of psseCase.transformers) {
          if (xf.windv1 < 0.8 || xf.windv1 > 1.2) {
            xf.windv1 = 1.0;
            fixed = true;
          }
          if (xf.windv2 < 0.8 || xf.windv2 > 1.2) {
            xf.windv2 = 1.0;
            fixed = true;
          }
        }
        if (fixed) {
          actions.push({
            title: "Reset transformer off-nominal tap ratio to 1.000 p.u.",
            kind: "quickfix",
            diagnostics: [diag],
            isPreferred: true,
            edit: {
              changes: {
                [uri]: [{ range: fullDocRange, newText: writeRaw(psseCase) }],
              },
            },
          });
        }
      } else if (diag.code === "P5001") {
        // Missing CON parameters in .dyr record
        const dyr = parseDyr(content);
        let fixed = false;
        for (const rec of dyr.records) {
          const schema = DYR_MODEL_SCHEMAS[rec.model];
          if (schema && rec.con.length < schema.params.length) {
            while (rec.con.length < schema.params.length) {
              rec.con.push(0.0);
            }
            fixed = true;
          }
        }
        if (fixed) {
          const formattedLines = dyr.records.map((r) => {
            const paddedModel = `'${r.model.padEnd(6, " ")}'`;
            return `${r.ibus} ${paddedModel} ${r.id} ${r.con.join(" ")} /`;
          });
          actions.push({
            title: "Pad missing dynamic model CON parameters with defaults",
            kind: "quickfix",
            diagnostics: [diag],
            isPreferred: true,
            edit: {
              changes: {
                [uri]: [{ range: fullDocRange, newText: formattedLines.join("\n") + "\n" }],
              },
            },
          });
        }
      }
    } catch {}
  }

  return actions;
}

/**
 * Formats a PSS/E `.raw` or `.dyr` document into clean tabular columns with `@!` section headers.
 */
export function formatPsseDocument(content: string, uri: string = "model.raw"): string {
  if (uri.toLowerCase().endsWith(".dyr") || isLikelyDyrContent(content)) {
    const dyr = parseDyr(content);
    const out: string[] = ["@! IBUS  'MODEL ' ID   CON(1) ... CON(N) /"];
    for (const rec of dyr.records) {
      const ibusStr = String(rec.ibus).padStart(6, " ");
      const modelStr = `'${rec.model.padEnd(6, " ")}'`;
      const idStr = `'${rec.id.padEnd(2, " ")}'`;
      const cons = rec.con.map((v) => Number(v.toPrecision(6)).toString().padStart(8, " ")).join(" ");
      out.push(`${ibusStr} ${modelStr} ${idStr} ${cons} /`);
    }
    return out.join("\n") + "\n";
  }

  const psseCase = parseRaw(content);
  return writeRaw(psseCase);
}

/**
 * Executes domain actions on a PSS/E model.
 */
export async function executePsseAction(action: string, args: Record<string, unknown>): Promise<unknown> {
  const content =
    typeof args["content"] === "string"
      ? args["content"]
      : typeof args["documentText"] === "string"
        ? args["documentText"]
        : "";
  const psseCase: PsseCase = parseRaw(content);
  if (typeof args["dyrText"] === "string" && args["dyrText"].trim().length > 0) {
    psseCase.dyr = parseDyr(args["dyrText"]);
  }
  const caseTitle = psseCase.title1 || `PSS/E Grid (Rev ${psseCase.header.rev})`;

  switch (action) {
    case "lint":
    case "lint_psse_case":
      return lintPsse(psseCase);

    case "extract_netlist":
    case "extract_powerflow_netlist": {
      const netlist = extractPowerFlowNetlist(psseCase);
      return serializePowerFlowNetlist(netlist, caseTitle);
    }

    case "to_modelica":
    case "export_psse_modelica":
      return psseToModelica(psseCase);

    case "to_pscad":
    case "export_psse_pscad":
      return psseToEmtNetlist(psseCase);

    case "to_dae":
    case "export_psse_dae": {
      const dae = lowerPsseToDae(psseCase);
      return {
        varCount: dae.varCount,
        eqCount: dae.eqCount,
      };
    }

    case "solve_powerflow": {
      const sol = solvePowerFlow(psseCase);
      return {
        ...sol,
        reportText: formatPowerFlowReport(sol, caseTitle),
      };
    }

    case "n1_contingency":
    case "analyze_n1_contingencies":
      return analyzeN1Contingencies(psseCase);

    case "short_circuit":
    case "solve_short_circuit":
      return calculateShortCircuit(psseCase);

    case "simulate":
    case "simulate_transient":
    case "simulate_psse_transient":
      return simulatePsseTransient(psseCase, {
        stopTime: typeof args["stopTime"] === "number" ? args["stopTime"] : undefined,
        timeStep: typeof args["timeStep"] === "number" ? args["timeStep"] : undefined,
        faultBus: typeof args["faultBus"] === "number" ? args["faultBus"] : undefined,
        faultStartSec: typeof args["faultStartSec"] === "number" ? args["faultStartSec"] : undefined,
        faultClearSec: typeof args["faultClearSec"] === "number" ? args["faultClearSec"] : undefined,
        dyr: psseCase.dyr,
      });

    case "format":
      return formatPsseDocument(content, typeof args["uri"] === "string" ? args["uri"] : "model.raw");

    default:
      throw new Error(`Unknown PSS/E action: ${action}`);
  }
}

/**
 * Applies bi-directional SLD diagram property writeback onto a PSS/E `.raw` source text.
 * Supports mutating Bus (`bus_<id>`), Generator (`gen_<id>_<ckt>`), Load (`load_<id>_<ckt>`),
 * Fixed Shunt (`shunt_<id>_<ckt>`), Switched Shunt (`swshunt_<id>_SW`),
 * AC Branch (`branch_<i>_<j>_<ckt>` or `line_<i>_<j>_<ckt>`), and Transformer (`xfmr_<i>_<j>_<ckt>`) records.
 */
export function applyPsseDiagramWriteback(
  sourceText: string,
  cellId: string,
  changes: Record<string, unknown>,
): string {
  const psseCase = parseRaw(sourceText);
  const num = (v: unknown, fallback: number): number => {
    const parsed = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  if (cellId.startsWith("bus_")) {
    const busId = parseInt(cellId.slice(4), 10);
    const bus = psseCase.buses.get(busId);
    if (bus) {
      if ("vm" in changes) bus.vm = num(changes["vm"], bus.vm);
      if ("va" in changes) bus.va = num(changes["va"], bus.va);
      if ("baseKv" in changes) bus.baseKv = num(changes["baseKv"], bus.baseKv);
      if ("ide" in changes) bus.ide = Math.round(num(changes["ide"], bus.ide)) as 1 | 2 | 3 | 4;
      if (typeof changes["name"] === "string") bus.name = changes["name"];
    }
  } else if (cellId.startsWith("gen_")) {
    const parts = cellId.split("_");
    const busId = parseInt(parts[1] ?? "0", 10);
    const ckt = parts[2]?.trim();
    const gen = psseCase.generators.find((g) => g.i === busId && (!ckt || g.id.trim() === ckt));
    if (gen) {
      if ("pg" in changes) gen.pg = num(changes["pg"], gen.pg);
      if ("qg" in changes) gen.qg = num(changes["qg"], gen.qg);
      if ("vs" in changes) gen.vs = num(changes["vs"], gen.vs);
      if ("qt" in changes) gen.qt = num(changes["qt"], gen.qt);
      if ("qb" in changes) gen.qb = num(changes["qb"], gen.qb);
      if ("mbase" in changes) gen.mbase = num(changes["mbase"], gen.mbase);
      const stVal = changes["stat"] ?? changes["status"] ?? changes["st"];
      if (stVal !== undefined) gen.stat = Math.round(num(stVal, gen.stat)) as 0 | 1;
    }
  } else if (cellId.startsWith("load_")) {
    const parts = cellId.split("_");
    const busId = parseInt(parts[1] ?? "0", 10);
    const ckt = parts[2]?.trim();
    const load = psseCase.loads.find((l) => l.i === busId && (!ckt || l.id.trim() === ckt));
    if (load) {
      if ("pl" in changes) load.pl = num(changes["pl"], load.pl);
      if ("ql" in changes) load.ql = num(changes["ql"], load.ql);
      if ("ip" in changes) load.ip = num(changes["ip"], load.ip);
      if ("iq" in changes) load.iq = num(changes["iq"], load.iq);
      if ("yp" in changes) load.yp = num(changes["yp"], load.yp);
      if ("yq" in changes) load.yq = num(changes["yq"], load.yq);
      const stVal = changes["status"] ?? changes["stat"] ?? changes["st"];
      if (stVal !== undefined) load.status = Math.round(num(stVal, load.status)) as 0 | 1;
    }
  } else if (cellId.startsWith("shunt_")) {
    const parts = cellId.split("_");
    const busId = parseInt(parts[1] ?? "0", 10);
    const ckt = parts[2]?.trim();
    const shunt = psseCase.fixedShunts.find((s) => s.i === busId && (!ckt || s.id.trim() === ckt));
    if (shunt) {
      if ("gl" in changes) shunt.gl = num(changes["gl"], shunt.gl);
      if ("bl" in changes) shunt.bl = num(changes["bl"], shunt.bl);
      if ("bMvar" in changes) shunt.bl = num(changes["bMvar"], shunt.bl);
      const stVal = changes["status"] ?? changes["stat"] ?? changes["st"];
      if (stVal !== undefined) shunt.status = Math.round(num(stVal, shunt.status)) as 0 | 1;
    }
  } else if (cellId.startsWith("swshunt_")) {
    const parts = cellId.split("_");
    const busId = parseInt(parts[1] ?? "0", 10);
    const sw = psseCase.switchedShunts.find((s) => s.i === busId);
    if (sw) {
      if ("binit" in changes) sw.binit = num(changes["binit"], sw.binit);
      if ("bMvar" in changes) sw.binit = num(changes["bMvar"], sw.binit);
      if ("vswhi" in changes) sw.vswhi = num(changes["vswhi"], sw.vswhi);
      if ("vswlo" in changes) sw.vswlo = num(changes["vswlo"], sw.vswlo);
      const stVal = changes["stat"] ?? changes["status"] ?? changes["st"];
      if (stVal !== undefined) sw.stat = Math.round(num(stVal, sw.stat)) as 0 | 1;
    }
  } else if (cellId.startsWith("line_") || cellId.startsWith("branch_")) {
    const parts = cellId.split("_");
    const iBus = parseInt(parts[1] ?? "0", 10);
    const jBus = parseInt(parts[2] ?? "0", 10);
    const ckt = parts[3]?.trim();
    const br = psseCase.branches.find((b) => b.i === iBus && Math.abs(b.j) === jBus && (!ckt || b.ckt.trim() === ckt));
    if (br) {
      if ("r" in changes) br.r = num(changes["r"], br.r);
      if ("x" in changes) br.x = num(changes["x"], br.x);
      if ("b" in changes) br.b = num(changes["b"], br.b);
      if ("rateA" in changes) br.rateA = num(changes["rateA"], br.rateA);
      if ("rateB" in changes) br.rateB = num(changes["rateB"], br.rateB);
      if ("rateC" in changes) br.rateC = num(changes["rateC"], br.rateC);
      const stVal = changes["st"] ?? changes["status"] ?? changes["stat"];
      if (stVal !== undefined) br.st = Math.round(num(stVal, br.st)) as 0 | 1;
    }
  } else if (cellId.startsWith("xfmr_")) {
    const parts = cellId.split("_");
    const iBus = parseInt(parts[1] ?? "0", 10);
    const jBus = parseInt(parts[2] ?? "0", 10);
    const ckt = parts[3]?.trim();
    const xf = psseCase.transformers.find((x) => x.i === iBus && x.j === jBus && (!ckt || x.ckt.trim() === ckt));
    if (xf) {
      if ("r12" in changes) xf.r12 = num(changes["r12"], xf.r12);
      if ("x12" in changes) xf.x12 = num(changes["x12"], xf.x12);
      if ("windv1" in changes) xf.windv1 = num(changes["windv1"], xf.windv1);
      if ("windv2" in changes) xf.windv2 = num(changes["windv2"], xf.windv2);
      if ("ang1" in changes) xf.ang1 = num(changes["ang1"], xf.ang1);
      if ("rata1" in changes) xf.rata1 = num(changes["rata1"], xf.rata1);
      const stVal = changes["stat"] ?? changes["status"] ?? changes["st"];
      if (stVal !== undefined) xf.stat = Math.round(num(stVal, xf.stat)) as 0 | 1;
    }
  }

  return writeRaw(psseCase);
}
