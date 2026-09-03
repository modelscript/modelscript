// SPDX-License-Identifier: AGPL-3.0-or-later

import type { QueryDB, SymbolEntry, SymbolId } from "@modelscript/language/compiler";
import type { Context } from "./context.js";
import type { ModelicaModArgs } from "./modifications.js";

export interface CSGExecutionGraph {
  nodes: CSGNode[];
}

export interface CSGNode {
  type: string;
  uuid: string;
  parameters: Record<string, number>;
}

function resolveParamValue(value: unknown, scopeId: SymbolId | null, db: QueryDB): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return isNaN(parsed) ? null : parsed;
  }
  if (value && typeof value === "object") {
    const modVal = value as Record<string, unknown>;
    if (modVal.kind === "literal" && typeof modVal.value === "number") {
      return modVal.value;
    }
    if (modVal.kind === "expression") {
      if (typeof modVal.text === "string") {
        const parsed = Number(modVal.text);
        if (!isNaN(parsed)) return parsed;
      }
      try {
        const evalRes = db.evaluate(modVal, scopeId);
        if (typeof evalRes === "number") return evalRes;
      } catch {
        // Fallback
      }
    }
  }
  try {
    const evalRes = db.evaluate(value, scopeId);
    if (typeof evalRes === "number") return evalRes;
  } catch {
    // Fallback
  }
  return null;
}

/**
 * Extracts topologically ordered CSG primitives and operations (e.g. Stock, MillingOperation)
 * from a Modelica class definition.
 */
export function extractCSGTopology(context: Context, className: string): CSGExecutionGraph {
  const db = context.queryEngine.toQueryDB();
  const index = context.queryEngine.index;
  const instance = context.query(className);
  if (!instance) throw new Error(`Class ${className} not found`);

  let rootId: SymbolId | undefined = undefined;
  const candidates = index.byName.get(className);
  if (candidates && candidates.length > 0) {
    rootId = candidates[0];
  } else {
    const parts = className.split(".");
    let currentIds = index.byName.get(parts[0] as string);
    for (let i = 1; i < parts.length; i++) {
      const nextIds: SymbolId[] = [];
      for (const pid of currentIds ?? []) {
        const children = index.childrenOf.get(pid);
        for (const cid of children ?? []) {
          const childEntry = index.symbols.get(cid);
          if (childEntry?.name === parts[i]) {
            nextIds.push(cid);
          }
        }
      }
      currentIds = nextIds;
    }
    if (currentIds && currentIds.length > 0) rootId = currentIds[0];
  }

  if (rootId === undefined) {
    for (const [id, entry] of index.symbols) {
      if (entry.name === className && entry.kind === "Class") {
        rootId = id;
        break;
      }
    }
  }

  if (rootId === undefined) throw new Error(`Could not resolve SymbolId for ${className}`);

  const nodes: CSGNode[] = [];

  function walk(classId: SymbolId, prefix: string) {
    const children = db.childrenOf(classId);

    // Extends
    for (const child of children) {
      if (child.kind === "Extends") {
        const baseEntry = db.query<SymbolEntry | null>("resolvedBaseClass", child.id);
        if (baseEntry) {
          walk(baseEntry.id, prefix);
        }
      }
    }

    // Components
    for (const child of children) {
      if (child.kind === "Component") {
        const classInstId = db.query<SymbolId | null>("classInstance", child.id);
        if (!classInstId) continue;
        const classEntry = db.symbol(classInstId);
        if (!classEntry) continue;

        if (
          classEntry.name === "Stock" ||
          classEntry.name === "MillingOperation" ||
          classEntry.name === "CSGPrimitive"
        ) {
          const parameters: Record<string, number> = {};

          const inlineMod = db.query<ModelicaModArgs | null>("effectiveModification", child.id);
          if (inlineMod) {
            for (const arg of inlineMod.args) {
              if (arg.value) {
                const val = resolveParamValue(arg.value, child.parentId, db);
                if (val !== null) {
                  parameters[arg.name] = val;
                }
              }
            }
          }

          // CST fallback for inline modifications
          const cstNode = db.cstNode(child.id) as { text?: string } | null;
          if (cstNode?.text) {
            const text = cstNode.text;
            const parenIdx = text.indexOf("(");
            const lastParen = text.lastIndexOf(")");
            if (parenIdx !== -1 && lastParen > parenIdx) {
              const inner = text.substring(parenIdx + 1, lastParen);
              const parts = inner.split(",");
              for (const part of parts) {
                const eqIdx = part.indexOf("=");
                if (eqIdx !== -1) {
                  const k = part.substring(0, eqIdx).trim();
                  const v = parseFloat(part.substring(eqIdx + 1).trim());
                  if (k && !isNaN(v) && parameters[k] === undefined) {
                    parameters[k] = v;
                  }
                }
              }
            }
          }

          for (const compChild of db.childrenOf(classInstId)) {
            if (compChild.kind === "Component" && parameters[compChild.name] === undefined) {
              const defaultMod = db.query<ModelicaModArgs | null>("effectiveModification", compChild.id);
              if (defaultMod && defaultMod.args.length > 0 && defaultMod.args[0]?.value) {
                const val = resolveParamValue(defaultMod.args[0].value, compChild.parentId, db);
                if (val !== null) {
                  parameters[compChild.name] = val;
                }
              }

              if (parameters[compChild.name] === undefined) {
                const compCst = db.cstNode(compChild.id) as { text?: string } | null;
                if (compCst?.text) {
                  const eqIdx = compCst.text.indexOf("=");
                  if (eqIdx !== -1) {
                    const v = parseFloat(
                      compCst.text
                        .substring(eqIdx + 1)
                        .replace(";", "")
                        .trim(),
                    );
                    if (!isNaN(v)) {
                      parameters[compChild.name] = v;
                    }
                  }
                }
              }
            }
          }

          nodes.push({
            type: classEntry.name,
            uuid: prefix + child.name,
            parameters,
          });
        }

        walk(classInstId, prefix + child.name + ".");
      }
    }
  }

  walk(rootId, "");

  return { nodes };
}
