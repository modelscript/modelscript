// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Post-WASM semantic validation pass.
 *
 * Runs lightweight CST + QueryDB semantic checks when the WASM flattener
 * succeeds (or when specific WASM bailouts correspond to semantic errors)
 * so strict `--flattener=wasm` preserves semantic diagnostics without
 * duplicating full TS DAE lowering.
 */

import { type DAEBuilder, type QueryDB, type SymbolEntry, type SymbolId } from "@modelscript/runtime";
import { type SyntaxNode } from "../../src-gen/bindings.js";
import { ModelicaErrorCode } from "../errors.js";
import { validateEnumeration } from "../queries.js";

function pushError(dae: DAEBuilder, code: number, rule: string, message: string, node?: SyntaxNode | null): void {
  dae.diagnostics.push({
    code,
    rule,
    severity: "error",
    message,
    range: node ? { startOffset: node.startIndex, endOffset: node.endIndex } : null,
  });
}

function pushNotification(dae: DAEBuilder, node?: SyntaxNode | null): void {
  if (!node) return;
  dae.diagnostics.push({
    code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
    rule: ModelicaErrorCode.NOTIFICATION_FROM_HERE.rule,
    severity: "notification",
    message: "From here:",
    range: { startOffset: node.startIndex, endOffset: node.endIndex },
  });
}

function findNodeAtByteRange(
  root: SyntaxNode,
  startByte: number,
  endByte: number,
  targetTypes: string[],
): SyntaxNode | null {
  let best: SyntaxNode | null = null;
  function visit(n: SyntaxNode): void {
    if (n.startIndex <= startByte && n.endIndex >= endByte) {
      if (targetTypes.includes(n.type)) {
        best = n;
      }
      for (const ch of n.namedChildren) {
        visit(ch);
      }
    }
  }
  visit(root);
  return best;
}

function cstOf(db: QueryDB, id: SymbolId): SyntaxNode | null {
  return (db.cstNode(id) as SyntaxNode | null) ?? null;
}

/**
 * Emits M3001 (`Type mismatch in binding ... expected subtype of Integer, got type Real.`)
 * when the WASM flattener bails with `WasmBailReason.IntegerRealBinding` (3629).
 */
