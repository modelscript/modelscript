// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Language Server Protocol (LSP) services for COMTRADE disturbance records.
 */

import { lintComtradeRecord } from "./lints/index.js";
import { parseComtradeCff, parseComtradeCfg } from "./parser/comtrade-reader.js";
import type { ComtradeAnalogChannel, ComtradeConfig, ComtradeDigitalChannel, ComtradeRecord } from "./types.js";

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

export function getComtradeDocumentSymbols(content: string, uri?: string): LspDocumentSymbol[] {
  let cfg: ComtradeConfig;
  try {
    if (uri?.endsWith(".cff") || content.includes("--- file type: CFG ---")) {
      const rec = parseComtradeCff(content);
      const c = rec.config ?? rec.cfg;
      if (!c) return [];
      cfg = c;
    } else {
      cfg = parseComtradeCfg(content);
    }
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
    name: `${cfg.stationName} (${cfg.recDevId || "COMTRADE"})`,
    detail: `IEEE C37.111-${cfg.revYear} (${cfg.analogCount}A, ${cfg.digitalCount}D)`,
    kind: LspSymbolKind.Class,
    range: defaultRange,
    selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: cfg.stationName.length } },
    children: [],
  };

  const analogList = cfg.analogChannels ?? cfg.analogs ?? [];
  const analogSymbols: LspDocumentSymbol[] = analogList.map((an: ComtradeAnalogChannel, i: number) => {
    const lineIndex = Math.min(2 + i, totalLines - 1);
    const range: LspRange = {
      start: { line: lineIndex, character: 0 },
      end: { line: lineIndex, character: (lines[lineIndex] ?? "").length },
    };
    return {
      name: `${an.index}: ${an.chId ?? an.name}`,
      detail: `${an.phase || "-"} | ${an.ccbm || ""} | Unit: ${an.uu ?? an.unit} (scale: ${an.a ?? an.multiplierA}x + ${an.b ?? an.offsetB})`,
      kind: LspSymbolKind.Field,
      range,
      selectionRange: range,
    };
  });

  if (analogSymbols.length > 0) {
    rootSymbol.children?.push({
      name: `Analog Channels (${cfg.analogCount ?? analogList.length})`,
      detail: "Current, Voltage, Frequency, Power",
      kind: LspSymbolKind.Namespace,
      range: defaultRange,
      selectionRange: defaultRange,
      children: analogSymbols,
    });
  }

  const digitalList = cfg.digitalChannels ?? cfg.digitals ?? [];
  const digitalSymbols: LspDocumentSymbol[] = digitalList.map((dg: ComtradeDigitalChannel, i: number) => {
    const lineIndex = Math.min(2 + (cfg.analogCount ?? analogList.length) + i, totalLines - 1);
    const range: LspRange = {
      start: { line: lineIndex, character: 0 },
      end: { line: lineIndex, character: (lines[lineIndex] ?? "").length },
    };
    return {
      name: `${dg.index}: ${dg.chId ?? dg.name}`,
      detail: `${dg.phase || "-"} | ${dg.ccbm || ""} (normal: ${dg.normalState})`,
      kind: LspSymbolKind.Boolean,
      range,
      selectionRange: range,
    };
  });

  if (digitalSymbols.length > 0) {
    rootSymbol.children?.push({
      name: `Digital Channels (${cfg.digitalCount ?? digitalList.length})`,
      detail: "Breaker Status, Protection Trip, Relay Flags",
      kind: LspSymbolKind.Namespace,
      range: defaultRange,
      selectionRange: defaultRange,
      children: digitalSymbols,
    });
  }

  return [rootSymbol];
}

export function getComtradeDiagnostics(content: string, uri?: string): LspDiagnosticItem[] {
  let record: ComtradeRecord;
  try {
    if (uri?.endsWith(".cff") || content.includes("--- file type: CFG ---")) {
      record = parseComtradeCff(content);
    } else {
      const cfg = parseComtradeCfg(content);
      const analogList = cfg.analogChannels ?? cfg.analogs ?? [];
      const digitalList = cfg.digitalChannels ?? cfg.digitals ?? [];
      record = {
        config: cfg,
        cfg,
        timeSec: new Float64Array(0),
        analogData: analogList.map(() => []),
        digitalData: digitalList.map(() => []),
        timestamps: [],
      };
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return [
      {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
        severity: 1,
        code: "CT1001",
        source: "comtrade-lint",
        message: `COMTRADE parse error: ${msg}`,
      },
    ];
  }

  const lints = lintComtradeRecord(record);
  return lints.map((l) => ({
    range: {
      start: { line: l.line ? l.line - 1 : 0, character: 0 },
      end: { line: l.line ? l.line - 1 : 0, character: 100 },
    },
    severity: l.severity === "error" ? 1 : l.severity === "warning" ? 2 : 3,
    code: l.code,
    source: "comtrade-lint",
    message: l.message,
  }));
}
