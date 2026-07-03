// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Context } from "@modelscript/core";
import type { SymbolId } from "@modelscript/compiler";
import type { CSGExecutionGraph, CSGNode } from "./worker.js";
import type { ModelicaModArgs } from "@modelscript/modelica/modification-args";

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
      const nextIds = [];
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const baseEntry = db.query<any>("resolvedBaseClass", child.id);
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
        
        if (classEntry.name === "Stock" || classEntry.name === "MillingOperation") {
           const parameters: Record<string, number> = {};
           
           const inlineMod = db.query<ModelicaModArgs | null>("effectiveModification", child.id);
           if (inlineMod) {
             for (const arg of inlineMod.args) {
               if (arg.value) {
                 const val = db.evaluate(arg.value, child.parentId);
                 if (typeof val === "number") {
                   parameters[arg.name] = val;
                 }
               }
             }
           }
           
           for (const compChild of db.childrenOf(classInstId)) {
             if (compChild.kind === "Component" && parameters[compChild.name] === undefined) {
               const defaultMod = db.query<ModelicaModArgs | null>("effectiveModification", compChild.id);
               if (defaultMod && defaultMod.args.length > 0 && defaultMod.args[0]?.value) {
                 const val = db.evaluate(defaultMod.args[0].value, compChild.parentId);
                 if (typeof val === "number") {
                   parameters[compChild.name] = val;
                 }
               }
             }
           }
           
           nodes.push({
             type: classEntry.name,
             uuid: prefix + child.name,
             parameters
           });
        }
        
        walk(classInstId, prefix + child.name + ".");
      }
    }
  }

  walk(rootId, "");
  
  return { nodes };
}
