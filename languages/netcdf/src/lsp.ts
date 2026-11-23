// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/netcdf — Language Server Protocol (LSP) Services.
 *
 * Provides diagnostics (`validateNetcdf`), document symbols (`getNetcdfDocumentSymbols`),
 * hover documentation (`getNetcdfHover`), and completions (`getNetcdfCompletions`).
 */

import { lookupNetcdfModelSchema } from "./catalog/library-package-adapter.js";
import { lintNetcdf } from "./lints/index.js";
import { parseCdl } from "./parser/cdl-parser.js";
import { computeFieldStats, computeVariableShape, unpackVariableValues } from "./solver/field-ops.js";

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
  Property = 7,
  Field = 8,
  Variable = 13,
  Constant = 14,
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
  kind: number; // 6 = Variable, 14 = Keyword, 10 = Property, 25 = TypeParameter
  detail?: string | undefined;
  documentation?: string | undefined;
  insertText?: string | undefined;
}

function makeLineRange(lineOneBased: number | undefined, colOneBased: number | undefined, len = 1): LspRange {
  const line = Math.max(0, (lineOneBased ?? 1) - 1);
  const startChar = Math.max(0, (colOneBased ?? 1) - 1);
  return {
    start: { line, character: startChar },
    end: { line, character: startChar + Math.max(1, len) },
  };
}

/**
 * Validates a NetCDF CDL document and returns LSP diagnostics.
 */
export function validateNetcdf(content: string, _uri = "dataset.cdl"): LspDiagnostic[] {
  const dataset = parseCdl(content);
  const lints = lintNetcdf(dataset);
  const lines = content.split(/\r?\n/);

  return lints.map((d) => {
    const lineIdx = Math.max(0, (d.line ?? 1) - 1);
    const lineText = lines[lineIdx] ?? "";
    const startChar = Math.max(0, (d.column ?? 1) - 1);
    const tokLen = d.symbolName ? d.symbolName.length : Math.max(1, lineText.trim().length);
    return {
      range: {
        start: { line: lineIdx, character: startChar },
        end: {
          line: lineIdx,
          character: Math.min(Math.max(startChar + 1, startChar + tokLen), Math.max(startChar + 1, lineText.length)),
        },
      },
      severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
      code: d.code,
      source: "modelscript-netcdf",
      message: d.message,
    };
  });
}

/**
 * Returns hierarchical LSP document symbols for a NetCDF CDL file (dataset → dimensions, variables, global attributes).
 */
export function getNetcdfDocumentSymbols(content: string): LspDocumentSymbol[] {
  const dataset = parseCdl(content);
  const lines = content.split(/\r?\n/);
  const fullRange: LspRange = {
    start: { line: 0, character: 0 },
    end: { line: Math.max(0, lines.length - 1), character: lines[lines.length - 1]?.length ?? 0 },
  };

  const children: LspDocumentSymbol[] = [];

  for (const dim of dataset.dimensions) {
    const r = makeLineRange(dim.line, dim.column, dim.name.length);
    children.push({
      name: dim.name,
      detail: dim.isUnlimited ? `UNLIMITED (${dim.size} currently)` : `dim = ${dim.size}`,
      kind: LspSymbolKind.Constant,
      range: r,
      selectionRange: r,
    });
  }

  for (const v of dataset.variables) {
    const r = makeLineRange(v.line, v.column, v.name.length);
    const attrChildren: LspDocumentSymbol[] = v.attributes.map((a) => {
      const ar = makeLineRange(a.line ?? v.line, a.column ?? v.column, a.name.length);
      return {
        name: `${v.name}:${a.name}`,
        detail: Array.isArray(a.value) ? a.value.join(", ") : String(a.value),
        kind: LspSymbolKind.Property,
        range: ar,
        selectionRange: ar,
      };
    });
    children.push({
      name: v.name,
      detail: `${v.type}(${v.dimensions.join(", ")})`,
      kind: LspSymbolKind.Variable,
      range: r,
      selectionRange: r,
      children: attrChildren.length > 0 ? attrChildren : undefined,
    });
  }

  for (const ga of dataset.globalAttributes) {
    const r = makeLineRange(ga.line, ga.column, ga.name.length + 1);
    children.push({
      name: `:${ga.name}`,
      detail: Array.isArray(ga.value) ? ga.value.join(", ") : String(ga.value),
      kind: LspSymbolKind.Property,
      range: r,
      selectionRange: r,
    });
  }

  return [
    {
      name: dataset.name,
      detail: `NetCDF ${dataset.format} (${dataset.dimensions.length} dims, ${dataset.variables.length} vars)`,
      kind: LspSymbolKind.Package,
      range: fullRange,
      selectionRange: makeLineRange(1, 1, dataset.name.length),
      children,
    },
  ];
}

function wordAtPosition(content: string, position: LspPosition): string {
  const lines = content.split(/\r?\n/);
  const line = lines[position.line] ?? "";
  if (position.character < 0 || position.character > line.length) return "";
  let start = position.character;
  let end = position.character;
  while (start > 0 && /[A-Za-z0-9_.-]/.test(line[start - 1]!)) start--;
  while (end < line.length && /[A-Za-z0-9_.-]/.test(line[end]!)) end++;
  return line.slice(start, end);
}

