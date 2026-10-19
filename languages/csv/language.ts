// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  choice,
  def,
  field,
  language,
  optional,
  repeat,
  seq,
  tggComplement,
  tggDefaultVal,
  tggEq,
  tggRule,
  type QueryDB,
  type SymbolEntry,
  type SymbolId,
} from "@modelscript/dsl";
import { lintCsv, type CsvDiagnostic } from "./src/csv-parser.js";

export { lintCsv, type CsvDiagnostic };

/**
 * Metadata attached to virtual CSV component symbols by the workspace indexer.
 */
interface CsvMetadata {
  /** Inferred or explicitly declared Modelica type name (e.g., `"Real"`). */
  typeSpecifier?: string | undefined;
  /** Dimensions of the tabular column or matrix. */
  arrayDimensions?: number[] | undefined;
  /** Parsed literal array or scalar value extracted from the CSV table. */
  csvValue?: unknown;
}

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
      return { startOffset: entry.startOffset, endOffset: entry.endOffset, newText: newValue.trim() };
    }
    return null;
  },

  // IDE and AI agent actions for telemetry plotting and Modelica package generation
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

    SourceFile: ($) =>
      def({
        syntax: seq(
          field("rows", $["Row"]!),
          repeat(seq($["_newline"]!, field("rows", $["Row"]!))),
          optional($["_newline"]!),
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
          // Resolve column component names within the CSV document scope
          resolveSimpleName: (db: QueryDB, self: SymbolEntry) => {
            const children = db.childrenOf(self.id);
            const byNameMap = new Map<string, SymbolEntry>();
            for (const child of children) {
              byNameMap.set(child.name, child);
            }
            return (name: string) => byNameMap.get(name) ?? null;
          },
          // Validate header uniqueness, row column counts, numeric cells, and time monotonicity
          lint__csvTableValidity: (db: QueryDB, self: SymbolEntry) => {
            const text = db["cstText"](self.startOffset, self.endOffset, self);
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
      }),

    Row: ($) =>
      choice(
        seq(field("cells", $["Cell"]!), repeat(seq($["_delimiter"]!, optional(field("cells", $["Cell"]!))))),
        seq($["_delimiter"]!, repeat(seq($["_delimiter"]!, optional(field("cells", $["Cell"]!))))),
      ),

    Cell: ($) => choice($["_quoted_cell"]!, $["_unquoted_cell"]!),

    _quoted_cell: () => /"([^"]|"")*"/,
    _unquoted_cell: () => /[^,\r\n\t;"]+/,

    _delimiter: () => choice(",", ";", "\t"),
    _newline: () => choice("\r\n", "\n", "\r"),

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
        queries: {
          // Resolve the target scalar class (defaults to top-level "Real")
          resolvedType: (db: QueryDB, self: SymbolEntry): SymbolEntry | null => {
            const metadata = self.metadata as CsvMetadata | undefined;
            const typeName = metadata?.typeSpecifier ?? "Real";
            const entries = db.byName(typeName);
            return entries.find((e) => e.kind === "Class" && e.parentId === null) ?? null;
          },
          // Map the virtual CSV column to its corresponding top-level class symbol ID
          classInstance: (db: QueryDB, self: SymbolEntry): SymbolId | null => {
            const metadata = self.metadata as CsvMetadata | undefined;
            const typeName = metadata?.typeSpecifier ?? "Real";
            const entries = db.byName(typeName);
            const classSymbol = entries.find((e) => e.kind === "Class" && e.parentId === null);
            return classSymbol ? classSymbol.id : null;
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
        },
      }),
  },

  // Polyglot TGG rules mapping CSV files and virtual columns to Modelica packages and constant components
  polyglot: {
    languages: ["modelica"],
    rules: [
      tggRule({
        name: "CsvDocumentToModelicaPackage",
        sourceLang: "csv",
        targetLang: "modelica",
        source: ($, v) => $.SourceFile({ rows: v("docName") }),
        target: ($, v) => $.ClassDefinition({ name: v("docName"), classKind: "package" }),
        where: (v) => [
          tggEq(v("docName"), v("docName")),
          tggDefaultVal(v("isAbstract"), false),
          tggComplement(["rows", "headers"]),
        ],
      }),
      tggRule({
        name: "CsvVirtualComponentToModelicaComponent",
        sourceLang: "csv",
        targetLang: "modelica",
        source: ($, v) => $.CSVVirtualComponent({ name: v("varName"), typeSpecifier: v("typeName") }),
        target: ($, v) => $.ComponentClause({ name: v("varName"), typeSpecifier: v("typeName") }),
        where: (v) => [
          tggEq(v("varName"), v("varName")),
          tggEq(v("typeName"), v("typeName")),
          tggDefaultVal(v("causality"), "local"),
          tggDefaultVal(v("variability"), "constant"),
        ],
      }),
    ],
  },
});

export default csvLanguage;
