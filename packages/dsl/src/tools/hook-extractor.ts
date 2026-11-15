// SPDX-License-Identifier: AGPL-3.0-or-later

export interface IndexerHook {
  ruleName: string;
  kind: string;
  namePath: string;
  exportPaths?: string[] | undefined;
  inheritPaths?: string[] | undefined;
  metadataFieldPaths?: Record<string, string> | undefined;
}

export type QueryHooks = Record<string, unknown>;

export interface SelfAccessor {
  readonly [key: string]: SelfAccessor;
}

export const SCOPE_PATH: unique symbol = Symbol.for("modelscript.scopePath");

export function createSelfProxy(path: string = ""): SelfAccessor {
  return new Proxy({} as SelfAccessor, {
    get(_, prop) {
      if (prop === SCOPE_PATH) return path;
      const newPath = path ? `${path}.${String(prop)}` : String(prop);
      return createSelfProxy(newPath);
    },
  });
}

export function extractScopePath(accessor: SelfAccessor): string {
  return (accessor as unknown as Record<symbol, string>)[SCOPE_PATH] ?? "";
}

export interface QueryHookInfo {
  ruleName: string;
  queryNames: string[];
  lintNames: string[];
}

export interface RefHookInfo {
  ruleName: string;
  namePath: string;
  targetKinds: string[];
  resolve: "lexical" | "qualified";
}

interface HookRuleAstLike {
  type?: string;
  options?: {
    symbol?: (self: SelfAccessor) => {
      kind?: string;
      name?: SelfAccessor;
      exports?: SelfAccessor[];
      inherits?: SelfAccessor[];
      attributes?: Record<string, SelfAccessor>;
    };
    name?: (self: SelfAccessor) => SelfAccessor | string;
    queries?: Record<string, unknown>;
    lints?: Record<string, unknown>;
    i18n?: unknown;
    graphics?: unknown;
    visual?: unknown;
  };
  value?: HookRuleAstLike["options"];
  children?: unknown[];
  args?: unknown[];
  arg?: unknown;
  rule?: unknown;
}

interface HookLangConfig {
  symbols?:
    | Record<
        string,
        | {
            kind?: string | undefined;
            name?: string | undefined;
            exports?: string | string[] | undefined;
            inherits?: string | string[] | undefined;
            attributes?: Record<string, string> | undefined;
          }
        | undefined
      >
    | undefined;
  rules?:
    | Record<string, { bivarianceHack(d: Record<string, unknown>): unknown }["bivarianceHack"] | undefined>
    | undefined;
  graphics?: Record<string, unknown> | undefined;
  visual?:
    | {
        entities?: Record<string, unknown> | undefined;
        connections?: Record<string, unknown> | undefined;
      }
    | undefined;
  indexing?: import("../dsl/language.js").LanguageIndexingConfig | undefined;
}

function createSymbolProxy(): Record<string, unknown> {
  return new Proxy(
    {},
    {
      get(_, prop) {
        return { type: "sym", name: prop };
      },
    },
  );
}

/**
 * Walks the evaluated language config and extracts IndexerHook[]
 * from all rules wrapped in `def()` and from `symbols` config.
 */
export function extractIndexerHooks(langConfig: HookLangConfig, $?: Record<string, unknown>): IndexerHook[] {
  const hooks: IndexerHook[] = [];
  const proxy = $ ?? createSymbolProxy();

  if (langConfig.symbols && typeof langConfig.symbols === "object") {
    for (const [ruleName, symConfig] of Object.entries(langConfig.symbols)) {
      if (!symConfig) continue;
      hooks.push({
        ruleName,
        kind: symConfig.kind || "Class",
        namePath: symConfig.name || "name",
        exportPaths: symConfig.exports
          ? Array.isArray(symConfig.exports)
            ? symConfig.exports
            : [symConfig.exports]
          : [],
        inheritPaths: symConfig.inherits
          ? Array.isArray(symConfig.inherits)
            ? symConfig.inherits
            : [symConfig.inherits]
          : [],
        metadataFieldPaths: symConfig.attributes || {},
      });
    }
  }

  if (!langConfig.rules) return hooks;

  for (const [ruleName, ruleFn] of Object.entries(langConfig.rules)) {
    if (typeof ruleFn !== "function") continue;
    const ruleAST = ruleFn(proxy);
    collectIndexerHooks(ruleAST, ruleName, hooks);
  }

  return hooks;
}

