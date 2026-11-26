// SPDX-License-Identifier: AGPL-3.0-or-later

import type { UnifiedWorkspace } from "@modelscript/runtime";
import { findCompanionPsseDyr, findCompanionPsseRaw } from "./builtins.js";
import { lowerPsseToDae } from "./dae/psse-to-dae.js";
import { PsseErrorCode } from "./errors.js";
import { lintPsse } from "./lints/index.js";
import { extractPowerFlowNetlist, serializePowerFlowNetlist } from "./netlist/powerflow-netlist.js";
import {
  buildCstFieldReplacementEdit,
  extractDyrCstRecords,
  extractFieldsFromCstTokens,
  getCstFieldIndexAtColumn,
  isPsseSectionTerminator,
  parsePsseCstDocument,
  type PsseCstDocument,
  type PsseCstLine,
} from "./parser/cst-tokens.js";
import { DYR_MODEL_SCHEMAS, isLikelyDyrContent, parseDyr } from "./parser/dyr-parser.js";
import { applyDyrCstParameterUpdates } from "./parser/dyr-serializer.js";
import { parseRaw, writeRaw } from "./parser/raw-parser.js";
import { parseSeq } from "./parser/seq-parser.js";
import { psseToModelica } from "./projections/psse-to-modelica.js";
import { psseToEmtNetlist } from "./projections/psse-to-pscad.js";
import { resolveDyrModelSchema } from "./schema/index.js";
import {
  analyzeN1Contingencies,
  calculateShortCircuit,
  formatPowerFlowReport,
  simulatePsseTransient,
  solvePowerFlow,
} from "./solver/ac-powerflow.js";
import type { PsseCase, SourceSpan, TransformerRecord } from "./types.js";

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

function cstLineLength(cstDoc: PsseCstDocument, row0: number): number {
  return cstDoc.byRow.get(row0)?.line.length ?? 1;
}

function fullCstDocRange(cstDoc: PsseCstDocument): LspRange {
  const last = cstDoc.lines[cstDoc.lines.length - 1];
  if (!last) return DEFAULT_RANGE;
  return {
    start: { line: 0, character: 0 },
    end: { line: last.row, character: last.line.length },
  };
}

function spanToRange(span: SourceSpan | undefined, cstDoc: PsseCstDocument, extraLines = 0): LspRange {
  if (!span) return DEFAULT_RANGE;
  const startLine = Math.max(0, span.line - 1);
  const maxRow = cstDoc.lines[cstDoc.lines.length - 1]?.row ?? 0;
  const endLine = Math.min(maxRow, startLine + extraLines);
  const startCol = Math.max(0, span.column - 1);
  const endCol =
    extraLines === 0 && span.endOffset > span.startOffset
      ? startCol + (span.endOffset - span.startOffset)
      : Math.max(startCol + 1, cstLineLength(cstDoc, endLine));
  return {
    start: { line: startLine, character: startCol },
    end: { line: endLine, character: endCol },
  };
}

function firstTokenRange(cstDoc: PsseCstDocument): LspRange {
  for (const entry of cstDoc.lines) {
    const firstTok = entry.tokens.find((t) => (t.text ?? "").trim().length > 0);
    if (firstTok) {
      const line = firstTok.startPosition?.row ?? entry.row;
      const col = firstTok.startPosition?.column ?? 0;
      return {
        start: { line, character: col },
        end: { line, character: col + (firstTok.text?.length ?? 1) },
      };
    }
  }
  return DEFAULT_RANGE;
}

function findSeqRecordRange(cstDoc: PsseCstDocument, source: string, busNum: number): LspRange {
  for (const entry of cstDoc.lines) {
    if (entry.isCommentOrBlank) continue;
    const fields = extractFieldsFromCstTokens(entry.tokens, source, "delimited");
    if (fields[0] && Number.parseInt(fields[0].value, 10) === busNum) {
      return {
        start: { line: fields[0].line0, character: fields[0].startCol0 },
        end: { line: fields[0].line0, character: Math.max(fields[0].startCol0 + 1, fields[0].endCol0) },
      };
    }
  }
  return firstTokenRange(cstDoc);
}

const NUMERIC_RE = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eEdD][-+]?\d+)?$/;

interface RawSyntaxNode {
  hasError?: boolean;
  type?: string;
  isMissing?: boolean;
  text?: string;
  startPosition?: { row: number; column: number };
  endPosition?: { row: number; column: number };
  children?: RawSyntaxNode[];
}

function collectRawSyntaxErrors(content: string, cstDoc: PsseCstDocument, precomputedTree?: unknown): LspDiagnostic[] {
  const syntaxDiags: LspDiagnostic[] = [];
  const root = (precomputedTree as { rootNode?: RawSyntaxNode } | null | undefined)?.rootNode;
  if (root?.hasError) {
    const stack: (RawSyntaxNode | undefined)[] = [root];
    let guard = 0;
    while (stack.length > 0 && guard++ < 4096) {
      const node = stack.pop();
      if (!node) continue;
      if (node.type === "ERROR" || node.isMissing) {
        const sp = node.startPosition ?? { row: 0, column: 0 };
        const ep = node.endPosition ?? { row: sp.row, column: sp.column + 1 };
        syntaxDiags.push({
          range: {
            start: { line: sp.row, character: sp.column },
            end: { line: ep.row, character: Math.max(sp.column + 1, ep.column) },
          },
          severity: 1,
          code: PsseErrorCode.RAW_SYNTAX_ERROR.code,
          source: "modelscript-psse",
          message: node.isMissing
            ? `Syntax error: missing expected token '${node.type}'.`
            : `Syntax error: unexpected token '${String(node.text ?? "").slice(0, 32)}'.`,
        });
        continue;
      }
      if (Array.isArray(node.children)) {
        for (let i = node.children.length - 1; i >= 0; i--) {
          stack.push(node.children[i]);
        }
      }
    }
  }

  // Validate RAW record structure in Bus (0), Load (1), FixedShunt (2), Generator (3), Branch (4) sections
  const lines = cstDoc.lines;
  let idx = 0;
  while (idx < lines.length && lines[idx]!.isCommentOrBlank) idx++;
  if (idx >= lines.length) return syntaxDiags;
  // Skip Case Identification line
  idx++;
  // Skip up to 2 optional title lines (if they don't look like a bus record)
  for (let t = 0; t < 2 && idx < lines.length; t++) {
    const info = lines[idx]!;
    if (info.isCommentOrBlank) {
      idx++;
      continue;
    }
    const fields = extractFieldsFromCstTokens(info.tokens, content, "delimited");
    const busNum = fields[0] ? Number(fields[0].value) : NaN;
    const baseKv = fields[2] ? Number(fields[2].value) : NaN;
    const ide = fields[3] ? Number(fields[3].value) : NaN;
    const looksLikeBus =
      fields.length >= 4 &&
      Number.isInteger(busNum) &&
      busNum > 0 &&
      Number.isFinite(baseKv) &&
      baseKv >= 0 &&
      (ide === 1 || ide === 2 || ide === 3 || ide === 4);
    if (looksLikeBus) break;
    idx++;
  }

  let section = 0;
  const resolveSec = (commentLine: string, cur: number): number => {
    const upper = commentLine.toUpperCase();
    if (upper.includes("BEGIN BUS")) return 0;
    if (upper.includes("BEGIN LOAD")) return 1;
    if (upper.includes("BEGIN FIXED SHUNT")) return 2;
    if (upper.includes("BEGIN GENERATOR")) return 3;
    if (upper.includes("BEGIN BRANCH") || upper.includes("BEGIN NON-TRANSFORMER")) return 4;
    if (upper.includes("BEGIN TRANSFORMER")) return 5;
    if (upper.includes("BEGIN AREA")) return 6;
    if (upper.includes("BEGIN TWO-TERMINAL DC")) return 7;
    if (upper.includes("BEGIN VSC DC")) return 8;
    if (upper.includes("BEGIN SWITCHED SHUNT")) return 9;
    if (upper.includes("BEGIN SUBSTATION")) return 18;
    return cur + 1;
  };

  const requiredNumericCols: Record<number, number[]> = {
    0: [0, 2, 3, 7, 8],
    1: [0, 2, 5, 6],
    2: [0, 2, 3, 4],
    3: [0, 2, 3, 6],
    4: [0, 1, 3, 4],
  };

  while (idx < lines.length) {
    const info = lines[idx++]!;
    if (info.isCommentOrBlank) continue;
    const fields = extractFieldsFromCstTokens(info.tokens, content, "delimited");
    const rawVals = fields.map((f) => f.value);
    if (isPsseSectionTerminator(fields)) {
      if (rawVals[0]?.trim().toUpperCase() === "Q") break;
      section = resolveSec(info.commentText || info.line, section);
      continue;
    }
    const cols = requiredNumericCols[section];
    if (!cols) continue;

    if (fields.length === 0 || !NUMERIC_RE.test(fields[0]!.value.trim())) {
      const f0 = fields[0];
      syntaxDiags.push({
        range: f0
          ? {
              start: { line: f0.line0, character: f0.startCol0 },
              end: { line: f0.line0, character: Math.max(f0.startCol0 + 1, f0.endCol0) },
            }
          : {
              start: { line: info.row, character: 0 },
              end: { line: info.row, character: Math.max(1, info.line.length) },
            },
        severity: 1,
        code: PsseErrorCode.RAW_SYNTAX_ERROR.code,
        source: "modelscript-psse",
        message: `Syntax error in PSS/E record: expected numeric bus identifier, got '${f0?.value ?? info.line.trim()}'.`,
      });
      continue;
    }

    for (const colIdx of cols) {
      const field = fields[colIdx];
      if (!field) continue;
      const val = field.value.trim();
      if (val !== "" && !NUMERIC_RE.test(val)) {
        syntaxDiags.push({
          range: {
            start: { line: field.line0, character: field.startCol0 },
            end: { line: field.line0, character: Math.max(field.startCol0 + 1, field.endCol0) },
          },
          severity: 1,
          code: PsseErrorCode.RAW_SYNTAX_ERROR.code,
          source: "modelscript-psse",
          message: `Syntax error in PSS/E record: expected numeric value at column ${colIdx + 1}, got '${val}'.`,
        });
      }
    }
  }

  return syntaxDiags;
}

/**
 * Validates a PSS/E RAW power flow deck or DYR dynamic data file and returns diagnostics.
 * Defaults to `"fast"` tier for `<20ms` keystroke LSP responsiveness; pass `{ tier: "deep" | "formal" }` for solver/formal passes.
 */
