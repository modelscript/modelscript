// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  choice,
  def,
  field,
  language,
  optional,
  repeat,
  seq,
  type ActionExecutionContext,
  type QueryDB,
  type SymbolEntry,
  type SymbolId,
} from "@modelscript/dsl";
import { lasToDataset, lintLas, parseLas, parseLasToModelica } from "./las-parser.js";
import { lasWorkspaceHooks } from "./workspace-hooks.js";

interface LasVirtualMetadata {
  typeSpecifier?: string | undefined;
  unit?: string | undefined;
  arrayDimensions?: number[] | undefined;
  lasValue?: unknown;
}

/**
 * Query hooks for virtual LAS curve and metadata component symbols.
 */
export const lasVirtualComponentQueries = {
  resolvedType: (db: QueryDB, self: SymbolEntry): SymbolEntry | null => {
    const metadata = self.metadata as LasVirtualMetadata | undefined;
    const typeName = metadata?.typeSpecifier ?? "Real";
    const entries = db.byName(typeName);
    return entries.find((e) => e.kind === "Class" && e.parentId === null) ?? null;
  },
  classInstance: (db: QueryDB, self: SymbolEntry): SymbolId | null => {
    const metadata = self.metadata as LasVirtualMetadata | undefined;
    const typeName = metadata?.typeSpecifier ?? "Real";
    const entries = db.byName(typeName);
    const classSymbol = entries.find((e) => e.kind === "Class" && e.parentId === null);
    return classSymbol ? classSymbol.id : null;
  },
  varType: (_db: QueryDB, self: SymbolEntry): "Real" | "Integer" => {
    const metadata = self.metadata as LasVirtualMetadata | undefined;
    return metadata?.typeSpecifier === "Integer" ? "Integer" : "Real";
  },
  unit: (_db: QueryDB, self: SymbolEntry): string | null => {
    const metadata = self.metadata as LasVirtualMetadata | undefined;
    return metadata?.unit ?? null;
  },
  variability: (): string => "constant",
  causality: (): string => "local",
  isOuter: (): boolean => false,
  isInner: (): boolean => false,
  isProtected: (): boolean => false,
  isFinal: (): boolean => false,
  resolvedArrayDimensions: (_db: QueryDB, self: SymbolEntry): number[] | null => {
    const metadata = self.metadata as LasVirtualMetadata | undefined;
    return metadata?.arrayDimensions ?? null;
  },
  arrayDimensions: (_db: QueryDB, self: SymbolEntry) => {
    const metadata = self.metadata as LasVirtualMetadata | undefined;
    const dims = metadata?.arrayDimensions;
    if (!dims || dims.length === 0) return null;
    return dims.map((d: number) => ({ kind: "literal", value: d }));
  },
  effectiveModification: (_db: QueryDB, self: SymbolEntry) => {
    const metadata = self.metadata as LasVirtualMetadata | undefined;
    const lasValue = metadata?.lasValue;
    if (lasValue === undefined) return null;
    return {
      args: [],
      bindingExpression: { kind: "literal", value: lasValue },
    };
  },
};

/**
 * ModelScript LAS (Log ASCII Standard 1.2 / 2.0 / 3.0) language specification.
 */
export const lasLanguage = language({
  name: "las",
  fileExtensions: [".las"],
  maturity: "experimental",
  lsp: {
    fileExtensions: [".las"],
  },
  indexing: {
    workspaceHooks: lasWorkspaceHooks,
  },

  actions: [
    {
      id: "plot_well_log",
      title: "Plot Well Log Curves",
      description: "Converts LAS curves into a canonical depth-indexed dataset for plotting.",
      category: "simulate",
      execute: async (
        ctx: ActionExecutionContext,
        params: { documentText?: string | undefined; title?: string | undefined },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        return lasToDataset(parseLas(text), { title: params?.title });
      },
    },
    {
      id: "import_as_modelica",
      title: "Import LAS as Modelica Package",
      description: "Generates a strongly-typed Modelica package containing well-log curve vectors and units.",
      category: "transform",
      execute: async (
        ctx: ActionExecutionContext,
        params: { documentText?: string | undefined; packageName?: string | undefined },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return "";
        return parseLasToModelica(text, params?.packageName);
      },
    },
  ],

  rules: {
    SourceFile: ($) => {
      const getRule = (name: string) => {
        const rule = $[name];
        if (!rule) throw new Error(`Missing grammar rule: ${name}`);
        return rule;
      };
      const lineChoice = choice(getRule("SectionHeader"), getRule("DataLine"), getRule("_comment"));
      return def({
        syntax: seq(
          optional(getRule("_newline")),
          optional(field("lines", lineChoice)),
          repeat(seq(getRule("_newline"), optional(field("lines", lineChoice)))),
        ),
        symbol: (self: Record<string, string>) => ({
          kind: "Class",
          name: self["lines"] ?? "WellLog",
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
              byNameMap.set(child.name.toUpperCase(), child);
            }
            return (name: string) => byNameMap.get(name) ?? byNameMap.get(name.toUpperCase()) ?? null;
          },
          lint__lasDocumentValidity: (db: QueryDB, self: SymbolEntry) => {
            const text = (
              db as unknown as {
                cstText?: (start?: number, end?: number, entry?: SymbolEntry) => string | null;
              }
            ).cstText?.(self.startOffset, self.endOffset, self);
            if (!text) return null;
            const diags = lintLas(text, self.startOffset ?? 0);
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

    SectionHeader: () => /~[^\r\n]*/,
    DataLine: () => /[^\r\n~#][^\r\n]*/,
    _comment: () => /#[^\r\n]*/,
    _newline: () => /(\r\n|\n|\r)+/,

    LASVirtualComponent: () =>
      def({
        syntax: "LASVirtualComponent",
        symbol: (self: Record<string, string>) => ({
          kind: "Component",
          name: self["syntax"] ?? "",
        }),
        queries: lasVirtualComponentQueries,
      }),
  },
});

export default lasLanguage;
export { lasWorkspaceHooks } from "./workspace-hooks.js";
