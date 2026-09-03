/* eslint-disable */
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Modelica Salsa Query Hooks.
 * Semantic query definitions for QueryEngine.
 */

import { error, warning } from "@modelscript/language";
import type { QueryDB, SymbolEntry, SymbolId } from "@modelscript/language/compiler";
import { isBroken, mergeModArgs, type ModelicaModArgs } from "./modifications.js";

function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed,
    h2 = 0x41c6ce57 ^ seed;
  for (let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString();
}

export function checkModifierNotFound(
  db: QueryDB,
  self: SymbolEntry,
  mod: any,
  typeClassId: SymbolId,
  typeEntry: SymbolEntry,
  overrideClassName?: string,
) {
  if (!typeClassId || !typeEntry || !mod || !mod.args || mod.args.length === 0) return null;

  const declaredNames = new Set<string>();

  let currentEntry: SymbolEntry | null = typeEntry;
  let isBuiltin = currentEntry?.metadata?.isPredefined;
  let isEnum = currentEntry?.metadata?.classPrefixes === "enumeration";
  let visited = new Set<SymbolId>();

  while (currentEntry && !isBuiltin && !isEnum && !visited.has(currentEntry.id)) {
    visited.add(currentEntry.id);
    let nextId: SymbolId | null = null;

    // If it's a component, get its class instance
    if (currentEntry.kind === "Component") {
      nextId = db.query<SymbolId | null>("classInstance", currentEntry.id);
    } else if (currentEntry.kind === "Class") {
      // If it's a ShortClassSpecifier, resolve its type
      const cst = db.cstNode(currentEntry.id) as any;
      const spec = cst?.childForFieldName?.("classSpecifier");
      if (spec?.type === "ShortClassSpecifier") {
        const typeName = spec.childForFieldName("typeSpecifier")?.text;
        if (typeName) {
          const resolve = db.query<any>("resolveName", currentEntry.parentId || currentEntry.id);
          let baseEntry: SymbolEntry | null = null;
          if (resolve) baseEntry = resolve(typeName, true) as SymbolEntry | null;
          if (!baseEntry && currentEntry.parentId) {
            const resSimple = db.query<any>("resolveSimpleName", currentEntry.parentId);
            if (resSimple) baseEntry = resSimple(typeName.split(".")[0]) as SymbolEntry | null;
          }
          if (!baseEntry) baseEntry = db.byName(typeName.split(".").pop()!)[0] ?? null;
          if (baseEntry) nextId = baseEntry.id;
        }
      }
    }

    if (!nextId || nextId === currentEntry.id) break;
    currentEntry = db.symbol(nextId) as SymbolEntry | null;
    if (currentEntry) {
      isBuiltin = currentEntry.metadata?.isPredefined;
      isEnum = currentEntry.metadata?.classPrefixes === "enumeration";
    }
  }

  if (isBuiltin || isEnum) {
    for (const k of Object.keys(currentEntry?.metadata || {})) {
      if (
        k !== "classKind" &&
        k !== "isPredefined" &&
        k !== "description" &&
        k !== "isEnumeration" &&
        k !== "literals" &&
        k !== "classPrefixes"
      ) {
        declaredNames.add(k);
      }
    }
    if (isEnum) {
      declaredNames.add("min");
      declaredNames.add("max");
      declaredNames.add("start");
      declaredNames.add("fixed");
    }
    if (currentEntry?.name === "StateSelect") declaredNames.add("default");
  }

  const elements = db.query<SymbolId[]>("instantiate", typeClassId) || [];
  for (const eid of elements) {
    const child = db.symbol(eid);
    if (child && child.name && child.kind !== "Reference") declaredNames.add(child.name);
  }

  const results = [];
  for (const arg of mod.args) {
    if (
      arg.name &&
      arg.name !== "annotation" &&
      !arg.name.startsWith("break_connect:") &&
      !declaredNames.has(arg.name)
    ) {
      let msg: string;
      if (self.kind === "Class") {
        if (overrideClassName === self.name) {
          let modText = arg.name;
          if (arg.value && typeof arg.value.text === "string") {
            modText += " = " + arg.value.text;
          } else if (arg.bindingExpression) {
            modText += " = " + arg.bindingExpression;
          }
          msg = `In modifier (${modText}), class or component ${arg.name} not found in <${self.name}>.`;
        } else {
          msg = `Modified element ${arg.name} not found in class ${typeEntry.name}.`;
        }
      } else if (!arg.isRedeclaration && overrideClassName) {
        // value modifier on a short class or nested
        let modText = arg.name;
        if (arg.value && typeof arg.value.text === "string") {
          modText += " = " + arg.value.text;
        } else if (arg.bindingExpression) {
          modText += " = " + arg.bindingExpression;
        }
        msg = `Variable ${self.name}.${overrideClassName}: In modifier (${modText}), class or component ${arg.name} not found in <${typeEntry.name}$${self.name}$${overrideClassName}>.`;
      } else {
        // Use the base type name
        msg = `Variable ${self.name}: In modifier (${arg.name}), class or component ${arg.name} not found in <${typeEntry.name}$${self.name}>.`;
      }

      if (arg.nameRange) {
        results.push(
          error(msg, {
            startByte: arg.nameRange[0],
            endByte: arg.nameRange[1],
          }),
        );
      } else {
        results.push(
          error(msg, {
            field: "declaration.modification",
          }),
        );
      }
    } else if (arg.name && declaredNames.has(arg.name)) {
      // Find the original element to check if it's a function replacement, or if it's final/constant
      const elements = db.query<SymbolId[]>("instantiate", typeClassId) || [];
      let originalId: SymbolId | null = null;
      for (const eid of elements) {
        const child = db.symbol(eid);
        if (child && child.name === arg.name) {
          originalId = eid;
          break;
        }
      }

      if (originalId) {
        const originalEntry = db.symbol(originalId);

        if (
          arg.value &&
          typeof arg.value === "object" &&
          arg.value.kind === "break" &&
          !arg.name.startsWith("break_connect:")
        ) {
          if (originalEntry && originalEntry.kind !== "Component") {
            results.push(
              error(`Invalid use of break on non-component '${arg.name}'.`, {
                startByte: arg.nameRange ? arg.nameRange[0] : undefined,
                endByte: arg.nameRange ? arg.nameRange[1] : undefined,
                field: arg.nameRange ? undefined : "declaration.modification",
              }),
            );
          }
        }

        const isFinal = db.query<boolean>("isFinal", originalId);
        if (isFinal) {
          results.push(
            error(`Redeclaration of final component ${arg.name} is not allowed.`, {
              startByte: arg.nameRange ? arg.nameRange[0] : undefined,
              endByte: arg.nameRange ? arg.nameRange[1] : undefined,
              field: arg.nameRange ? undefined : "declaration.modification",
            }),
          );
        }

        const variability = db.query<string>("variability", originalId);
        if (variability === "constant") {
          const origCst = db.cstNode(originalId) as any;
          const hasBinding = !!origCst?.childForFieldName?.("modification");
          if (hasBinding) {
            results.push(
              warning(`Redeclaration of constant component ${arg.name} is not allowed.`, {
                startByte: arg.nameRange ? arg.nameRange[0] : undefined,
                endByte: arg.nameRange ? arg.nameRange[1] : undefined,
                field: arg.nameRange ? undefined : "declaration.modification",
              }),
            );
          }
        }

        // Check if both are functions
        if (
          arg.isRedeclaration &&
          arg.redeclaredTypeSpecifier &&
          originalEntry &&
          (originalEntry.metadata?.classPrefixes as string)?.includes("function")
        ) {
          const resolve = db.query<any>("resolveName", self.id);
          let redeclaredEntry: SymbolEntry | null = null;
          if (resolve) redeclaredEntry = resolve(arg.redeclaredTypeSpecifier, true) as SymbolEntry | null;

          // If not found from self.id, try parentId
          if (!redeclaredEntry && self.parentId) {
            const resolveParent = db.query<any>("resolveName", self.parentId);
            if (resolveParent) redeclaredEntry = resolveParent(arg.redeclaredTypeSpecifier, true) as SymbolEntry | null;
          }

          if (redeclaredEntry && (redeclaredEntry.metadata?.classPrefixes as string)?.includes("function")) {
            const origElements = db.query<SymbolId[]>("instantiate", originalId) || [];
            const newElements = db.query<SymbolId[]>("instantiate", redeclaredEntry.id) || [];

            const getInputs = (eids: SymbolId[]) => {
              const inputs: string[] = [];
              for (const eid of eids) {
                const child = db.symbol(eid);
                if (child && child.kind === "Component") {
                  const causality = db.query<string>("causality", eid);
                  if (causality === "input") inputs.push(child.name!);
                }
              }
              return inputs;
            };

            const origInputs = getInputs(origElements);
            const newInputs = getInputs(newElements);

            let mismatch = origInputs.length !== newInputs.length;
            if (!mismatch) {
              for (let i = 0; i < origInputs.length; i++) {
                if (origInputs[i] !== newInputs[i]) {
                  mismatch = true;
                  break;
                }
              }
            }

            if (mismatch) {
              results.push(
                error(`Function arguments must be identical, including their names, in functions of the same type.`, {
                  startByte: arg.nameRange ? arg.nameRange[0] : undefined,
                  endByte: arg.nameRange ? arg.nameRange[1] : undefined,
                  field: arg.nameRange ? undefined : "declaration.modification",
                }),
              );
            }
          }
        }

        // Recursively check nested arguments
        if (arg.nestedArgs && arg.nestedArgs.length > 0) {
          let nestedTypeClassId = db.query<SymbolId | null>("classInstance", originalId);

          if (arg.isRedeclaration && arg.redeclaredTypeSpecifier) {
            const resolve = db.query<any>("resolveName", self.id);
            let redeclaredEntry: SymbolEntry | null = null;
            if (resolve) redeclaredEntry = resolve(arg.redeclaredTypeSpecifier, true) as SymbolEntry | null;
            if (!redeclaredEntry && self.parentId) {
              const resolveParent = db.query<any>("resolveName", self.parentId);
              if (resolveParent)
                redeclaredEntry = resolveParent(arg.redeclaredTypeSpecifier, true) as SymbolEntry | null;
            }
            if (redeclaredEntry) nestedTypeClassId = redeclaredEntry.id;
          }

          if (nestedTypeClassId) {
            const nestedTypeEntry = db.symbol(nestedTypeClassId);
            if (nestedTypeEntry) {
              const nestedResults = checkModifierNotFound(
                db,
                self,
                { args: arg.nestedArgs },
                nestedTypeClassId,
                nestedTypeEntry,
                arg.name,
              );
              if (nestedResults) results.push(...nestedResults);
            }
          }
        }
      }
    }
  }
  return results.length > 0 ? results : null;
}

