// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Composable feature mixins and builders for splitting large `LanguageOptions`
 * specifications into modular, typed slices.
 */

import type { LanguageOptions } from "./language.js";

/**
 * A partial language feature slice or transformer function that extends a `LanguageOptions` object.
 */
export type LanguageMixin<
  RuleName extends string = string,
  FieldName extends string = string,
  QueryName extends string = string,
  ModelAttrs extends Record<string, Record<string, unknown>> = Record<string, Record<string, unknown>>,
> =
  | Partial<LanguageOptions<RuleName, FieldName, QueryName, ModelAttrs>>
  | ((
      base: LanguageOptions<RuleName, FieldName, QueryName, ModelAttrs>,
    ) => Partial<LanguageOptions<RuleName, FieldName, QueryName, ModelAttrs>>);

function mergeArray<T>(a: T[] | undefined, b: T[] | undefined): T[] | undefined {
  if (!a) return b ? [...b] : undefined;
  if (!b) return [...a];
  return [...a, ...b];
}

function mergeRecord<T extends Record<string, unknown>>(a: T | undefined, b: T | undefined): T | undefined {
  if (!a) return b ? { ...b } : undefined;
  if (!b) return { ...a };
  return { ...a, ...b };
}

function mergeArrayOrFn<T>(a: T, b: T): T {
  if (a === undefined) return b;
  if (b === undefined) return a;
  if (Array.isArray(a) && Array.isArray(b)) {
    return [...a, ...b] as unknown as T;
  }
  if (typeof a === "function" && typeof b === "function") {
    type Fn = (arg: unknown) => unknown[];
    return (($: unknown) => [...(a as Fn)($), ...(b as Fn)($)]) as unknown as T;
  }
  return b;
}

/**
 * Purely merges one or more `LanguageMixin` slices onto a base `LanguageOptions` object
 * without mutating `base`. Record sections (`rules`, `queries`, `lints`, `symbols`, `lsp`,
 * `diagram`, `mcp`, `polyglot`, etc.) are shallow-merged, and array sections (`actions`,
 * `templates`, `inline`, `conflicts`, `brackets`, etc.) are concatenated.
 */
export function extendLanguage<
  RuleName extends string = string,
  FieldName extends string = string,
  QueryName extends string = string,
  ModelAttrs extends Record<string, Record<string, unknown>> = Record<string, Record<string, unknown>>,