function collectIndexerHooks(node: unknown, ruleName: string, hooks: IndexerHook[]): void {
  if (!node || typeof node !== "object") return;
  const ast = node as HookRuleAstLike;
  const t = (ast.type || "").toUpperCase();

  if (t === "DEF") {
    const options = ast.options || ast.value;
    if (options) {
      let kind = "Unknown";
      let namePath = "name";
      let exportPaths: string[] = [];
      let inheritPaths: string[] = [];
      const metadataFieldPaths: Record<string, string> = {};

      if (typeof options.symbol === "function") {
        const self = createSelfProxy();
        const symConfig = options.symbol(self);

        if (symConfig.kind) kind = symConfig.kind;
        if (symConfig.name) namePath = extractScopePath(symConfig.name);

        if (symConfig.exports) {
          exportPaths = symConfig.exports.map(extractScopePath);
        }
        if (symConfig.inherits) {
          inheritPaths = symConfig.inherits.map(extractScopePath);
        }
        if (symConfig.attributes) {
          for (const [key, accessor] of Object.entries(symConfig.attributes)) {
            metadataFieldPaths[key] = extractScopePath(accessor);
          }
        }
      }

      hooks.push({
        ruleName,
        kind,
        namePath,
        exportPaths,
        inheritPaths,
        metadataFieldPaths,
      });
    }
  } else if (t === "REF") {
    const opts = ast.options || ast.value || {};
    let namePath = "name";
    if (opts.name) {
      const self = createSelfProxy();
      const accessor = opts.name(self);
      if (typeof accessor === "string" && accessor === "$self") {
        namePath = "$self";
      } else if (typeof accessor !== "string") {
        namePath = extractScopePath(accessor);
      }
    }
    hooks.push({
      ruleName,
      kind: "Reference",
      namePath,
      exportPaths: [],
      inheritPaths: [],
      metadataFieldPaths: {},
    });
  }

  const children = ast.children || ast.args || (ast.arg ? [ast.arg] : []) || (ast.rule ? [ast.rule] : []);
  if (Array.isArray(children)) {
    for (const child of children) {
      collectIndexerHooks(child, ruleName, hooks);
    }
  }
}

/**
 * Walks the evaluated language config and extracts QueryHookInfo[]
 * for rules with queries or lints in their `def()` options.
 */
export function extractQueryHooks(langConfig: HookLangConfig, $?: Record<string, unknown>): QueryHookInfo[] {
  const hooks: QueryHookInfo[] = [];
  const proxy = $ ?? createSymbolProxy();

  if (!langConfig.rules) return hooks;

  for (const [ruleName, ruleFn] of Object.entries(langConfig.rules)) {
    if (typeof ruleFn !== "function") continue;
    const ruleAST = ruleFn(proxy) as HookRuleAstLike | null | undefined;

    if (!ruleAST) continue;
    const t = (ruleAST.type || "").toUpperCase();
    if (t !== "DEF") continue;
    const options = ruleAST.options || ruleAST.value;
    const hasQueries = options?.queries && Object.keys(options.queries).length > 0;
    const hasLints = options?.lints && Object.keys(options.lints).length > 0;
    if (!hasQueries && !hasLints) continue;

    const queryNames = options?.queries ? Object.keys(options.queries) : [];
    const lintNames = options?.lints ? Object.keys(options.lints) : [];
    hooks.push({ ruleName, queryNames, lintNames });
  }

  return hooks;
}

/**
 * Directly extracts a Map<string, QueryHooks> from the language definition
 * by merging query functions and lint__<name> functions.
 */
export function extractQueryHooksMap(langConfig: HookLangConfig, $?: Record<string, unknown>): Map<string, QueryHooks> {
  const hooks = new Map<string, QueryHooks>();
  if (!langConfig?.rules) return hooks;

  const proxy = $ ?? createSymbolProxy();

  for (const [ruleName, ruleFn] of Object.entries(langConfig.rules)) {
    if (typeof ruleFn !== "function") continue;
    const ruleAST = ruleFn(proxy) as HookRuleAstLike | null | undefined;
    if (!ruleAST) continue;
    const t = (ruleAST.type || "").toUpperCase();
    if (t !== "DEF") continue;
    const options = ruleAST.options || ruleAST.value;
    if (!options) continue;

    const merged: Record<string, unknown> = {};
    if (options.queries) Object.assign(merged, options.queries);
    if (options.lints) {
      for (const [lintName, fn] of Object.entries(options.lints)) {
        merged["lint__" + lintName] = fn;
      }
    }
    if (Object.keys(merged).length > 0) {
      hooks.set(ruleName, merged);
    }
  }

  return hooks;
}

/**
 * Walks the evaluated language configuration to identify reference sites.
 */
export function extractRefHooks(langConfig: HookLangConfig, $?: Record<string, unknown>): RefHookInfo[] {
  const hooks: RefHookInfo[] = [];
  const proxy = $ ?? createSymbolProxy();

  if (!langConfig.rules) return hooks;

  for (const [ruleName, ruleFn] of Object.entries(langConfig.rules)) {
    if (typeof ruleFn !== "function") continue;
    const ruleAST = ruleFn(proxy);
    if (!ruleAST) continue;

    collectRefNodes(ruleAST, ruleName, hooks);
  }

  return hooks;
}

