// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  choice,
  def,
  field,
  language,
  optional,
  repeat,
  seq,
  type QueryDB,
  type SymbolEntry,
  type SymbolId,
} from "@modelscript/dsl";
import { lintCsv, parseCsvHeaderAnnotation, type CsvDiagnostic, type CsvVarType } from "./csv-parser.js";
import { csvPolyglotConfig } from "./tgg/index.js";

export { lintCsv, parseCsvHeaderAnnotation, type CsvDiagnostic, type CsvVarType };

/**
 * Metadata attached to virtual CSV component symbols by the workspace indexer.
 */
interface CsvMetadata {
  /** Inferred or explicitly declared Modelica type name (e.g., `"Real"`, `"Boolean"`). */
  typeSpecifier?: string | undefined;
  /** Physical unit extracted from header annotation (e.g., `"rad/s"`, `"K"`). */
  unit?: string | undefined;
  /** Original raw header text before stripping unit/type annotations. */
  rawHeader?: string | undefined;
  /** Dimensions of the tabular column or matrix. */
  arrayDimensions?: number[] | undefined;
  /** Parsed literal array or scalar value extracted from the CSV table. */
  csvValue?: unknown;
}

/**
 * Query hooks for virtual CSV column/matrix component symbols.
 */
export const csvVirtualComponentQueries = {
  // Resolve the target scalar class (defaults to top-level "Real" or header `: Type` annotation)
  resolvedType: (db: QueryDB, self: SymbolEntry): SymbolEntry | null => {
    const metadata = self.metadata as CsvMetadata | undefined;
    const parsedHeader = parseCsvHeaderAnnotation(metadata?.rawHeader ?? self.name);
    const typeName = metadata?.typeSpecifier ?? parsedHeader.declaredType ?? "Real";
    const entries = db.byName(typeName);
    return entries.find((e) => e.kind === "Class" && e.parentId === null) ?? null;
  },
  // Map the virtual CSV column to its corresponding top-level class symbol ID
  classInstance: (db: QueryDB, self: SymbolEntry): SymbolId | null => {
    const metadata = self.metadata as CsvMetadata | undefined;
    const parsedHeader = parseCsvHeaderAnnotation(metadata?.rawHeader ?? self.name);
    const typeName = metadata?.typeSpecifier ?? parsedHeader.declaredType ?? "Real";
    const entries = db.byName(typeName);
    const classSymbol = entries.find((e) => e.kind === "Class" && e.parentId === null);
    return classSymbol ? classSymbol.id : null;
  },
  // Return the resolved scalar type name ("Real", "Integer", "Boolean", or "String")
  varType: (_db: QueryDB, self: SymbolEntry): CsvVarType => {
    const metadata = self.metadata as CsvMetadata | undefined;
    const parsedHeader = parseCsvHeaderAnnotation(metadata?.rawHeader ?? self.name);
    const rawType = metadata?.typeSpecifier ?? parsedHeader.declaredType ?? "Real";
    if (rawType === "Integer" || rawType === "Boolean" || rawType === "String") {
      return rawType;
    }
    return "Real";
  },
  // Return the extracted physical unit from `[unit]` or `(unit)` header annotations
  unit: (_db: QueryDB, self: SymbolEntry): string | null => {
    const metadata = self.metadata as CsvMetadata | undefined;
    if (metadata?.unit) return metadata.unit;
    const parsedHeader = parseCsvHeaderAnnotation(metadata?.rawHeader ?? self.name);
    return parsedHeader.unit ?? null;
  },
  variability: (): string => "constant",
  causality: (): string => "local",
  isOuter: (): boolean => false,
  isInner: (): boolean => false,
  isProtected: (): boolean => false,
  isFinal: (): boolean => false,
  // Return raw numeric array dimensions attached by the workspace indexer
  resolvedArrayDimensions: (_db: QueryDB, self: SymbolEntry): number[] | null => {
    const metadata = self.metadata as CsvMetadata | undefined;
    const dims = metadata?.arrayDimensions;
    return dims ?? null;
  },
  // Wrap numeric dimensions as literal expressions for the Modelica flattener
  arrayDimensions: (_db: QueryDB, self: SymbolEntry) => {
    const metadata = self.metadata as CsvMetadata | undefined;
    const dims = metadata?.arrayDimensions;
    if (!dims || dims.length === 0) return null;
    return dims.map((d: number) => ({ kind: "literal", value: d }));
  },
  // Expose parsed CSV cell/column values as a constant literal binding expression
  effectiveModification: (_db: QueryDB, self: SymbolEntry) => {
    const metadata = self.metadata as CsvMetadata | undefined;
    const csvValue = metadata?.csvValue;
    if (csvValue === undefined) return null;
    return {
      args: [],
      bindingExpression: { kind: "literal", value: csvValue },
    };
  },
};