export function validatePsse(
  content: string,
  uri: string = "model.raw",
  precomputedTree?: unknown,
  options?: { tier?: "fast" | "deep" | "formal" },
): LspDiagnostic[] {
  const cstDoc = parsePsseCstDocument(content, precomputedTree as { rootNode?: unknown } | null | undefined);
  try {
    if (uri.toLowerCase().endsWith(".seq")) {
      const seq = parseSeq(content, cstDoc);
      const diags: LspDiagnostic[] = [];
      for (const g of seq.generators) {
        if (g.zxpos <= 0 || g.zxneg <= 0 || g.zx0 <= 0) {
          diags.push({
            range: g.span ? spanToRange(g.span, cstDoc) : findSeqRecordRange(cstDoc, content, g.i),
            severity: 2,
            code: PsseErrorCode.SEQ_GENERATOR_REACTANCE_INVALID.code,
            source: "modelscript-psse",
            message: PsseErrorCode.SEQ_GENERATOR_REACTANCE_INVALID.message(
              g.id.trim() || "1",
              g.i,
              g.zxpos,
              g.zxneg,
              g.zx0,
            ),
          });
        }
      }
      for (const br of seq.branches) {
        if (Math.abs(br.r0) < 1e-9 && Math.abs(br.x0) < 1e-9) {
          diags.push({
            range: br.span ? spanToRange(br.span, cstDoc) : findSeqRecordRange(cstDoc, content, br.i),
            severity: 2,
            code: PsseErrorCode.SEQ_BRANCH_ZERO_IMPEDANCE.code,
            source: "modelscript-psse",
            message: PsseErrorCode.SEQ_BRANCH_ZERO_IMPEDANCE.message(br.i, br.j, br.ckt.trim() || "1"),
          });
        }
      }
      for (const xf of seq.transformers) {
        if (xf.cc < 1 || xf.cc > 22) {
          diags.push({
            range: xf.span ? spanToRange(xf.span, cstDoc) : findSeqRecordRange(cstDoc, content, xf.i),
            severity: 1,
            code: PsseErrorCode.SEQ_TRANSFORMER_CC_INVALID.code,
            source: "modelscript-psse",
            message: PsseErrorCode.SEQ_TRANSFORMER_CC_INVALID.message(xf.i, xf.j, xf.cc),
          });
        }
      }
      return diags;
    }

    if (uri.toLowerCase().endsWith(".dyr") || isLikelyDyrContent(content)) {
      const dyr = parseDyr(content);
      const diags: LspDiagnostic[] = [];
      for (const rec of dyr.records) {
        const schema = DYR_MODEL_SCHEMAS[rec.model];
        if (schema && rec.con.length < schema.params.length) {
          diags.push({
            range: spanToRange(rec.span, cstDoc),
            severity: 2,
            code: PsseErrorCode.DYR_PARAM_COUNT_MISMATCH.code,
            source: "modelscript-psse",
            message: PsseErrorCode.DYR_PARAM_COUNT_MISMATCH.message(
              rec.model,
              rec.ibus,
              rec.con.length,
              schema.params.length,
            ),
          });
        }
        if (rec.headerKind === "usrmdl" && !schema) {
          diags.push({
            range: spanToRange(rec.span, cstDoc),
            severity: 3,
            code: PsseErrorCode.DYR_USRMDL_UNMAPPED_CUSTOM.code,
            source: "modelscript-psse",
            message: PsseErrorCode.DYR_USRMDL_UNMAPPED_CUSTOM.message(rec.model, rec.ibus),
          });
        }
        if (schema?.icons && rec.icons && rec.icons.length > 0) {
          for (let idx = 0; idx < schema.icons.length && idx < rec.icons.length; idx++) {
            const im = schema.icons[idx]!;
            const val = rec.icons[idx]!;
            if (im.validValues && typeof val === "number" && !im.validValues.includes(val)) {
              diags.push({
                range: spanToRange(rec.span, cstDoc),
                severity: 1,
                code: PsseErrorCode.DYR_ICON_INVALID_VALUE.code,
                source: "modelscript-psse",
                message: PsseErrorCode.DYR_ICON_INVALID_VALUE.message(
                  rec.model,
                  rec.ibus,
                  im.name,
                  String(val),
                  im.validValues.join(", "),
                ),
              });
            }
          }
        }
        if (schema) {
          for (let idx = 0; idx < schema.params.length && idx < rec.con.length; idx++) {
            const pm = schema.params[idx]!;
            const v = rec.con[idx]!;
            if ((pm.min !== undefined && v < pm.min) || (pm.max !== undefined && v > pm.max)) {
              diags.push({
                range: spanToRange(rec.span, cstDoc),
                severity: 2,
                code: PsseErrorCode.DYR_CON_PHYSICAL_BOUNDS.code,
                source: "modelscript-psse",
                message: PsseErrorCode.DYR_CON_PHYSICAL_BOUNDS.message(
                  rec.model,
                  rec.ibus,
                  pm.name,
                  v,
                  pm.min ?? -Infinity,
                  pm.max ?? Infinity,
                ),
              });
            }
          }
        }
        const s10 = rec.namedParams["S10"] ?? rec.namedParams["SE1"];
        const s12 = rec.namedParams["S12"] ?? rec.namedParams["SE2"];
        if (s10 !== undefined && s12 !== undefined && (s10 < 0 || s12 < 0 || (s10 > 0 && s12 < s10))) {
          diags.push({
            range: spanToRange(rec.span, cstDoc),
            severity: 1,
            code: PsseErrorCode.DYR_SATURATION_NON_MONOTONIC.code,
            source: "modelscript-psse",
            message: PsseErrorCode.DYR_SATURATION_NON_MONOTONIC.message(rec.model, rec.ibus, s10, s12),
          });
        }
        if (schema?.daeArchetype === "load_composite_cmpldw") {
          const fSum =
            (rec.namedParams["Fma"] ?? 0) +
            (rec.namedParams["Fmb"] ?? 0) +
            (rec.namedParams["Fmc"] ?? 0) +
            (rec.namedParams["Fmd"] ?? 0) +
            (rec.namedParams["Fel"] ?? 0);
          if (fSum > 1.001 || fSum < 0) {
            diags.push({
              range: spanToRange(rec.span, cstDoc),
              severity: 1,
              code: PsseErrorCode.DYR_COMPOSITE_LOAD_FRACTION_SUM.code,
              source: "modelscript-psse",
              message: PsseErrorCode.DYR_COMPOSITE_LOAD_FRACTION_SUM.message(rec.model, rec.ibus, fSum),
            });
          }
        }
        if (rec.category === "generator" && (rec.namedParams["H"] ?? 1) <= 0) {
          diags.push({
            range: spanToRange(rec.span, cstDoc),
            severity: 1,
            code: PsseErrorCode.ZERO_INERTIA_DYNAMIC_BUS.code,
            source: "modelscript-psse",
            message: PsseErrorCode.ZERO_INERTIA_DYNAMIC_BUS.message(rec.ibus),
          });
        }
      }
      return diags;
    }

    const psseCase = parseRaw(content, cstDoc);
    const syntaxDiags = collectRawSyntaxErrors(content, cstDoc, precomputedTree);
    const diags = lintPsse(psseCase, { tier: options?.tier ?? "fast" });

    return [
      ...syntaxDiags,
      ...diags.map((d) => {
        const lineNum = Math.max(0, (d.line ?? 1) - 1);
        const colNum = Math.max(0, (d.column ?? 1) - 1);
        const lineLen = cstLineLength(cstDoc, lineNum);

        return {
          range: {
            start: { line: lineNum, character: colNum },
            end: { line: lineNum, character: Math.max(colNum + 1, lineLen) },
          },
          severity: (d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3) as 1 | 2 | 3,
          code: d.code,
          source: "modelscript-psse",
          message: d.message,
        };
      }),
    ];
  } catch (err: unknown) {
    return [
      {
        range: firstTokenRange(cstDoc),
        severity: 1,
        code: PsseErrorCode.RAW_SYNTAX_ERROR.code,
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
    const cstDoc = parsePsseCstDocument(content);
    const docRange = fullCstDocRange(cstDoc);

    if (uri.toLowerCase().endsWith(".dyr") || isLikelyDyrContent(content)) {
      const dyr = parseDyr(content);
      const children: LspDocumentSymbol[] = dyr.records.map((rec) => {
        const r = spanToRange(rec.span, cstDoc);
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
      const r = spanToRange(bus.span, cstDoc);
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
      const r = spanToRange(load.span, cstDoc);
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
      const r = spanToRange(gen.span, cstDoc);
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
      const r = spanToRange(br.span, cstDoc);
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
      const r = spanToRange(xf.span, cstDoc, xf.k !== 0 ? 4 : 3);
      children.push({
        name: `Xfmr ${xf.i} -> ${xf.j}${xf.k !== 0 ? ` -> ${xf.k}` : ""} [${xf.ckt.trim()}]`,
        detail: `Ratio: ${xf.windv1.toFixed(3)} / ${xf.windv2.toFixed(3)} | Sbase: ${xf.sbase12} MVA`,
        kind: LspSymbolKind.Constructor,
        range: r,
        selectionRange: r,
      });
    }

    const headerRange = spanToRange(psseCase.header.span, cstDoc);

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

function getColumnIndexAtCursor(cstLine: PsseCstLine | undefined, source: string, character: number): number {
  if (!cstLine) return 0;
  return getCstFieldIndexAtColumn(cstLine.tokens, source, character);
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

function getSpaceSeparatedTokenIndexAtCursor(
  cstLine: PsseCstLine | undefined,
  source: string,
  character: number,
): number {
  if (!cstLine) return 0;
  const fields = extractFieldsFromCstTokens(cstLine.tokens, source, "whitespace");
  for (let i = 0; i < fields.length; i++) {
    if (character <= fields[i]!.endCol0) return i;
  }
  return Math.max(0, fields.length - 1);
}

/**
 * Contextual, section- and field-aware hover documentation for PSS/E `.raw` and `.dyr` records.
 */
export function getPsseHover(
  content: string,
  position: LspPosition,
  uri: string = "model.raw",
  workspace?: UnifiedWorkspace,
): LspHover | undefined {
  try {
    const cstDoc = parsePsseCstDocument(content);
    const cstLine = cstDoc.byRow.get(position.line);
    const line = cstLine?.line ?? "";
    const targetLine1 = position.line + 1;

    // 0. Check if this is a .dyr dynamic model file
    if (uri.toLowerCase().endsWith(".dyr") || isLikelyDyrContent(content)) {
      const dyr = parseDyr(content);
      const companionRaw = workspace ? findCompanionPsseRaw(workspace, uri)?.psseCase : undefined;
      for (const rec of dyr.records) {
        if (rec.span?.line === targetLine1) {
          const schema = DYR_MODEL_SCHEMAS[rec.model];
          const tokIdx = getSpaceSeparatedTokenIndexAtCursor(cstLine, content, position.character);
          const headerLen =
            rec.headerKind === "usrmdl"
              ? 10
              : rec.headerKind === "branch"
                ? 4
                : rec.headerKind === "bus" || rec.deviceName
                  ? 2
                  : 3;
          const iconCount = rec.icons?.length ?? 0;
          const activeIconIdx = tokIdx >= headerLen && tokIdx < headerLen + iconCount ? tokIdx - headerLen : -1;
          const activeConIdx = tokIdx >= headerLen + iconCount ? tokIdx - (headerLen + iconCount) : -1;

          const iconLines: string[] = [];
          if (rec.icons && rec.icons.length > 0) {
            for (let i = 0; i < rec.icons.length; i++) {
              const im = schema?.icons?.[i];
              const marker = i === activeIconIdx ? " **(Active)**" : "";
              iconLines.push(
                `- **\`${im ? im.name : `ICON(${i + 1})`}\`**${im ? ` (${im.description})` : ""}: \`${rec.icons[i]}\`${marker}`,
              );
            }
          }

          const paramLines: string[] = [];
          if (schema) {
            for (let i = 0; i < schema.params.length && i < rec.con.length; i++) {
              const p = schema.params[i]!;
              const marker = i === activeConIdx ? " **(Active)**" : "";
              const bounds = p.min !== undefined || p.max !== undefined ? ` [${p.min ?? "-∞"}, ${p.max ?? "+∞"}]` : "";
              paramLines.push(`- **\`${p.name}\`** (${p.description}): \`${rec.con[i]}\` ${p.unit}${bounds}${marker}`);
            }
          } else {
            for (let i = 0; i < rec.con.length; i++) {
              const marker = i === activeConIdx ? " **(Active)**" : "";
              paramLines.push(`- **\`CON(${i + 1})\`**: \`${rec.con[i]}\`${marker}`);
            }
          }
          const activeParam =
            activeIconIdx >= 0 && schema?.icons?.[activeIconIdx]
              ? `\n\n**Active ICON (\`ICON(${activeIconIdx + 1})\`)**: \`${schema.icons[activeIconIdx]!.name}\` = \`${rec.icons?.[activeIconIdx]}\` — ${schema.icons[activeIconIdx]!.description}`
              : activeConIdx >= 0 && schema?.params[activeConIdx]
                ? `\n\n**Active Parameter (\`CON(${activeConIdx + 1})\`)**: \`${schema.params[activeConIdx]!.name}\` = \`${rec.con[activeConIdx]}\` ${schema.params[activeConIdx]!.unit} — ${schema.params[activeConIdx]!.description}`
                : "";
          const rawBus = companionRaw?.buses.get(rec.ibus);
          const rawGen = companionRaw?.generators.find((g) => g.i === rec.ibus && g.id.trim() === rec.id.trim());
          const rawContext = rawBus
            ? `\n- **Connected \`.raw\` Bus**: \`${rec.ibus}\` (${rawBus.name}, ${rawBus.baseKv} kV)${rawGen ? ` — Gen \`${rawGen.id.trim()}\`: $P_g = ${rawGen.pg.toFixed(1)}$ MW, $M_{\\text{base}} = ${rawGen.mbase}$ MVA` : ""}`
            : "";
          const stdBadge = schema?.standardRef ? `\n- **Reference**: ${schema.standardRef}` : "";
          const headerId = rec.deviceName
            ? `- **Device**: \`${rec.deviceName}\``
            : rec.jbus && rec.jbus > 0
              ? `- **Branch**: \`${rec.ibus}\` — \`${rec.jbus}\` | **CKT**: \`${rec.id}\``
              : `- **Bus (\`IBUS\`)**: \`${rec.ibus}\` | **Machine ID**: \`${rec.id}\``;
          const allParamLines = [...iconLines, ...paramLines].join("\n");
          return {
            contents: {
              kind: "markdown",
              value: `### PSS/E Dynamic Model \`${rec.model}\` — ${schema?.title ?? rec.category.toUpperCase()}\n${headerId}${stdBadge}${rawContext}\n${schema ? `\n_${schema.description}_\n\n` : "\n"}${allParamLines}${activeParam}`,
            },
            range: spanToRange(rec.span, cstDoc),
          };
        }
      }
      return undefined;
    }

    const psseCase = parseRaw(content);
    const companionDyr = psseCase.dyr ?? (workspace ? findCompanionPsseDyr(workspace, uri)?.dyr : undefined);
    const colIdx = getColumnIndexAtCursor(cstLine, content, position.character);

    // 1. Header line
    if (psseCase.header.span?.line === targetLine1) {
      const fieldDoc = HEADER_FIELD_DOCS[colIdx] ? `\n\n**Active Field**: \`${HEADER_FIELD_DOCS[colIdx]}\`` : "";
      return {
        contents: {
          kind: "markdown",
          value: `### PSS/E Case Identification Header\n- **System MVA Base (\`SBASE\`)**: ${psseCase.header.sbase} MVA\n- **Format Revision (\`REV\`)**: v${psseCase.header.rev}\n- **Base Frequency (\`BASFRQ\`)**: ${psseCase.header.basfrq} Hz\n- **Title 1**: ${psseCase.title1 || "N/A"}\n- **Title 2**: ${psseCase.title2 || "N/A"}${fieldDoc}`,
        },
        range: spanToRange(psseCase.header.span, cstDoc),
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
          range: spanToRange(bus.span, cstDoc),
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
          range: spanToRange(load.span, cstDoc),
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
          range: spanToRange(shunt.span, cstDoc),
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
          range: spanToRange(gen.span, cstDoc),
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
          range: spanToRange(br.span, cstDoc),
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
          range: spanToRange(xf.span, cstDoc, nLines - 1),
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
          range: spanToRange(area.span, cstDoc),
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
          range: spanToRange(sw.span, cstDoc),
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
 * Helper that resolves which bus number is referenced at `(line, character)` in a `.raw` file via WASM CST.
 */
function resolveTargetBusAtPosition(
  psseCase: PsseCase,
  cstDoc: PsseCstDocument,
  source: string,
  position: LspPosition,
): number | undefined {
  const targetLine1 = position.line + 1;
  const colIdx = getColumnIndexAtCursor(cstDoc.byRow.get(position.line), source, position.character);

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

function psseOffsetToPosition(text: string, offset: number): LspPosition {
  const clamped = Math.max(0, Math.min(text.length, offset));
  let line = 0;
  let lineStart = 0;
  for (let i = 0; i < clamped; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, character: clamped - lineStart };
}

function collectPsseCrossLanguagePeers(
  workspace: UnifiedWorkspace,
  uri: string,
  candidateNames: readonly string[],
): LspLocation[] {
  const uIdx = workspace.getIndex();
  workspace.syncTggCorrespondences(uIdx);
  const out: LspLocation[] = [];
  const seen = new Set<string>();
  const pushSym = (sym: {
    resourceId?: string | undefined;
    documentUri?: string | undefined;
    fieldRanges?: Record<string, { startOffset: number; endOffset: number }> | undefined;
    startOffset: number;
    endOffset: number;
  }) => {
    const symUri = sym.resourceId || sym.documentUri || "";
    if (!symUri) return;
    const docText = workspace.getDocument(symUri)?.text ?? "";
    const nameRange = sym.fieldRanges?.["name"];
    const startOff = nameRange?.startOffset ?? sym.startOffset ?? 0;
    const endOff = nameRange?.endOffset ?? sym.endOffset ?? startOff;
    const range: LspRange = {
      start: psseOffsetToPosition(docText, startOff),
      end: psseOffsetToPosition(docText, Math.max(startOff, endOff)),
    };
    const key = `${symUri}:${range.start.line}:${range.start.character}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ uri: symUri, range });
    }
  };

  const indexer = workspace.tggCorrespondenceIndexer;
  const candidateLowers = new Set(candidateNames.map((n) => n.trim().toLowerCase()).filter(Boolean));
  const matchedSymIds = new Set<number>();
  for (const name of candidateNames) {
    if (!name) continue;
    for (const symId of uIdx.byName.get(name) ?? []) {
      matchedSymIds.add(symId);
    }
  }
  if (candidateLowers.size > 0) {
    for (const [symName, ids] of uIdx.byName.entries()) {
      if (candidateLowers.has(symName.toLowerCase())) {
        for (const symId of ids) {
          matchedSymIds.add(symId);
        }
      }
    }
  }

  for (const symId of matchedSymIds) {
    const sym = uIdx.symbols.get(symId);
    if (!sym) continue;
    if ((sym.resourceId || sym.documentUri || "") === uri) {
      for (const slot of indexer.getSlotsForSymbol(symId)) {
        const rec = indexer.hypergraph.getRecord(slot);
        if (!rec || rec.isRemoved) continue;
        for (const memberId of Object.values(rec.domainNodes)) {
          if (typeof memberId === "number" && memberId !== symId) {
            const peer = uIdx.symbols.get(memberId);
            if (peer) pushSym(peer);
          }
        }
      }
    } else if (sym.language !== "psse" && workspace.tggProjectionTable.canResolveAs("psse", sym)) {
      pushSym(sym);
    }
  }

  return out;
}

/**
 * Resolves Go-to-Definition for bus references in Loads, Shunts, Generators, Branches, Transformers,
 * cross-file jumps between `.raw` and companion `.dyr` files, and TGG cross-language counterparts.
 */
export function getPsseDefinition(
  content: string,
  position: LspPosition,
  uri: string = "model.raw",
  workspace?: UnifiedWorkspace,
): LspLocation | undefined {
  try {
    const cstDoc = parsePsseCstDocument(content);
    const targetLine1 = position.line + 1;

    if (workspace && !workspace.getNativeFileIndex(uri)) {
      workspace.indexDocumentText(uri, content, "psse");
    }

    // Cross-file jump from .dyr record -> companion .raw Bus declaration or TGG counterpart (e.g. Modelica GENROU wrapper)
    if (uri.toLowerCase().endsWith(".dyr") || isLikelyDyrContent(content)) {
      const dyr = parseDyr(content);
      const rec = dyr.records.find((r) => r.span?.line === targetLine1);
      if (!rec) return undefined;
      const tokIdx = getSpaceSeparatedTokenIndexAtCursor(cstDoc.byRow.get(position.line), content, position.character);
      // Clicking on model name token (e.g. 'GENROU') jumps to TGG Modelica/SysML2/PSCAD model definition if present
      if (workspace && tokIdx === 1) {
        const modelPeers = collectPsseCrossLanguagePeers(workspace, uri, [
          rec.model,
          `${rec.model}_${rec.ibus}_${rec.id.trim() || "1"}`,
        ]);
        if (modelPeers.length > 0) return modelPeers[0];
      }
      const companion = workspace ? findCompanionPsseRaw(workspace, uri) : undefined;
      if (companion) {
        const bus = companion.psseCase.buses.get(rec.ibus);
        if (bus?.span) {
          const busLine = Math.max(0, bus.span.line - 1);
          const busStartCol = Math.max(0, (bus.span.column ?? 1) - 1);
          const busEndCol = busStartCol + String(rec.ibus).length;
          return {
            uri: companion.uri,
            range: {
              start: { line: busLine, character: busStartCol },
              end: { line: busLine, character: busEndCol },
            },
          };
        }
      }
      if (workspace) {
        const fallbackPeers = collectPsseCrossLanguagePeers(workspace, uri, [
          rec.model,
          `${rec.model}_${rec.ibus}_${rec.id.trim() || "1"}`,
        ]);
        if (fallbackPeers.length > 0) return fallbackPeers[0];
      }
      return undefined;
    }

    const psseCase = parseRaw(content);
    const colIdx = getColumnIndexAtCursor(cstDoc.byRow.get(position.line), content, position.character);

    // Header line jump to cross-language case wrapper (Modelica / SysML2) if aligned
    if (workspace && psseCase.header.span?.line === targetLine1) {
      const stem = (uri.split("/").pop() || "case").replace(/\.(raw|dyr|seq)$/i, "");
      const peers = collectPsseCrossLanguagePeers(workspace, uri, [stem, psseCase.title1?.trim() ?? ""]);
      if (peers.length > 0) return peers[0];
    }

    // Cross-file jump from .raw Generator ID (column 1) -> companion .dyr generator model
    if (colIdx === 1 && workspace) {
      const gen = psseCase.generators.find((g) => g.span?.line === targetLine1);
      if (gen) {
        const companionDyr = findCompanionPsseDyr(workspace, uri);
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

    const busNum = resolveTargetBusAtPosition(psseCase, cstDoc, content, position);
    if (busNum === undefined) return undefined;
    const bus = psseCase.buses.get(busNum);
    if (!bus?.span) return undefined;
    if (workspace && bus.span.line === targetLine1) {
      const busPeers = collectPsseCrossLanguagePeers(workspace, uri, [bus.name.trim(), `Bus_${busNum}`]);
      if (busPeers.length > 0) return busPeers[0];
    }
    return {
      uri,
      range: spanToRange(bus.span, cstDoc),
    };
  } catch {
    return undefined;
  }
}

/**
 * Finds all references (Bus declaration + Loads, Shunts, Generators, Branches, Transformers, companion `.dyr` records,
 * and cross-language TGG counterparts) for a Bus or dynamic model.
 */
export function getPsseReferences(
  content: string,
  position: LspPosition,
  uri: string = "model.raw",
  workspace?: UnifiedWorkspace,
): LspLocation[] {
  try {
    const cstDoc = parsePsseCstDocument(content);
    const isDyr = uri.toLowerCase().endsWith(".dyr") || isLikelyDyrContent(content);

    if (workspace && !workspace.getNativeFileIndex(uri)) {
      workspace.indexDocumentText(uri, content, "psse");
    }

    let busNum: number | undefined;
    let rawCase: PsseCase | undefined;
    const rawUri = uri;

    if (isDyr) {
      const dyr = parseDyr(content);
      const targetLine1 = position.line + 1;
      const rec = dyr.records.find((r) => r.span?.line === targetLine1);
      if (!rec) return [];
      busNum = rec.ibus;
      const locations: LspLocation[] = [];
      for (const r of dyr.records) {
        if (r.ibus === busNum && r.span) {
          locations.push({ uri, range: spanToRange(r.span, cstDoc) });
        }
      }
      const companionRaw = workspace ? findCompanionPsseRaw(workspace, uri) : undefined;
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
      if (workspace) {
        locations.push(
          ...collectPsseCrossLanguagePeers(workspace, uri, [
            rec.model,
            `${rec.model}_${rec.ibus}_${rec.id.trim() || "1"}`,
          ]),
        );
      }
      return locations;
    }

    rawCase = parseRaw(content);
    busNum = resolveTargetBusAtPosition(rawCase, cstDoc, content, position);
    if (busNum === undefined) return [];

    const locations: LspLocation[] = [];
    const bus = rawCase.buses.get(busNum);
    if (bus?.span) {
      locations.push({ uri: rawUri, range: spanToRange(bus.span, cstDoc) });
    }
    for (const load of rawCase.loads) {
      if (load.i === busNum && load.span) {
        locations.push({ uri: rawUri, range: spanToRange(load.span, cstDoc) });
      }
    }
    for (const shunt of rawCase.fixedShunts) {
      if (shunt.i === busNum && shunt.span) {
        locations.push({ uri: rawUri, range: spanToRange(shunt.span, cstDoc) });
      }
    }
    for (const gen of rawCase.generators) {
      if ((gen.i === busNum || gen.ireg === busNum) && gen.span) {
        locations.push({ uri: rawUri, range: spanToRange(gen.span, cstDoc) });
      }
    }
    for (const br of rawCase.branches) {
      if ((br.i === busNum || Math.abs(br.j) === busNum) && br.span) {
        locations.push({ uri: rawUri, range: spanToRange(br.span, cstDoc) });
      }
    }
    for (const xf of rawCase.transformers) {
      if ((xf.i === busNum || xf.j === busNum || xf.k === busNum) && xf.span) {
        locations.push({ uri: rawUri, range: spanToRange(xf.span, cstDoc, xf.k !== 0 ? 4 : 3) });
      }
    }
    for (const sw of rawCase.switchedShunts) {
      if (sw.i === busNum && sw.span) {
        locations.push({ uri: rawUri, range: spanToRange(sw.span, cstDoc) });
      }
    }

    // Include cross-file references in companion .dyr file when workspace is provided
    const companionDyr = workspace ? findCompanionPsseDyr(workspace, uri) : undefined;
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

    if (workspace && bus) {
      locations.push(...collectPsseCrossLanguagePeers(workspace, uri, [bus.name.trim(), `Bus_${busNum}`]));
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
    const cstDoc = parsePsseCstDocument(content);
    if (uri.toLowerCase().endsWith(".dyr") || isLikelyDyrContent(content)) {
      const dyr = parseDyr(content);
      for (const rec of dyr.records) {
        if (!rec.span) continue;
        const schema = DYR_MODEL_SCHEMAS[rec.model];
        if (!schema) continue;
        const lineIdx = Math.max(0, rec.span.line - 1);
        const lineText = cstDoc.byRow.get(lineIdx)?.line ?? "";
        const summaryParts: string[] = [];
        if (rec.icons && rec.icons.length > 0 && schema.icons) {
          const maxIcons = Math.min(2, schema.icons.length, rec.icons.length);
          for (let i = 0; i < maxIcons; i++) {
            summaryParts.push(`${schema.icons[i]!.name}=${rec.icons[i]}`);
          }
        }
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
      const lineText = cstDoc.byRow.get(lineIdx)?.line ?? "";
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
      const lineText = cstDoc.byRow.get(lineIdx)?.line ?? "";
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
      const lineText = cstDoc.byRow.get(lineIdx)?.line ?? "";
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
      const lineText = cstDoc.byRow.get(lineIdx)?.line ?? "";
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

function applyOffsetPatches(
  source: string,
  patches: Array<{ startOffset: number; endOffset: number; newText: string }>,
): string {
  const sorted = [...patches].sort((a, b) => b.startOffset - a.startOffset);
  let out = source;
  for (const p of sorted) {
    if (p.endOffset >= p.startOffset && p.startOffset >= 0 && p.endOffset <= out.length) {
      out = out.slice(0, p.startOffset) + p.newText + out.slice(p.endOffset);
    }
  }
  return out;
}

/**
 * Atomic Bus Renumbering (F2 Rename Symbol) across `.raw` (Bus, Load, Shunt, Generator I/IREG,
 * Branch I/J, Transformer I/J/K/CONT1, Switched Shunt, HVDC) and companion `.dyr` (`IBUS`)
 * using surgical WASM CST token replacement via `CstUnparser` so comments and formatting remain intact.
 */
export function getPsseRenameEdits(
  content: string,
  position: LspPosition,
  newName: string,
  uri: string = "model.raw",
  workspace?: UnifiedWorkspace,
): LspWorkspaceEdit | undefined {
  const newBusNum = Number.parseInt(newName.trim(), 10);
  if (!Number.isFinite(newBusNum) || newBusNum <= 0 || newBusNum > 999997) {
    return undefined;
  }

  try {
    const cstDoc = parsePsseCstDocument(content);
    const psseCase = parseRaw(content);
    const oldBusNum = resolveTargetBusAtPosition(psseCase, cstDoc, content, position);
    if (oldBusNum === undefined || oldBusNum === newBusNum) return undefined;
    if (psseCase.buses.has(newBusNum)) return undefined;

    const rawPatches: Array<{ startOffset: number; endOffset: number; newText: string }> = [];
    const patchFieldIfBus = (line1: number | undefined, colIdx: number, preserveNegative = false) => {
      if (!line1) return;
      const cstLine = cstDoc.byRow.get(line1 - 1);
      if (!cstLine) return;
      const fields = extractFieldsFromCstTokens(cstLine.tokens, content, "delimited");
      const field = fields[colIdx];
      if (!field) return;
      const parsedVal = Number.parseInt(field.value, 10);
      if (preserveNegative && Math.abs(parsedVal) === oldBusNum) {
        const replacement = parsedVal < 0 ? `-${newBusNum}` : String(newBusNum);
        rawPatches.push(buildCstFieldReplacementEdit(field, replacement));
      } else if (parsedVal === oldBusNum) {
        rawPatches.push(buildCstFieldReplacementEdit(field, String(newBusNum)));
      }
    };

    const bus = psseCase.buses.get(oldBusNum);
    if (bus) patchFieldIfBus(bus.span?.line, 0);
    for (const l of psseCase.loads) {
      if (l.i === oldBusNum) patchFieldIfBus(l.span?.line, 0);
    }
    for (const s of psseCase.fixedShunts) {
      if (s.i === oldBusNum) patchFieldIfBus(s.span?.line, 0);
    }
    for (const g of psseCase.generators) {
      if (g.i === oldBusNum) patchFieldIfBus(g.span?.line, 0);
      if (g.ireg === oldBusNum) patchFieldIfBus(g.span?.line, 7);
    }
    for (const br of psseCase.branches) {
      if (br.i === oldBusNum) patchFieldIfBus(br.span?.line, 0);
      if (Math.abs(br.j) === oldBusNum) patchFieldIfBus(br.span?.line, 1, true);
    }
    for (const xf of psseCase.transformers) {
      if (xf.span) {
        if (xf.i === oldBusNum) patchFieldIfBus(xf.span.line, 0);
        if (xf.j === oldBusNum) patchFieldIfBus(xf.span.line, 1);
        if (xf.k === oldBusNum) patchFieldIfBus(xf.span.line, 2);
        if (xf.cont1 === oldBusNum) patchFieldIfBus(xf.span.line + 2, 7);
      }
    }
    for (const area of psseCase.areas) {
      if (area.isw === oldBusNum) patchFieldIfBus(area.span?.line, 1);
    }
    for (const dc of psseCase.twoTerminalDc) {
      if (dc.span) {
        if (dc.ipr === oldBusNum) patchFieldIfBus(dc.span.line + 1, 0);
        if (dc.ipi === oldBusNum) patchFieldIfBus(dc.span.line + 2, 0);
      }
    }
    for (const vsc of psseCase.vscDc) {
      if (vsc.span) {
        if (vsc.ibus1 === oldBusNum) patchFieldIfBus(vsc.span.line + 1, 0);
        if (vsc.ibus2 === oldBusNum) patchFieldIfBus(vsc.span.line + 2, 0);
      }
    }
    for (const sw of psseCase.switchedShunts) {
      if (sw.i === oldBusNum) patchFieldIfBus(sw.span?.line, 0);
      if (sw.swrem === oldBusNum) patchFieldIfBus(sw.span?.line, 6);
    }

    const updatedRaw = applyOffsetPatches(content, rawPatches);
    const changes: Record<string, LspTextEdit[]> = {
      [uri]: [
        {
          range: fullCstDocRange(cstDoc),
          newText: updatedRaw,
        },
      ],
    };

    const companionDyr = workspace ? findCompanionPsseDyr(workspace, uri) : undefined;
    if (companionDyr) {
      const dyrSource = workspace?.getDocument(companionDyr.uri)?.text ?? "";
      if (dyrSource) {
        const dyrCst = parsePsseCstDocument(dyrSource);
        const cstRecs = extractDyrCstRecords(dyrCst);
        const dyrPatches: Array<{ startOffset: number; endOffset: number; newText: string }> = [];
        for (const rec of cstRecs) {
          if (rec.ibusField && Number.parseInt(rec.ibusField.value, 10) === oldBusNum) {
            dyrPatches.push(buildCstFieldReplacementEdit(rec.ibusField, String(newBusNum)));
          }
          if (rec.jbusField && Number.parseInt(rec.jbusField.value, 10) === oldBusNum) {
            dyrPatches.push(buildCstFieldReplacementEdit(rec.jbusField, String(newBusNum)));
          }
          const schema = resolveDyrModelSchema(rec.modelName);
          if (schema?.icons) {
            for (let i = 0; i < schema.icons.length && i < rec.iconFields.length; i++) {
              if (schema.icons[i]!.type === "bus" && Number.parseInt(rec.iconFields[i]!.value, 10) === oldBusNum) {
                dyrPatches.push(buildCstFieldReplacementEdit(rec.iconFields[i]!, String(newBusNum)));
              }
            }
          }
        }
        if (dyrPatches.length > 0) {
          changes[companionDyr.uri] = [
            {
              range: fullCstDocRange(dyrCst),
              newText: applyOffsetPatches(dyrSource, dyrPatches),
            },
          ];
        }
      }
    }

    return { changes };
  } catch {
    return undefined;
  }
}

/**
 * Provides deterministic Quick Fix Code Actions for PSS/E diagnostics (`P2001`, `P2002`, `P3001`, `P3002`, `P4003`, `P5001`)
 * using surgical WASM CST token/record patches.
 */
export function getPsseCodeActions(
  content: string,
  _range: LspRange,
  diagnostics: LspDiagnostic[],
  uri: string = "model.raw",
): LspCodeAction[] {
  const actions: LspCodeAction[] = [];
  const cstDoc = parsePsseCstDocument(content);
  const fullDocRange = fullCstDocRange(cstDoc);

  const patchCsvField = (
    patches: Array<{ startOffset: number; endOffset: number; newText: string }>,
    line1: number | undefined,
    colIdx: number,
    newVal: string,
  ): boolean => {
    if (!line1) return false;
    const cstLine = cstDoc.byRow.get(line1 - 1);
    if (!cstLine) return false;
    const fields = extractFieldsFromCstTokens(cstLine.tokens, content, "delimited");
    const field = fields[colIdx];
    if (!field || field.tokenType === "empty") return false;
    patches.push(buildCstFieldReplacementEdit(field, newVal));
    return true;
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
            const patches: Array<{ startOffset: number; endOffset: number; newText: string }> = [];
            const patched = patchCsvField(patches, bus.span?.line, 3, "4");
            const newText = patched
              ? applyOffsetPatches(content, patches)
              : (() => {
                  bus.ide = 4;
                  return writeRaw(psseCase);
                })();
            actions.push({
              title: `Set Bus ${busId} type to Isolated (IDE = 4)`,
              kind: "quickfix",
              diagnostics: [diag],
              isPreferred: true,
              edit: {
                changes: {
                  [uri]: [{ range: fullDocRange, newText }],
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
          const patches: Array<{ startOffset: number; endOffset: number; newText: string }> = [];
          const patched = patchCsvField(patches, candidate.span?.line, 3, "3");
          const newText = patched
            ? applyOffsetPatches(content, patches)
            : (() => {
                candidate.ide = 3;
                return writeRaw(psseCase);
              })();
          actions.push({
            title: `Promote Bus ${candidate.i} (${candidate.name}) to Swing/Slack Bus (IDE = 3)`,
            kind: "quickfix",
            diagnostics: [diag],
            isPreferred: true,
            edit: {
              changes: {
                [uri]: [{ range: fullDocRange, newText }],
              },
            },
          });
        }
      } else if (diag.code === "P3001") {
        // Inverted Qmin / Qmax limits on generator (cols 4=QT, 5=QB)
        const psseCase = parseRaw(content);
        const patches: Array<{ startOffset: number; endOffset: number; newText: string }> = [];
        let fixed = false;
        for (const g of psseCase.generators) {
          if (g.qb > g.qt) {
            const ok1 = patchCsvField(patches, g.span?.line, 4, g.qb.toFixed(3));
            const ok2 = patchCsvField(patches, g.span?.line, 5, g.qt.toFixed(3));
            const tmp = g.qb;
            g.qb = g.qt;
            g.qt = tmp;
            fixed = ok1 && ok2 ? true : fixed || true;
          }
        }
        if (fixed) {
          const newText = patches.length > 0 ? applyOffsetPatches(content, patches) : writeRaw(psseCase);
          actions.push({
            title: "Swap inverted generator reactive limits (Qmin / Qmax)",
            kind: "quickfix",
            diagnostics: [diag],
            isPreferred: true,
            edit: {
              changes: {
                [uri]: [{ range: fullDocRange, newText }],
              },
            },
          });
        }
      } else if (diag.code === "P3002") {
        // Inverted Pmin / Pmax limits on generator (cols 16=PT, 17=PB; +1 in v35)
        const psseCase = parseRaw(content);
        const patches: Array<{ startOffset: number; endOffset: number; newText: string }> = [];
        let fixed = false;
        for (const g of psseCase.generators) {
          if (g.pb > g.pt) {
            const cstLine = g.span ? cstDoc.byRow.get(g.span.line - 1) : undefined;
            const fields = cstLine ? extractFieldsFromCstTokens(cstLine.tokens, content, "delimited") : [];
            const off = psseCase.header.rev >= 35 && fields.length >= 20 ? 1 : 0;
            patchCsvField(patches, g.span?.line, 16 + off, g.pb.toFixed(3));
            patchCsvField(patches, g.span?.line, 17 + off, g.pt.toFixed(3));
            const tmp = g.pb;
            g.pb = g.pt;
            g.pt = tmp;
            fixed = true;
          }
        }
        if (fixed) {
          const newText = patches.length > 0 ? applyOffsetPatches(content, patches) : writeRaw(psseCase);
          actions.push({
            title: "Swap inverted generator active power limits (Pmin / Pmax)",
            kind: "quickfix",
            diagnostics: [diag],
            isPreferred: true,
            edit: {
              changes: {
                [uri]: [{ range: fullDocRange, newText }],
              },
            },
          });
        }
      } else if (diag.code === "P4003") {
        // Off-nominal tap ratio out of [0.8, 1.2] range: clamp to 1.000 (line+2 col 0 = WINDV1, line+3 col 0 = WINDV2)
        const psseCase = parseRaw(content);
        const patches: Array<{ startOffset: number; endOffset: number; newText: string }> = [];
        let fixed = false;
        for (const xf of psseCase.transformers) {
          if (xf.windv1 < 0.8 || xf.windv1 > 1.2) {
            if (xf.span) patchCsvField(patches, xf.span.line + 2, 0, "1.0000");
            xf.windv1 = 1.0;
            fixed = true;
          }
          if (xf.windv2 < 0.8 || xf.windv2 > 1.2) {
            if (xf.span) patchCsvField(patches, xf.span.line + 3, 0, "1.0000");
            xf.windv2 = 1.0;
            fixed = true;
          }
        }
        if (fixed) {
          const newText = patches.length > 0 ? applyOffsetPatches(content, patches) : writeRaw(psseCase);
          actions.push({
            title: "Reset transformer off-nominal tap ratio to 1.000 p.u.",
            kind: "quickfix",
            diagnostics: [diag],
            isPreferred: true,
            edit: {
              changes: {
                [uri]: [{ range: fullDocRange, newText }],
              },
            },
          });
        }
      } else if (diag.code === "P5001") {
        // Missing CON parameters in .dyr record
        const dyr = parseDyr(content);
        const patches: Array<{ startOffset: number; endOffset: number; newText: string }> = [];
        let fixed = false;
        for (const rec of dyr.records) {
          const schema = DYR_MODEL_SCHEMAS[rec.model];
          if (schema && rec.con.length < schema.params.length) {
            while (rec.con.length < schema.params.length) {
              rec.con.push(0.0);
            }
            fixed = true;
            if (rec.span) {
              const paddedModel = `'${rec.model.padEnd(6, " ")}'`;
              patches.push({
                startOffset: rec.span.startOffset,
                endOffset: rec.span.endOffset,
                newText: `${rec.ibus} ${paddedModel} ${rec.id} ${rec.con.join(" ")} /`,
              });
            }
          }
        }
        if (fixed) {
          const newText =
            patches.length > 0
              ? applyOffsetPatches(content, patches)
              : dyr.records
                  .map((r) => `${r.ibus} '${r.model.padEnd(6, " ")}' ${r.id} ${r.con.join(" ")} /`)
                  .join("\n") + "\n";
          actions.push({
            title: "Pad missing dynamic model CON parameters with defaults",
            kind: "quickfix",
            diagnostics: [diag],
            isPreferred: true,
            edit: {
              changes: {
                [uri]: [{ range: fullDocRange, newText }],
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

function formatTransformerRecord(t: TransformerRecord): string {
  const lines: string[] = [
    `${t.i}, ${t.j}, ${t.k}, '${t.ckt}', ${t.cw}, ${t.cm}, ${t.mag1.toFixed(5)}, ${t.mag2.toFixed(5)}, ${t.nmetr}, '${t.name}', ${t.stat}`,
    t.k !== 0
      ? `${t.r12.toFixed(5)}, ${t.x12.toFixed(5)}, ${t.sbase12.toFixed(2)}, ${(t.r23 ?? 0).toFixed(5)}, ${(t.x23 ?? 0.0001).toFixed(5)}, ${(t.sbase23 ?? t.sbase12).toFixed(2)}, ${(t.r31 ?? 0).toFixed(5)}, ${(t.x31 ?? 0.0001).toFixed(5)}, ${(t.sbase31 ?? t.sbase12).toFixed(2)}, ${(t.vmstar ?? 1).toFixed(4)}, ${(t.anstar ?? 0).toFixed(4)}`
      : `${t.r12.toFixed(5)}, ${t.x12.toFixed(5)}, ${t.sbase12.toFixed(2)}`,
    `${t.windv1.toFixed(4)}, ${t.nomv1.toFixed(2)}, ${t.ang1.toFixed(2)}, ${t.rata1.toFixed(2)}, ${t.ratb1.toFixed(2)}, ${t.ratc1.toFixed(2)}, ${t.cod1}, ${t.cont1}, ${t.rma1.toFixed(4)}, ${t.rmi1.toFixed(4)}, ${t.vma1.toFixed(4)}, ${t.vmi1.toFixed(4)}, ${t.ntp1}, ${t.tab1}, ${t.cr1.toFixed(5)}, ${t.cx1.toFixed(5)}, ${t.cnxa1.toFixed(2)}`,
    `${t.windv2.toFixed(4)}, ${t.nomv2.toFixed(2)}`,
  ];
  if (t.k !== 0) {
    lines.push(`${(t.windv3 ?? 1.0).toFixed(4)}, ${(t.nomv3 ?? 0.0).toFixed(2)}`);
  }
  return lines.join("\n");
}

/**
 * Applies bi-directional SLD diagram property writeback onto a PSS/E `.raw` source text.
 * Supports mutating Bus (`bus_<id>`), Generator (`gen_<id>_<ckt>`), Load (`load_<id>_<ckt>`),
 * Fixed Shunt (`shunt_<id>_<ckt>`), Switched Shunt (`swshunt_<id>_SW`),
 * AC Branch (`branch_<i>_<j>_<ckt>` or `line_<i>_<j>_<ckt>`), and Transformer (`xfmr_<i>_<j>_<ckt>`) records
 * via surgical CST record spans without wiping comments or unrelated sections.
 */
export function applyPsseDiagramWriteback(
  sourceText: string,
  cellId: string,
  changes: Record<string, unknown>,
): string {
  if (cellId.startsWith("dyr_") || isLikelyDyrContent(sourceText)) {
    const parts = cellId.split("_");
    const busNumber = parts.length >= 2 && /^-?\d+$/.test(parts[1] ?? "") ? Number.parseInt(parts[1]!, 10) : undefined;
    const id = parts.length >= 4 ? parts[2] : undefined;
    const model = parts.length >= 4 ? parts.slice(3).join("_") : parts.length === 3 ? parts[2] : undefined;
    const updates: Record<string, number | string> = {};
    for (const [k, v] of Object.entries(changes)) {
      if (typeof v === "number" || typeof v === "string") updates[k] = v;
    }
    return applyDyrCstParameterUpdates(sourceText, { busNumber, id, model }, updates);
  }
  const psseCase = parseRaw(sourceText);
  const num = (v: unknown, fallback: number): number => {
    const parsed = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const posOnly = "x" in changes && "y" in changes && Object.keys(changes).every((k) => k === "x" || k === "y");
  const posX = "x" in changes ? Math.round(num(changes["x"], 0)) : undefined;
  const posY = "y" in changes ? Math.round(num(changes["y"], 0)) : undefined;

  const upsertPosComment = (lineText: string, x: number, y: number): string => {
    const tag = `@pos(${x}, ${y})`;
    if (/@pos\(\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*\)/i.test(lineText)) {
      return lineText.replace(/@pos\(\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*\)/i, tag);
    }
    // Check if the line already has a `/` trailing comment outside quotes
    let inSingle = false;
    let inDouble = false;
    for (let i = 0; i < lineText.length; i++) {
      const ch = lineText[i];
      if (ch === "'" && !inDouble) inSingle = !inSingle;
      else if (ch === '"' && !inSingle) inDouble = !inDouble;
      else if (ch === "/" && !inSingle && !inDouble) {
        return `${lineText.trimEnd()} ${tag}`;
      }
    }
    return `${lineText.trimEnd()} / ${tag}`;
  };

  let targetSpan: SourceSpan | undefined;
  let formattedLine: string | undefined;

  if (cellId.startsWith("bus_")) {
    const busId = parseInt(cellId.slice(4), 10);
    const bus = psseCase.buses.get(busId);
    if (bus) {
      if ("vm" in changes) bus.vm = num(changes["vm"], bus.vm);
      if ("va" in changes) bus.va = num(changes["va"], bus.va);
      if ("baseKv" in changes) bus.baseKv = num(changes["baseKv"], bus.baseKv);
      if ("ide" in changes) bus.ide = Math.round(num(changes["ide"], bus.ide)) as 1 | 2 | 3 | 4;
      if (typeof changes["name"] === "string") bus.name = changes["name"];
      if (bus.span && bus.span.startOffset !== undefined && bus.span.endOffset !== undefined) {
        targetSpan = bus.span;
        formattedLine = `${bus.i}, '${bus.name.padEnd(12)}', ${bus.baseKv.toFixed(3)}, ${bus.ide}, ${bus.area}, ${bus.zone}, ${bus.owner}, ${bus.vm.toFixed(4)}, ${bus.va.toFixed(4)}${bus.nvhi !== undefined ? `, ${bus.nvhi.toFixed(4)}, ${bus.nvlo?.toFixed(4)}, ${bus.evhi?.toFixed(4)}, ${bus.evlo?.toFixed(4)}` : ""}`;
        if ("orientation" in changes) {
          const orient = Math.round(num(changes["orientation"], 0)) === 90 ? 90 : 0;
          formattedLine += ` / @orient(${orient})`;
        }
      }
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
      if (gen.span && gen.span.startOffset !== undefined && gen.span.endOffset !== undefined) {
        targetSpan = gen.span;
        formattedLine = `${gen.i}, '${gen.id}', ${gen.pg.toFixed(3)}, ${gen.qg.toFixed(3)}, ${gen.qt.toFixed(3)}, ${gen.qb.toFixed(3)}, ${gen.vs.toFixed(4)}, ${gen.ireg}, ${gen.mbase.toFixed(2)}, ${gen.zr.toFixed(5)}, ${gen.zx.toFixed(5)}, ${gen.rt.toFixed(5)}, ${gen.xt.toFixed(5)}, ${gen.gtap.toFixed(4)}, ${gen.stat}, ${gen.rmpct.toFixed(1)}, ${gen.pt.toFixed(3)}, ${gen.pb.toFixed(3)}`;
      }
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
      if (load.span && load.span.startOffset !== undefined && load.span.endOffset !== undefined) {
        targetSpan = load.span;
        formattedLine = `${load.i}, '${load.id}', ${load.status}, ${load.area}, ${load.zone}, ${load.pl.toFixed(3)}, ${load.ql.toFixed(3)}, ${load.ip.toFixed(3)}, ${load.iq.toFixed(3)}, ${load.yp.toFixed(3)}, ${load.yq.toFixed(3)}, ${load.owner}, ${load.scale}, ${load.intrct}`;
      }
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
      if (shunt.span && shunt.span.startOffset !== undefined && shunt.span.endOffset !== undefined) {
        targetSpan = shunt.span;
        formattedLine = `${shunt.i}, '${shunt.id}', ${shunt.status}, ${shunt.gl.toFixed(3)}, ${shunt.bl.toFixed(3)}`;
      }
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
      if (sw.span && sw.span.startOffset !== undefined && sw.span.endOffset !== undefined) {
        targetSpan = sw.span;
        formattedLine = `${sw.i}, ${sw.modsw}, ${sw.adjm}, ${sw.stat}, ${sw.vswhi.toFixed(4)}, ${sw.vswlo.toFixed(4)}, ${sw.swrem}, ${sw.rmpct.toFixed(1)}, '${sw.rmidnt}', ${sw.binit.toFixed(3)}, ${sw.n1}, ${sw.b1.toFixed(3)}`;
      }
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
      if (br.span && br.span.startOffset !== undefined && br.span.endOffset !== undefined) {
        targetSpan = br.span;
        formattedLine = `${br.i}, ${br.j}, '${br.ckt}', ${br.r.toFixed(5)}, ${br.x.toFixed(5)}, ${br.b.toFixed(5)}, ${br.rateA.toFixed(2)}, ${br.rateB.toFixed(2)}, ${br.rateC.toFixed(2)}, ${br.gi.toFixed(5)}, ${br.bi.toFixed(5)}, ${br.gj.toFixed(5)}, ${br.bj.toFixed(5)}, ${br.st}, ${br.met}, ${br.len.toFixed(2)}`;
      }
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
      if ("sbase12" in changes) xf.sbase12 = num(changes["sbase12"], xf.sbase12);
      if ("windv1" in changes) xf.windv1 = num(changes["windv1"], xf.windv1);
      if ("windv2" in changes) xf.windv2 = num(changes["windv2"], xf.windv2);
      if ("ang1" in changes) xf.ang1 = num(changes["ang1"], xf.ang1);
      if ("rata1" in changes) xf.rata1 = num(changes["rata1"], xf.rata1);
      const stVal = changes["stat"] ?? changes["status"] ?? changes["st"];
      if (stVal !== undefined) xf.stat = Math.round(num(stVal, xf.stat)) as 0 | 1;
      if (xf.span && xf.span.startOffset !== undefined && xf.span.endOffset !== undefined) {
        targetSpan = xf.span;
        formattedLine = formatTransformerRecord(xf);
      }
    }
  }

  if (
    targetSpan &&
    targetSpan.startOffset !== undefined &&
    targetSpan.endOffset !== undefined &&
    formattedLine !== undefined
  ) {
    const origLine = sourceText.slice(targetSpan.startOffset, targetSpan.endOffset);
    let nextLine: string;
    if (posOnly && posX !== undefined && posY !== undefined) {
      nextLine = upsertPosComment(origLine, posX, posY);
    } else {
      nextLine = formattedLine;
      if (posX !== undefined && posY !== undefined) {
        nextLine = upsertPosComment(nextLine, posX, posY);
      } else {
        const existingPos = /@pos\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/i.exec(origLine);
        if (existingPos) {
          nextLine = upsertPosComment(nextLine, Math.round(Number(existingPos[1])), Math.round(Number(existingPos[2])));
        }
      }
    }
    return sourceText.slice(0, targetSpan.startOffset) + nextLine + sourceText.slice(targetSpan.endOffset);
  }

  return writeRaw(psseCase);
}

function findRawSectionInsertOffset(
  sourceText: string,
  sectionBeginPattern: RegExp,
  sectionEndPattern: RegExp,
): number | null {
  const lines = sourceText.split(/\r?\n/);
  let offset = 0;
  let inSection = false;
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx]!;
    const trimmed = line.trim();
    if (!inSection && sectionBeginPattern.test(trimmed)) {
      inSection = true;
    } else if (inSection && /^0\b/.test(trimmed) && (sectionEndPattern.test(trimmed) || /END OF /i.test(trimmed))) {
      return offset;
    }
    offset += line.length + (sourceText[offset + line.length] === "\r" ? 2 : 1);
  }
  return null;
}

function insertRawRecordInSection(
  sourceText: string,
  sectionName: string,
  sectionBeginPattern: RegExp,
  sectionEndPattern: RegExp,
  recordLine: string,
  isBusSection = false,
): string {
  if (isBusSection) {
    const lines = sourceText.split(/\r?\n/);
    let offset = 0;
    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx]!;
      const trimmed = line.trim();
      if (
        idx > 0 &&
        /^0\b/.test(trimmed) &&
        (/END OF BUS/i.test(trimmed) || /BEGIN /i.test(trimmed) || trimmed === "0")
      ) {
        return sourceText.slice(0, offset) + recordLine + "\n" + sourceText.slice(offset);
      }
      offset += line.length + (sourceText[offset + line.length] === "\r" ? 2 : 1);
    }
  }

  const insertAt = findRawSectionInsertOffset(sourceText, sectionBeginPattern, sectionEndPattern);
  if (insertAt !== null) {
    return sourceText.slice(0, insertAt) + recordLine + "\n" + sourceText.slice(insertAt);
  }

  // Append new section before trailing Q / end-of-file
  const qMatch = /\n[ \t]*Q[ \t]*\r?\n?$/i.exec(sourceText);
  const block = `0 / BEGIN ${sectionName} DATA\n${recordLine}\n0 / END OF ${sectionName} DATA\n`;
  if (qMatch) {
    const head = sourceText.slice(0, qMatch.index + 1);
    return head + block + sourceText.slice(qMatch.index + 1);
  }
  const sep = sourceText.endsWith("\n") || sourceText.length === 0 ? "" : "\n";
  return sourceText + sep + block;
}

/**
 * Adds a PSS/E component (from the diagram palette or `PSSEDynamics` library)
 * to a `.raw` or `.dyr` document and returns the updated source text.
 */
export function addPsseDiagramComponent(sourceText: string, className: string, x?: number, y?: number): string {
  const cleanClass = className
    .replace(/^__LIB__:[^/]+\//, "")
    .replace(/^__LIB__:/, "")
    .replace(/^PSSEDynamics\./i, "")
    .trim();
  const lower = cleanClass.toLowerCase();
  const hasPos = typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y);
  const rx = hasPos ? Math.round(x) : 0;
  const ry = hasPos ? Math.round(y) : 0;
  const posTag = hasPos ? `@pos(${rx}, ${ry})` : "";

  if (isLikelyDyrContent(sourceText)) {
    const modelName = cleanClass.replace(/^psse:/i, "").toUpperCase() || "GENROU";
    const dyr = parseDyr(sourceText);
    const busNum = dyr.records[0]?.ibus ?? 1;
    const sep = sourceText.endsWith("\n") || sourceText.length === 0 ? "" : "\n";
    return `${sourceText}${sep}${busNum} '${modelName}' 1 5.0 0.05 0.1 5.0 0.5 1.8 1.7 0.3 0.5 0.25 0.1 0.3 / /* ${modelName} */${posTag ? ` ${posTag}` : ""}\n`;
  }

  let workingText = sourceText;
  const firstNonCommentLine = workingText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((t) => t.length > 0 && !t.startsWith("/") && !t.startsWith("@!"));
  const hasRawHeader = Boolean(firstNonCommentLine) && !/^(?:0(?:\s*\/.*)?|Q(?:\s*\/.*)?)$/i.test(firstNonCommentLine!);
  if (!hasRawHeader) {
    if (!firstNonCommentLine) {
      const sep = workingText.length === 0 || workingText.endsWith("\n") ? "" : "\n";
      workingText = `${workingText}${sep}0, 100.00, 33, 0, 1, 60.00 / PSS/E-33.0\nNEW PSS/E CASE\n\n0 / END OF BUS DATA\nQ\n`;
    } else {
      workingText = `0, 100.00, 33, 0, 1, 60.00 / PSS/E-33.0\nNEW PSS/E CASE\n\n0 / END OF BUS DATA\n${workingText}`;
    }
  }

  const psseCase = parseRaw(workingText);
  const existingBusIds = [...psseCase.buses.keys()];
  let maxBusId = existingBusIds.length > 0 ? Math.max(...existingBusIds) : 0;
  const defaultBusId = existingBusIds[existingBusIds.length - 1] ?? 1;

  const ensureBus = (ide: 1 | 2 | 3, bx: number, by: number): number => {
    const newId = ++maxBusId;
    const busPos = hasPos ? ` / @pos(${Math.round(bx)}, ${Math.round(by)})` : "";
    const busRec = `${newId}, '${`BUS ${newId}`.padEnd(12)}', 230.0, ${ide}, 1, 1, 1, 1.0000, 0.0000${busPos}`;
    workingText = insertRawRecordInSection(workingText, "BUS", /BEGIN BUS/i, /END OF BUS/i, busRec, true);
    existingBusIds.push(newId);
    return newId;
  };

  if (lower === "psse:bus_pq" || lower === "psse:bus_pv" || lower === "psse:bus_slack" || lower === "bus") {
    const newBusId = maxBusId + 1;
    const ide = lower === "psse:bus_slack" ? 3 : lower === "psse:bus_pv" ? 2 : 1;
    const baseKv = psseCase.buses.get(defaultBusId)?.baseKv || 230.0;
    const posSuffix = posTag ? ` / ${posTag}` : "";
    const record = `${newBusId}, '${`BUS ${newBusId}`.padEnd(12)}', ${baseKv.toFixed(1)}, ${ide}, 1, 1, 1, 1.0000, 0.0000${posSuffix}`;
    return insertRawRecordInSection(workingText, "BUS", /BEGIN BUS/i, /END OF BUS/i, record, true);
  }

  if (lower === "psse:load" || lower === "load") {
    // Dropped components get their own fresh bus so they wait to be connected by the user.
    const targetBus = ensureBus(1, rx, ry - 82);
    const existingIds = new Set(psseCase.loads.filter((l) => l.i === targetBus).map((l) => l.id.trim()));
    let ckt = 1;
    while (existingIds.has(String(ckt))) ckt++;
    const posSuffix = posTag ? ` / ${posTag}` : "";
    const record = `${targetBus}, '${String(ckt).padEnd(2)}', 1, 1, 1, 50.0, 15.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0${posSuffix}`;
    return insertRawRecordInSection(workingText, "LOAD", /BEGIN LOAD/i, /END OF LOAD/i, record);
  }

  if (lower === "psse:fixed_shunt" || lower === "fixed_shunt" || lower.includes("svc") || lower.includes("shunt")) {
    const targetBus = ensureBus(1, rx, ry - 82);
    if (lower === "psse:switched_shunt" || lower === "switched_shunt") {
      const posSuffix = posTag ? ` / ${posTag}` : "";
      const record = `${targetBus}, 1, 1, 1, 1.0200, 0.9800, 0, 100.0, '', 0.000, 1, 25.000${posSuffix}`;
      return insertRawRecordInSection(
        workingText,
        "SWITCHED SHUNT",
        /BEGIN SWITCHED SHUNT/i,
        /END OF SWITCHED SHUNT/i,
        record,
      );
    }
    const existingIds = new Set(psseCase.fixedShunts.filter((s) => s.i === targetBus).map((s) => s.id.trim()));
    let ckt = 1;
    while (existingIds.has(String(ckt))) ckt++;
    const comment = !lower.startsWith("psse:") ? ` /* ${cleanClass} */` : "";
    const posSuffix = posTag ? ` / ${posTag}` : "";
    const record = `${targetBus}, '${String(ckt).padEnd(2)}', 1, 0.000, 25.000${posSuffix}${comment}`;
    return insertRawRecordInSection(workingText, "FIXED SHUNT", /BEGIN FIXED SHUNT/i, /END OF FIXED SHUNT/i, record);
  }

  if (lower === "psse:branch" || lower === "branch") {
    const busA = ensureBus(1, rx - 100, ry);
    const busB = ensureBus(1, rx + 100, ry);
    const existingCkts = new Set(
      psseCase.branches.filter((b) => b.i === busA && Math.abs(b.j) === busB).map((b) => b.ckt.trim()),
    );
    let ckt = 1;
    while (existingCkts.has(String(ckt))) ckt++;
    const record = `${busA}, ${busB}, '${String(ckt).padEnd(2)}', 0.01000, 0.05000, 0.02000, 100.00, 120.00, 140.00, 0.00000, 0.00000, 0.00000, 0.00000, 1, 1, 0.00`;
    return insertRawRecordInSection(
      workingText,
      "BRANCH",
      /BEGIN (?:NON-TRANSFORMER )?BRANCH/i,
      /END OF (?:NON-TRANSFORMER )?BRANCH/i,
      record,
    );
  }

  if (lower === "psse:xfmr_2w" || lower === "psse:xfmr_3w") {
    const needed = lower === "psse:xfmr_3w" ? 3 : 2;
    const busA = ensureBus(1, rx - 100, ry);
    const busB = ensureBus(1, rx + 100, ry);
    const busK = needed === 3 ? ensureBus(1, rx, ry + 120) : 0;
    const recordLines = [
      `${busA}, ${busB}, ${busK}, '1 ', 1, 1, 1, 0.00000, 0.00000, 2, 'XFMR_${busA}_${busB}', 1, 1, 1.0000`,
      `0.00200, 0.08000, 100.00`,
      `1.00000, 0.000, 0.000, 100.00, 120.00, 140.00, 0, 0, 1.10000, 0.90000, 1.10000, 0.90000, 33, 0, 0.00000, 0.00000`,
      `1.00000, 0.000`,
    ];
    if (busK !== 0) {
      recordLines.push(`1.00000, 0.000`);
    }
    return insertRawRecordInSection(
      workingText,
      "TRANSFORMER",
      /BEGIN TRANSFORMER/i,
      /END OF TRANSFORMER/i,
      recordLines.join("\n"),
    );
  }

  // Default for `psse:generator` or any PSSEDynamics.* model: add a generator on the nearest Slack/PV bus
  const targetBus = ensureBus(psseCase.buses.size === 0 ? 3 : 2, rx, ry + 82);
  const existingIds = new Set(psseCase.generators.filter((g) => g.i === targetBus).map((g) => g.id.trim()));
  let ckt = 1;
  while (existingIds.has(String(ckt))) ckt++;
  const modelComment = !lower.startsWith("psse:") ? ` /* ${cleanClass} */` : "";
  const posSuffix = posTag ? ` / ${posTag}` : "";
  const record = `${targetBus}, '${String(ckt).padEnd(2)}', 100.000, 0.000, 50.000, -50.000, 1.0000, 0, 100.00, 0.00000, 0.20000, 0.00000, 0.00000, 1.0000, 1, 100.0, 200.000, 0.000${posSuffix}${modelComment}`;
  return insertRawRecordInSection(workingText, "GENERATOR", /BEGIN GENERATOR/i, /END OF GENERATOR/i, record);
}

/**
 * Deletes one or more PSS/E diagram components (buses, loads, generators, shunts, branches, transformers, or DYR records)
 * from a `.raw` or `.dyr` document and returns the updated source text.
 */
export function deletePsseDiagramComponents(sourceText: string, cellIds: string[]): string {
  if (cellIds.length === 0) return sourceText;

  if (isLikelyDyrContent(sourceText)) {
    const dyr = parseDyr(sourceText);
    const spansToDelete: Array<{ startOffset: number; endOffset: number }> = [];
    for (const cellId of cellIds) {
      if (!cellId.startsWith("dyr_")) continue;
      const parts = cellId.split("_");
      const busNum = Number.parseInt(parts[1] ?? "0", 10);
      const id = parts[2];
      const model = parts.slice(3).join("_");
      for (const rec of dyr.records) {
        if (
          rec.ibus === busNum &&
          (!id || rec.id.trim() === id) &&
          (!model || rec.model.trim() === model) &&
          rec.span?.startOffset !== undefined &&
          rec.span?.endOffset !== undefined
        ) {
          spansToDelete.push({ startOffset: rec.span.startOffset, endOffset: rec.span.endOffset });
        }
      }
    }
    if (spansToDelete.length === 0) return sourceText;
    spansToDelete.sort((a, b) => b.startOffset - a.startOffset);
    let out = sourceText;
    for (const sp of spansToDelete) {
      let end = sp.endOffset;
      if (out[end] === "\r") end++;
      if (out[end] === "\n") end++;
      out = out.slice(0, sp.startOffset) + out.slice(end);
    }
    return out;
  }

  const psseCase = parseRaw(sourceText);
  const spanMap = new Map<string, { startOffset: number; endOffset: number }>();
  const addSpan = (span?: SourceSpan) => {
    if (span && span.startOffset !== undefined && span.endOffset !== undefined) {
      spanMap.set(`${span.startOffset}:${span.endOffset}`, {
        startOffset: span.startOffset,
        endOffset: span.endOffset,
      });
    }
  };

  // Normalize wire_* IDs to the underlying attached element
  const normalizedIds: string[] = [];
  for (const id of cellIds) {
    if (id.startsWith("wire_bus_") && id.includes("_to_load_")) {
      normalizedIds.push(id.slice(id.indexOf("_to_") + 4));
    } else if (id.startsWith("wire_gen_") && id.includes("_to_bus_")) {
      normalizedIds.push(id.slice(5, id.indexOf("_to_bus_")));
    } else if (id.startsWith("wire_bus_") && id.includes("_to_shunt_")) {
      normalizedIds.push(id.slice(id.indexOf("_to_") + 4));
    } else if (id.startsWith("wire_bus_") && id.includes("_to_swshunt_")) {
      normalizedIds.push(id.slice(id.indexOf("_to_") + 4));
    } else {
      normalizedIds.push(id);
    }
  }

  for (const cellId of normalizedIds) {
    if (cellId.startsWith("bus_")) {
      const busId = Number.parseInt(cellId.slice(4), 10);
      addSpan(psseCase.buses.get(busId)?.span);
      for (const l of psseCase.loads) if (l.i === busId) addSpan(l.span);
      for (const g of psseCase.generators) if (g.i === busId) addSpan(g.span);
      for (const s of psseCase.fixedShunts) if (s.i === busId) addSpan(s.span);
      for (const s of psseCase.switchedShunts) if (s.i === busId) addSpan(s.span);
      for (const b of psseCase.branches) if (b.i === busId || Math.abs(b.j) === busId) addSpan(b.span);
      for (const t of psseCase.transformers) if (t.i === busId || t.j === busId || t.k === busId) addSpan(t.span);
    } else if (cellId.startsWith("load_")) {
      const parts = cellId.split("_");
      const busId = Number.parseInt(parts[1] ?? "0", 10);
      const ckt = parts[2]?.trim();
      const load = psseCase.loads.find((l) => l.i === busId && (!ckt || l.id.trim() === ckt));
      addSpan(load?.span);
    } else if (cellId.startsWith("gen_")) {
      const parts = cellId.split("_");
      const busId = Number.parseInt(parts[1] ?? "0", 10);
      const ckt = parts[2]?.trim();
      const gen = psseCase.generators.find((g) => g.i === busId && (!ckt || g.id.trim() === ckt));
      addSpan(gen?.span);
    } else if (cellId.startsWith("shunt_")) {
      const parts = cellId.split("_");
      const busId = Number.parseInt(parts[1] ?? "0", 10);
      const ckt = parts[2]?.trim();
      const shunt = psseCase.fixedShunts.find((s) => s.i === busId && (!ckt || s.id.trim() === ckt));
      addSpan(shunt?.span);
    } else if (cellId.startsWith("swshunt_")) {
      const parts = cellId.split("_");
      const busId = Number.parseInt(parts[1] ?? "0", 10);
      const sw = psseCase.switchedShunts.find((s) => s.i === busId);
      addSpan(sw?.span);
    } else if (cellId.startsWith("branch_") || cellId.startsWith("line_")) {
      const parts = cellId.split("_");
      const iBus = Math.abs(Number.parseInt(parts[1] ?? "0", 10));
      const jBus = Math.abs(Number.parseInt(parts[2] ?? "0", 10));
      const ckt = parts[3]?.trim();
      const br = psseCase.branches.find(
        (b) =>
          ((b.i === iBus && Math.abs(b.j) === jBus) || (b.i === jBus && Math.abs(b.j) === iBus)) &&
          (!ckt || b.ckt.trim() === ckt),
      );
      addSpan(br?.span);
    } else if (cellId.startsWith("xfmr_")) {
      const parts = cellId.split("_");
      const iBus = Math.abs(Number.parseInt(parts[1] ?? "0", 10));
      const jBus = Math.abs(Number.parseInt(parts[2] ?? "0", 10));
      const ckt = parts[3]?.trim();
      const xf = psseCase.transformers.find(
        (x) =>
          ((x.i === iBus && (x.j === jBus || x.k === jBus)) || (x.j === iBus && (x.i === jBus || x.k === jBus))) &&
          (!ckt || x.ckt.trim() === ckt),
      );
      addSpan(xf?.span);
    }
  }

  if (spanMap.size === 0) return sourceText;
  const sorted = [...spanMap.values()].sort((a, b) => b.startOffset - a.startOffset);
  let out = sourceText;
  for (const sp of sorted) {
    let end = sp.endOffset;
    if (out[end] === "\r") end++;
    if (out[end] === "\n") end++;
    out = out.slice(0, sp.startOffset) + out.slice(end);
  }

  // Strip stale `@! @edge <key> vertices=...` annotations referencing deleted cells/edges
  const deletedKeys = new Set<string>([...cellIds, ...normalizedIds]);
  if (out.includes("@edge")) {
    out = out
      .split("\n")
      .filter((line) => {
        const m = /^@!\s*@edge\s+(\S+)\s+vertices=/i.exec(line.trim());
        if (!m) return true;
        const key = m[1]!;
        if (deletedKeys.has(key)) return false;
        const parts = key.split("__");
        if (parts.length === 2 && (deletedKeys.has(parts[0]!) || deletedKeys.has(parts[1]!))) return false;
        return true;
      })
      .join("\n");
  }
  return out;
}

/**
 * Adds an AC branch connecting two buses in a PSS/E `.raw` document.
 */
export function connectPsseDiagramBuses(sourceText: string, sourceCellId: string, targetCellId: string): string {
  const srcBase = sourceCellId.split(".")[0] ?? sourceCellId;
  const tgtBase = targetCellId.split(".")[0] ?? targetCellId;
  const iBus = srcBase.startsWith("bus_") ? Number.parseInt(srcBase.slice(4), 10) : NaN;
  const jBus = tgtBase.startsWith("bus_") ? Number.parseInt(tgtBase.slice(4), 10) : NaN;
  if (!Number.isFinite(iBus) || !Number.isFinite(jBus) || iBus === jBus) return sourceText;

  const psseCase = parseRaw(sourceText);
  const existingCkts = new Set(
    psseCase.branches
      .filter((b) => (b.i === iBus && Math.abs(b.j) === jBus) || (b.i === jBus && Math.abs(b.j) === iBus))
      .map((b) => b.ckt.trim()),
  );
  let ckt = 1;
  while (existingCkts.has(String(ckt))) ckt++;
  const record = `${iBus}, ${jBus}, '${String(ckt).padEnd(2)}', 0.01000, 0.05000, 0.02000, 100.00, 120.00, 140.00, 0.00000, 0.00000, 0.00000, 0.00000, 1, 1, 0.00`;
  return insertRawRecordInSection(
    sourceText,
    "BRANCH",
    /BEGIN (?:NON-TRANSFORMER )?BRANCH/i,
    /END OF (?:NON-TRANSFORMER )?BRANCH/i,
    record,
  );
}

const isPsseEdgeCellId = (id: string): boolean =>
  id.startsWith("branch_") || id.startsWith("line_") || id.startsWith("xfmr_") || id.startsWith("wire_");

const isPsseAttachedEquipmentId = (id: string): boolean =>
  id.startsWith("gen_") || id.startsWith("load_") || id.startsWith("shunt_") || id.startsWith("swshunt_");

/**
 * Removes AC branches/transformers (or a specific edge/equipment lead) in a PSS/E `.raw` document.
 */
export function disconnectPsseDiagramBuses(
  sourceText: string,
  sourceCellId: string,
  targetCellId: string,
  edgeId?: string,
): string {
  const directEdgeId =
    edgeId && isPsseEdgeCellId(edgeId)
      ? edgeId
      : isPsseEdgeCellId(sourceCellId)
        ? sourceCellId
        : isPsseEdgeCellId(targetCellId)
          ? targetCellId
          : undefined;
  if (directEdgeId) {
    return deletePsseDiagramComponents(sourceText, [directEdgeId]);
  }

  const srcBase = sourceCellId.split(".")[0] ?? sourceCellId;
  const tgtBase = targetCellId.split(".")[0] ?? targetCellId;
  if (isPsseAttachedEquipmentId(srcBase) && tgtBase.startsWith("bus_")) {
    return deletePsseDiagramComponents(sourceText, [srcBase]);
  }
  if (isPsseAttachedEquipmentId(tgtBase) && srcBase.startsWith("bus_")) {
    return deletePsseDiagramComponents(sourceText, [tgtBase]);
  }

  const iBus = srcBase.startsWith("bus_") ? Number.parseInt(srcBase.slice(4), 10) : NaN;
  const jBus = tgtBase.startsWith("bus_") ? Number.parseInt(tgtBase.slice(4), 10) : NaN;
  if (!Number.isFinite(iBus) || !Number.isFinite(jBus)) return sourceText;

  const psseCase = parseRaw(sourceText);
  const toDelete: string[] = [];
  for (const b of psseCase.branches) {
    if ((b.i === iBus && Math.abs(b.j) === jBus) || (b.i === jBus && Math.abs(b.j) === iBus)) {
      toDelete.push(`branch_${b.i}_${Math.abs(b.j)}_${b.ckt.trim() || "1"}`);
    }
  }
  for (const t of psseCase.transformers) {
    if ((t.i === iBus && t.j === jBus) || (t.i === jBus && t.j === iBus)) {
      toDelete.push(`xfmr_${t.i}_${t.j}_${t.ckt.trim() || "1"}`);
    }
  }
  return toDelete.length > 0 ? deletePsseDiagramComponents(sourceText, toDelete) : sourceText;
}
