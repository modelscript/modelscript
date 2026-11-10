// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Language Server Protocol (LSP) services for IEC 61850 SCL documents.
 */

import { lintSclDocument } from "./lints/index.js";
import { parseSclXml } from "./parser/scl-parser.js";
import type { SclDocument } from "./types.js";

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

export function getSclDocumentSymbols(content: string): LspDocumentSymbol[] {
  let doc: SclDocument;
  try {
    doc = parseSclXml(content);
  } catch {
    return [];
  }

  const lines = content.split(/\r?\n/);
  const totalLines = lines.length;
  const defaultRange: LspRange = {
    start: { line: 0, character: 0 },
    end: { line: Math.max(0, totalLines - 1), character: (lines[totalLines - 1] ?? "").length },
  };

  const symbols: LspDocumentSymbol[] = [];

  // 1. Substation tree
  if (doc.substation) {
    const s = doc.substation;
    const sSymbol: LspDocumentSymbol = {
      name: s.name,
      detail: `Substation (${s.voltageLevels.length} Voltage Levels)`,
      kind: LspSymbolKind.Class,
      range: defaultRange,
      selectionRange: defaultRange,
      children: [],
    };

    for (const vl of s.voltageLevels) {
      const vlSymbol: LspDocumentSymbol = {
        name: vl.name,
        detail: `${vl.nominalVoltageKv ?? 110} kV (${vl.bays.length} Bays)`,
        kind: LspSymbolKind.Namespace,
        range: defaultRange,
        selectionRange: defaultRange,
        children: [],
      };

      for (const bay of vl.bays) {
        const baySymbol: LspDocumentSymbol = {
          name: bay.name,
          detail: `Bay (${bay.conductingEquipment.length} Equipment)`,
          kind: LspSymbolKind.Module,
          range: defaultRange,
          selectionRange: defaultRange,
          children: bay.conductingEquipment.map((ce) => ({
            name: `${ce.name} [${ce.type}]`,
            detail: ce.desc ?? ce.type,
            kind: ce.type === "CBR" ? LspSymbolKind.Event : LspSymbolKind.Field,
            range: defaultRange,
            selectionRange: defaultRange,
          })),
        };
        vlSymbol.children?.push(baySymbol);
      }
      sSymbol.children?.push(vlSymbol);
    }
    symbols.push(sSymbol);
  }

  // 2. IED tree
  if (doc.ieds.size > 0) {
    const iedGroup: LspDocumentSymbol = {
      name: `Intelligent Electronic Devices (${doc.ieds.size} IEDs)`,
      detail: "Substation Protection, Automation & Control",
      kind: LspSymbolKind.Package,
      range: defaultRange,
      selectionRange: defaultRange,
      children: [],
    };

    for (const [iedName, ied] of doc.ieds) {
      const iedSymbol: LspDocumentSymbol = {
        name: iedName,
        detail: `${ied.type ?? "Relay"} (${ied.manufacturer ?? "IEC 61850"})`,
        kind: LspSymbolKind.Interface,
        range: defaultRange,
        selectionRange: defaultRange,
        children: [],
      };

      for (const [apName, ap] of ied.accessPoints) {
        if (!ap.server) continue;
        for (const [ldInst, ld] of ap.server.logicalDevices) {
          const ldSymbol: LspDocumentSymbol = {
            name: `${apName}/${ldInst}`,
            detail: `Logical Device (${ld.logicalNodes.size} Logical Nodes)`,
            kind: LspSymbolKind.Struct,
            range: defaultRange,
            selectionRange: defaultRange,
            children: Array.from(ld.logicalNodes.values()).map((ln) => ({
              name: ln.prefix ? `${ln.prefix}${ln.lnClass}${ln.inst}` : `${ln.lnClass}${ln.inst}`,
              detail: `${ln.lnClass} (${ln.lnType})`,
              kind: ln.lnClass.startsWith("P") ? LspSymbolKind.Event : LspSymbolKind.Method,
              range: defaultRange,
              selectionRange: defaultRange,
            })),
          };
          iedSymbol.children?.push(ldSymbol);
        }
      }
      iedGroup.children?.push(iedSymbol);
    }
    symbols.push(iedGroup);
  }

  return symbols;
}

export function getSclDiagnostics(content: string): LspDiagnosticItem[] {
  if (!content.includes("<SCL") && !content.includes("<Header") && !content.includes("<Substation")) {
    return [
      {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
        severity: 1,
        code: "SCL1001",
        source: "scl-lint",
        message: "Invalid SCL file: missing root <SCL> or <Header> element.",
      },
    ];
  }

  let doc: SclDocument;
  try {
    doc = parseSclXml(content);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return [
      {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
        severity: 1,
        code: "SCL1001",
        source: "scl-lint",
        message: `SCL XML parse error: ${msg}`,
      },
    ];
  }

  const diags = lintSclDocument(doc);
  return diags.map((d) => ({
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 80 } },
    severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
    code: d.code,
    source: "scl-lint",
    message: d.message,
  }));
}