function collectRefNodes(node: unknown, ruleName: string, hooks: RefHookInfo[]): void {
  if (!node || typeof node !== "object") return;
  const ast = node as HookRuleAstLike;
  const t = (ast.type || "").toUpperCase();

  if (t === "REF") {
    const opts = (ast.options || ast.value || {}) as {
      name?: (self: SelfAccessor) => SelfAccessor | string;
      targetKinds?: string[];
      resolve?: "lexical" | "qualified";
    };
    let namePath = "name";
    if (opts.name) {
      const self = createSelfProxy();
      const accessor = opts.name(self);
      if (typeof accessor === "string" && accessor === "$self") {
        namePath = "$self";
      } else if (typeof accessor !== "string") {
        namePath = extractScopePath(accessor);
      }
    }
    hooks.push({
      ruleName,
      namePath,
      targetKinds: opts.targetKinds || [],
      resolve: opts.resolve || "lexical",
    });
  }

  if (t === "DEF") {
    const options = (ast.options || ast.value) as
      | {
          symbol?: (self: SelfAccessor) => {
            name?: SelfAccessor;
            ref?: { targetKinds?: string[]; resolve?: "lexical" | "qualified" };
          };
        }
      | undefined;
    if (options && typeof options.symbol === "function") {
      const self = createSelfProxy();
      const symConfig = options.symbol(self);
      if (symConfig && symConfig.ref) {
        let namePath = "name";
        if (symConfig.name) {
          namePath = extractScopePath(symConfig.name);
        }
        hooks.push({
          ruleName,
          namePath,
          targetKinds: symConfig.ref.targetKinds || [],
          resolve: symConfig.ref.resolve || "lexical",
        });
      }
    }
  }

  const children = ast.children || ast.args || (ast.arg ? [ast.arg] : []) || (ast.rule ? [ast.rule] : []);
  if (Array.isArray(children)) {
    for (const child of children) {
      collectRefNodes(child, ruleName, hooks);
    }
  }
}

/**
 * Extracts I18nConfig mappings from language definition.
 */
export function extractI18nConfig(langConfig: HookLangConfig, $?: Record<string, unknown>): Record<string, unknown> {
  const configs: Record<string, unknown> = {};
  if (!langConfig?.rules) return configs;

  const proxy = $ ?? createSymbolProxy();

  for (const [ruleName, ruleFn] of Object.entries(langConfig.rules)) {
    if (typeof ruleFn !== "function") continue;
    const ruleAST = ruleFn(proxy) as HookRuleAstLike | null | undefined;
    if (!ruleAST) continue;
    const t = (ruleAST.type || "").toUpperCase();
    if (t !== "DEF") continue;
    const options = ruleAST.options || ruleAST.value;
    if (options?.i18n) {
      configs[ruleName] = options.i18n;
    }
  }

  return configs;
}

/**
 * Extracts GraphicsConfig mappings from language definition.
 */
export function extractGraphicsConfig(
  langConfig: HookLangConfig,
  $?: Record<string, unknown>,
): Record<string, unknown> {
  const configs: Record<string, unknown> = {};
  if (!langConfig) return configs;

  // 1. Check top-level langConfig.graphics or langConfig.visual
  if (langConfig.graphics && typeof langConfig.graphics === "object") {
    Object.assign(configs, langConfig.graphics);
  }
  if (langConfig.visual?.entities && typeof langConfig.visual.entities === "object") {
    Object.assign(configs, langConfig.visual.entities);
  }
  if (langConfig.visual?.connections && typeof langConfig.visual.connections === "object") {
    Object.assign(configs, langConfig.visual.connections);
  }

  if (!langConfig.rules) return configs;

  const proxy = $ ?? createSymbolProxy();

  for (const [ruleName, ruleFn] of Object.entries(langConfig.rules)) {
    if (typeof ruleFn !== "function") continue;
    try {
      const ruleAST = ruleFn(proxy) as HookRuleAstLike | null | undefined;
      if (!ruleAST) continue;
      const t = (ruleAST.type || "").toUpperCase();
      if (t !== "DEF") continue;
      const options = ruleAST.options || ruleAST.value;
      const gfx = options?.graphics ?? options?.visual;
      if (gfx) {
        configs[ruleName] = typeof gfx === "function" ? (gfx as () => unknown)() : gfx;
      }
    } catch {
      // ignore rules that throw on proxy evaluation
    }
  }

  return configs;
}

/**
 * Extracts declarative `LanguageIndexingConfig` from a language definition, if defined.
 */
export function extractIndexingConfig(
  langConfig: HookLangConfig,
): import("../dsl/language.js").LanguageIndexingConfig | undefined {
  if (!langConfig || typeof langConfig !== "object") return undefined;
  return langConfig.indexing;
}
