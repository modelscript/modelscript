// SPDX-License-Identifier: AGPL-3.0-or-later

import { parseXmlSync } from "@modelscript/dsl/xml";
import { lintPscx } from "./lints/index.js";
import { registerPscadSource } from "./model/workspace-registry.js";
import { parsePscx } from "./parser/pscx-parser.js";

export interface PscadLspDiagnostic {
  severity: 1 | 2 | 3 | 4;
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  code?: string | undefined;
  message: string;
  source: string;
}

export interface ValidatePscadOptions {
  uri: string;
  wasmTree?: any;
  syntaxLines?: Set<number>;
  workspaceDocs?: Array<{ uri: string; text: string }>;
  positionAt: (offset: number) => { line: number; character: number };
  computeTokenEndCharacter?: (text: string, line: number, col: number) => number;
}

/**
 * Parses and lints a PSCAD project/library XML document, returning the parsed project and LSP diagnostics.
 */
export function validatePscadDocumentCore(
  text: string,
  opts: ValidatePscadOptions,
): { project: any; diagnostics: PscadLspDiagnostic[] } {
  const diagnostics: PscadLspDiagnostic[] = [];
  const syntaxLines = opts.syntaxLines ?? new Set<number>();

  for (const doc of opts.workspaceDocs ?? []) {
    if (/\.(pscx|pslx|pswx|psmx)$/i.test(doc.uri)) {
      registerPscadSource(doc.uri, doc.text);
    }
  }
  registerPscadSource(opts.uri, text);

  const project = parsePscx(text, { cstTree: opts.wasmTree });
  const xmlErrors = project.xmlErrors !== undefined ? project.xmlErrors : parseXmlSync(text).errors;
  if (xmlErrors.length > 0) {
    for (const err of xmlErrors) {
      const start = opts.positionAt(err.start);
      const end = opts.positionAt(Math.max(err.start + 1, err.end));
      if (syntaxLines.has(start.line) && err.code !== "XML-1002" && err.code !== "XML-1003") {
        continue;
      }
      syntaxLines.add(start.line);
      diagnostics.push({
        severity: 1,
        range: { start, end },
        code: err.code ?? "XML-PARSE-ERROR",
        message: err.message || "XML syntax error",
        source: "pscad",
      });
    }
  }

  const lints = lintPscx(project, { tier: "fast" });
  for (const lint of lints) {
    const line = Math.max(0, (lint.line ?? 1) - 1);
    const col = Math.max(0, (lint.column ?? 1) - 1);
    const endLine = Math.max(line, (lint.endLine ?? lint.line ?? 1) - 1);
    const endCol =
      endLine === line
        ? lint.endColumn !== undefined
          ? Math.max(col + 1, lint.endColumn - 1)
          : opts.computeTokenEndCharacter
            ? opts.computeTokenEndCharacter(text, line, col)
            : col + 1
        : Math.max(0, (lint.endColumn ?? 1) - 1);
    diagnostics.push({
      severity: lint.severity === "warning" ? 2 : lint.severity === "info" ? 3 : 1,
      range: {
        start: { line, character: col },
        end: { line: endLine, character: endCol },
      },
      code: lint.code,
      message: `[${lint.code}] ${lint.message}`,
      source: "pscad",
    });
  }

  return { project, diagnostics };
}

export interface PscadCodeLensContext {
  uri?: string | undefined;
  flags?: {
    showSimulate?: boolean | undefined;
    showVerification?: boolean | undefined;
    showDiagram?: boolean | undefined;
  };
}

function computePscadLineOffsets(text: string): number[] {
  const offsets = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") offsets.push(i + 1);
  }
  return offsets;
}

function pscadOffsetToPos(offset: number, lineOffsets: number[]): { line: number; character: number } {
  let low = 0;
  let high = lineOffsets.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lineOffsets[mid]! <= offset) low = mid + 1;
    else high = mid - 1;
  }
  const line = Math.max(0, low - 1);
  return { line, character: offset - (lineOffsets[line] ?? 0) };
}

function getPscadXmlAttr(el: any, ...names: string[]): string | undefined {
  for (const name of names) {
    const lower = name.toLowerCase();
    for (const a of el.attributes ?? []) {
      if (a.name.toLowerCase() === lower) return a.value;
    }
  }
  return undefined;
}

function containsAnyCI(haystack: string, needles: string[]): boolean {
  const lower = haystack.toLowerCase();
  return needles.some((n) => lower.includes(n));
}

/**
 * Generates PSCAD schematic sub-page, line-constants, and IEEE 2800 CodeLenses.
 */
export function getPscadCodeLenses(
  text: string,
  uri: string,
  ctx: PscadCodeLensContext = {},
): {
  lenses: any[];
  appendUniversal: true;
} {
  const lenses: any[] = [];
  if (!text) return { lenses, appendUniversal: true };

  const showSimulate = ctx.flags?.showSimulate ?? false;
  const showVerification = ctx.flags?.showVerification ?? false;
  const showDiagram = ctx.flags?.showDiagram ?? false;

  const xmlDoc = parseXmlSync(text);
  if (xmlDoc.root) {
    const lineOffsets = computePscadLineOffsets(text);
    const walkPscad = (el: any): void => {
      const tag = (el.name.includes(":") ? el.name.slice(el.name.indexOf(":") + 1) : el.name).toLowerCase();
      if (tag === "definition" && showDiagram) {
        const defName = getPscadXmlAttr(el, "name");
        if (defName) {
          const col = text.indexOf(defName, el.start);
          const pos = pscadOffsetToPos(el.start, lineOffsets);
          const namePos = col !== -1 && col < el.end ? pscadOffsetToPos(col, lineOffsets) : pos;
          lenses.push({
            range: { start: namePos, end: { line: namePos.line, character: namePos.character + defName.length } },
            command: {
              title: `⊞ Open Schematic Sub-Page '${defName}'`,
              command: "modelscript.openDiagram",
              arguments: [uri, defName],
            },
          });
        }
      } else if (tag === "user") {
        const defn = getPscadXmlAttr(el, "defn");
        if (defn) {
          const compId = getPscadXmlAttr(el, "id") ?? defn;
          const col = text.indexOf(defn, el.start);
          const pos = pscadOffsetToPos(el.start, lineOffsets);
          const namePos = col !== -1 && col < el.end ? pscadOffsetToPos(col, lineOffsets) : pos;
          const range = { start: namePos, end: { line: namePos.line, character: namePos.character + defn.length } };
          if (containsAnyCI(defn, ["tline", "cable"]) && (showSimulate || showDiagram)) {
            lenses.push({
              range,
              command: {
                title: `🗼 Inspect Line Constants & Tower Geometry (${defn})`,
                command: "modelscript.pscad.inspect_line_constants",
                arguments: [uri, compId],
              },
            });
          } else if (
            containsAnyCI(defn, ["inverter", "ibr", "grid_forming", "vsc", "statcom"]) &&
            (showVerification || showSimulate)
          ) {
            lenses.push({
              range,
              command: {
                title: `✓ Verify IEEE 2800 Ride-Through & Sequence Current (${defn})`,
                command: "modelscript.pscad.verify_ieee2800",
                arguments: [uri, compId],
              },
            });
          }
        }
      }
      for (const child of el.children ?? []) walkPscad(child);
    };
    walkPscad(xmlDoc.root);
  }

  return { lenses, appendUniversal: true };
}