>(
  base: LanguageOptions<RuleName, FieldName, QueryName, ModelAttrs>,
  ...mixins: LanguageMixin<RuleName, FieldName, QueryName, ModelAttrs>[]
): LanguageOptions<RuleName, FieldName, QueryName, ModelAttrs> {
  let acc: LanguageOptions<RuleName, FieldName, QueryName, ModelAttrs> = { ...base };

  for (const rawMixin of mixins) {
    const mixin = typeof rawMixin === "function" ? rawMixin(acc) : rawMixin;
    if (!mixin) continue;

    acc = {
      ...acc,
      ...mixin,
      rules: mergeRecord(acc.rules, mixin.rules),
      queries: mergeRecord(acc.queries, mixin.queries),
      lints: mergeRecord(acc.lints, mixin.lints),
      symbols: mergeRecord(acc.symbols, mixin.symbols),
      model: mergeRecord(acc.model, mixin.model),
      domains: mergeRecord(acc.domains, mixin.domains),
      connectors: mergeRecord(acc.connectors, mixin.connectors),
      pipelines: mergeRecord(acc.pipelines, mixin.pipelines),
      hostQueries: mergeRecord(acc.hostQueries, mixin.hostQueries),
      errorCodes: mergeRecord(acc.errorCodes, mixin.errorCodes),
      reserved: mergeRecord(acc.reserved, mixin.reserved),
      cfgNodes: mergeRecord(acc.cfgNodes, mixin.cfgNodes),
      analysis: mergeRecord(acc.analysis, mixin.analysis),
      targets: mergeRecord(acc.targets, mixin.targets),
      lsp:
        acc.lsp || mixin.lsp
          ? { ...acc.lsp, ...mixin.lsp, handlers: mergeRecord(acc.lsp?.handlers, mixin.lsp?.handlers) }
          : undefined,
      formatting:
        acc.formatting || mixin.formatting
          ? {
              ...acc.formatting,
              ...mixin.formatting,
              rules: mergeRecord(acc.formatting?.rules, mixin.formatting?.rules),
            }
          : undefined,
      indexing: acc.indexing || mixin.indexing ? { ...acc.indexing, ...mixin.indexing } : undefined,
      recovery:
        acc.recovery || mixin.recovery
          ? {
              ...acc.recovery,
              ...mixin.recovery,
              sync: mergeArray(acc.recovery?.sync, mixin.recovery?.sync),
              delimiters: mergeArray(acc.recovery?.delimiters, mixin.recovery?.delimiters),
              operators: mergeArray(acc.recovery?.operators, mixin.recovery?.operators),
              structuralRules: mergeArray(acc.recovery?.structuralRules, mixin.recovery?.structuralRules),
            }
          : undefined,
      polyglot:
        acc.polyglot || mixin.polyglot
          ? {
              ...acc.polyglot,
              ...mixin.polyglot,
              rules: mergeArray(acc.polyglot?.rules, mixin.polyglot?.rules),
            }
          : undefined,
      mcp:
        acc.mcp || mixin.mcp
          ? {
              ...acc.mcp,
              ...mixin.mcp,
              tools: mergeArray(acc.mcp?.tools, mixin.mcp?.tools) ?? [],
              resources: mergeArray(acc.mcp?.resources, mixin.mcp?.resources),
              prompts: mergeArray(acc.mcp?.prompts, mixin.mcp?.prompts),
            }
          : undefined,
      actions: mergeArray(acc.actions, mixin.actions),
      templates: mergeArray(acc.templates, mixin.templates),
      inline: mergeArray(acc.inline, mixin.inline),
      brackets: mergeArray(acc.brackets, mixin.brackets),
      runtimeFiles: mergeArray(acc.runtimeFiles, mixin.runtimeFiles),
      conflicts: mergeArrayOrFn(acc.conflicts, mixin.conflicts),
      supertypes: mergeArrayOrFn(acc.supertypes, mixin.supertypes),
      precedences: mergeArrayOrFn(acc.precedences, mixin.precedences),
      extras: mergeArrayOrFn(acc.extras, mixin.extras),
    };
  }

  return acc;
}

/** Creates a typed LSP configuration mixin. */
export function withLsp<
  RuleName extends string = string,
  FieldName extends string = string,
  QueryName extends string = string,
  ModelAttrs extends Record<string, Record<string, unknown>> = Record<string, Record<string, unknown>>,
>(
  lsp: NonNullable<LanguageOptions<RuleName, FieldName, QueryName, ModelAttrs>["lsp"]>,
): Partial<LanguageOptions<RuleName, FieldName, QueryName, ModelAttrs>> {
  return { lsp };
}

/** Creates a typed diagram configuration mixin. */
export function withDiagram<
  RuleName extends string = string,
  FieldName extends string = string,
  QueryName extends string = string,
  ModelAttrs extends Record<string, Record<string, unknown>> = Record<string, Record<string, unknown>>,
>(
  diagram: NonNullable<LanguageOptions<RuleName, FieldName, QueryName, ModelAttrs>["diagram"]>,
): Partial<LanguageOptions<RuleName, FieldName, QueryName, ModelAttrs>> {
  return { diagram };
}

/** Creates a typed indexing configuration mixin. */
export function withIndexing<
  RuleName extends string = string,
  FieldName extends string = string,
  QueryName extends string = string,
  ModelAttrs extends Record<string, Record<string, unknown>> = Record<string, Record<string, unknown>>,
>(
  indexing: NonNullable<LanguageOptions<RuleName, FieldName, QueryName, ModelAttrs>["indexing"]>,
): Partial<LanguageOptions<RuleName, FieldName, QueryName, ModelAttrs>> {
  return { indexing };
}