export function parseModArgsFromCst(node: any, scopeId: number | null = null): any {
  const args: any[] = [];
  if (!node) return { args, bindingExpression: null, evaluationScopeId: scopeId };

  const walk = (n: any) => {
    if (!n) return;
    if (n.type === "ElementModification") {
      const nameNode = n.childForFieldName("name");
      const modNode = n.childForFieldName("modification");
      const finalNode = n.children.find((c: any) => c.type === "final");
      const eachNode = n.children.find((c: any) => c.type === "each");

      const name = nameNode ? nameNode.text : "";
      const nameRange = nameNode ? ([nameNode.startIndex, nameNode.endIndex] as const) : undefined;
      const nested = parseModArgsFromCst(modNode, scopeId);

      const parts = name.split(".");
      let currentNested = nested;
      for (let i = parts.length - 1; i > 0; i--) {
        currentNested = {
          args: [
            {
              name: parts[i],
              each: false,
              final: false,
              isRedeclaration: false,
              nestedArgs: currentNested.args,
              value: currentNested.bindingExpression,
              evaluationScopeId: scopeId,
            },
          ],
          bindingExpression: null,
        };
      }

      args.push({
        name: parts[0],
        nameRange,
        each: !!eachNode,
        final: !!finalNode,
        isRedeclaration: false,
        nestedArgs: currentNested.args,
        value: currentNested.bindingExpression,
        evaluationScopeId: scopeId,
      });
      return;
    } else if (n.type === "ElementRedeclaration" || n.type === "ElementReplaceable") {
      const extractSubscripts = (arraySubNode: any): any[] | undefined => {
        if (!arraySubNode) return undefined;
        const subs: any[] = [];
        for (const child of arraySubNode.children) {
          if (child.type !== "Subscript") continue;
          const flexChild = child.childForFieldName("flexible");
          if (flexChild) {
            subs.push({ kind: "flexible" });
            continue;
          }
          const exprChild = child.childForFieldName("expression");
          if (exprChild) {
            if (exprChild.type === "UNSIGNED_INTEGER") {
              subs.push({ kind: "literal", value: parseInt(exprChild.text, 10) });
            } else {
              subs.push({
                kind: "expression",
                cstBytes: [exprChild.startIndex ?? exprChild.startByte, exprChild.endIndex ?? exprChild.endByte],
                text: exprChild.text,
              });
            }
            continue;
          }
        }
        return subs.length > 0 ? subs : undefined;
      };

      const clause = n.childForFieldName("componentClause");
      if (clause) {
        const typeSpec = clause.childForFieldName("typeSpecifier");
        const decl1 = clause.childForFieldName("componentDeclaration");
        const decl = decl1?.childForFieldName("declaration");
        const ident = decl?.childForFieldName("identifier");
        const modNode = decl?.childForFieldName("modification");

        const name = ident ? ident.text : "";
        const nameRange = ident ? ([ident.startIndex, ident.endIndex] as const) : undefined;
        const typeName = typeSpec ? typeSpec.text : "";
        const nested = parseModArgsFromCst(modNode, scopeId);

        args.push({
          name,
          nameRange,
          each: false,
          final: false,
          isRedeclaration: true,
          redeclaredTypeSpecifier: typeName,
          redeclaredArrayDimensionsRaw: extractSubscripts(decl1?.childForFieldName("arraySubscripts")),
          nestedArgs: nested.args,
          value: nested.bindingExpression,
          evaluationScopeId: scopeId,
        });
      } else {
        const classDef = n.childForFieldName("classDefinition");
        if (classDef) {
          const shortClass = classDef.childForFieldName("classSpecifier");
          if (shortClass) {
            const ident = shortClass.childForFieldName("identifier");
            const typeSpec = shortClass.childForFieldName("typeSpecifier");
            const name = ident ? ident.text : "";
            const typeName = typeSpec ? typeSpec.text : "";

            const modNode = shortClass.childForFieldName("classModification");
            const nested = parseModArgsFromCst(modNode, scopeId);

            args.push({
              name,
              each: false,
              final: false,
              isRedeclaration: true,
              redeclaredTypeSpecifier: typeName,
              redeclaredArrayDimensionsRaw: extractSubscripts(shortClass.childForFieldName("arraySubscripts")),
              nestedArgs: nested.args,
              value: nested.bindingExpression,
              evaluationScopeId: scopeId,
            });
          }
        }
      }
      return;
    } else if (n.type === "InheritanceModification") {
      const connectEq = n.childForFieldName("connectEquation");
      if (connectEq) {
        const source = connectEq.childForFieldName("componentReference1");
        const target = connectEq.childForFieldName("componentReference2");
        if (source && target) {
          const canonEq = `connect(${source.text},${target.text})`;
          args.push({
            name: "break_connect:" + canonEq,
            each: false,
            final: false,
            isRedeclaration: false,
            nestedArgs: [],
            value: { kind: "break", target: canonEq },
            evaluationScopeId: scopeId,
          });
        }
      }
      const identifier = n.childForFieldName("identifier");
      if (identifier) {
        args.push({
          name: identifier.text,
          each: false,
          final: false,
          isRedeclaration: false,
          nestedArgs: [],
          value: { kind: "break" },
          evaluationScopeId: scopeId,
        });
      }
      return;
    }
    if (n.type === "ModificationExpression" || n.type === "modification_expression") return;
    for (const child of n.children) walk(child);
  };
  walk(node);

  let bindingExpression = null;
  const nt = node.type.toLowerCase();
  if (nt === "modification" || nt === "elementmodification" || nt === "element_modification") {
    const expr = node.childForFieldName("modification_expression") ?? node.childForFieldName("modificationExpression");
    if (expr) bindingExpression = { kind: "expression", cstBytes: [expr.startIndex, expr.endIndex], text: expr.text };
  }

  let finalMod: ModelicaModArgs = { args: [], bindingExpression, evaluationScopeId: scopeId };
  for (const arg of args) {
    finalMod = mergeModArgs({ args: [arg], bindingExpression: null, evaluationScopeId: scopeId }, finalMod);
  }

  return finalMod;
}

const BUILTIN_MODELICA_NAMES = new Set([
  // Independent variable
  "time",
  // Built-in operators
  "der",
  "pre",
  "edge",
  "change",
  "reinit",
  "initial",
  "terminal",
  "sample",
  "noEvent",
  "smooth",
  "delay",
  "cardinality",
  "inStream",
  "actualStream",
  // Synchronous Language Elements
  "Clock",
  "hold",
  "previous",
  "backSample",
  "shiftSample",
  "subSample",
  "superSample",
  "noClock",
  "interval",
  "initialState",
  "activeState",
  "ticksInState",
  "timeInState",
  "transition",
  // Assertions / utilities
  "assert",
  "print",
  "terminate",
  // Mathematical functions
  "abs",
  "sign",
  "sqrt",
  "exp",
  "log",
  "log10",
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "atan2",
  "sinh",
  "cosh",
  "tanh",
  "floor",
  "ceil",
  "integer",
  "mod",
  "rem",
  "div",
  // Array / reduction functions
  "max",
  "min",
  "sum",
  "product",
  "ndims",
  "size",
  "zeros",
  "ones",
  "fill",
  "identity",
  "diagonal",
  "transpose",
  "cat",
  "scalar",
  "vector",
  "matrix",
  "cross",
  "skew",
  "outerProduct",
  "symmetric",
  // Type names
  "String",
  "Integer",
  "Boolean",
  "Real",
  // Modelica package
  "Modelica",
  // Enumerations
  "enumeration",
  // Scripting API
  "simulate",
]);

// ---------------------------------------------------------------------------
// Helper combinators (mirrors grammar.js utility functions)
// ---------------------------------------------------------------------------

/**
 * Split a string on top-level commas (ignoring commas inside parentheses).
 * Used for parsing class modification argument lists.
 */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") depth--;
    else if (text[i] === "," && depth === 0) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  const last = text.slice(start).trim();
  if (last) parts.push(last);
  return parts;
}

export interface ScopeData {
  directByName: Record<string, SymbolId>;
  qualifiedImports: Record<string, string>;
  unqualifiedImportPkgs: string[];
  compoundImports: Array<{ pkg: string; names: string[] }>;
  isEncapsulated: boolean;
  parentId: SymbolId | null;
  id: SymbolId;
}

let __g_scope_calls = 0;
let __g_scope_time = 0;
export function getScopeData(db: QueryDB, self: SymbolEntry): ScopeData {
  const _t0 = performance.now();
  __g_scope_calls++;
  const baseId = db.baseOf(self.id);
  const sourceId = baseId ?? self.id;
  const children = db.childrenOf(sourceId);

  const directByName: Record<string, SymbolId> = {};
  const qualifiedImports: Record<string, string> = {};
  const unqualifiedImportPkgs: string[] = [];
  const compoundImports: Array<{ pkg: string; names: string[] }> = [];

  for (const child of children) {
    if (child.kind === "Class" || child.kind === "Component" || child.kind === "EnumerationLiteral") {
      directByName[child.name] = child.id;
    }

    if (child.kind === "Import") {
      const meta = child.metadata as Record<string, unknown>;
      const importKind =
        (meta?.importKind as string | undefined) ??
        (child.ruleName === "UnqualifiedImportClause"
          ? "unqualified"
          : child.ruleName === "CompoundImportClause"
            ? "compound"
            : "simple");
      const pkgName = (meta?.packageName ?? child.name) as string;

      if (importKind === "simple") {
        const shortName = (meta?.shortName as string) ?? pkgName.split(".").pop() ?? pkgName;
        qualifiedImports[shortName] = pkgName;
      } else if (importKind === "unqualified") {
        unqualifiedImportPkgs.push(pkgName);
      } else if (importKind === "compound") {
        const importNames = db
          .childrenOfField(child.id, "importName")
          .map((c) => c.name)
          .filter(Boolean);
        compoundImports.push({ pkg: pkgName, names: importNames });
      }
    }
  }

  const isEncapsulated = !!(self.metadata as Record<string, unknown>)?.encapsulated;

  const ret = {
    directByName,
    qualifiedImports,
    unqualifiedImportPkgs,
    compoundImports,
    isEncapsulated,
    parentId: self.parentId,
    id: self.id,
  };
  return ret;
}

export function mergeInto(target: Record<string, SymbolId>, source: Record<string, SymbolId>) {
  for (const [key, value] of Object.entries(source)) {
    if (!(key in target)) {
      target[key] = value;
    }
  }
}

export function resolveSimpleNameHelper(
  db: QueryDB,
  classId: SymbolId,
  name: string,
  encapsulated = false,
  skipInherited = false,
): SymbolEntry | null {
  const unspecializedId = db.baseOf(classId) ?? classId;
  const scope = db.query<ScopeData | null>("scopeData", unspecializedId);
  if (!scope) return null;

  // 1. Direct elements
  const directId = scope.directByName[name];
  if (directId !== undefined) return db.symbol(directId);

  // 2. Inherited elements
  if (!skipInherited) {
    const inheritedMap = db.query<Record<string, SymbolId> | null>("inheritedSymbolsMap", unspecializedId);
    const inheritedId = inheritedMap?.[name];
    if (inheritedId !== undefined) return db.symbol(inheritedId);
  }

  // 2.5. Short class target
  if (!skipInherited) {
    const self = db.symbol(classId);
    const meta = self?.metadata as Record<string, unknown>;
    if (self && !meta?.isPredefined) {
      const cst = db.cstNode(classId) as any;
      const classSpecifier = cst?.childForFieldName?.("classSpecifier");
      if (classSpecifier?.type === "ShortClassSpecifier") {
        const typeSpec = classSpecifier.childForFieldName?.("typeSpecifier");
        const typeName = typeSpec?.text;
        if (typeName && self.parentId !== null) {
          const parentResolver = db.query<(n: string) => { id: SymbolId } | null>("resolveName", self.parentId);
          if (parentResolver) {
            const resolved = parentResolver(typeName);
            if (resolved?.id && resolved.id !== classId) {
              const found = resolveSimpleNameHelper(db, resolved.id, name, encapsulated, skipInherited);
              if (found) return found;
            }
          }
        }
      }
    }
  }

  // 3. Qualified imports
  const qualPkg = scope.qualifiedImports[name];
  if (qualPkg) {
    return resolveQualified(db, qualPkg);
  }

  // Helper to resolve an import path, respecting local aliases for the first segment
  const resolveImportPath = (pathStr: string): SymbolEntry | null => {
    const parts = pathStr.split(".");
    const first = parts[0];
    const aliasTarget = scope.qualifiedImports[first!];
    if (aliasTarget) {
      const fullPath = [aliasTarget, ...parts.slice(1)].join(".");
      return resolveQualified(db, fullPath);
    } else {
      return resolveQualified(db, pathStr);
    }
  };

  // 4. Compound imports
  for (const ci of scope.compoundImports) {
    if (ci.names.includes(name)) {
      const pkgEntry = resolveImportPath(ci.pkg);
      if (pkgEntry) {
        const foundEntry = db.childrenOf(pkgEntry.id).find((c) => c.name === name && c.kind !== "Reference");
        if (foundEntry) return foundEntry;
      }
    }
  }

  // 5. Unqualified imports
  for (const pkg of scope.unqualifiedImportPkgs) {
    const pkgEntry = resolveImportPath(pkg);
    if (pkgEntry) {
      for (const pkgChild of db.childrenOf(pkgEntry.id)) {
        if (pkgChild.name === name && pkgChild.kind !== "Reference") return pkgChild;
      }
    }
  }

  // 6. Parent scope walk (unless encapsulated)
  if (!encapsulated && !scope.isEncapsulated && scope.parentId !== null && scope.parentId !== unspecializedId) {
    const parentEntry = db.symbol(scope.parentId);
    if (parentEntry && (parentEntry.kind === "Class" || parentEntry.kind === "Package")) {
      const found = resolveSimpleNameHelper(db, parentEntry.id, name, false, skipInherited);
      if (found) return found;
    }
  }

  // 7. Predefined types fallback
  const predefined = db.byName(name);
  return (
    predefined?.find(
      (e) => e.kind === "Class" || e.kind === "Package" || e.kind === "Function" || e.kind === "Definition",
    ) ?? null
  );
}