/**
 * ModelScript CSV language specification.
 *
 * Defines grammar rules for delimiter-separated tables (`,`, `;`, `\t`),
 * virtual component queries for polyglot workspace indexing, semantic table
 * validation hooks, and Triple Graph Grammar (TGG) rules projecting CSV files
 * into Modelica parameter packages.
 */
export const csvLanguage = language({
  name: "csv",
  fileExtensions: [".csv"],
  maturity: "stable",
  lsp: {
    fileExtensions: [".csv"],
    icons: {
      light: "./assets/csv/icon-light.png",
      dark: "./assets/csv/icon-dark.png",
    },
  },

  // In-place cell value writeback using byte offsets recorded on the symbol entry
  writeback: (ctx) => {
    const { entry, newValue } = ctx;
    if (entry?.startOffset != null && entry?.endOffset != null && entry.endOffset >= entry.startOffset) {
      const trimmed = newValue.trim();
      const needsQuotes = /[",;\t\r\n]/.test(trimmed);
      const formatted = needsQuotes ? `"${trimmed.replace(/"/g, '""')}"` : trimmed;
      return { startOffset: entry.startOffset, endOffset: entry.endOffset, newText: formatted };
    }
    return null;
  },

  // IDE and AI agent actions for telemetry plotting and Modelica package generation
  ui: {
    toolbarButtons: [
      {
        id: "plotTelemetry",
        label: "Plot CSV Telemetry Data",
        shortLabel: "Plot CSV",
        tooltip: "Plot CSV Telemetry Data",
        icon: "graph",
        views: ["code", "inspector"],
        targets: ["ansatz"],
        placement: "primary",
        order: 10,
        actionId: "plot_telemetry",
      },
      {
        id: "importAsModelica",
        label: "Import as Modelica Parameter Package",
        shortLabel: "Import as",
        tooltip: "Import as Modelica Parameter Package",
        icon: "export",
        views: ["code", "inspector"],
        targets: ["ansatz"],
        placement: "primary",
        order: 20,
        actionId: "import_as_modelica",
      },
    ],
  },
  actions: [
    {
      id: "plot_telemetry",
      title: "Plot CSV Telemetry Data",
      description: "Visualizes tabular time-series columns in the simulation plotting panel.",
      category: "simulate",
      ui: {
        editorTitle: {
          icon: "$(graph)",
          group: "navigation@1",
        },
        editorContextMenu: {
          group: "1_run@0",
        },
        explorerContextMenu: {
          group: "modelscript_run@0",
        },
        languageModelTool: {
          name: "csv_plot_telemetry",
          displayName: "Plot CSV Telemetry",
          modelDescription: "Visualizes tabular time-series data from CSV in the simulation plot panel.",
        },
      },
    },
    {
      id: "import_as_modelica",
      title: "Import as Modelica Parameter Package",
      description: "Generates a strongly-typed Modelica package defining parameters and constants from table rows.",
      category: "transform",
      ui: {
        editorContextMenu: {
          group: "2_transform@1",
        },
        explorerContextMenu: {
          group: "modelscript_convert@0",
        },
        languageModelTool: {
          name: "csv_to_modelica",
          displayName: "Import CSV as Modelica Package",
          modelDescription: "Transforms CSV parameters and tabular rows into a Modelica package.",
        },
      },
    },
  ],

  rules: {
    // =====================================================================
    // Grammar Rules
    // =====================================================================

    SourceFile: ($) => {
      const getRule = (name: string) => {
        const rule = $[name];
        if (!rule) throw new Error(`Missing grammar rule: ${name}`);
        return rule;
      };
      return def({
        syntax: seq(
          optional(getRule("_newline")),
          field("rows", choice(getRule("Row"), getRule("_comment"))),
          repeat(seq(getRule("_newline"), field("rows", choice(getRule("Row"), getRule("_comment"))))),
          optional(getRule("_newline")),
        ),
        symbol: (self: Record<string, string>) => ({
          kind: "Class",
          name: self["rows"], // dummy access to record namePath
        }),
        queries: {
          // Return all virtual column/matrix component symbols belonging to this CSV document
          instantiate: (db: QueryDB, self: SymbolEntry): SymbolId[] => {
            return db.childrenOf(self.id).map((c) => c.id);
          },
          // Resolve column component names within the CSV document scope (by clean name or raw header)
          resolveSimpleName: (db: QueryDB, self: SymbolEntry) => {
            const children = db.childrenOf(self.id);
            const byNameMap = new Map<string, SymbolEntry>();
            for (const child of children) {
              byNameMap.set(child.name, child);
              const parsed = parseCsvHeaderAnnotation(child.name);
              if (parsed.name && !byNameMap.has(parsed.name)) {
                byNameMap.set(parsed.name, child);
              }
            }
            return (name: string) => byNameMap.get(name) ?? byNameMap.get(parseCsvHeaderAnnotation(name).name) ?? null;
          },
          // Validate header uniqueness, row column counts, mixed delimiters, numeric cells, and time monotonicity
          lint__csvTableValidity: (db: QueryDB, self: SymbolEntry) => {
            const text = (
              db as unknown as {
                cstText?: (start?: number, end?: number, entry?: SymbolEntry) => string | null;
              }
            ).cstText?.(self.startOffset, self.endOffset, self);
            if (!text) return null;
            const diags = lintCsv(text, self.startOffset ?? 0);
            if (diags.length === 0) return null;
            return diags.map((d) => ({
              severity: d.severity,
              code: d.code,
              message: d.message,
              startOffset: d.startOffset,
              endOffset: d.endOffset,
            }));
          },
        },
      });
    },

    Row: ($) => {
      const getRule = (name: string) => {
        const rule = $[name];
        if (!rule) throw new Error(`Missing grammar rule: ${name}`);
        return rule;
      };
      return choice(
        seq(
          field("cells", getRule("Cell")),
          repeat(seq(getRule("_delimiter"), optional(field("cells", getRule("Cell"))))),
        ),
        seq(getRule("_delimiter"), repeat(seq(getRule("_delimiter"), optional(field("cells", getRule("Cell")))))),
      );
    },

    Cell: ($) => {
      const getRule = (name: string) => {
        const rule = $[name];
        if (!rule) throw new Error(`Missing grammar rule: ${name}`);
        return rule;
      };
      return choice(getRule("_quoted_cell"), getRule("_unquoted_cell"));
    },

    _comment: () => /#[^\r\n]*/,
    _quoted_cell: () => /"([^"]|"")*"/,
    _unquoted_cell: () => /[^#,\r\n\t;"][^,\r\n\t;"]*/,

    _delimiter: () => choice(",", ";", "\t"),
    _newline: () => /[\r\n]+/,

    // =====================================================================
    // Dummy Rule for Virtual Component Symbols
    // This allows query-hooks and AST classes to be generated for
    // CSVVirtualComponent rule used by the workspace indexer.
    // =====================================================================
    CSVVirtualComponent: () =>
      def({
        syntax: "CSVVirtualComponent",
        symbol: (self: Record<string, string>) => ({
          kind: "Component",
          name: self["syntax"] ?? "", // dummy access to record namePath
        }),
        queries: csvVirtualComponentQueries,
      }),
  },

  // Polyglot TGG rules mapping CSV files and virtual columns to Modelica packages and constant components
  polyglot: csvPolyglotConfig,
});

export default csvLanguage;

/** Workspace indexing conventions for tabular CSV resources (consumed by language workspaces that index CSV files). */
export { csvWorkspaceHooks } from "./workspace-hooks.js";
