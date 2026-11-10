// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Language Server Protocol (LSP) services for OGC WaterML 2.0.
 */

import { lintWaterMlDocument } from "./lints/index.js";
import { parseWaterMl } from "./parser/waterml-parser.js";
import type { WaterMlDocument } from "./types.js";

export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
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

export interface LspDiagnosticItem {
  range: LspRange;
  severity: 1 | 2 | 3;
  code?: string | number | undefined;
  source: string;
  message: string;
}

export function getWaterMlDocumentSymbols(content: string): LspDocumentSymbol[] {
  let doc: WaterMlDocument;
  try {
    doc = parseWaterMl(content);
  } catch {
    return [];
  }

  const lines = content.split(/\r?\n/);
  const totalLines = lines.length;

  const defaultRange: LspRange = {
    start: { line: 0, character: 0 },
    end: { line: Math.max(0, totalLines - 1), character: (lines[totalLines - 1] ?? "").length },
  };

  const rootSymbol: LspDocumentSymbol = {
    name: doc.id,
    detail: `WaterML 2.0 Collection (${doc.timeSeriesList.length} Time Series)`,
    kind: LspSymbolKind.Package,
    range: defaultRange,
    selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: doc.id.length } },
    children: [],
  };

  for (let i = 0; i < doc.timeSeriesList.length; i++) {
    const ts = doc.timeSeriesList[i]!;
    const tsSymbol: LspDocumentSymbol = {
      name: `${ts.monitoringPoint.stationId} - ${ts.observedProperty}`,
      detail: `${ts.points.length} points (${ts.unit}, ${ts.interpolationType})`,
      kind: LspSymbolKind.Class,
      range: defaultRange,
      selectionRange: defaultRange,
      children: [
        {
          name: `Station: ${ts.monitoringPoint.stationName}`,
          detail:
            ts.monitoringPoint.latitude !== undefined && ts.monitoringPoint.longitude !== undefined
              ? `Coord: (${ts.monitoringPoint.latitude}, ${ts.monitoringPoint.longitude})`
              : undefined,
          kind: LspSymbolKind.Interface,
          range: defaultRange,
          selectionRange: defaultRange,
        },
        {
          name: `Observations (${ts.points.length})`,
          detail: `Property: ${ts.observedProperty} [${ts.unit}]`,
          kind: LspSymbolKind.Array,
          range: defaultRange,
          selectionRange: defaultRange,
        },
      ],
    };

    rootSymbol.children?.push(tsSymbol);
  }

  return [rootSymbol];
}

export function getWaterMlDiagnostics(content: string): LspDiagnosticItem[] {
  let doc: WaterMlDocument;
  try {
    doc = parseWaterMl(content);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return [
      {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
        severity: 1,
        code: "WML1001",
        source: "waterml-lint",
        message: `WaterML parse error: ${msg}`,
      },
    ];
  }

  const lints = lintWaterMlDocument(doc);
  return lints.map((l) => ({
    range: {
      start: { line: l.sampleIndex !== undefined ? Math.min(l.sampleIndex, 500) : 0, character: 0 },
      end: { line: l.sampleIndex !== undefined ? Math.min(l.sampleIndex, 500) : 0, character: 80 },
    },
    severity: l.severity === "error" ? 1 : l.severity === "warning" ? 2 : 3,
    code: l.code,
    source: "waterml-lint",
    message: l.message,
  }));
}
