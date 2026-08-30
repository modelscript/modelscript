/* eslint-disable @typescript-eslint/no-explicit-any */
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { IndexerHook, QueryHooks } from "./runtime.js";

export interface SelfAccessor {
  readonly [key: string]: SelfAccessor;
}

export const SCOPE_PATH = Symbol("scopePath");

export function createSelfProxy(path: string = ""): SelfAccessor {
  return new Proxy({} as SelfAccessor, {
    get(_, prop) {
      if (prop === SCOPE_PATH) return path;
      const newPath = path ? `${path}.${String(prop)}` : String(prop);
      return createSelfProxy(newPath) as any;
    },
  });
}

export function extractScopePath(accessor: SelfAccessor): string {
  return (accessor as any)[SCOPE_PATH] as string;
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

function createSymbolProxy(): Record<string, any> {
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
export function extractIndexerHooks(langConfig: any, $?: Record<string, any>): IndexerHook[] {
  const hooks: IndexerHook[] = [];
  const proxy = $ ?? createSymbolProxy();

  if (langConfig.symbols && typeof langConfig.symbols === "object") {
    for (const [ruleName, symConfig] of Object.entries<any>(langConfig.symbols)) {
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

  for (const [ruleName, ruleFn] of Object.entries<any>(langConfig.rules)) {
    if (typeof ruleFn !== "function") continue;
    const ruleAST = ruleFn(proxy);
    collectIndexerHooks(ruleAST, ruleName, hooks);
  }

  return hooks;
}

function collectIndexerHooks(node: any, ruleName: string, hooks: IndexerHook[]): void {
  if (!node || typeof node !== "object") return;

  const t = (node.type || "").toUpperCase();

  if (t === "DEF") {
    const options = node.options || node.value;
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
            metadataFieldPaths[key] = extractScopePath(accessor as any);
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
    const opts = node.options || node.value || {};
    let namePath = "name";
    if (opts.name) {
      const self = createSelfProxy();
      const accessor = opts.name(self);
      if (typeof accessor === "string" && accessor === "$self") {
        namePath = "$self";
      } else {
        namePath = extractScopePath(accessor);
      }
    }
    hooks.push({
      ruleName,
      kind: "Reference" as any,
      namePath,
      exportPaths: [],
      inheritPaths: [],
      metadataFieldPaths: {},
    });
  }

  const children = node.children || node.args || (node.arg ? [node.arg] : []) || (node.rule ? [node.rule] : []);
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
export function extractQueryHooks(langConfig: any, $?: Record<string, any>): QueryHookInfo[] {
  const hooks: QueryHookInfo[] = [];
  const proxy = $ ?? createSymbolProxy();

  if (!langConfig.rules) return hooks;

  for (const [ruleName, ruleFn] of Object.entries<any>(langConfig.rules)) {
    if (typeof ruleFn !== "function") continue;
    const ruleAST = ruleFn(proxy);

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
export function extractQueryHooksMap(langConfig: any, $?: Record<string, any>): Map<string, QueryHooks> {
  const hooks = new Map<string, QueryHooks>();
  if (!langConfig?.rules) return hooks;

  const proxy = $ ?? createSymbolProxy();

  for (const [ruleName, ruleFn] of Object.entries<any>(langConfig.rules)) {
    if (typeof ruleFn !== "function") continue;
    const ruleAST = ruleFn(proxy);
    if (!ruleAST) continue;
    const t = (ruleAST.type || "").toUpperCase();
    if (t !== "DEF") continue;
    const options = ruleAST.options || ruleAST.value;
    if (!options) continue;

    const merged: Record<string, any> = {};
    if (options.queries) Object.assign(merged, options.queries);
    if (options.lints) {
      for (const [lintName, fn] of Object.entries<any>(options.lints)) {
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
export function extractRefHooks(langConfig: any, $?: Record<string, any>): RefHookInfo[] {
  const hooks: RefHookInfo[] = [];
  const proxy = $ ?? createSymbolProxy();

  if (!langConfig.rules) return hooks;

  for (const [ruleName, ruleFn] of Object.entries<any>(langConfig.rules)) {
    if (typeof ruleFn !== "function") continue;
    const ruleAST = ruleFn(proxy);
    if (!ruleAST) continue;

    collectRefNodes(ruleAST, ruleName, hooks);
  }

  return hooks;
}

function collectRefNodes(node: any, ruleName: string, hooks: RefHookInfo[]): void {
  if (!node || typeof node !== "object") return;

  const t = (node.type || "").toUpperCase();

  if (t === "REF") {
    const opts = node.options || node.value || {};
    let namePath = "name";
    if (opts.name) {
      const self = createSelfProxy();
      const accessor = opts.name(self);
      if (typeof accessor === "string" && accessor === "$self") {
        namePath = "$self";
      } else {
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
    const options = node.options || node.value;
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

  const children = node.children || node.args || (node.arg ? [node.arg] : []) || (node.rule ? [node.rule] : []);
  if (Array.isArray(children)) {
    for (const child of children) {
      collectRefNodes(child, ruleName, hooks);
    }
  }
}

/**
 * Extracts I18nConfig mappings from language definition.
 */
export function extractI18nConfig(langConfig: any, $?: Record<string, any>): Record<string, any> {
  const configs: Record<string, any> = {};
  if (!langConfig?.rules) return configs;

  const proxy = $ ?? createSymbolProxy();

  for (const [ruleName, ruleFn] of Object.entries<any>(langConfig.rules)) {
    if (typeof ruleFn !== "function") continue;
    const ruleAST = ruleFn(proxy);
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
