import {
  choice,
  def,
  field,
  language,
  optional,
  repeat,
  seq,
  type AdapterDB,
  type QueryDB,
  type SymbolEntry,
  type SymbolId,
} from "@modelscript/compiler";

interface CsvMetadata {
  typeSpecifier?: string;
  arrayDimensions?: number[];
  csvValue?: unknown;
}

export default language({
  name: "csv",

  rules: {
    // =====================================================================
    // Grammar Rules
    // =====================================================================

    SourceFile: ($) =>
      def({
        syntax: seq(field("rows", $.Row), repeat(seq($._newline, field("rows", $.Row))), optional($._newline)),
        symbol: (self) => ({
          kind: "Class",
          name: self.rows, // dummy access to record namePath
        }),
        queries: {
          instantiate: (db: QueryDB, self: SymbolEntry): SymbolId[] => {
            return db.childrenOf(self.id).map((c) => c.id);
          },
          resolveSimpleName: (db: QueryDB, self: SymbolEntry) => {
            const children = db.childrenOf(self.id);
            const byNameMap = new Map<string, SymbolEntry>();
            for (const child of children) {
              byNameMap.set(child.name, child);
            }
            return (name: string) => byNameMap.get(name) ?? null;
          },
        },
        adapters: {
          modelica: {
            target: "ClassDefinition",
            transform: (db: AdapterDB, self: SymbolEntry) => {
              return {
                name: self.name,
                classKind: "package",
                isAbstract: false,
                components: db
                  .childrenOf(self.id)
                  .map((c) => db.project(c, "modelica"))
                  .filter(Boolean),
                nestedClasses: [],
              };
            },
          },
        },
      }),

    Row: ($) =>
      choice(
        seq(field("cells", $.Cell), repeat(seq($._delimiter, optional(field("cells", $.Cell))))),
        seq($._delimiter, repeat(seq($._delimiter, optional(field("cells", $.Cell))))),
      ),

    Cell: ($) => choice($._quoted_cell, $._unquoted_cell),

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
        symbol: (self) => ({
          kind: "Component",
          name: self.syntax, // dummy access to record namePath
        }),
        queries: {
          resolvedType: (db: QueryDB, self: SymbolEntry): SymbolEntry | null => {
            const metadata = self.metadata as CsvMetadata | undefined;
            const typeName = metadata?.typeSpecifier ?? "Real";
            const entries = db.byName(typeName);
            return entries.find((e) => e.kind === "Class" && e.parentId === null) ?? null;
          },
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
          resolvedArrayDimensions: (db: QueryDB, self: SymbolEntry): number[] | null => {
            const metadata = self.metadata as CsvMetadata | undefined;
            const dims = metadata?.arrayDimensions;
            return dims ?? null;
          },
          arrayDimensions: (db: QueryDB, self: SymbolEntry) => {
            const metadata = self.metadata as CsvMetadata | undefined;
            const dims = metadata?.arrayDimensions;
            if (!dims || dims.length === 0) return null;
            return dims.map((d: number) => ({ kind: "literal", value: d }));
          },
          effectiveModification: (db: QueryDB, self: SymbolEntry) => {
            const metadata = self.metadata as CsvMetadata | undefined;
            const csvValue = metadata?.csvValue;
            if (csvValue === undefined) return null;
            return {
              args: [],
              bindingExpression: { kind: "literal", value: csvValue },
            };
          },
        },
        adapters: {
          modelica: {
            target: "ComponentClause",
            transform: (db: AdapterDB, self: SymbolEntry) => {
              const metadata = self.metadata as CsvMetadata | undefined;
              return {
                name: self.name,
                typeSpecifier: metadata?.typeSpecifier ?? "Real",
                causality: "local",
                variability: "constant",
              };
            },
          },
        },
      }),
  },
});