/** Creates a typed polyglot TGG configuration mixin. */
export function withTgg<
  RuleName extends string = string,
  FieldName extends string = string,
  QueryName extends string = string,
  ModelAttrs extends Record<string, Record<string, unknown>> = Record<string, Record<string, unknown>>,
>(
  polyglot: NonNullable<LanguageOptions<RuleName, FieldName, QueryName, ModelAttrs>["polyglot"]>,
): Partial<LanguageOptions<RuleName, FieldName, QueryName, ModelAttrs>> {
  return { polyglot };
}

/** Creates a typed MCP configuration mixin. */
export function withMcp<
  RuleName extends string = string,
  FieldName extends string = string,
  QueryName extends string = string,
  ModelAttrs extends Record<string, Record<string, unknown>> = Record<string, Record<string, unknown>>,
>(
  mcp: NonNullable<LanguageOptions<RuleName, FieldName, QueryName, ModelAttrs>["mcp"]>,
): Partial<LanguageOptions<RuleName, FieldName, QueryName, ModelAttrs>> {
  return { mcp };
}

/** Creates a typed actions mixin. */
export function withActions<
  RuleName extends string = string,
  FieldName extends string = string,
  QueryName extends string = string,
  ModelAttrs extends Record<string, Record<string, unknown>> = Record<string, Record<string, unknown>>,
>(
  actions: NonNullable<LanguageOptions<RuleName, FieldName, QueryName, ModelAttrs>["actions"]>,
): Partial<LanguageOptions<RuleName, FieldName, QueryName, ModelAttrs>> {
  return { actions };
}

/** Creates a typed writeback mixin. */
export function withWriteback<
  RuleName extends string = string,
  FieldName extends string = string,
  QueryName extends string = string,
  ModelAttrs extends Record<string, Record<string, unknown>> = Record<string, Record<string, unknown>>,
>(
  writeback: NonNullable<LanguageOptions<RuleName, FieldName, QueryName, ModelAttrs>["writeback"]>,
): Partial<LanguageOptions<RuleName, FieldName, QueryName, ModelAttrs>> {
  return { writeback };
}

/** Creates a typed compiler lints mixin. */
export function withLints<
  RuleName extends string = string,
  FieldName extends string = string,
  QueryName extends string = string,
  ModelAttrs extends Record<string, Record<string, unknown>> = Record<string, Record<string, unknown>>,
>(
  lints: NonNullable<LanguageOptions<RuleName, FieldName, QueryName, ModelAttrs>["lints"]>,
): Partial<LanguageOptions<RuleName, FieldName, QueryName, ModelAttrs>> {
  return { lints };
}

/** Creates a typed AST queries mixin. */
export function withQueries<
  RuleName extends string = string,
  FieldName extends string = string,
  QueryName extends string = string,
  ModelAttrs extends Record<string, Record<string, unknown>> = Record<string, Record<string, unknown>>,
>(
  queries: NonNullable<LanguageOptions<RuleName, FieldName, QueryName, ModelAttrs>["queries"]>,
): Partial<LanguageOptions<RuleName, FieldName, QueryName, ModelAttrs>> {
  return { queries };
}

/**
 * Creates a unified `LanguageOptions` definition for a tabular/spreadsheet-first language,
 * wiring `fileExtensions`, `lsp.fileExtensions`, and `tabular` in one call.
 */
export function tabularLanguage<
  RuleName extends string = string,
  FieldName extends string = string,
  QueryName extends string = string,
  ModelAttrs extends Record<string, Record<string, unknown>> = Record<string, Record<string, unknown>>,
>(
  options: Omit<LanguageOptions<RuleName, FieldName, QueryName, ModelAttrs>, "tabular"> & {
    tabular: NonNullable<LanguageOptions<RuleName, FieldName, QueryName, ModelAttrs>["tabular"]>;
  },
): LanguageOptions<RuleName, FieldName, QueryName, ModelAttrs> {
  const exts = options.fileExtensions ?? options.lsp?.fileExtensions;
  return {
    ...options,
    lsp: exts ? { fileExtensions: exts, ...options.lsp } : options.lsp,
  };
}