export function emitIntegerRealBindingDiagnostic(
  db: QueryDB,
  dae: DAEBuilder,
  rootClassId: SymbolId,
  startByte: number,
  endByte: number,
): boolean {
  if (startByte < 0 || endByte < startByte) return false;
  const rootCst = cstOf(db, rootClassId);
  if (!rootCst) return false;
  const declNode = findNodeAtByteRange(rootCst, startByte, endByte, [
    "declaration",
    "element_modification",
    "component_declaration",
  ]);
  if (!declNode) return false;
  const text = declNode.text.trim();
  const eqIdx = text.indexOf("=");
  if (eqIdx < 0) return false;
  const lhsPart = text.slice(0, eqIdx).trim();
  const rhsPart = text.slice(eqIdx + 1).trim();
  if (!lhsPart || !rhsPart || rhsPart.startsWith("sign(")) return false;
  const varName = lhsPart.split(/[.\s[(]/)[0] ?? lhsPart;
  pushError(
    dae,
    ModelicaErrorCode.TYPE_MISMATCH_BINDING.code,
    ModelicaErrorCode.TYPE_MISMATCH_BINDING.rule,
    `Type mismatch in binding ${varName} = ${rhsPart}, expected subtype of Integer, got type Real.`,
    declNode,
  );
  return true;
}

function getHeaderText(classCst: SyntaxNode): string {
  const txt = classCst.text ?? "";
  const nl = txt.indexOf("\n");
  return nl >= 0 ? txt.slice(0, nl) : txt;
}

function getClassSpecialization(sym: SymbolEntry, classCst: SyntaxNode | null): string {
  const meta = sym.metadata as Record<string, unknown> | undefined;
  const spec = (meta?.["specialization"] ?? meta?.["classType"] ?? "") as string;
  if (spec) return spec;
  if (!classCst) return "model";
  const hdr = getHeaderText(classCst);
  const m = hdr.match(/\b(package|model|block|connector|record|type|function|class|operator)\b/);
  return m ? m[1]! : "model";
}

function isClassPartial(sym: SymbolEntry, classCst: SyntaxNode | null): boolean {
  const meta = sym.metadata as Record<string, unknown> | undefined;
  if (meta?.["isPartial"] === true) return true;
  if (!classCst) return false;
  return /^(?:(?:encapsulated|pure|impure)\s+)*partial\b/.test((classCst.text ?? "").trim());
}

function resolveClassSym(db: QueryDB, scopeId: SymbolId, name: string): SymbolEntry | null {
  const baseName = name.split(".")[0] ?? name;
  const resolved =
    db.query<((n: string) => SymbolEntry | null) | null>("resolveSimpleName", scopeId)?.(baseName) ??
    db.byName(name).find((e) => e.kind === "Class" || e.kind === "Package") ??
    db.byName(baseName).find((e) => e.kind === "Class" || e.kind === "Package") ??
    null;
  if (!resolved) return null;
  if (!name.includes(".")) return resolved;
  const parts = name.split(".");
  let cur: SymbolEntry | null = resolved;
  for (let i = 1; i < parts.length && cur; i++) {
    const child: SymbolEntry | undefined = db
      .childrenOf(cur.id)
      .find((c) => c.name === parts[i] && (c.kind === "Class" || c.kind === "Package"));
    cur = child ?? null;
  }
  return cur;
}

function inferSimpleLiteralType(exprText: string): string | null {
  const t = exprText.trim();
  if (t === "true" || t === "false") return "Boolean";
  if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) return "String";
  if (/^[+-]?\d+$/.test(t)) return "Integer";
  if (/^[+-]?(?:\d+\.\d*|\.\d+|\d+[eE][+-]?\d+|\d+\.\d*[eE][+-]?\d+)$/.test(t)) return "Real";
  return null;
}

interface CompInfo {
  sym: SymbolEntry;
  typeName: string;
  variability: string;
  isProtected: boolean;
  isFinal: boolean;
  isFlow: boolean;
  isStream: boolean;
  isOuter: boolean;
  isReplaceable: boolean;
  ndims: number;
  cst: SyntaxNode | null;
}

function findAncestor(node: SyntaxNode | null, typeName: string, maxHops = 5): SyntaxNode | null {
  let cur = node;
  for (let i = 0; i < maxHops && cur; i++) {
    if (cur.type === typeName) return cur;
    cur = cur.parent;
  }
  return null;
}

function getCompInfo(db: QueryDB, compSym: SymbolEntry): CompInfo {
  const meta = (compSym.metadata ?? {}) as Record<string, unknown>;
  const cst = cstOf(db, compSym.id);
  const declClause = findAncestor(cst, "component_clause") ?? cst?.parent?.parent ?? cst?.parent;
  const elemNode = declClause?.parent?.type === "element" ? declClause.parent : declClause;
  const clauseText = (elemNode?.text ?? cst?.text ?? "").trim();
  const headerBeforeParen = clauseText.split("(")[0] ?? clauseText;
  let typeName = (meta["typeName"] as string) ?? "";
  if (!typeName && declClause) {
    const tsNode = declClause.namedChildren.find((c) => c.type === "type_specifier");
    if (tsNode) typeName = tsNode.text.trim();
  }
  let variability = (meta["variability"] as string) ?? "";
  if (!variability) {
    if (/\bconstant\b/.test(headerBeforeParen)) variability = "constant";
    else if (/\bparameter\b/.test(headerBeforeParen)) variability = "parameter";
    else if (/\bdiscrete\b/.test(headerBeforeParen)) variability = "discrete";
    else variability = "continuous";
  }
  const ndims = Array.isArray(meta["dimensions"]) ? meta["dimensions"].length : headerBeforeParen.includes("[") ? 1 : 0;
  return {
    sym: compSym,
    typeName,
    variability,
    isProtected: Boolean(meta["isProtected"]),
    isFinal: Boolean(meta["isFinal"]) || /\bfinal\b/.test(headerBeforeParen),
    isFlow: /\bflow\b/.test(headerBeforeParen),
    isStream: /\bstream\b/.test(headerBeforeParen),
    isOuter: /\bouter\b/.test(headerBeforeParen) && !/\binner\b/.test(headerBeforeParen),
    isReplaceable: /\breplaceable\b/.test(headerBeforeParen),
    ndims,
    cst,
  };
}

function collectClassComponents(db: QueryDB, classId: SymbolId, visited = new Set<SymbolId>()): Map<string, CompInfo> {
  const map = new Map<string, CompInfo>();
  if (visited.has(classId)) return map;
  visited.add(classId);

  for (const child of db.childrenOf(classId)) {
    if (child.kind === "Extends") {
      const base =
        db.query<SymbolEntry | null>("resolvedBaseClass", child.id) ?? resolveClassSym(db, classId, child.name);
      if (base) {
        const baseComps = collectClassComponents(db, base.id, visited);
        for (const [k, v] of baseComps) {
          if (!map.has(k)) map.set(k, v);
        }
      }
    } else if (child.kind === "Component") {
      map.set(child.name, getCompInfo(db, child));
    }
  }
  return map;
}

function collectModifiersInNode(
  modListNode: SyntaxNode | null,
): Array<{ name: string; text: string; node: SyntaxNode; nested?: SyntaxNode | null }> {
  const out: Array<{ name: string; text: string; node: SyntaxNode; nested?: SyntaxNode | null }> = [];
  if (!modListNode) return out;
  function walk(n: SyntaxNode): void {
    if (n.type === "element_modification") {
      const nameNode = n.childForFieldName("name") ?? n.namedChildren[0] ?? null;
      const name = nameNode?.text?.trim() ?? "";
      if (name) {
        const modNode = n.childForFieldName("modification") ?? n.namedChildren[1] ?? null;
        out.push({ name, text: n.text.trim(), node: n, nested: modNode });
      }
      return;
    }
    if (n.type === "element_redeclaration") {
      out.push({ name: "", text: n.text.trim(), node: n });
      return;
    }
    for (const ch of n.namedChildren) walk(ch);
  }
  walk(modListNode);
  return out;
}

function validateClassSubtree(db: QueryDB, dae: DAEBuilder, classId: SymbolId, visitedClasses: Set<SymbolId>): void {
  if (visitedClasses.has(classId)) return;
  visitedClasses.add(classId);

  const sym = db.symbol(classId);
  if (!sym) return;
  const classCst = cstOf(db, classId);
  if (!classCst) return;

  // 1. Enumeration validation (skipped when flattenedInWasm === true)
  const enumErr = validateEnumeration(classCst as any, sym);
  if (enumErr) {
    pushError(dae, enumErr.code, "enum-validation", enumErr.message, classCst);
  }

  const spec = getClassSpecialization(sym, classCst);
  const classPartial = isClassPartial(sym, classCst);
  const children = db.childrenOf(classId);
  const comps = collectClassComponents(db, classId);

  // 2. Builtin extension with extra elements (e.g., inst4, usertype6)
  if (spec !== "type") {
    for (const child of children) {
      if (child.kind === "Extends" && /^(Real|Integer|Boolean|String)$/.test(child.name)) {
        const hasOtherElems = children.some((c) => c.kind === "Component");
        if (hasOtherElems) {
          pushError(
            dae,
            4000,
            "builtin-extends-elements",
            `A class extending from builtin type ${child.name} may not have other elements.`,
            classCst,
          );
        }
      }
    }
  }

  // 3. Invalid stream connector (must have exactly one flow variable)
  if (spec === "connector") {
    let hasStream = false;
    let flowCount = 0;
    for (const info of comps.values()) {
      if (info.isStream) hasStream = true;
      if (info.isFlow) flowCount++;
    }
    if (hasStream && flowCount !== 1) {
      pushError(
        dae,
        4000,
        "invalid-stream-connector",
        `Invalid stream connector ${sym.name}: A stream connector must have exactly one flow variable.`,
        classCst,
      );
    }
  }

  // 4. Component-level checks (partial type, outer modifier, final override, protected mod, condition type)
  for (const child of children) {
    if (child.kind !== "Component") continue;
    const info = getCompInfo(db, child);
    const compCst = info.cst;
    const declClause = compCst?.parent?.type === "component_declaration" ? compCst.parent.parent : compCst?.parent;
    const clauseText = (declClause?.text ?? compCst?.text ?? "").trim();

    // 4a. Outer element with modifier
    if (info.isOuter && compCst) {
      const errNode = findAncestor(compCst, "component_clause") ?? compCst;
      const errText = errNode.text;
      const hasEq = errText.includes("=");
      const hasParen = errText.includes("(");
      if (hasEq || hasParen) {
        let modIdx = Math.min(hasEq ? errText.indexOf("=") : Infinity, hasParen ? errText.indexOf("(") : Infinity);
        if (hasEq && modIdx === errText.indexOf("=") && modIdx > 0 && errText[modIdx - 1] === " ") {
          modIdx -= 1;
        }
        const modText = errText.slice(modIdx).replace(/;\s*$/, "").trimEnd();
        pushError(
          dae,
          ModelicaErrorCode.OUTER_MODIFIER.code,
          ModelicaErrorCode.OUTER_MODIFIER.rule,
          ModelicaErrorCode.OUTER_MODIFIER.message(modText, child.name),
          errNode,
        );
      }
    }

    // 4b. Conditional component condition type (e.g. Real x if "true";)
    if (compCst) {
      for (const n of compCst.namedChildren) {
        if (n.type === "condition_attribute") {
          const expr = n.namedChildren[0];
          if (expr) {
            const litType = inferSimpleLiteralType(expr.text);
            if (litType && litType !== "Boolean") {
              pushError(
                dae,
                ModelicaErrorCode.TYPE_MISMATCH_BINDING.code,
                ModelicaErrorCode.TYPE_MISMATCH_BINDING.rule,
                `Type error in conditional '${expr.text.trim()}'. Expected Boolean, got ${litType}.`,
                n,
              );
            }
          }
        }
      }
    }

    // 4c. Resolve component type and recurse + check partial/final/protected
    if (info.typeName && !/^(Real|Integer|Boolean|String)$/.test(info.typeName)) {
      const typeSym = resolveClassSym(db, classId, info.typeName);
      if (typeSym) {
        const typeCst = cstOf(db, typeSym.id);
        if (!classPartial && !info.isReplaceable && !info.isOuter && isClassPartial(typeSym, typeCst)) {
          const errNode = findAncestor(compCst, "component_clause") ?? compCst;
          pushNotification(dae, typeCst);
          pushError(
            dae,
            4028,
            "partial-type-component",
            `Component '${child.name}' has partial type '${info.typeName}'.`,
            errNode,
          );
        }

        // Check component class_modification against target class members
        if (compCst) {
          const targetComps = collectClassComponents(db, typeSym.id);
          const compDeclNode = findAncestor(compCst, "component_declaration") ?? compCst;
          const modNode =
            compDeclNode.namedChildren.find((c) => c.type === "modification" || c.type === "class_modification") ??
            compDeclNode;
          if (modNode) {
            for (const m of collectModifiersInNode(modNode)) {
              const target = targetComps.get(m.name);
              if (target) {
                if (target.isFinal) {
                  const eqPart = m.text.includes("=") ? m.text.slice(m.text.indexOf("=")).trim() : m.text;
                  const targetNode = findAncestor(target.cst, "component_clause") ?? target.cst;
                  pushNotification(dae, m.node);
                  pushError(
                    dae,
                    ModelicaErrorCode.FINAL_OVERRIDE.code,
                    ModelicaErrorCode.FINAL_OVERRIDE.rule,
                    ModelicaErrorCode.FINAL_OVERRIDE.message(m.name, eqPart),
                    targetNode,
                  );
                }
                if (target.isProtected) {
                  pushError(
                    dae,
                    ModelicaErrorCode.PROTECTED_MODIFICATION.code,
                    ModelicaErrorCode.PROTECTED_MODIFICATION.rule,
                    ModelicaErrorCode.PROTECTED_MODIFICATION.message(m.name, m.text),
                    m.node,
                  );
                }
              }
            }
          }
        }

        validateClassSubtree(db, dae, typeSym.id, visitedClasses);
      }
    }

    // 4d. Check builtin attribute final override on own `extends`
    if (/\bfinal\b/.test(clauseText) && compCst) {
      // Nothing to check on self; checked when extended/modified
    }
  }

  // 5. Extends modification checks (final override / protected mod, including nested `x(start = 2.0)`)
  for (const child of children) {
    if (child.kind !== "Extends") continue;
    const baseSym =
      db.query<SymbolEntry | null>("resolvedBaseClass", child.id) ?? resolveClassSym(db, classId, child.name);
    if (!baseSym) continue;
    const extCst = cstOf(db, child.id);
    if (extCst) {
      const baseComps = collectClassComponents(db, baseSym.id);
      const modWrap = extCst.namedChildren.find(
        (c) => c.type === "class_or_inheritance_modification" || c.type === "class_modification",
      );
      const modNode =
        modWrap?.type === "class_modification"
          ? modWrap
          : (modWrap?.namedChildren.find((c) => c.type === "class_modification") ?? modWrap ?? null);
      if (modNode) {
        for (const m of collectModifiersInNode(modNode)) {
          const target = baseComps.get(m.name);
          if (target) {
            if (target.isFinal) {
              const eqPart = m.text.includes("=") ? m.text.slice(m.text.indexOf("=")).trim() : m.text;
              pushError(
                dae,
                ModelicaErrorCode.FINAL_OVERRIDE.code,
                ModelicaErrorCode.FINAL_OVERRIDE.rule,
                ModelicaErrorCode.FINAL_OVERRIDE.message(m.name, eqPart),
                m.node,
              );
            }
            if (target.isProtected) {
              pushError(
                dae,
                ModelicaErrorCode.PROTECTED_MODIFICATION.code,
                ModelicaErrorCode.PROTECTED_MODIFICATION.rule,
                ModelicaErrorCode.PROTECTED_MODIFICATION.message(m.name, m.text),
                m.node,
              );
            }
            // Check nested attribute modifications like `x(start = 2.0)` when `target` had `final start = 1.0`
            if (m.nested && target.cst) {
              const targetText = target.cst.text ?? "";
              for (const nm of collectModifiersInNode(m.nested)) {
                const re = new RegExp(`\\bfinal\\s+${nm.name}\\b`);
                if (re.test(targetText)) {
                  const eqPart = nm.text.includes("=") ? nm.text.slice(nm.text.indexOf("=")).trim() : nm.text;
                  const targetMod =
                    collectModifiersInNode(target.cst).find((tm) => tm.name === nm.name)?.node ?? target.cst;
                  pushNotification(dae, nm.node);
                  pushError(
                    dae,
                    ModelicaErrorCode.FINAL_OVERRIDE.code,
                    ModelicaErrorCode.FINAL_OVERRIDE.rule,
                    ModelicaErrorCode.FINAL_OVERRIDE.message(nm.name, eqPart),
                    targetMod,
                  );
                }
              }
            }
          }
        }
      }
    }
    validateClassSubtree(db, dae, baseSym.id, visitedClasses);
  }

  // 6. Walk CST for equations, statements, and function calls
  function walkCst(node: SyntaxNode, inWhen: boolean, inCondCtx: boolean): void {
    const t = node.type;

    if (t === "if_equation" || t === "if_statement" || t === "if_expression") {
      // Check condition child
      const cond = node.childForFieldName("condition") ?? node.namedChildren[0] ?? null;
      if (cond) {
        const litType = inferSimpleLiteralType(cond.text);
        if (litType && litType !== "Boolean") {
          pushError(
            dae,
            ModelicaErrorCode.TYPE_MISMATCH_BINDING.code,
            ModelicaErrorCode.TYPE_MISMATCH_BINDING.rule,
            `Type error in conditional '${cond.text.trim()}'. Expected Boolean, got ${litType}.`,
            node,
          );
        }
        walkCst(cond, inWhen, true);
      }
      for (const ch of node.namedChildren) {
        if (ch !== cond) walkCst(ch, inWhen, inCondCtx);
      }
      return;
    }

    if (t === "when_equation" || t === "when_statement") {
      // Check elsewhen variable mismatch
      const branches: Set<string>[] = [];
      let curSet = new Set<string>();
      function collectBranchEqs(n: SyntaxNode): void {
        if (n.type.includes("elsewhen") || n.text === "elsewhen") {
          branches.push(curSet);
          curSet = new Set<string>();
          if (n.type !== "elsewhen" && n.text !== "elsewhen") {
            for (const ch of n.children) collectBranchEqs(ch);
          }
          return;
        }
        if (n.type === "simple_equation" || n.type === "equation" || n.type === "assignment_statement") {
          const lhs = n.namedChildren[0]?.text?.trim();
          if (lhs) curSet.add(lhs.split("[")[0]!.trim());
          return;
        }
        for (const ch of n.children) collectBranchEqs(ch);
      }
      for (const ch of node.children) collectBranchEqs(ch);
      branches.push(curSet);
      if (branches.length > 1) {
        const first = branches[0]!;
        for (let i = 1; i < branches.length; i++) {
          const b = branches[i]!;
          if (b.size !== first.size || Array.from(first).some((v) => !b.has(v))) {
            pushError(
              dae,
              5000,
              "when-variable-mismatch",
              `The same variables must be solved in elsewhen clause as in the when clause.`,
              node,
            );
            break;
          }
        }
      }
      for (const ch of node.namedChildren) {
        walkCst(ch, true, inCondCtx);
      }
      return;
    }

    if (t === "simple_equation" || t === "equation" || t === "assignment_statement") {
      const lhs = node.namedChildren[0];
      if (lhs) {
        const lhsName = lhs.text.trim();
        const comp = comps.get(lhsName);
        if (comp && comp.typeName && !/^(Real|Integer|Boolean|String)$/.test(comp.typeName)) {
          const typeSym = resolveClassSym(db, classId, comp.typeName);
          if (typeSym) {
            const tSpec = getClassSpecialization(typeSym, cstOf(db, typeSym.id));
            if (tSpec === "model" || tSpec === "package" || tSpec === "block") {
              pushError(
                dae,
                5014,
                "assignment-to-non-variable",
                `Component '${lhsName}' may not be assigned to due to class specialization '${tSpec}'.`,
                node,
              );
            }
          }
        }
      }
    }

    if (t === "range_expression" && node.namedChildren.length === 3) {
      const step = node.namedChildren[1]!.text.trim();
      if (step === "0" || step === "0.0") {
        pushError(dae, 5000, "range-invalid-step", `Step size 0 in range is too small.`, node);
      }
    }

    if (t === "function_call") {
      const fnNode = node.childForFieldName("function") ?? node.namedChildren[0] ?? null;
      const fnName = fnNode?.text?.trim() ?? "";
      const argsNode = node.namedChildren.find(
        (c) => c.type === "function_call_args" || c.type === "function_arguments",
      );
      const rawArgs: SyntaxNode[] = [];
      if (argsNode) {
        function collectArgs(n: SyntaxNode): void {
          if (n.type === "function_argument" || n.type === "named_argument") {
            rawArgs.push(n);
            return;
          }
          if (n.type === "function_call") return;
          for (const ch of n.namedChildren) collectArgs(ch);
        }
        collectArgs(argsNode);
      }
      const argTexts = rawArgs.map((a) => a.text.trim());

      if (fnName === "assert" && argTexts.length >= 2) {
        const condType = inferSimpleLiteralType(argTexts[0]!);
        if (condType && condType !== "Boolean") {
          pushError(
            dae,
            ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
            ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.rule,
            `Type mismatch for positional argument 1 in assert(condition=${argTexts[0]}). The argument has type:\n  ${condType}\nexpected type:\n  Boolean`,
            node,
          );
        }
        const msgType = inferSimpleLiteralType(argTexts[1]!);
        if (msgType && msgType !== "String") {
          pushError(
            dae,
            ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
            ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.rule,
            `Type mismatch for positional argument 2 in assert(message=${argTexts[1]}). The argument has type:\n  ${msgType}\nexpected type:\n  String`,
            node,
          );
        }
        // First argument of assert is a valid condition context for cardinality()
        if (rawArgs[0]) walkCst(rawArgs[0], inWhen, true);
        for (let i = 1; i < rawArgs.length; i++) walkCst(rawArgs[i]!, inWhen, inCondCtx);
        return;
      }

      if (fnName === "cardinality" && argTexts.length >= 1) {
        if (!inCondCtx) {
          pushError(
            dae,
            4000,
            "cardinality-invalid-context",
            `cardinality may only be used in the condition of an if-statement/equation or an assert.`,
            node,
          );
        }
        const argName = argTexts[0]!.replace(/^[a-zA-Z_]\w*\s*=\s*/, "").trim();
        if (!comps.has(argName) && resolveClassSym(db, classId, argName)) {
          pushError(
            dae,
            4048,
            "cardinality-expected-component",
            `Expected ${argName} to be a component, but found class instead.`,
            rawArgs[0],
          );
        } else {
          const cInfo = comps.get(argName.split(".")[0] ?? argName);
          if (cInfo && /^(Real|Integer|Boolean|String)$/.test(cInfo.typeName)) {
            pushError(
              dae,
              ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
              ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.rule,
              `Type mismatch for positional argument 1 in ${node.text.trim()}.`,
              node,
            );
          }
        }
      }

      if (fnName === "reinit" && argTexts.length >= 2) {
        if (!inWhen) {
          pushError(
            dae,
            5000,
            "reinit-outside-when",
            `Operator reinit may only be used in the body of a when equation.`,
            node,
          );
        }
        const xName = argTexts[0]!;
        const cInfo = comps.get(xName.split("[")[0]!.trim());
        if (cInfo) {
          if (
            cInfo.variability === "parameter" ||
            cInfo.variability === "constant" ||
            cInfo.variability === "discrete"
          ) {
            pushError(
              dae,
              5000,
              "reinit-non-continuous",
              `The first argument to reinit must be a continuous time variable, but ${xName} is ${cInfo.variability}.`,
              node,
            );
          } else if (/^(Integer|Boolean|String)$/.test(cInfo.typeName)) {
            pushError(
              dae,
              3000,
              "reinit-invalid-type",
              `The first argument to reinit must be a subtype of Real, but ${xName} has type ${cInfo.typeName}.`,
              node,
            );
          }
        }
      }

      if (fnName === "der" && argTexts.length === 1) {
        const xName = argTexts[0]!;
        const cInfo = comps.get(xName.split("[")[0]!.trim());
        if (cInfo) {
          if (cInfo.variability === "parameter" || cInfo.variability === "constant") {
            pushError(dae, 3000, "der-not-differentiable", `Argument ${xName} of der is not differentiable.`, node);
          } else if (/^(Integer|Boolean|String)$/.test(cInfo.typeName)) {
            pushError(
              dae,
              3000,
              "der-invalid-type",
              `Argument '${xName}' to der has illegal type ${cInfo.typeName}, must be a subtype of Real.`,
              node,
            );
          }
        }
      }

      if (fnName === "size" && argTexts.length >= 1) {
        const arrArg = argTexts[0]!;
        const cInfo = comps.get(arrArg);
        if ((cInfo && cInfo.ndims === 0) || inferSimpleLiteralType(arrArg) !== null) {
          pushError(dae, 3000, "size-non-array", `The first argument of size must be an array expression.`, node);
        } else if (argTexts.length >= 2 && cInfo && cInfo.ndims > 0 && /^-?\d+$/.test(argTexts[1]!)) {
          const dim = parseInt(argTexts[1]!, 10);
          if (dim < 1 || dim > cInfo.ndims) {
            pushError(
              dae,
              3000,
              "size-invalid-index",
              `Invalid index ${dim} in call to size of ${arrArg}, valid index interval is [1,${cInfo.ndims}].`,
              node,
            );
          }
        }
      }

      if ((fnName === "sum" || fnName === "product") && argTexts.length === 1) {
        const arg0 = argTexts[0]!;
        const cInfo = comps.get(arg0);
        const litType = inferSimpleLiteralType(arg0);
        if ((cInfo && cInfo.ndims === 0 && /^(Real|Integer)$/.test(cInfo.typeName)) || litType !== null) {
          const tName = cInfo ? cInfo.typeName : litType!;
          pushError(
            dae,
            3000,
            "reduction-scalar-arg",
            `In ${fnName}(${arg0}), the expression is of type ${tName}, but is required to be of builtin array type.`,
            node,
          );
        }
      }

      // User-defined function call checks
      if (
        fnName &&
        !/^(assert|cardinality|reinit|der|pre|size|sum|product|min|max|sin|cos|tan|exp|log|sqrt|abs|sign|integer|mod|rem|div|ceil|floor|noEvent|smooth|sample|initial|terminal|edge|change|delay|spatialDistribution|fill|zeros|ones|identity|diagonal|linspace|transpose|cross|skew|outerProduct|symmetric|cat|ndims|scalar|vector|matrix|String)$/.test(
          fnName,
        )
      ) {
        const fnSym = resolveClassSym(db, classId, fnName);
        if (fnSym) {
          const fnCst = cstOf(db, fnSym.id);
          if (isClassPartial(fnSym, fnCst)) {
            pushError(dae, 4000, "partial-function-call", `Called function '${fnName}' is partial.`, node);
          }
          // Check named arguments exist as inputs
          const fnComps = collectClassComponents(db, fnSym.id);
          for (const rawArg of rawArgs) {
            if (rawArg.type === "named_argument") {
              const paramName =
                rawArg.childForFieldName("name")?.text?.trim() ?? rawArg.namedChildren[0]?.text?.trim() ?? "";
              const pInfo = fnComps.get(paramName);
              const pText = pInfo?.cst?.parent?.parent?.text ?? pInfo?.cst?.text ?? "";
              if (!pInfo || !/\binput\b/.test(pText)) {
                pushError(
                  dae,
                  3000,
                  "named-arg-not-input",
                  `'${paramName}' is not an input of function '${fnName}'.`,
                  rawArg,
                );
              }
            }
          }
        }
      }
    }

    for (const ch of node.namedChildren) {
      walkCst(ch, inWhen, inCondCtx);
    }
  }

  walkCst(classCst, false, false);
}

/**
 * Runs post-WASM semantic validation on `rootClassId` and populates `dae.diagnostics`.
 */
export function postWasmValidate(db: QueryDB, dae: DAEBuilder, rootClassId: SymbolId): void {
  const visited = new Set<SymbolId>();
  validateClassSubtree(db, dae, rootClassId, visited);
}
