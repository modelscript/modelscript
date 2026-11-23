// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Language Server Protocol (LSP) services for EDIF 2.0.0 (`.edf`, `.edif`, `.edn`).
 */

import { lookupEdifModelSchema } from "./catalog/library-package-adapter.js";
import { lintEdif } from "./lints/index.js";
import { parseEdif } from "./parser/edif-parser.js";
import type { EdifDocument, EdifSpan } from "./types.js";

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
  range?: LspRange | undefined;
}

export interface LspCompletionItem {
  label: string;
  kind: number;
  detail?: string | undefined;
  documentation?: string | undefined;
}

export interface LspLocation {
  uri: string;
  range: LspRange;
}

const DEFAULT_RANGE: LspRange = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 1 },
};

function spanToRange(span?: EdifSpan): LspRange {
  if (!span) return DEFAULT_RANGE;
  const startLine = Math.max(0, span.line - 1);
  const startChar = Math.max(0, span.column - 1);
  const endLine = span.endLine ? Math.max(startLine, span.endLine - 1) : startLine;
  const endChar = span.endColumn ? Math.max(0, span.endColumn - 1) : startChar + 1;
  return {
    start: { line: startLine, character: startChar },
    end: { line: endLine, character: endLine === startLine ? Math.max(startChar + 1, endChar) : endChar },
  };
}

/**
 * Validates an EDIF 2.0.0 source document and returns LSP diagnostics.
 */
export function validateEdif(content: string, _uri: string = "design.edf"): LspDiagnostic[] {
  const doc = parseEdif(content);
  const diags = lintEdif(doc);
  return diags.map((d) => {
    const startLine = d.line ? Math.max(0, d.line - 1) : 0;
    const startChar = d.column ? Math.max(0, d.column - 1) : 0;
    const endLine = d.endLine ? Math.max(startLine, d.endLine - 1) : startLine;
    const endChar = d.endColumn ? Math.max(0, d.endColumn - 1) : startChar + 1;
    return {
      range: {
        start: { line: startLine, character: startChar },
        end: { line: endLine, character: endLine === startLine ? Math.max(startChar + 1, endChar) : endChar },
      },
      severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
      code: d.id,
      source: "modelscript-edif",
      message: d.message,
    };
  });
}

/**
 * Extracts hierarchical LSP document symbols (edif -> libraries -> cells -> views -> ports/instances/nets).
 */
export function getEdifDocumentSymbols(content: string): LspDocumentSymbol[] {
  const doc: EdifDocument = parseEdif(content);
  const children: LspDocumentSymbol[] = [];

  for (const lib of [...doc.externals, ...doc.libraries]) {
    const cellSymbols: LspDocumentSymbol[] = lib.cells.map((cell) => {
      const viewSymbols: LspDocumentSymbol[] = cell.views.map((view) => {
        const viewChildren: LspDocumentSymbol[] = [
          ...view.ports.map((p) => ({
            name: p.name,
            detail: p.direction ?? "PORT",
            kind: LspSymbolKind.Interface,
            range: spanToRange(p.span),
            selectionRange: spanToRange(p.span),
          })),
          ...view.instances.map((inst) => ({
            name: inst.name,
            detail: inst.viewRef.cellName ? `instance of ${inst.viewRef.cellName}` : "instance",
            kind: LspSymbolKind.Field,
            range: spanToRange(inst.span),
            selectionRange: spanToRange(inst.span),
          })),
          ...view.nets.map((net) => ({
            name: net.name,
            detail: `net (${net.joined.length} pins)`,
            kind: LspSymbolKind.Variable,
            range: spanToRange(net.span),
            selectionRange: spanToRange(net.span),
          })),
        ];

        return {
          name: view.name,
          detail: view.viewType,
          kind: LspSymbolKind.Module,
          range: spanToRange(view.span),
          selectionRange: spanToRange(view.span),
          children: viewChildren,
        };
      });

      return {
        name: cell.name,
        detail: cell.cellType,
        kind: LspSymbolKind.Class,
        range: spanToRange(cell.span),
        selectionRange: spanToRange(cell.span),
        children: viewSymbols,
      };
    });

    children.push({
      name: lib.name,
      detail: lib.isExternal ? "external" : "library",
      kind: LspSymbolKind.Package,
      range: spanToRange(lib.span),
      selectionRange: spanToRange(lib.span),
      children: cellSymbols,
    });
  }

  if (doc.design) {
    children.push({
      name: doc.design.name,
      detail: `design -> ${doc.design.cellName}`,
      kind: LspSymbolKind.Constructor,
      range: spanToRange(doc.design.span),
      selectionRange: spanToRange(doc.design.span),
    });
  }

  return [
    {
      name: doc.name,
      detail: doc.edifVersion ? `EDIF ${doc.edifVersion.join(".")}` : "EDIF",
      kind: LspSymbolKind.File,
      range: spanToRange(doc.span),
      selectionRange: spanToRange(doc.span),
      children,
    },
  ];
}