/**
 * Resolves a dot-separated path from the global scope.
 * Used for resolving import targets and global fallbacks.
 */
function resolveQualified(db: QueryDB, path: string): SymbolEntry | null {
  const parts = path.split(".");
  if (parts.length === 0) return null;

  // Try to find the root part (entry with no parent)
  const rootEntries = db.byName(parts[0]!);
  let current =
    rootEntries.find((e) => (e.metadata as any)?.isPredefined) ??
    rootEntries.find((e) => e.parentId === null) ??
    rootEntries.find((e) => ["Class", "Package", "Function", "Definition", "Enumeration"].includes(e.kind)) ??
    rootEntries[0] ??
    null;

  if (!current) return null;

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i]!;
    const children = db.childrenOf(current.id);
    // Prefer non-reference entries (Class, Component) over Reference entries
    current =
      children.find((c) => c.name === part && c.kind !== "Reference") || children.find((c) => c.name === part) || null;
    if (!current) return null;
  }

  return current;
}

// Stacks for tracking dimension evaluation and queries to detect cycles
interface DimensionStackFrame {
  symbolId: SymbolId;
  dimIndex: number;
  exprText: string;
}

interface ActiveDimQuery {
  symbolId: SymbolId;
  dimIndex: number;
}

let evaluatingDimensionsStack: DimensionStackFrame[] = [];
let activeDimQueriesStack: ActiveDimQuery[] = [];
const cyclicDimensionDiagnostics = new Map<SymbolId, Array<{ dimIndex: number; exprText: string }>>();
let activeQueryDB: QueryDB | null = null;

function addCyclicDiagnostic(symbolId: SymbolId, dimIndex: number, exprText: string) {
  let list = cyclicDimensionDiagnostics.get(symbolId);
  if (!list) {
    list = [];
    cyclicDimensionDiagnostics.set(symbolId, list);
  }
  if (!list.some((d) => d.dimIndex === dimIndex)) {
    list.push({ dimIndex, exprText });
  }
}

// ---------------------------------------------------------------------------
// Dimension Expression Evaluator (for resolvedArrayDimensions Salsa query)
// ---------------------------------------------------------------------------

/**
 * Evaluate a dimension expression to a concrete integer value.
 *
 * Walks the CST node for the expression and evaluates it in the Salsa
 * query context. Supports:
 *   - Integer literals
 *   - Name references to parameters/constants (reads their binding value)
 *   - size(x, d) calls → recursively queries resolvedArrayDimensions (cycle-safe)
 *   - Basic arithmetic (+, -, *, integer(), ndims())
 *   - Enumeration type references (returns literal count)
 *
 * Returns null if the expression cannot be statically evaluated.
 */
function evaluateDimExpr(
  db: QueryDB,
  self: SymbolEntry,
  dim: { kind: "expression"; cstBytes: readonly [number, number]; text?: string },
): number | null {
  // Try to get the CST node for this expression
  const cst = db.cstNodeRange(dim.cstBytes[0], dim.cstBytes[1], self) as any;
  if (!cst) {
    // Fallback: try to parse the text directly as an integer
    if (dim.text) {
      const parsed = parseInt(dim.text, 10);
      if (!isNaN(parsed) && String(parsed) === dim.text.trim()) return parsed;
    }
    return null;
  }
  return evaluateDimCSTNode(db, self, cst);
}

/**
 * Recursively evaluate a CST node to an integer value in a Salsa context.
 */
function evaluateDimCSTNode(db: QueryDB, self: SymbolEntry, node: any): number | null {
  if (!node) return null;
  const type = node.type;

  // Integer literal
  if (type === "UNSIGNED_INTEGER") {
    return parseInt(node.text, 10);
  }

  // Parenthesized expression — unwrap
  if (type === "ParenthesizedExpression") {
    const inner = node.childForFieldName("expression");
    return evaluateDimCSTNode(db, self, inner);
  }

  // Binary expression (a + b, a * b, a - b)
  if (type === "BinaryExpression") {
    const op1 = node.childForFieldName("operand1");
    const op = node.childForFieldName("operator");
    const op2 = node.childForFieldName("operand2");
    const left = evaluateDimCSTNode(db, self, op1);
    const right = evaluateDimCSTNode(db, self, op2);
    if (left === null || right === null) return null;
    const opText = op?.text;
    if (opText === "+") return left + right;
    if (opText === "-") return left - right;
    if (opText === "*") return left * right;
    if (opText === "/") return right !== 0 ? Math.floor(left / right) : null;
    if (opText === "^") return Math.pow(left, right);
    return null;
  }

  // Unary expression (-a, +a)
  if (type === "UnaryExpression") {
    const op = node.childForFieldName("operator");
    const operand = node.childForFieldName("operand");
    const val = evaluateDimCSTNode(db, self, operand);
    if (val === null) return null;
    return op?.text === "-" ? -val : val;
  }

  // Function call — handle size(), integer(), ndims()
  if (type === "FunctionCall") {
    const funcRef = node.childForFieldName("functionReference");
    const funcName = funcRef?.text;

    if (funcName === "size") {
      return evaluateDimSizeCall(db, self, node);
    }
    if (funcName === "integer") {
      // integer(expr) — evaluate the inner expression
      const args = node.childForFieldName("functionCallArguments");
      const firstArg = args?.namedChildren?.find((c: any) => c.type !== "(" && c.type !== ")" && c.type !== ",");
      return evaluateDimCSTNode(db, self, firstArg);
    }
    if (funcName === "ndims") {
      return evaluateDimNdimsCall(db, self, node);
    }
    return null;
  }

  // Component reference — resolve to a parameter/constant value
  if (type === "ComponentReference" || type === "ComponentReferencePart") {
    const refText = node.text;
    if (!refText) return null;
    return evaluateDimNameRef(db, self, refText);
  }

  // Name — sometimes dimension expressions are just names
  if (type === "Name" || type === "IDENT") {
    return evaluateDimNameRef(db, self, node.text);
  }

  // If the node is a simple text that looks like an integer
  if (node.text) {
    const parsed = parseInt(node.text, 10);
    if (!isNaN(parsed) && String(parsed) === node.text.trim()) return parsed;
  }

  return null;
}

/**
 * Helper to safely get or evaluate a single dimension index of a component.
 * If the component is already on evaluatingDimensionsStack, we evaluate only
 * the requested dimension index directly (bypassing the Salsa query for the component
 * as a whole) to avoid false-positive circular dependency detections in Salsa.
 */
function getOrEvaluateSingleDimension(db: QueryDB, resolved: SymbolEntry, idx: number): number | null {
  const isCurrentlyEvaluating = evaluatingDimensionsStack.some((f) => f.symbolId === resolved.id);
  if (!isCurrentlyEvaluating) {
    const resolvedDims = db.query<number[] | null>("resolvedArrayDimensions", resolved.id);
    return resolvedDims ? (resolvedDims[idx] ?? null) : null;
  }

  // Fallback: evaluate only the requested dimension index directly to avoid false cycles
  const rawDims = db.query<Array<
    | { kind: "literal"; value: number }
    | { kind: "flexible" }
    | { kind: "expression"; cstBytes: readonly [number, number]; text?: string }
  > | null>("arrayDimensions", resolved.id);
  if (!rawDims || idx < 0 || idx >= rawDims.length) return null;

  const dim = rawDims[idx];
  if (dim.kind === "literal") {
    return dim.value;
  } else if (dim.kind === "flexible") {
    return 0;
  } else if (dim.kind === "expression") {
    const isEvaluatingThisDim = evaluatingDimensionsStack.some((f) => f.symbolId === resolved.id && f.dimIndex === idx);
    if (isEvaluatingThisDim) {
      // Actual cycle detected! Report it.
      const frame = evaluatingDimensionsStack[evaluatingDimensionsStack.length - 1];
      if (frame) {
        addCyclicDiagnostic(frame.symbolId, frame.dimIndex, frame.exprText);
      } else {
        addCyclicDiagnostic(resolved.id, idx, dim.text ?? "?");
      }
      return null;
    }
    evaluatingDimensionsStack.push({
      symbolId: resolved.id,
      dimIndex: idx,
      exprText: dim.text ?? "?",
    });
    let value: number | null = null;
    try {
      value = evaluateDimExpr(db, resolved, dim);
    } finally {
      evaluatingDimensionsStack.pop();
    }
    return value;
  }
  return null;
}

/**
 * Helper to get the number of dimensions (ndims) of a component.
 */
function getOrEvaluateNdims(db: QueryDB, resolved: SymbolEntry): number | null {
  const rawDims = db.query<Array<
    | { kind: "literal"; value: number }
    | { kind: "flexible" }
    | { kind: "expression"; cstBytes: readonly [number, number]; text?: string }
  > | null>("arrayDimensions", resolved.id);
  return rawDims?.length ?? null;
}

/**
 * Evaluate a `size(x, d)` call in a dimension context.
 */
function evaluateDimSizeCall(db: QueryDB, self: SymbolEntry, node: any): number | null {
  const args = node.childForFieldName("functionCallArguments");
  if (!args) return null;

  // Extract the two arguments: size(arrayRef, dimIndex)
  const argNodes = args.namedChildren?.filter((c: any) => c.type !== "(" && c.type !== ")" && c.type !== ",") ?? [];

  if (argNodes.length < 2) return null;

  const arrayRefNode = argNodes[0];
  const dimArgNode = argNodes[1];
  const dimIndex = evaluateDimCSTNode(db, self, dimArgNode);
  if (dimIndex === null) return null;

  // Resolve the array reference to a symbol
  const refName = arrayRefNode?.text;
  if (!refName) return null;

  // Find the component in the parent scope
  const parentId = self.parentId;
  if (parentId === null) return null;

  const resolver = db.query<((name: string) => SymbolEntry | null) | null>("resolveSimpleName", parentId);
  if (!resolver) return null;

  // Handle dot-separated references (e.g., pkg.x)
  const parts = refName.split(".");
  let resolved = resolver(parts[0]!);
  for (let i = 1; i < parts.length && resolved; i++) {
    const subResolver = db.query<((name: string) => SymbolEntry | null) | null>("resolveSimpleName", resolved.id);
    if (!subResolver) {
      resolved = null;
      break;
    }
    resolved = subResolver(parts[i]!);
  }

  if (!resolved) {
    // console.error(`[DEBUG LANG SIZE CALL FAIL] refName=${refName} NOT RESOLVED!`);
    return null;
  }

  activeDimQueriesStack.push({ symbolId: resolved.id, dimIndex: dimIndex - 1 });
  try {
    const res = getOrEvaluateSingleDimension(db, resolved, dimIndex - 1);
    // console.error(`[DEBUG LANG SIZE CALL] refName=${refName} dimIndex=${dimIndex} res=${res}`);
    return res;
  } finally {
    activeDimQueriesStack.pop();
  }
}

