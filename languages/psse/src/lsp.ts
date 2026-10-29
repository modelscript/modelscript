// SPDX-License-Identifier: AGPL-3.0-or-later

import { lowerPsseToDae } from "./dae/psse-to-dae.js";
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
          const paramLines: string[] = [];
          if (schema) {
            for (let i = 0; i < schema.params.length && i < rec.con.length; i++) {
              const p = schema.params[i]!;
              paramLines.push(`- **\`${p.name}\`** (${p.description}): \`${rec.con[i]}\` ${p.unit}`);
            }
          } else {
            for (let i = 0; i < rec.con.length; i++) {
              paramLines.push(`- **\`CON(${i + 1})\`**: \`${rec.con[i]}\``);
            }
          }
          const rawBus = companionRaw?.buses.get(rec.ibus);
          const rawGen = companionRaw?.generators.find((g) => g.i === rec.ibus && g.id.trim() === rec.id.trim());
          const rawContext = rawBus
            ? `\n- **Connected \`.raw\` Bus**: \`${rec.ibus}\` (${rawBus.name}, ${rawBus.baseKv} kV)${rawGen ? ` — Gen \`${rawGen.id.trim()}\`: $P_g = ${rawGen.pg.toFixed(1)}$ MW, $M_{\\text{base}} = ${rawGen.mbase}$ MVA` : ""}`
            : "";
          return {
            contents: {
              kind: "markdown",
              value: `### PSS/E Dynamic Model \`${rec.model}\` — ${schema?.title ?? rec.category.toUpperCase()}\n- **Bus (\`IBUS\`)**: \`${rec.ibus}\` | **Machine ID**: \`${rec.id}\`${rawContext}\n${schema ? `\n_${schema.description}_\n\n` : "\n"}${paramLines.join("\n")}`,
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
      return {
        contents: {
          kind: "markdown",
          value: `### PSS/E Case Identification Header\n- **System MVA Base (\`SBASE\`)**: ${psseCase.header.sbase} MVA\n- **Format Revision (\`REV\`)**: v${psseCase.header.rev}\n- **Base Frequency (\`BASFRQ\`)**: ${psseCase.header.basfrq} Hz\n- **Title 1**: ${psseCase.title1 || "N/A"}\n- **Title 2**: ${psseCase.title2 || "N/A"}`,
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
            value: `### PSS/E Bus \`${busNum}\` (${bus.name})\n- **Type**: \`${typeStr}\`\n- **Base Voltage**: ${bus.baseKv} kV\n- **Voltage Magnitude**: ${bus.vm.toFixed(4)} p.u. (${(bus.vm * bus.baseKv).toFixed(2)} kV)\n- **Voltage Angle**: ${bus.va.toFixed(2)}°\n- **Area / Zone / Owner**: ${bus.area} / ${bus.zone} / ${bus.owner}${dyrDoc}${fieldDoc}`,
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
        return {
          contents: {
            kind: "markdown",
            value: `### PSS/E Fixed Shunt \`${shunt.id.trim()}\` at Bus \`${shunt.i}\` (${bus?.name ?? "Unknown"})\n- **Status**: ${shunt.status === 1 ? "In-Service (1)" : "Out-of-Service (0)"}\n- **Active Conductance (\`GL\`)**: ${shunt.gl.toFixed(2)} MW\n- **Reactive Susceptance (\`BL\`)**: ${shunt.bl.toFixed(2)} Mvar`,
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
        const fromBus = psseCase.buses.get(xf.i);
        const toBus = psseCase.buses.get(xf.j);
        return {
          contents: {
            kind: "markdown",
            value: `### PSS/E Transformer \`${xf.i}\` (${fromBus?.name ?? "?"}) → \`${xf.j}\` (${toBus?.name ?? "?"}) [Ckt \`${xf.ckt.trim()}\`]\n- **Status**: ${xf.stat === 1 ? "In-Service (1)" : "Out-of-Service (0)"}\n- **Leakage Impedance**: $R_{12} = ${xf.r12.toFixed(5)}$, $X_{12} = ${xf.x12.toFixed(5)}$ p.u. on ${xf.sbase12} MVA\n- **Off-Nominal Tap Ratio**: ${xf.windv1.toFixed(4)} : ${xf.windv2.toFixed(4)} (Phase Shift: ${xf.ang1.toFixed(2)}°)\n- **Ratings (A / B / C)**: ${xf.rata1} / ${xf.ratb1} / ${xf.ratc1} MVA`,
          },
          range: spanToRange(xf.span, lines, nLines - 1),
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
 * Finds all references (Bus declaration + Loads, Shunts, Generators, Branches, Transformers) for a Bus.
 */
export function getPsseReferences(content: string, position: LspPosition, uri: string = "model.raw"): LspLocation[] {
  try {
    const psseCase = parseRaw(content);
    const lines = content.split(/\r?\n/);
    const busNum = resolveTargetBusAtPosition(psseCase, lines, position);
    if (busNum === undefined) return [];

    const locations: LspLocation[] = [];
    const bus = psseCase.buses.get(busNum);
    if (bus?.span) {
      locations.push({ uri, range: spanToRange(bus.span, lines) });
    }
    for (const load of psseCase.loads) {
      if (load.i === busNum && load.span) {
        locations.push({ uri, range: spanToRange(load.span, lines) });
      }
    }
    for (const shunt of psseCase.fixedShunts) {
      if (shunt.i === busNum && shunt.span) {
        locations.push({ uri, range: spanToRange(shunt.span, lines) });
      }
    }
    for (const gen of psseCase.generators) {
      if ((gen.i === busNum || gen.ireg === busNum) && gen.span) {
        locations.push({ uri, range: spanToRange(gen.span, lines) });
      }
    }
    for (const br of psseCase.branches) {
      if ((br.i === busNum || Math.abs(br.j) === busNum) && br.span) {
        locations.push({ uri, range: spanToRange(br.span, lines) });
      }
    }
    for (const xf of psseCase.transformers) {
      if ((xf.i === busNum || xf.j === busNum || xf.k === busNum) && xf.span) {
        locations.push({ uri, range: spanToRange(xf.span, lines, xf.k !== 0 ? 4 : 3) });
      }
    }
    for (const sw of psseCase.switchedShunts) {
      if (sw.i === busNum && sw.span) {
        locations.push({ uri, range: spanToRange(sw.span, lines) });
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

    default:
      throw new Error(`Unknown PSS/E action: ${action}`);
  }
}

/**
 * Applies bi-directional SLD diagram property writeback onto a PSS/E `.raw` source text.
 * Supports mutating Bus (`bus_<id>`), Generator (`gen_<id>_<ckt>`), Load (`load_<id>_<ckt>`),
 * AC Branch (`line_<i>_<j>_<ckt>`), and Transformer (`xfmr_<i>_<j>_<ckt>`) records.
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
      if ("stat" in changes) gen.stat = Math.round(num(changes["stat"], gen.stat)) as 0 | 1;
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
      if ("status" in changes) load.status = Math.round(num(changes["status"], load.status)) as 0 | 1;
    }
  } else if (cellId.startsWith("line_")) {
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
      if ("st" in changes) br.st = Math.round(num(changes["st"], br.st)) as 0 | 1;
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
      if ("stat" in changes) xf.stat = Math.round(num(changes["stat"], xf.stat)) as 0 | 1;
    }
  }

  return writeRaw(psseCase);
}