const EDIF_KEYWORDS: ReadonlyArray<{ label: string; detail: string; doc: string }> = [
  { label: "edif", detail: "EDIF 2.0.0 root form", doc: "Top-level EDIF interchange file container." },
  { label: "edifVersion", detail: "(edifVersion 2 0 0)", doc: "Declares the EDIF specification version." },
  { label: "edifLevel", detail: "(edifLevel 0)", doc: "Declares the EDIF compliance level (0, 1, or 2)." },
  { label: "keywordMap", detail: "(keywordMap (keywordLevel 0))", doc: "Keyword aliasing table." },
  { label: "status", detail: "(status (written ...))", doc: "File provenance and timestamp metadata." },
  { label: "external", detail: "(external <name> ...)", doc: "External library of primitive cells." },
  { label: "library", detail: "(library <name> ...)", doc: "Design library containing cells." },
  { label: "technology", detail: "(technology ...)", doc: "Technology scaling and grid definitions." },
  { label: "cell", detail: "(cell <name> ...)", doc: "Circuit module or primitive definition." },
  { label: "cellType", detail: "(cellType GENERIC)", doc: "Classifies a cell (GENERIC, RIPPER, TIE)." },
  { label: "view", detail: "(view <name> ...)", doc: "Representation of a cell (NETLIST, SCHEMATIC, SYMBOL)." },
  { label: "viewType", detail: "(viewType NETLIST)", doc: "Type of a cell view." },
  { label: "interface", detail: "(interface (port ...) ...)", doc: "External pin interface of a view." },
  { label: "port", detail: "(port <name> (direction ...))", doc: "Named connection port on a cell interface." },
  { label: "direction", detail: "(direction INPUT|OUTPUT|INOUT)", doc: "Signal flow direction of a port." },
  {
    label: "contents",
    detail: "(contents (instance ...) (net ...))",
    doc: "Internal netlist implementation of a view.",
  },
  { label: "instance", detail: "(instance <name> (viewRef ...))", doc: "Instantiation of a cell view." },
  { label: "viewRef", detail: "(viewRef <v> (cellRef <c> ...))", doc: "Reference to a target cell view." },
  { label: "cellRef", detail: "(cellRef <c> (libraryRef <l>))", doc: "Reference to a cell in a library." },
  { label: "libraryRef", detail: "(libraryRef <l>)", doc: "Reference to a library or external." },
  { label: "net", detail: "(net <name> (joined ...))", doc: "Electrical connection node joining portRefs." },
  { label: "joined", detail: "(joined (portRef ...) ...)", doc: "List of connected pins on a net." },
  { label: "portRef", detail: "(portRef <p> (instanceRef <i>))", doc: "Reference to a port on an instance or parent." },
  { label: "instanceRef", detail: "(instanceRef <i>)", doc: "Reference to an instance in the current contents." },
  { label: "property", detail: "(property <name> <value>)", doc: "Key-value electrical or metadata property." },
  { label: "design", detail: "(design <name> (cellRef ...))", doc: "Top-level design root selection." },
  { label: "rename", detail: '(rename <id> "<orig>")', doc: "Maps an EDIF identifier to its original display name." },
];

function getWordAtPosition(content: string, position: LspPosition): string | undefined {
  const lines = content.split(/\r?\n/);
  const lineText = lines[position.line];
  if (!lineText) return undefined;
  let start = Math.min(position.character, lineText.length);
  let end = start;
  const isWord = (c: string): boolean => /[A-Za-z0-9_&$-]/.test(c);
  while (start > 0 && isWord(lineText[start - 1]!)) start--;
  while (end < lineText.length && isWord(lineText[end]!)) end++;
  const word = lineText.slice(start, end);
  return word.length > 0 ? word : undefined;
}

/**
 * Provides Markdown hover information for EDIF keywords, standard cells, and user-defined cells/instances/nets.
 */