/**
 * Evaluate an `ndims(x)` call in a dimension context.
 */
function evaluateDimNdimsCall(db: QueryDB, self: SymbolEntry, node: any): number | null {
  const args = node.childForFieldName("functionCallArguments");
  if (!args) return null;

  const argNodes = args.namedChildren?.filter((c: any) => c.type !== "(" && c.type !== ")" && c.type !== ",") ?? [];

  if (argNodes.length < 1) return null;

  const refName = argNodes[0]?.text;
  if (!refName) return null;

  const parentId = self.parentId;
  if (parentId === null) return null;

  const resolver = db.query<((name: string) => SymbolEntry | null) | null>("resolveSimpleName", parentId);
  if (!resolver) return null;
  const resolved = resolver(refName);
  if (!resolved) return null;

  activeDimQueriesStack.push({ symbolId: resolved.id, dimIndex: 0 });
  try {
    return getOrEvaluateNdims(db, resolved);
  } finally {
    activeDimQueriesStack.pop();
  }
}

/**
 * Resolve a name reference (e.g., `n`, `N`, `pkg.n`) to an integer value.
 *
 * Looks up the symbol and reads its binding value if it's a parameter or constant.
 */
function evaluateDimNameRef(db: QueryDB, self: SymbolEntry, name: string): number | null {
  const parentId = self.parentId;
  if (parentId === null) return null;

  const resolver = db.query<((name: string) => SymbolEntry | null) | null>("resolveSimpleName", parentId);
  if (!resolver) return null;

  // Handle dot-separated names
  const parts = name.split(".");
  let resolved = resolver(parts[0]!);
  for (let i = 1; i < parts.length && resolved; i++) {
    const subResolver = db.query<((name: string) => SymbolEntry | null) | null>("resolveSimpleName", resolved.id);
    if (!subResolver) {
      resolved = null;
      break;
    }
    resolved = subResolver(parts[i]!);
  }
  if (!resolved) return null;

  // Check if it's an enumeration type (return literal count)
  if (resolved.kind === "Class") {
    const meta = resolved.metadata as Record<string, unknown>;
    const classPrefixes = meta?.classPrefixes;
    if (typeof classPrefixes === "string" && classPrefixes.includes("enumeration")) {
      const children = db.childrenOf(resolved.id);
      return children.filter((c) => c.kind === "Component").length;
    }
  }

  // Must be a parameter or constant with an integer binding
  if (resolved.kind !== "Component") return null;
  const meta = resolved.metadata as Record<string, unknown>;
  const variability = meta?.variability;
  if (variability !== "parameter" && variability !== "constant") return null;

  // Try to read the binding value from the modification
  const mod = db.query<any>("effectiveModification", resolved.id);
  if (mod?.bindingExpression?.text) {
    const val = parseInt(mod.bindingExpression.text, 10);
    if (!isNaN(val) && String(val) === mod.bindingExpression.text.trim()) return val;
    // If it's not a plain integer, try to get the CST and evaluate
    if (mod.bindingExpression.cstBytes) {
      const exprCst = db.cstNodeRange(
        mod.bindingExpression.cstBytes[0],
        mod.bindingExpression.cstBytes[1],
        resolved,
      ) as any;
      if (exprCst) {
        evaluatingDimensionsStack.push({
          symbolId: resolved.id,
          dimIndex: -1,
          exprText: mod.bindingExpression.text,
        });
        try {
          return evaluateDimCSTNode(db, resolved, exprCst);
        } finally {
          evaluatingDimensionsStack.pop();
        }
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Precedence constants (matching grammar.js)
// ---------------------------------------------------------------------------

export const classDefinitionQueries: Record<string, any> = {
  /** All direct children of this class. */
  members: (db: QueryDB, self: SymbolEntry) => db.childrenOf(self.id),
  /** Extract array dimensions for ShortClassSpecifiers like type ArrayType = Real[3]; */
  arrayDimensions: (db: QueryDB, self: SymbolEntry) => {
    const cst = db.cstNode(self.id) as import("@modelscript/language/compiler").CSTNode | null;
    if (!cst) return null;
    const classSpec = cst.childForFieldName("classSpecifier");
    if (!classSpec || classSpec.type !== "ShortClassSpecifier") return null;
    const arraySubNode = classSpec.childForFieldName("arraySubscripts");
    if (!arraySubNode) return null;

    const subscripts: Array<
      | { kind: "literal"; value: number }
      | { kind: "flexible" }
      | { kind: "expression"; cstBytes: readonly [number, number]; text?: string }
    > = [];

    for (const child of arraySubNode.children) {
      if (child.type !== "Subscript") continue;
      const flexChild = child.childForFieldName("flexible");
      if (flexChild) {
        subscripts.push({ kind: "flexible" });
        continue;
      }
      const exprChild = child.childForFieldName("expression");
      if (exprChild) {
        if (exprChild.type === "UNSIGNED_INTEGER") {
          subscripts.push({ kind: "literal", value: parseInt(exprChild.text, 10) });
        } else {
          subscripts.push({
            kind: "expression",
            cstBytes: [exprChild.startIndex, exprChild.endIndex],
            text: exprChild.text,
          });
        }
      }
    }
    return subscripts;
  },
  /**
   * Get the effective modification for this class (specifically for ShortClassSpecifier).
   */
  effectiveModification: (db: QueryDB, self: SymbolEntry) => {
    // console.error("Executing effectiveModification on ClassDefinition for " + self.name);
    const cst = db.cstNode(self.id) as import("@modelscript/language/compiler").CSTNode | null;
    if (!cst) return null;
    const classSpec = cst.childForFieldName("classSpecifier");
    if (!classSpec || classSpec.type !== "ShortClassSpecifier") return null;
    const modNode = classSpec.childForFieldName("classModification");
    if (!modNode) return null;
    return parseModArgsFromCst(modNode, self.parentId) as import("./modifications.js").ModelicaModArgs;
  },
  /** Only nested class definitions. */
  nestedClasses: (db: QueryDB, self: SymbolEntry) => db.childrenOf(self.id).filter((c) => c.kind === "Class"),
  /** Only component declarations. */
  components: (db: QueryDB, self: SymbolEntry) => db.childrenOf(self.id).filter((c) => c.kind === "Component"),
  /** Only extends clauses. */
  extendsClasses: (db: QueryDB, self: SymbolEntry) => db.childrenOf(self.id).filter((c) => c.kind === "Extends"),
  /** Only import clauses. */
  imports: (db: QueryDB, self: SymbolEntry) => db.childrenOf(self.id).filter((c) => c.kind === "Import"),
  /** Components with causality=input. */
  inputParameters: (db: QueryDB, self: SymbolEntry) =>
    db
      .childrenOf(self.id)
      .filter((c) => c.kind === "Component" && (c.metadata as Record<string, unknown>)?.causality === "input"),
  /** Components with causality=output. */
  outputParameters: (db: QueryDB, self: SymbolEntry) =>
    db
      .childrenOf(self.id)
      .filter((c) => c.kind === "Component" && (c.metadata as Record<string, unknown>)?.causality === "output"),
  /** Components with variability=parameter. */
  parameters: (db: QueryDB, self: SymbolEntry) =>
    db
      .childrenOf(self.id)
      .filter((c) => c.kind === "Component" && (c.metadata as Record<string, unknown>)?.variability === "parameter"),
  /** Components with variability=constant. */
  constants: (db: QueryDB, self: SymbolEntry) =>
    db
      .childrenOf(self.id)
      .filter((c) => c.kind === "Component" && (c.metadata as Record<string, unknown>)?.variability === "constant"),
  /** Connect equations among children. */
  connectEquations: (db: QueryDB, self: SymbolEntry) =>
    db.childrenOf(self.id).filter((c) => c.kind === "ConnectEquation"),
  /**
   * All elements including inherited members (flattened).
   *
   * Implements the core of the Modelica instantiation algorithm:
   * 1. Collect declared elements from the class body
   * 2. For each extends clause, resolve the base class and inline its elements
   * 3. Filter out elements that have been redeclared in the body
   * 4. Filter out elements removed via `break` in extends clauses
   *
   * Uses cycle recovery to handle circular extends chains.
   */
  allElements: {
    execute: (db: QueryDB, self: SymbolEntry) => {
      const visited = new Set<SymbolId>([self.id]);
      const result: SymbolEntry[] = [];

      // Collect names of body-level redeclare elements
      const redeclaredNames = new Set<string>();
      const brokenNames = new Set<string>();
      const children = db.childrenOf(self.id);

      for (const child of children) {
        if (child.kind === "Component" && (child.metadata as Record<string, unknown>)?.redeclare) {
          redeclaredNames.add(child.name);
        }
        if (child.kind === "Class" && (child.metadata as Record<string, unknown>)?.redeclare) {
          redeclaredNames.add(child.name);
        }
      }

      // Inline extends at their declaration order
      for (const child of children) {
        if (child.kind === "Extends") {
          // Resolve the base class
          const baseName = child.name;
          const baseEntries = db.byName(baseName);
          const baseClass = baseEntries?.[0];
          if (baseClass && !visited.has(baseClass.id)) {
            visited.add(baseClass.id);
            // Recursively get all elements of the base class
            const baseElements = db.childrenOf(baseClass.id);
            for (const inherited of baseElements) {
              if (inherited.name && !redeclaredNames.has(inherited.name) && !brokenNames.has(inherited.name)) {
                result.push(inherited);
              }
            }
          }
        } else {
          result.push(child);
        }
      }

      return result;
    },
    recovery: () => [],
  },
  /**
   * Check if this class is a connector type.
   */
  isConnector: (db: QueryDB, self: SymbolEntry) => {
    const kind = (self.metadata as Record<string, unknown>)?.classPrefixes;
    return (
      kind === "connector" ||
      kind === "expandable connector" ||
      (typeof kind === "string" && kind.includes("connector"))
    );
  },
  /**
   * Check if this class is an operator record type.
   */
  isOperatorRecord: (db: QueryDB, self: SymbolEntry) => {
    const kind = (self.metadata as Record<string, unknown>)?.classPrefixes;
    return kind === "operator record";
  },
  /**
   * For an `operator record` class, collect all operator functions.
   *
   * Returns a Map from operator name (e.g. "'+'", "'-'", "'*'") to an
   * array of function overloads. Each overload describes input types
   * and the qualified function name for call emission.
   *
   * Structure of each operator class:
   *   operator record C
   *     operator '+'
   *       function self ... end self;
   *       function rightInt ... end rightInt;
   *     end '+';
   *     operator function '+' ... end '+';  // shorthand form
   *   end C;
   */
  operatorFunctions: (db: QueryDB, self: SymbolEntry) => {
    const kind = (self.metadata as Record<string, unknown>)?.classPrefixes;
    if (kind !== "operator record") return null;

    type CSTNode = import("@modelscript/language/compiler").CSTNode;
    const recordName = self.name;

    interface OperatorOverload {
      qualifiedName: string;
      inputTypes: string[];
      outputType: string;
      inputCount: number;
    }

    const result = new Map<string, OperatorOverload[]>();

    const children = db.childrenOf(self.id);
    // console.error(`[debug] operatorFunctions for ${self.name}, children count: ${children.length}`);

    // Walk children of the operator record
    for (const child of children) {
      if (child.kind !== "Class") continue;
      const childMeta = child.metadata as Record<string, unknown>;
      const childPrefix = childMeta?.classPrefixes as string | undefined;

      // console.error(`[debug] child: ${child.name}, prefix: ${childPrefix}`);

      // Case 1: `operator function '+'` (shorthand — the class IS the function)
      if (childPrefix === "operator function") {
        const opName = child.name; // e.g., "'+'"
        const inputTypes: string[] = [];
        let outputType = "";
        let inputCount = 0;

        // Extract input/output types from function children
        for (const param of db.childrenOf(child.id)) {
          if (param.kind !== "Component") continue;
          const pMeta = param.metadata as Record<string, unknown>;
          const causality = pMeta?.causality as string | undefined;
          const typeSpec = pMeta?.typeSpecifier as string | undefined;
          if (causality === "input") {
            inputTypes.push(typeSpec ?? "Real");
            inputCount++;
          } else if (causality === "output") {
            outputType = typeSpec ?? "Real";
          }
        }

        const overloads = result.get(opName) ?? [];
        overloads.push({
          qualifiedName: `${recordName}.${opName}`,
          inputTypes,
          outputType,
          inputCount,
        });
        result.set(opName, overloads);
        continue;
      }

      // Case 2: `operator '+'` containing function children
      if (childPrefix === "operator") {
        const opName = child.name; // e.g., "'+'"

        const funcs = db.childrenOf(child.id);
        // console.error(`[debug] found operator ${opName}, funcs count: ${funcs.length}`);

        for (const func of funcs) {
          // console.error(`[debug]   func: ${func.name}, kind: ${func.kind}`);
          if (func.kind !== "Class") continue;
          const funcMeta = func.metadata as Record<string, unknown>;
          const funcPrefix = funcMeta?.classPrefixes as string | undefined;
          // console.error(`[debug]   funcPrefix: ${funcPrefix}`);
          if (funcPrefix !== "function" && funcPrefix !== "operator function") continue;

          const inputTypes: string[] = [];
          let outputType = "";
          let inputCount = 0;

          for (const param of db.childrenOf(func.id)) {
            if (param.kind !== "Component") continue;
            const pMeta = param.metadata as Record<string, unknown>;
            const causality = pMeta?.causality as string | undefined;
            const typeSpec = pMeta?.typeSpecifier as string | undefined;
            if (causality === "input") {
              inputTypes.push(typeSpec ?? "Real");
              inputCount++;
            } else if (causality === "output") {
              outputType = typeSpec ?? "Real";
            }
          }

          const overloads = result.get(opName) ?? [];
          overloads.push({
            qualifiedName: `${recordName}.${opName}.${func.name}`,
            inputTypes,
            outputType,
            inputCount,
          });
          result.set(opName, overloads);
        }
        continue;
      }
    }

    // console.error(`[debug] returning result size: ${result.size}`);
    return result.size > 0 ? result : null;
  },
  /**
   * Resolve a modification argument by name from the class's
   * active modification context.
   */
  resolveModification: (db: QueryDB, self: SymbolEntry) => {
    // Modification resolution is context-dependent:
    // the effective modification comes from the instantiation site
    // (outer modification merged with local declaration modifications).
    // In a Salsa query context, we return the metadata-level modification info.
    return (self.metadata as Record<string, unknown>)?.modification ?? null;
  },

  // =================================================================
  // Milestone 2: Scope Resolution (Modelica §5.3)
  // =================================================================

  /**
   * Resolve a simple name in this class's scope.
   *
   * Implements Modelica §5.3 name lookup:
   *   1. Direct elements (class defs, components)
   *   2. Inherited elements (via extends)
   *   3. Qualified imports (import A = B.C.D)
   *   4. Unqualified imports (import B.C.*)
   *   5. Compound imports (import B.C.{D, E})
   *   6. Parent scope walk (unless encapsulated)
   *   7. Predefined types fallback (via db.byName)
   *
   * Returns a resolver function that accepts a name string.
   * This is a "factory query" — it computes the scope once and
   * returns a closure that callers invoke with specific names.
   */
  scopeData: (db: QueryDB, self: SymbolEntry): ScopeData => {
    return getScopeData(db, self);
  },

  /** Precompute inherited symbols mapping (memoized). */
  inheritedSymbolsMap: {
    execute: (db: QueryDB, self: SymbolEntry): Record<string, SymbolId> => {
      const result: Record<string, SymbolId> = {};
      const baseId = db.baseOf(self.id);
      const sourceId = baseId ?? self.id;
      const children = db.childrenOf(sourceId);

      // First walk extends clauses in declaration order
      for (const child of children) {
        if (child.kind === "Extends") {
          const baseClass = db.query<SymbolEntry | null>("resolvedBaseClass", child.id);
          if (baseClass) {
            const baseUnspecializedId = db.baseOf(baseClass.id) ?? baseClass.id;
            const baseInherited = db.query<Record<string, SymbolId>>("inheritedSymbolsMap", baseUnspecializedId) || {};
            mergeInto(result, baseInherited);
            const baseScope = db.query<ScopeData>("scopeData", baseUnspecializedId);
            if (baseScope) {
              mergeInto(result, baseScope.directByName);
            }
          }
        }
      }

      // Also handle extends in LongClassSpecifier
      const selfCst = db.cstNode(sourceId) as any;
      const spec = selfCst?.childForFieldName?.("classSpecifier");
      if (spec?.type === "LongClassSpecifier") {
        let hasExtends = false;
        for (let i = 0; i < spec.childCount; i++) {
          if (spec.child(i).type === "extends") {
            hasExtends = true;
            break;
          }
        }
        if (hasExtends) {
          const identNode = spec.childForFieldName("identifier");
          if (identNode?.text && self.parentId !== null) {
            const baseName = identNode.text;
            const resolveName = db.query<any>("resolveName", self.parentId);
            if (resolveName) {
              let resolved = resolveName(baseName, true);
              if (resolved && resolved.id === self.id) {
                resolved = null;
                if (self.parentId !== null && self.parentId !== undefined) {
                  for (const pChild of db.childrenOf(self.parentId)) {
                    if (pChild.kind === "Extends") {
                      const pBase = db.query<any>("resolvedBaseClass", pChild.id);
                      if (pBase) {
                        const pExtResolver = db.query<any>("resolveName", pBase.id);
                        if (pExtResolver) {
                          const found = pExtResolver(baseName);
                          if (found && found.id !== self.parentId) {
                            resolved = found;
                            break;
                          }
                        }
                      }
                    }
                  }
                }
              }
              if (resolved && resolved.kind !== "Reference") {
                const resolvedUnspecializedId = db.baseOf(resolved.id) ?? resolved.id;
                const baseInherited =
                  db.query<Record<string, SymbolId>>("inheritedSymbolsMap", resolvedUnspecializedId) || {};
                mergeInto(result, baseInherited);
                const baseScope = db.query<ScopeData>("scopeData", resolvedUnspecializedId);
                if (baseScope) {
                  mergeInto(result, baseScope.directByName);
                }
              }
            }
          }
        }
      }

      return result;
    },
    recovery: () => ({}),
  },

  resolveSimpleName: (db: QueryDB, self: SymbolEntry) => {
    return (name: string, encapsulated = false, skipInherited = false): SymbolEntry | null => {
      return resolveSimpleNameHelper(db, self.id, name, encapsulated, skipInherited);
    };
  },

  /**
   * Resolve a qualified (dot-separated) name from this class's scope.
   *
   * Uses resolveSimpleName for the first part, then navigates
   * into children for each subsequent part.
   */
  resolveName: (db: QueryDB, self: SymbolEntry) => {
    return (qualifiedName: string, skipInherited = false): SymbolEntry | null => {
      const parts = qualifiedName.split(".");
      if (parts.length === 0) return null;

      // Handle fully qualified names (e.g. .Modelica.Math.sin)
      let startIndex = 0;
      let current: SymbolEntry | null = null;
      if (parts[0] === "") {
        if (parts.length < 2) return null;
        current =
          db
            .byName(parts[1])
            ?.find(
              (e) => e.parentId === null && (e.kind === "Class" || e.kind === "Package" || e.kind === "Function"),
            ) ?? null;
        startIndex = 2;
      } else {
        // Resolve first part via scope resolution
        const resolver = db.query<(n: string, enc?: boolean, skip?: boolean) => SymbolEntry | null>(
          "resolveSimpleName",
          self.id,
        );
        current = resolver?.(parts[0]!, false, skipInherited) ?? null;
        startIndex = 1;
      }

      if (!current) return null;

      // Navigate remaining parts
      for (let i = startIndex; i < parts.length; i++) {
        const part = parts[i]!;
        const targetResolver = db.query<(n: string, enc?: boolean, skip?: boolean) => SymbolEntry | null>(
          "resolveSimpleName",
          current.id,
        );
        const nextPart = targetResolver?.(part, false, false);
        if (!nextPart) return null;
        current = nextPart;
      }

      return current;
    };
  },

  // =================================================================
  // Milestone 3: Instantiation Query
  // =================================================================

  /**
   * Instantiate this class: resolve all elements, expand extends,
   * and filter redeclarations.
   *
   * This is the central query that replaces ModelicaClassInstance.instantiate().
   *
   * Returns direct children, recursively inlining inherited elements
   * from extends clauses and filtering redeclared names.
   *
   * NOTE: This query no longer creates virtual (specialized) symbols.
   * All modification propagation is handled by the flattener's
   * ModificationStack during flattening.
   *
   * Returns a list of static (non-virtual) SymbolIds.
   */
  instantiate: {
    execute: (db: QueryDB, self: SymbolEntry) => {
      // Get outer modification (if this is a specialized entry)
      const specArgs = db.argsOf<ModelicaModArgs>(self.id);
      const outerMod: ModelicaModArgs | null = specArgs?.data ?? null;

      // Determine actual children: for specialized entries,
      // use the base symbol's children
      const baseId = db.baseOf(self.id);
      const sourceId = baseId ?? self.id;

      // Handle ShortClassSpecifier aliases
      const selfCstShort = db.cstNode(sourceId) as any;
      const specShort = selfCstShort?.childForFieldName?.("classSpecifier");
      if (specShort?.type === "ShortClassSpecifier") {
        const typeSpec = specShort.childForFieldName?.("typeSpecifier");
        const typeName = typeSpec?.text;
        if (typeName && self.parentId !== null) {
          const parentResolver = db.query<(n: string) => { id: SymbolId } | null>("resolveName", self.parentId);
          if (parentResolver) {
            const resolved = parentResolver(typeName);
            if (resolved && resolved.id !== self.id) {
              // Short class alias: instantiate the resolved target directly.
              // Outer modifications are propagated by the flattener's ModificationStack,
              // eliminating the need for virtual specialized entries.
              return db.query<SymbolId[]>("instantiate", resolved.id);
            }
          }
        }
      }

      const children = db.childrenOf(sourceId);

      // Pre-scan for body-level redeclares
      const redeclaredNames = new Set<string>();
      for (const child of children) {
        const meta = child.metadata as Record<string, unknown>;
        if (meta?.redeclare) {
          redeclaredNames.add(child.name);
        }
      }

      const elements: SymbolId[] = [];

      // NEW: handle extends in long class specifier!
      const selfCstExt = db.cstNode(self.id) as any;
      const specExt = selfCstExt?.childForFieldName?.("classSpecifier");
      if (specExt?.type === "LongClassSpecifier") {
        let hasExtends = false;
        for (let i = 0; i < specExt.childCount; i++) {
          if (specExt.child(i).type === "extends") {
            hasExtends = true;
            break;
          }
        }
        if (hasExtends) {
          const identNode = specExt.childForFieldName("identifier");
          if (identNode?.text && self.parentId !== null) {
            const baseName = identNode.text;
            const resolveName = db.query<any>("resolveName", self.parentId);
            if (resolveName) {
              let resolved = resolveName(baseName, true);
              if (resolved && resolved.id === self.id) {
                // Cycle detected, look in parent's inherited classes
                resolved = null;
                const grandParentId = db.symbol(self.parentId)?.parentId;
                if (self.parentId !== null && self.parentId !== undefined) {
                  for (const pChild of db.childrenOf(self.parentId)) {
                    if (pChild.kind === "Extends") {
                      const pBase = db.query<any>("resolvedBaseClass", pChild.id);
                      if (pBase) {
                        const pExtResolver = db.query<any>("resolveName", pBase.id);
                        if (pExtResolver) {
                          const found = pExtResolver(baseName);
                          if (found && found.id !== self.parentId) {
                            resolved = found;
                            break;
                          }
                        }
                      }
                    }
                  }
                }
              }

              if (resolved && resolved.kind !== "Reference") {
                // We found the base class! Let's instantiate it!
                const baseElements = db.query<any>("instantiate", resolved.id) || [];
                for (const eid of baseElements) {
                  const entry = db.symbol(eid);
                  if (entry && !redeclaredNames.has(entry.name)) {
                    elements.push(eid);
                  }
                }
              }
            }
          }
        }
      }

      for (const child of children) {
        if (child.kind === "Component") {
          // Always use the static component SymbolId.
          // Outer modifications are resolved by the flattener's ModificationStack,
          // eliminating the need for virtual specialized component entries.
          elements.push(child.id);
        } else if (child.kind === "Extends") {
          // Check for break
          if (isBroken(outerMod, child.name)) continue;

          // Resolve the base class
          const resolveName = db.query<(n: string) => SymbolEntry | null>("resolveName", self.id);
          let baseClass: SymbolEntry | null | undefined = undefined;
          if (resolveName) {
            baseClass = resolveName(child.name);
          }
          if (!baseClass) {
            baseClass = db.byName(child.name)?.find((e) => e.kind === "Class" || e.kind === "Package") ?? null;
          }

          if (!baseClass) {
            // Unresolved extends — skip but still record the extends entry
            elements.push(child.id);
            continue;
          }

          // Instantiate the base class directly (unmodified).
          // Extends modifications are propagated by the flattener's ModificationStack,
          // eliminating the need for virtual specialized base class entries.
          const baseElements = db.query<SymbolId[]>("instantiate", baseClass.id);

          // Extract broken names from the extends clause modification
          const extendsModParsedRaw = db.query<any>("extendsModificationParsed", child.id);
          const extendsModParsed: any[] = Array.isArray(extendsModParsedRaw)
            ? extendsModParsedRaw
            : (extendsModParsedRaw?.args ?? []);
          const brokenNames = new Set<string>();
          for (const arg of extendsModParsed) {
            if (arg.isBreak && !arg.name.startsWith("break_connect:")) {
              brokenNames.add(arg.name);
            }
          }

          // Inline inherited elements, filtering redeclared names and broken names
          for (const eid of baseElements) {
            const entry = db.symbol(eid);
            if (entry && !redeclaredNames.has(entry.name) && !brokenNames.has(entry.name)) {
              elements.push(eid);
            }
          }
        } else if (child.kind === "Class") {
          // Nested class — include local redeclarations and regular classes
          elements.push(child.id);
        } else if (child.kind === "Import") {
          // Imports are not instantiated elements but recorded for scope
          elements.push(child.id);
        } else if (child.kind === "Reference") {
          // References shouldn't be instantiated as child elements
          continue;
        } else {
          // Other children (equations, algorithms, etc.)
          elements.push(child.id);
        }
      }

      return elements;
    },
    recovery: (_cycle: unknown, _self: SymbolEntry) => [] as SymbolId[],
  },
};

export const extendsClauseQueries: Record<string, any> = {
  modificationText: (db: QueryDB, self: SymbolEntry) => {
    const cst = db.cstNode(self.id) as any;
    return cst?.childForFieldName("classOrInheritanceModification")?.text ?? null;
  },
  /**
   * Resolve the base class referenced by this extends clause.
   * Returns the SymbolEntry of the resolved class, or null.
   */
  resolvedBaseClass: (db: QueryDB, self: SymbolEntry) => {
    const baseName = self.name;
    if (!baseName) return null;
    // Use resolveName from the enclosing class for proper scope resolution
    if (self.parentId !== null) {
      const resolveName = db.query<(n: string, skip?: boolean) => SymbolEntry | null>("resolveName", self.parentId);
      if (resolveName) {
        // Pass true for skipInherited to prevent cyclic lookup in extends clauses
        let resolved = resolveName(baseName, true);
        // console.error(`[DEBUG RESOLVE] resolveName("${baseName}") returned: ${resolved?.kind} (id=${resolved?.id})`);

        // If it resolves to the exact class that contains this extends clause,
        // this is a redeclared extends (e.g. `redeclare class extends BaseClass`).
        // We must resolve it from the parent's base classes instead.
        if (resolved && resolved.id === self.parentId) {
          resolved = null;
          const grandParentId = db.symbol(self.parentId)?.parentId;
          if (grandParentId !== null && grandParentId !== undefined) {
            const parentChildren = db.childrenOf(grandParentId);
            for (const pChild of parentChildren) {
              if (pChild.kind === "Extends") {
                const pBase = db.query<SymbolEntry | null>("resolvedBaseClass", pChild.id);
                if (pBase) {
                  const pExtResolver = db.query<(n: string, enc?: boolean, skip?: boolean) => SymbolEntry | null>(
                    "resolveSimpleName",
                    pBase.id,
                  );
                  if (pExtResolver) {
                    const found = pExtResolver(baseName);
                    if (found && found.id !== self.parentId) {
                      resolved = found;
                      break;
                    }
                  }
                }
              }
            }
          }
        }

        if (resolved && resolved.kind !== "Reference") return resolved;
      }
    }
    // Fallback to global lookup, filtering out Reference entries
    const entries = db.byName(baseName);
    return entries?.find((e) => e.kind === "Class" || e.kind === "Package") ?? entries?.[0] ?? null;
  },
  /**
   * Get the merged modification for this extends clause.
   * Combines the class-or-inheritance-modification with the
   * outer modification from the enclosing class.
   */
  effectiveModification: (db: QueryDB, self: SymbolEntry) => {
    // The modification from the extends clause itself
    return (self.metadata as Record<string, unknown>)?.classOrInheritanceModification ?? null;
  },
  /**
   * Parse the extends clause's class-or-inheritance modification from the CST
   * into a structured ModelicaModArgs object.
   *
   * This is the extends-clause equivalent of the component's effectiveModification
   * query, providing the modification data needed by the flattener's ModificationStack.
   *
   * e.g., `extends Base(p = 1, redeclare type T = NewT)` →
   *   { args: [{name:"p", value:{kind:"expression",...}}, {name:"T", isRedeclaration:true, ...}], ... }
   */
  extendsModificationParsed: (db: QueryDB, self: SymbolEntry) => {
    const cst = db.cstNode(self.id) as any;
    const modNode = cst?.childForFieldName("classOrInheritanceModification");
    console.log("extendsModificationParsed for", self.id, "cst type:", cst?.type, "modNode:", !!modNode);
    if (!modNode) return null;
    return parseModArgsFromCst(modNode, self.parentId) as ModelicaModArgs;
  },
};

export const componentDeclarationQueries: Record<string, any> = {
  /**
   * Get the raw type specifier name for this component.
   */
  typeSpecifier: (db: QueryDB, self: SymbolEntry) => {
    const specArgs = db.argsOf<import("./modifications.js").ModelicaModArgs>(self.id);
    if (specArgs?.data?.isRedeclaration && specArgs.data.redeclaredTypeSpecifier) {
      return specArgs.data.redeclaredTypeSpecifier;
    }
    const cstNode = db.cstNode(self.id);
    let current = cstNode as any;
    while (current && current.type !== "ComponentClause" && current.type !== "component_clause") {
      current = current.parent;
    }
    return current?.childForFieldName("typeSpecifier")?.text ?? null;
  },

  /**
   * Resolve the type specifier to the class it references.
   */
  resolvedType: (db: QueryDB, self: SymbolEntry) => {
    const specArgs = db.argsOf<import("./modifications.js").ModelicaModArgs>(self.id);
    let typeName = "";

    if (specArgs?.data?.isRedeclaration && specArgs.data.redeclaredTypeSpecifier) {
      typeName = specArgs.data.redeclaredTypeSpecifier;
    } else {
      const cstNode = db.cstNode(self.id);
      let current = cstNode as any;
      while (current && current.type !== "ComponentClause" && current.type !== "component_clause") {
        current = current.parent;
      }
      typeName = current?.childForFieldName("typeSpecifier")?.text ?? "";
    }

    if (!typeName || typeof typeName !== "string") return null;

    // Try resolution from parent scope
    if (self.parentId !== null) {
      const parentEntry = db.symbol(self.parentId);
      if (parentEntry && (parentEntry.kind === "Class" || parentEntry.kind === "Package")) {
        const qualResolver = db.query<(n: string) => SymbolEntry | null>("resolveName", parentEntry.id);
        if (qualResolver) {
          const resolved = qualResolver(typeName);
          if (resolved) return resolved;
        }
      }
    }

    // Fallback: global lookup — try full qualified name first, then simple name
    if (typeName.includes(".")) {
      const entries = db.byName(typeName);
      const found = entries?.find((e) => e.kind === "Class" || e.kind === "Package" || e.kind === "Function");
      if (found) return found;
    }
    const simpleName = typeName.includes(".") ? typeName.split(".").pop()! : typeName;
    const entries = db.byName(simpleName);
    return (
      entries?.find((e) => (e.metadata as Record<string, unknown>)?.isPredefined && e.kind === "Class") ??
      entries?.find((e) => e.kind === "Class" || e.kind === "Package" || e.kind === "Function") ??
      null
    );
  },
  /**
   * Get the effective modification for this component as a
   * structured ModelicaModArgs object.
   *
   * Parses the raw modification metadata text into:
   * - args: nested modifications like (x=1, y=2)
   * - bindingExpression: scalar binding like = expr
   *
   * Returns null if no modification is present.
   */
  effectiveModification: (db: QueryDB, self: SymbolEntry) => {
    const cst = db.cstNode(self.id) as any;
    let current = cst;
    while (
      current &&
      current.type !== "ComponentDeclaration" &&
      current.type !== "component_declaration" &&
      current.type !== "Declaration" &&
      current.type !== "declaration"
    ) {
      current = current.parent;
    }
    const declNode =
      current?.type === "Declaration" || current?.type === "declaration"
        ? current
        : current?.childForFieldName("declaration");
    const modNode = declNode?.childForFieldName("modification");
    if (!modNode) return null;
    return parseModArgsFromCst(modNode, self.parentId) as ModelicaModArgs;
  },
  /**
   * Check if this component's type is a connector.
   */
  isConnectorType: (db: QueryDB, self: SymbolEntry) => {
    const cstNode = db.cstNode(self.id);
    let current = cstNode as any;
    while (current && current.type !== "ComponentClause" && current.type !== "component_clause") {
      current = current.parent;
    }
    let typeName = current?.childForFieldName("typeSpecifier")?.text;
    if (!typeName || typeof typeName !== "string") return false;

    let typeEntry: SymbolEntry | null = null;

    // Try qualified resolution from parent scope
    if (typeName.includes(".") && self.parentId !== null) {
      const parentEntry = db.symbol(self.parentId);
      if (parentEntry && (parentEntry.kind === "Class" || parentEntry.kind === "Package")) {
        const qualResolver = db.query<(n: string) => SymbolEntry | null>("resolveName", parentEntry.id);
        if (qualResolver) {
          typeEntry = qualResolver(typeName);
        }
      }
    }

    // Fallback: global lookup — try full qualified name first
    if (!typeEntry && typeName.includes(".")) {
      const entries = db.byName(typeName);
      typeEntry = entries?.find((e) => e.kind === "Class" || e.kind === "Package" || e.kind === "Function") ?? null;
    }
    if (!typeEntry) {
      const simpleName = typeName.includes(".") ? typeName.split(".").pop()! : typeName;
      const entries = db.byName(simpleName);
      typeEntry =
        entries?.find((e) => (e.metadata as Record<string, unknown>)?.isPredefined && e.kind === "Class") ??
        entries?.find((e) => e.kind === "Class" || e.kind === "Package" || e.kind === "Function") ??
        null;
    }

    if (!typeEntry) return false;
    const classPrefixes = (typeEntry.metadata as Record<string, unknown>)?.classPrefixes;
    return typeof classPrefixes === "string" && classPrefixes.includes("connector");
  },

  variability: (db: QueryDB, self: SymbolEntry) => {
    let current = db.cstNode(self.id) as any;
    while (
      current &&
      current.type !== "ComponentClause" &&
      current.type !== "ComponentClause1" &&
      current.type !== "component_clause" &&
      current.type !== "component_clause1"
    )
      current = current.parent;
    const tp = current?.childForFieldName("type_prefix") ?? current?.childForFieldName("typePrefix");
    const vNode = tp?.childForFieldName("variability") ?? current?.childForFieldName("variability");
    if (vNode?.text) return vNode.text;
    const tpText = tp?.text ?? "";
    if (tpText.includes("parameter")) return "parameter";
    if (tpText.includes("constant")) return "constant";
    if (tpText.includes("discrete")) return "discrete";
    return null;
  },

  causality: (db: QueryDB, self: SymbolEntry) => {
    let current = db.cstNode(self.id) as any;
    while (
      current &&
      current.type !== "ComponentClause" &&
      current.type !== "ComponentClause1" &&
      current.type !== "component_clause" &&
      current.type !== "component_clause1"
    )
      current = current.parent;
    const tp = current?.childForFieldName("type_prefix") ?? current?.childForFieldName("typePrefix");
    const cNode = tp?.childForFieldName("causality") ?? current?.childForFieldName("causality");
    if (cNode?.text) return cNode.text;
    const tpText = tp?.text ?? "";
    if (tpText.includes("input")) return "input";
    if (tpText.includes("output")) return "output";
    return null;
  },

  flowPrefix: (db: QueryDB, self: SymbolEntry) => {
    let current = db.cstNode(self.id) as any;
    while (
      current &&
      current.type !== "ComponentClause" &&
      current.type !== "ComponentClause1" &&
      current.type !== "component_clause" &&
      current.type !== "component_clause1"
    )
      current = current.parent;
    return (
      current?.childForFieldName("typePrefix")?.children.find((c: any) => c.type === "flow" || c.type === "stream")
        ?.text ??
      current?.childForFieldName("flow")?.text ??
      null
    );
  },

  isFinal: (db: QueryDB, self: SymbolEntry) => {
    let current = db.cstNode(self.id) as any;
    while (current && current.type !== "ComponentClause" && current.type !== "component_clause")
      current = current.parent;
    return !!current?.childForFieldName("final");
  },

  /**
   * Check if this component has annotation(Evaluate=true).
   * Per Modelica §18.3, this promotes a parameter to be evaluated at compile time.
   */
  isEvaluate: (db: QueryDB, self: SymbolEntry) => {
    const cst = db.cstNode(self.id) as any;
    let current = cst;
    while (current && current.type !== "ComponentDeclaration" && current.type !== "component_declaration")
      current = current.parent;
    const ann = current?.childForFieldName("annotationClause");
    if (!ann) return false;
    const classMod = ann.childForFieldName?.("classModification");
    if (!classMod) return false;
    for (const arg of classMod.namedChildren ?? []) {
      if (arg.type !== "ElementModification") continue;
      const argName = arg.childForFieldName?.("name")?.text;
      if (argName === "Evaluate") {
        const modNode = arg.childForFieldName?.("modification");
        const modExpr = modNode?.childForFieldName?.("modificationExpression");
        if (modExpr?.text === "true") return true;
      }
    }
    return false;
  },

  isRedeclare: (db: QueryDB, self: SymbolEntry) => {
    let current = db.cstNode(self.id) as any;
    while (current && current.type !== "ComponentClause" && current.type !== "component_clause")
      current = current.parent;
    return !!current?.childForFieldName("redeclare");
  },

  isInner: (db: QueryDB, self: SymbolEntry) => {
    let current = db.cstNode(self.id) as any;
    while (current && current.type !== "ComponentClause" && current.type !== "component_clause")
      current = current.parent;
    return current?.text.match(/\binner\b/) !== null;
  },

  isReplaceable: (db: QueryDB, self: SymbolEntry) => {
    let current = db.cstNode(self.id) as any;
    while (current && current.type !== "ComponentClause" && current.type !== "component_clause")
      current = current.parent;
    return !!current?.childForFieldName("replaceable");
  },

  isProtected: (db: QueryDB, self: SymbolEntry) => {
    let current = db.cstNode(self.id) as any;
    while (current && current.type !== "ElementSection") {
      // Stop at class definition boundaries — don't walk into a parent class
      if (
        current.type === "LongClassSpecifier" ||
        current.type === "ShortClassSpecifier" ||
        current.type === "long_class_specifier" ||
        current.type === "short_class_specifier"
      )
        return false;
      current = current.parent;
    }
    return current ? current.childForFieldName("visibility")?.text === "protected" : false;
  },

  isOuter: (db: QueryDB, self: SymbolEntry) => {
    let current = db.cstNode(self.id) as any;
    while (current && current.type !== "ComponentClause" && current.type !== "component_clause")
      current = current.parent;
    return !!current?.childForFieldName("outer");
  },

  // =================================================================
  // Milestone 3: Component Instantiation
  // =================================================================

  /**
   * Instantiate this component: resolve its type specifier
   * to a class, then specialize that class with the component's
   * effective modification.
   *
   * Returns the SymbolId of the (possibly specialized) class.
   * Returns null if the type cannot be resolved.
   *
   * This replaces ModelicaComponentInstance.classInstance.
   */
  classInstance: (db: QueryDB, self: SymbolEntry) => {
    const specArgs = db.argsOf<import("./modifications.js").ModelicaModArgs>(self.id);
    let typeName = "";

    if (specArgs?.data?.isRedeclaration && specArgs.data.redeclaredTypeSpecifier) {
      typeName = specArgs.data.redeclaredTypeSpecifier;
    } else {
      const cstNode = db.cstNode(self.id);
      let current = cstNode as any;
      while (current && current.type !== "ComponentClause" && current.type !== "component_clause") {
        current = current.parent;
      }
      const typeSpecNode = current?.childForFieldName("type_specifier") ?? current?.childForFieldName("typeSpecifier");
      typeName =
        typeSpecNode?.text ?? (self.metadata as any)?.typeSpecifier ?? (self.metadata as any)?.type_specifier ?? "";
    }

    if (!typeName) return null;

    let typeEntry: SymbolEntry | null = null;
    const scopeId =
      specArgs?.data?.evaluationScopeId !== undefined && specArgs.data.evaluationScopeId !== null
        ? specArgs.data.evaluationScopeId
        : self.parentId;
    if (scopeId !== null) {
      const parentEntry = db.symbol(scopeId);
      if (parentEntry && (parentEntry.kind === "Class" || parentEntry.kind === "Package")) {
        // Use resolveName for qualified (dotted) names, resolveSimpleName for simple names
        if (typeName.includes(".")) {
          const qualResolver = db.query<(n: string) => SymbolEntry | null>("resolveName", parentEntry.id);
          if (qualResolver) {
            typeEntry = qualResolver(typeName);
          }
        } else {
          const resolver = db.query<(n: string, enc?: boolean) => SymbolEntry | null>(
            "resolveSimpleName",
            parentEntry.id,
          );
          if (resolver) {
            typeEntry = resolver(typeName);
          }
        }
      }
    }
    // Fallback: global lookup — try full qualified name first, then simple name
    if (!typeEntry && typeName.includes(".")) {
      typeEntry = resolveQualified(db, typeName);
    }
    if (!typeEntry) {
      const simpleName = typeName.includes(".") ? typeName.split(".").pop()! : typeName;
      const entries = db.byName(simpleName);
      // Prefer predefined types (Real, Integer, etc.) and types over models
      // to avoid resolving e.g. "Temperature" to a random sensor class.
      typeEntry =
        entries?.find((e) => (e.metadata as Record<string, unknown>)?.isPredefined && e.kind === "Class") ??
        entries?.find((e) => (e.metadata as Record<string, unknown>)?.classPrefixes === "type") ??
        entries?.find((e) => e.kind === "Class" || e.kind === "Package" || e.kind === "Function") ??
        null;
    }
    if (!typeEntry) return null;

    // Return the unmodified type class ID.
    // Value modifications (e.g., R=100) are resolved by the flattener's
    // ModificationStack, eliminating the need for virtual specialized type entries.
    // Note: Redeclarations (type replacement via extends) are still handled
    // by extends specialization in the instantiate query (Phase 1b).
    return typeEntry.id;
  },

  /**
   * Get the array dimensions for this component as structured subscripts.
   *
   * Walks the actual CST ArraySubscripts → Subscript children to produce:
   *   - { kind: "literal", value: number }   — integer literal dimension
   *   - { kind: "flexible" }                  — ':' (flexible dimension)
   *   - { kind: "expression", cstBytes: [start, end] } — symbolic expression
   */
  arrayDimensions: (db: QueryDB, self: SymbolEntry) => {
    // Get the CST node for this ComponentDeclaration
    const cst = db.cstNode(self.id) as import("@modelscript/language/compiler").CSTNode | null;
    if (!cst) return null;

    /** Extract subscript descriptors from an ArraySubscripts CST node. */
    const extractSubscripts = (
      arraySubNode: any,
    ): Array<
      | { kind: "literal"; value: number }
      | { kind: "flexible" }
      | { kind: "expression"; cstBytes: readonly [number, number]; text?: string }
    > => {
      const subs: Array<
        | { kind: "literal"; value: number }
        | { kind: "flexible" }
        | { kind: "expression"; cstBytes: readonly [number, number]; text?: string }
      > = [];
      for (const child of arraySubNode.children) {
        if (child.type !== "Subscript" && child.type !== "subscript") continue;
        const flexChild = child.childForFieldName("flexible");
        if (flexChild) {
          subs.push({ kind: "flexible" });
          continue;
        }
        const exprChild = child.childForFieldName("expression");
        if (exprChild) {
          const num = parseInt(exprChild.text, 10);
          if (!isNaN(num) && String(num) === exprChild.text.trim()) {
            subs.push({ kind: "literal", value: num });
          } else {
            subs.push({
              kind: "expression",
              cstBytes: [exprChild.startIndex ?? exprChild.startByte, exprChild.endIndex ?? exprChild.endByte],
              text: exprChild.text,
            });
          }
          continue;
        }
      }
      return subs;
    };

    // Navigate up to the Declaration node to get component-level subscripts (e.g. x[2])
    let declNode = cst as any;
    while (declNode && declNode.type !== "Declaration" && declNode.type !== "declaration") {
      declNode = declNode.parent;
    }
    const declArraySubNode =
      declNode?.childForFieldName("array_subscripts") ?? declNode?.childForFieldName("arraySubscripts");
    const declSubscripts = declArraySubNode ? extractSubscripts(declArraySubNode) : [];

    // Navigate up to the ComponentClause to get type-level subscripts (e.g. Real[3])
    let clauseNode = cst as any;
    while (
      clauseNode &&
      clauseNode.type !== "ComponentClause" &&
      clauseNode.type !== "component_clause" &&
      clauseNode.type !== "ComponentClause1" &&
      clauseNode.type !== "component_clause1"
    ) {
      clauseNode = clauseNode.parent;
    }
    const clauseArraySubNode =
      clauseNode?.childForFieldName("array_subscripts") ?? clauseNode?.childForFieldName("arraySubscripts");
    const typeSubscripts = clauseArraySubNode ? extractSubscripts(clauseArraySubNode) : [];

    // Combine: component dimensions first, then type dimensions.
    // For `Real[3] x[2]`, this produces [2, 3] matching Modelica semantics.
    const subscripts = [...declSubscripts, ...typeSubscripts];

    // Also check if the resolved type has its own array dimensions (e.g. type T = Real[3])
    const classInstanceId = db.query<SymbolId | null>("classInstance", self.id);
    if (classInstanceId !== null) {
      let currentClassId: SymbolId | null = classInstanceId;
      const visitedBase = new Set<SymbolId>();

      while (currentClassId && !visitedBase.has(currentClassId)) {
        visitedBase.add(currentClassId);
        const typeClassDims = db.query<any[] | null>("arrayDimensions", currentClassId);
        if (typeClassDims && typeClassDims.length > 0) {
          subscripts.push(...typeClassDims);
          break;
        }

        // Check Extends
        const children = db.childrenOf(currentClassId);
        const extendsClause = children.find((c) => c.kind === "Extends");
        if (extendsClause) {
          const baseClass = db.query<{ id: SymbolId } | null>("resolvedBaseClass", extendsClause.id);
          if (baseClass) {
            currentClassId = baseClass.id;
            continue;
          }
        }

        // Check ShortClassSpecifier
        const cstNode = db.cstNode(currentClassId) as any;
        const spec = cstNode?.childForFieldName?.("classSpecifier");
        if (spec?.type === "ShortClassSpecifier") {
          const typeSpec = spec.childForFieldName?.("typeSpecifier");
          if (typeSpec?.text) {
            const currentEntry = db.symbol(currentClassId);
            if (currentEntry) {
              // We need to resolve the type name in the scope of the class
              const resolvedEntry = resolveQualified(db, typeSpec.text); // Fast path
              if (resolvedEntry) {
                currentClassId = resolvedEntry.id;
                continue;
              }
              const simpleName = typeSpec.text.includes(".") ? typeSpec.text.split(".").pop()! : typeSpec.text;
              const entries = db.byName(simpleName);
              const typeEntry = entries?.find((e) => e.kind === "Class" || e.kind === "Package") ?? null;
              if (typeEntry) {
                currentClassId = typeEntry.id;
                continue;
              }
            }
          }
        }

        break;
      }
    }

    return subscripts.length > 0 ? subscripts : null;
  },

  /**
   * Resolve array dimensions to concrete numeric values.
   *
   * For literal dimensions, returns the value directly.
   * For expression dimensions (e.g. `size(y,1)`, `n+1`), evaluates
   * the expression by walking the CST and resolving name references.
   * For flexible dimensions (`:`), returns 0 (inferred from binding later).
   *
   * Uses Salsa cycle recovery: if evaluating a dimension expression
   * triggers a cycle (e.g. `x[size(y,1)], y[size(x,1)]`), the recovery
   * function returns null, signalling an unresolvable cycle.
   */
  resolvedArrayDimensions: {
    execute: (db: QueryDB, self: SymbolEntry): number[] | null => {
      if (evaluatingDimensionsStack.length === 0) {
        cyclicDimensionDiagnostics.clear();
        activeDimQueriesStack = [];
      }
      activeQueryDB = db;

      const rawDims = db.query<Array<
        | { kind: "literal"; value: number }
        | { kind: "flexible" }
        | { kind: "expression"; cstBytes: readonly [number, number]; text?: string }
      > | null>("arrayDimensions", self.id);
      if (!rawDims || rawDims.length === 0) return null;

      const shape: number[] = [];
      for (let i = 0; i < rawDims.length; i++) {
        const dim = rawDims[i];
        if (dim.kind === "literal") {
          shape.push(dim.value);
        } else if (dim.kind === "flexible") {
          // Try to infer from binding expression
          const mod = db.query<any | null>("effectiveModification", self.id);
          if (mod?.bindingExpression) {
            const val = db.evaluate(mod.bindingExpression, self.parentId);
            if (Array.isArray(val)) {
              shape.push(val.length);
              continue;
            }
          }
          shape.push(0); // Inferred from binding later
        } else if (dim.kind === "expression") {
          evaluatingDimensionsStack.push({
            symbolId: self.id,
            dimIndex: i,
            exprText: dim.text ?? "?",
          });
          let value: number | null = null;
          try {
            value = evaluateDimExpr(db, self, dim);
          } finally {
            evaluatingDimensionsStack.pop();
          }
          if (value === null) {
            shape.push(-1);
          } else {
            shape.push(value);
          }
        }
      }
      return shape;
    },
    // Salsa cycle recovery: trace the circular dependency and record diagnostic
    recovery: (cycle: any, self: SymbolEntry): number[] | null => {
      if (activeQueryDB) {
        const db = activeQueryDB;
        const firstIdx = evaluatingDimensionsStack.findIndex((f) => f.symbolId === self.id);
        if (firstIdx !== -1) {
          const requestedDimIndex = activeDimQueriesStack[activeDimQueriesStack.length - 1]?.dimIndex ?? 0;
          const rawDims = db.query<any[] | null>("arrayDimensions", self.id);
          const requestedExprText = rawDims?.[requestedDimIndex]?.text ?? "?";

          const cycleStartIdx = evaluatingDimensionsStack.findIndex((frame) => {
            const name = db.symbol(frame.symbolId)?.name;
            if (!name) return false;
            const regex = new RegExp(`\\b${name}\\b`);
            return regex.test(requestedExprText);
          });

          const cycleFrames =
            cycleStartIdx !== -1
              ? evaluatingDimensionsStack.slice(cycleStartIdx)
              : evaluatingDimensionsStack.slice(firstIdx);

          for (const frame of cycleFrames) {
            if (frame.dimIndex !== -1) {
              addCyclicDiagnostic(frame.symbolId, frame.dimIndex, frame.exprText);
            }
          }
          addCyclicDiagnostic(self.id, requestedDimIndex, requestedExprText);
        }
      }
      return null;
    },
  },

  /**
   * Aggregate query returning the component's metadata.
   */
  componentInstance: (db: QueryDB, self: SymbolEntry) => {
    return {
      id: self.id,
      name: self.name,
      classInstance: db.query<SymbolId | null>("classInstance", self.id),
      variability: db.query<string | null>("variability", self.id),
      causality: db.query<string | null>("causality", self.id),
      flowPrefix: db.query<string | null>("flowPrefix", self.id),
      isFinal: db.query<boolean>("isFinal", self.id),
      isRedeclare: db.query<boolean>("isRedeclare", self.id),
      isInner: db.query<boolean>("isInner", self.id),
      isOuter: db.query<boolean>("isOuter", self.id),
      isReplaceable: db.query<boolean>("isReplaceable", self.id),
      isProtected: db.query<boolean>("isProtected", self.id),
      arrayDimensions: db.query<number[] | null>("resolvedArrayDimensions", self.id),
      isConnectorType: db.query<boolean>("isConnectorType", self.id),
      typeSpecifier: db.query<string | null>("typeSpecifier", self.id),
      modification: db.query<any>("effectiveModification", self.id),
    };
  },
};

export const shortClassSpecifierQueries: Record<string, any> = {
  effectiveModification: {
    execute: (db: QueryDB, self: SymbolEntry) => {
      const cst = db.cstNode(self.id) as any;
      if (!cst) return null;
      const classSpec = cst.childForFieldName("classSpecifier");
      if (!classSpec || classSpec.type !== "ShortClassSpecifier") return null;
      const modNode = classSpec.childForFieldName("classModification");
      if (!modNode) return null;
      return parseModArgsFromCst(modNode, self.parentId);
    },
    recovery: () => null,
  },
  resolvedBaseClass: {
    execute: (db: QueryDB, self: SymbolEntry) => {
      const selfCstShort = db.cstNode(self.id) as any;
      const specShort = selfCstShort?.childForFieldName?.("classSpecifier");
      if (specShort?.type === "ShortClassSpecifier") {
        const typeSpec = specShort.childForFieldName?.("typeSpecifier");
        const typeName = typeSpec?.text;
        if (typeName && self.parentId !== null) {
          const parentResolver = db.query<(n: string) => { id: number } | null>("resolveName", self.parentId);
          if (parentResolver) {
            const resolved = parentResolver(typeName);
            if (resolved && resolved.id !== self.id) {
              return resolved;
            }
          }
        }
      }
      return null;
    },
    recovery: () => null,
  },
  instantiate: {
    execute: (db: QueryDB, self: SymbolEntry) => {
      const base = db.query<any>("resolvedBaseClass", self.id);
      if (base && base.id !== self.id) {
        return db.query<number[]>("instantiate", base.id);
      }
      return [];
    },
    recovery: () => [],
  },
  resolveSimpleName: (db: QueryDB, self: SymbolEntry) => {
    const base = db.query<any>("resolvedBaseClass", self.id);
    if (base && base.id !== self.id) {
      return db.query<any>("resolveSimpleName", base.id);
    }
    return () => null;
  },
  resolveName: (db: QueryDB, self: SymbolEntry) => {
    return (name: string, encapsulated?: boolean) => {
      const simpleNameResolver = db.query<any>("resolveSimpleName", self.id);
      if (simpleNameResolver) {
        const resolved = simpleNameResolver(name, encapsulated);
        if (resolved) return resolved;
      }
      if (self.parentId !== null) {
        const parentResolver = db.query<any>("resolveName", self.parentId);
        if (parentResolver) return parentResolver(name, encapsulated);
      }
      return null;
    };
  },
  allElements: (db: QueryDB, self: SymbolEntry) => {
    const base = db.query<any>("resolvedBaseClass", self.id);
    if (base && base.id !== self.id) {
      return db.query<any>("allElements", base.id);
    }
    return [];
  },
  scopeData: (db: QueryDB, self: SymbolEntry) => {
    const base = db.query<any>("resolvedBaseClass", self.id);
    if (base && base.id !== self.id) {
      return db.query<any>("scopeData", base.id);
    }
    return { directByName: {}, extendsClasses: [], imports: [], hasExtends: false };
  },
};

export const connectEquationQueries: Record<string, any> = {
  /**
   * Validate that both sides of the connect equation reference
   * connector-typed components, and that they are plug-compatible.
   */
  validateConnect: (db: QueryDB, self: SymbolEntry) => {
    const meta = self.metadata as Record<string, unknown>;
    const ref1Name = typeof meta?.ref1 === "string" ? meta.ref1 : null;
    const ref2Name = typeof meta?.ref2 === "string" ? meta.ref2 : null;
    if (!ref1Name || !ref2Name) return { valid: false, reason: "unresolved" };

    // Resolve both component references
    const ref1Entries = db.byName(ref1Name);
    const ref2Entries = db.byName(ref2Name);
    if (!ref1Entries?.length || !ref2Entries?.length) {
      return { valid: false, reason: "not found" };
    }
    return { valid: true, reason: null };
  },
};

export const modelicaQueryHooks = new Map<string, Record<string, any>>([
  ["class_definition", classDefinitionQueries],
  ["ClassDefinition", classDefinitionQueries],
  ["component_declaration", componentDeclarationQueries],
  ["ComponentDeclaration", componentDeclarationQueries],
  ["extends_clause", extendsClauseQueries],
  ["ExtendsClause", extendsClauseQueries],
  ["short_class_specifier", shortClassSpecifierQueries],
  ["ShortClassSpecifier", shortClassSpecifierQueries],
  ["connect_equation", connectEquationQueries],
  ["ConnectEquation", connectEquationQueries],
]);
