// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/iges — Language Server Protocol (LSP) Providers.
 *
 * Provides diagnostics, document symbols, hover documentation, and completions for IGES 5.3 files.
 */

import { getIgesSchemasFromLibraries, lookupIgesEntitySchema } from "./catalog/library-package-adapter.js";
import { lintIges } from "./lints/index.js";
import { parseIges } from "./parser/iges-parser.js";
import { IGES_ENTITY_TYPE_NAMES, IGES_UNIT_NAMES } from "./types.js";

export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export const LspSymbolKind = {
  File: 1,
  Module: 2,
  Package: 4,
  Class: 5,
  Property: 7,
  Constant: 14,
  Struct: 23,
} as const;

export type LspSymbolKind = (typeof LspSymbolKind)[keyof typeof LspSymbolKind];

export interface LspDocumentSymbol {
  name: string;
  detail?: string;
  kind: LspSymbolKind;
  range: LspRange;
  selectionRange: LspRange;
  children?: LspDocumentSymbol[];
}

export interface LspDiagnostic {
  range: LspRange;
  severity: 1 | 2 | 3 | 4;
  code: string;
  source: string;
  message: string;
}

export interface LspHover {
  contents: {
    kind: "markdown" | "plaintext";
    value: string;
  };
  range?: LspRange;
}

export interface LspCompletionItem {
  label: string;
  detail?: string;
  documentation?: string;
  insertText?: string;
}

/**
 * Validate an IGES 5.3 file and return LSP diagnostics.
 */
export function validateIges(content: string, _uri = "model.igs"): LspDiagnostic[] {
  const doc = parseIges(content);
  const diags = lintIges(doc);
  const lines = content.split(/\r?\n/);

  return diags.map((d) => {
    const lineIdx = Math.max(0, d.line - 1);
    const lineText = lines[lineIdx] ?? "";
    const startChar = d.column ? Math.max(0, d.column - 1) : 0;
    const endChar = Math.max(startChar + 1, Math.min(lineText.length, startChar + 8));
    return {
      range: {
        start: { line: lineIdx, character: startChar },
        end: { line: lineIdx, character: endChar },
      },
      severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
      code: d.id,
      source: "modelscript-iges",
      message: d.message,
    };
  });
}

/**
 * Return hierarchical LSP document symbols for an IGES 5.3 file.
 */
export function getIgesDocumentSymbols(content: string): LspDocumentSymbol[] {
  const doc = parseIges(content);
  const totalLines = Math.max(1, doc.rawLines.length);

  const entityChildren: LspDocumentSymbol[] = [];
  for (const [deNum, de] of doc.directoryEntries) {
    const typeName = IGES_ENTITY_TYPE_NAMES[de.entityType] ?? `Type ${de.entityType}`;
    const startLine = Math.max(0, de.startLine - 1);
    const endLine = Math.max(startLine, de.endLine - 1);
    const range: LspRange = {
      start: { line: startLine, character: 0 },
      end: { line: endLine, character: 80 },
    };
    entityChildren.push({
      name: de.entityLabel ? `${de.entityLabel} (D${deNum})` : `D${deNum}`,
      detail: `Type ${de.entityType} — ${typeName}`,
      kind: LspSymbolKind.Struct,
      range,
      selectionRange: {
        start: { line: startLine, character: 0 },
        end: { line: startLine, character: 8 },
      },
    });
  }

  const rootName = doc.global?.productIdSender || doc.global?.fileName || "IGES Model";
  const unitName = doc.global ? (IGES_UNIT_NAMES[doc.global.unitFlag] ?? doc.global.unitName) : "UNKNOWN";

  return [
    {
      name: rootName,
      detail: `IGES 5.3 (${doc.entities.length} entities, units: ${unitName})`,
      kind: LspSymbolKind.Package,
      range: {
        start: { line: 0, character: 0 },
        end: { line: totalLines - 1, character: 80 },
      },
      selectionRange: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 80 },
      },
      children: entityChildren,
    },
  ];
}

/**
 * Provide rich Markdown hover documentation for an IGES 5.3 line/position.
 */
export function getIgesHover(content: string, position: LspPosition): LspHover | null {
  const doc = parseIges(content);
  const lineNumber = position.line + 1;
  const rawLine = doc.rawLines[position.line];
  if (!rawLine) return null;

  if (rawLine.sectionCode === "S") {
    return {
      contents: {
        kind: "markdown",
        value: `**IGES Start Section (\`S\`)** — Human-readable prologue comment (line ${lineNumber}).`,
      },
    };
  }

  if (rawLine.sectionCode === "G" && doc.global) {
    return {
      contents: {
        kind: "markdown",
        value:
          `**IGES Global Section (\`G\`)**\n\n` +
          `- **Product**: \`${doc.global.productIdSender || "—"}\`\n` +
          `- **File**: \`${doc.global.fileName || "—"}\`\n` +
          `- **Units**: Flag \`${doc.global.unitFlag}\` (\`${doc.global.unitName}\`)\n` +
          `- **Delimiters**: param=\`${doc.global.parameterDelimiter}\`, record=\`${doc.global.recordDelimiter}\``,
      },
    };
  }

  if (rawLine.sectionCode === "T" && doc.terminate) {
    return {
      contents: {
        kind: "markdown",
        value:
          `**IGES Terminate Section (\`T\`)**\n\n` +
          `Declared section counts: \`S=${doc.terminate.startCount}\`, \`G=${doc.terminate.globalCount}\`, \`D=${doc.terminate.directoryCount}\`, \`P=${doc.terminate.parameterCount}\`.`,
      },
    };
  }

  if (rawLine.sectionCode === "D") {
    for (const [deNum, de] of doc.directoryEntries) {
      if (lineNumber >= de.startLine && lineNumber <= de.endLine) {
        const schema = lookupIgesEntitySchema(de.entityType);
        const typeName = IGES_ENTITY_TYPE_NAMES[de.entityType] ?? `Type ${de.entityType}`;
        return {
          contents: {
            kind: "markdown",
            value:
              `**Directory Entry \`D${deNum}\` — Type \`${de.entityType}\` (${typeName})**\n\n` +
              (schema ? `${schema.description}\n\n_Reference: ${schema.provenance}_` : ""),
          },
          range: {
            start: { line: position.line, character: 0 },
            end: { line: position.line, character: 80 },
          },
        };
      }
    }
  }

  if (rawLine.sectionCode === "P") {
    for (const [dePtr, prec] of doc.parameterRecords) {
      if (lineNumber >= prec.startLine && lineNumber <= prec.endLine) {
        const schema = lookupIgesEntitySchema(prec.entityType);
        const typeName = IGES_ENTITY_TYPE_NAMES[prec.entityType] ?? `Type ${prec.entityType}`;
        return {
          contents: {
            kind: "markdown",
            value:
              `**Parameter Data for \`D${dePtr}\` — Type \`${prec.entityType}\` (${typeName})**\n\n` +
              `Fields: \`${prec.fields.length}\`` +
              (schema ? `\n\n${schema.description}` : ""),
          },
        };
      }
    }
  }

  return null;
}

/**
 * Provide IGES 5.3 entity type & unit preset completion items.
 */
export function getIgesCompletions(): LspCompletionItem[] {
  const schemas = getIgesSchemasFromLibraries();
  return schemas.map((s) => ({
    label: s.name,
    detail: s.label,
    documentation: `${s.description} (${s.provenance})`,
    insertText: s.aliases?.[0] ?? s.name,
  }));
}