/**
 * Returns Markdown hover information for dimensions, variables, CF-1.x standard names, and NetCDF types.
 */
export function getNetcdfHover(content: string, position: LspPosition): LspHover | null {
  const word = wordAtPosition(content, position);
  if (!word) return null;

  const dataset = parseCdl(content);

  // 1. Variable in current dataset
  const variable = dataset.variables.find((v) => v.name === word);
  if (variable) {
    const shape = computeVariableShape(dataset, variable);
    const lines: string[] = [
      `**NetCDF Variable** \`${variable.type} ${variable.name}(${variable.dimensions.join(", ")})\``,
      `- **Shape:** \`[${shape.join(" × ")}]\``,
    ];
    for (const a of variable.attributes) {
      lines.push(`- **${a.name}:** \`${Array.isArray(a.value) ? a.value.join(", ") : String(a.value)}\``);
    }
    if (variable.type !== "char" && variable.data && variable.data.length > 0) {
      const stats = computeFieldStats(unpackVariableValues(variable));
      if (stats.validCount > 0) {
        lines.push(
          `- **Stats:** min=\`${stats.min.toFixed(4)}\`, max=\`${stats.max.toFixed(4)}\`, mean=\`${stats.mean.toFixed(4)}\`, std=\`${stats.std.toFixed(4)}\``,
        );
      }
    }
    return { contents: { kind: "markdown", value: lines.join("\n") } };
  }

  // 2. Dimension in current dataset
  const dim = dataset.dimensions.find((d) => d.name === word);
  if (dim) {
    return {
      contents: {
        kind: "markdown",
        value: `**NetCDF Dimension** \`${dim.name}\`\n\n- **Size:** \`${dim.isUnlimited ? `UNLIMITED (${dim.size} currently)` : dim.size}\``,
      },
    };
  }

  // 3. Cleanroom CF-1.x / NetCDF Classic data type schema lookup
  const schema = lookupNetcdfModelSchema(word);
  if (schema) {
    return {
      contents: {
        kind: "markdown",
        value: `**${schema.label}** (\`${schema.namePath}\`)\n\n${schema.description}\n\n*${schema.provenance}*`,
      },
    };
  }

  return null;
}

/**
 * Returns CDL keyword, NetCDF Classic type, CF-1.x attribute, and in-scope symbol completions.
 */
export function getNetcdfCompletions(content: string, _position: LspPosition): LspCompletionItem[] {
  const items: LspCompletionItem[] = [
    // CDL sections & keywords
    { label: "netcdf", kind: 14, detail: "CDL dataset declaration", insertText: "netcdf ${1:dataset} {\n\n}" },
    { label: "dimensions:", kind: 14, detail: "CDL dimensions section" },
    { label: "variables:", kind: 14, detail: "CDL variables & attributes section" },
    { label: "data:", kind: 14, detail: "CDL data values section" },
    { label: "UNLIMITED", kind: 14, detail: "NetCDF Classic unlimited record dimension" },

    // NetCDF Classic data types
    { label: "byte", kind: 25, detail: "NC_BYTE (8-bit signed integer)" },
    { label: "char", kind: 25, detail: "NC_CHAR (8-bit ASCII character)" },
    { label: "short", kind: 25, detail: "NC_SHORT (16-bit signed integer)" },
    { label: "int", kind: 25, detail: "NC_INT (32-bit signed integer)" },
    { label: "long", kind: 25, detail: "NC_INT alias (32-bit signed integer)" },
    { label: "float", kind: 25, detail: "NC_FLOAT (IEEE-754 32-bit float)" },
    { label: "double", kind: 25, detail: "NC_DOUBLE (IEEE-754 64-bit float)" },

    // CF-1.x standard attributes
    { label: "units", kind: 10, detail: "CF-1.x physical units (UDUNITS)" },
    { label: "long_name", kind: 10, detail: "CF-1.x descriptive variable name" },
    { label: "standard_name", kind: 10, detail: "CF-1.x canonical standard_name" },
    { label: "_FillValue", kind: 10, detail: "NetCDF missing/fill sentinel value" },
    { label: "scale_factor", kind: 10, detail: "CF-1.x linear packing scale_factor" },
    { label: "add_offset", kind: 10, detail: "CF-1.x linear packing add_offset" },
    { label: ":Conventions", kind: 10, detail: 'Global CF conventions (e.g. "CF-1.8")' },
  ];

  // Add declared dimensions and variables from current document
  if (content.trim()) {
    const dataset = parseCdl(content);
    for (const d of dataset.dimensions) {
      items.push({
        label: d.name,
        kind: 6,
        detail: d.isUnlimited ? `dimension (UNLIMITED, ${d.size})` : `dimension (${d.size})`,
      });
    }
    for (const v of dataset.variables) {
      items.push({
        label: v.name,
        kind: 6,
        detail: `${v.type}(${v.dimensions.join(", ")})`,
      });
    }
  }

  return items;
}