export function getEdifHover(content: string, position: LspPosition): LspHover | null {
  const word = getWordAtPosition(content, position);
  if (!word) return null;

  // Check standard library cell
  const stdSchema = lookupEdifModelSchema(word);
  if (stdSchema) {
    const portList = stdSchema.ports.map((p) => `\`${p.name}\``).join(", ");
    return {
      contents: {
        kind: "markdown",
        value: `**${stdSchema.label}** (\`${stdSchema.namePath}\`)\n\n${stdSchema.description}\n\n- **Category**: ${stdSchema.category}\n- **Ports**: ${portList}`,
      },
    };
  }

  // Check EDIF keyword
  const kw = EDIF_KEYWORDS.find((k) => k.label.toLowerCase() === word.toLowerCase());
  if (kw) {
    return {
      contents: {
        kind: "markdown",
        value: `**EDIF 2.0.0 Keyword** \`${kw.label}\`\n\nSyntax: \`${kw.detail}\`\n\n${kw.doc}`,
      },
    };
  }

  // Check user-defined cells, instances, and nets
  const doc = parseEdif(content);
  for (const lib of [...doc.externals, ...doc.libraries]) {
    if (lib.name.toLowerCase() === word.toLowerCase()) {
      return {
        contents: {
          kind: "markdown",
          value: `**EDIF ${lib.isExternal ? "External" : "Library"}** \`${lib.name}\`\n\nContains ${lib.cells.length} cell(s).`,
        },
      };
    }
    for (const cell of lib.cells) {
      if (cell.name.toLowerCase() === word.toLowerCase()) {
        return {
          contents: {
            kind: "markdown",
            value: `**EDIF Cell** \`${lib.name}.${cell.name}\` (\`${cell.cellType}\`)\n\nViews: ${cell.views.map((v) => `\`${v.name}\``).join(", ") || "none"}`,
          },
        };
      }
      for (const view of cell.views) {
        const inst = view.instances.find((i) => i.name.toLowerCase() === word.toLowerCase());
        if (inst) {
          return {
            contents: {
              kind: "markdown",
              value: `**EDIF Instance** \`${inst.name}\`\n\nCell: \`${inst.viewRef.cellName ?? "unknown"}\` (view \`${inst.viewRef.viewName}\`)`,
            },
          };
        }
        const net = view.nets.find((n) => n.name.toLowerCase() === word.toLowerCase());
        if (net) {
          return {
            contents: {
              kind: "markdown",
              value: `**EDIF Net** \`${net.name}\`\n\nConnected pins: ${net.joined.length}`,
            },
          };
        }
      }
    }
  }

  return null;
}

/**
 * Provides completion items for EDIF 2.0.0 keywords and in-scope cells/libraries.
 */
export function getEdifCompletions(content: string): LspCompletionItem[] {
  const doc = parseEdif(content);
  const items: LspCompletionItem[] = EDIF_KEYWORDS.map((k) => ({
    label: k.label,
    kind: 14, // Keyword
    detail: k.detail,
    documentation: k.doc,
  }));

  for (const lib of [...doc.externals, ...doc.libraries]) {
    items.push({
      label: lib.name,
      kind: 9, // Module
      detail: lib.isExternal ? "EDIF external" : "EDIF library",
    });
    for (const cell of lib.cells) {
      items.push({
        label: cell.name,
        kind: 7, // Class
        detail: `${lib.name}.${cell.name} (${cell.cellType})`,
      });
    }
  }

  return items;
}

/**
 * Resolves go-to-definition for cell/library/instance names in an EDIF document.
 */
export function getEdifDefinition(
  content: string,
  position: LspPosition,
  uri: string = "design.edf",
): LspLocation | null {
  const word = getWordAtPosition(content, position);
  if (!word) return null;
  const doc = parseEdif(content);

  for (const lib of [...doc.externals, ...doc.libraries]) {
    if (lib.name.toLowerCase() === word.toLowerCase() && lib.span) {
      return { uri, range: spanToRange(lib.span) };
    }
    for (const cell of lib.cells) {
      if (cell.name.toLowerCase() === word.toLowerCase() && cell.span) {
        return { uri, range: spanToRange(cell.span) };
      }
      for (const view of cell.views) {
        for (const inst of view.instances) {
          if (inst.name.toLowerCase() === word.toLowerCase() && inst.span) {
            return { uri, range: spanToRange(inst.span) };
          }
        }
      }
    }
  }

  return null;
}
