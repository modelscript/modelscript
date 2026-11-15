// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * In-Tree FMU Lowering for Modelica.
 *
 * Inspects flattened Modelica classes and component declarations for
 * black-box FMU metadata annotations (`__ModelScript_fmuPath`, `__ModelScript_fmiVersion`,
 * `__ModelScript_guid`, `__ModelScript_preferredKind`, `__ModelScript_terminalMapping`, etc.).
 *
 * Populates `dae.extensionMetadata.fmuInstances` with structured `FmuInstanceMetadata`,
 * which is utilized by:
 *  1. `checkBalance`: Accounting for FMU black-box outputs as determined by external subsystems.
 *  2. BLT / Solver: Treating FMU outputs as known boundary values evaluated at communication steps.
 *  3. `ArenaSimulator`: Automatically registering and stepping `FmuSubsystem` co-simulation participants.
 */

import {
  Causality,
  UnifiedWorkspace,
  Variability,
  type DAEBuilder,
  type FmuInstanceMetadata,
  type SymbolId,
} from "@modelscript/runtime";
import { Cst, type SyntaxNode } from "../../../src-gen/bindings.js";
import { AnnotationEvaluator } from "../../diagram/annotation-evaluator.js";
import {
  stripLeadingDots,
  stripOuterDoubleQuotes,
  tokenizeCommentStrippedWords,
  type CstNodeLike,
} from "../expressions/cst-utils.js";

const PRIMITIVE_FMU_TYPES = new Set(["Real", "Integer", "Boolean", "String"]);

function parseAnnotationClauseCst(annText: string): CstNodeLike | null {
  const trimmed = annText.trim();
  if (!trimmed) return null;
  const parser = UnifiedWorkspace.getGlobalParser(".mo");
  if (!parser) return null;
  const wrapped = `model _MsFmuAnnTmp ${trimmed.endsWith(";") ? trimmed : `${trimmed};`} end _MsFmuAnnTmp;`;
  const root = parser.parse(wrapped)?.rootNode as CstNodeLike | undefined;
  return root ? findDirectAnnotationClause(root) : null;
}

function collectAnnotationElementMods(annNode: CstNodeLike | null | undefined): Map<string, CstNodeLike> {
  const mods = new Map<string, CstNodeLike>();
  if (!annNode) return mods;
  const stack: CstNodeLike[] = [annNode];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (!cur) continue;
    if (cur.type === "element_modification") {
      const nameNode = cur.childForFieldName?.("name") ?? cur.children?.find((c) => c.type === "name");
      const modNode = cur.childForFieldName?.("modification") ?? cur.children?.find((c) => c.type === "modification");
      const modExpr =
        modNode?.childForFieldName?.("expression") ??
        modNode?.children?.find((c) => c.type === "modification_expression") ??
        modNode?.children?.find((c) => c.type === "expression") ??
        null;
      const exprNode = modExpr?.children?.find((c) => c.type === "expression") ?? modExpr;
      const key = nameNode?.text?.trim()?.toLowerCase();
      if (key && exprNode && !mods.has(key)) {
        mods.set(key, exprNode);
      }
      continue;
    }
    const kids = cur.children || [];
    for (let i = kids.length - 1; i >= 0; i--) {
      if (kids[i]) stack.push(kids[i]!);
    }
  }
  return mods;
}

function isQuotedStringCstNode(cur: CstNodeLike | null | undefined): boolean {
  if (!cur) return false;
  if (cur.type === "string_literal" || cur.type === "STRING") return true;
  if (
    (cur.childCount === 0 || (Array.isArray(cur.children) && cur.children.length === 0)) &&
    typeof cur.text === "string"
  ) {
    const t = cur.text.trim();
    return t.length >= 2 && t.startsWith('"') && t.endsWith('"');
  }
  return false;
}

function extractStringLiteralFromCst(exprNode: CstNodeLike | null | undefined): string | undefined {
  if (!exprNode) return undefined;
  const stack: CstNodeLike[] = [exprNode];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (!cur) continue;
    if (isQuotedStringCstNode(cur)) {
      return stripOuterDoubleQuotes((cur.text ?? "").trim());
    }
    const kids = cur.children || [];
    for (let i = kids.length - 1; i >= 0; i--) {
      if (kids[i]) stack.push(kids[i]!);
    }
  }
  const raw = exprNode.text?.trim();
  if (raw && raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
    return stripOuterDoubleQuotes(raw);
  }
  return undefined;
}

function extractTerminalMappingPairsFromCst(
  exprNode: CstNodeLike | null | undefined,
): { portMember: string; fmuVar: string; terminalName?: string }[] {
  const pairs: { portMember: string; fmuVar: string; terminalName?: string }[] = [];
  if (!exprNode) return pairs;
  const collectStrings = (node: CstNodeLike): string[] => {
    const out: string[] = [];
    const stack: CstNodeLike[] = [node];
    while (stack.length > 0) {
      const cur = stack.pop();
      if (!cur) continue;
      if (isQuotedStringCstNode(cur)) {
        out.push(stripOuterDoubleQuotes((cur.text ?? "").trim()));
        continue;
      }
      const kids = cur.children || [];
      for (let i = kids.length - 1; i >= 0; i--) {
        if (kids[i]) stack.push(kids[i]!);
      }
    }
    return out;
  };
  const stack: CstNodeLike[] = [exprNode];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (!cur) continue;
    if (cur.type === "output_expression_list" || (cur.type === "primary" && cur.children?.[0]?.text?.trim() === "(")) {
      const strs = collectStrings(cur);
      if (strs.length >= 2) {
        pairs.push({ portMember: strs[0]!, fmuVar: strs[1]! });
        continue;
      }
    }
    const kids = cur.children || [];
    for (let i = kids.length - 1; i >= 0; i--) {
      if (kids[i]) stack.push(kids[i]!);
    }
  }
  return pairs;
}

function collectDirectPrimitiveIoFromCst(
  classCst: CstNodeLike,
  inputs: string[],
  outputs: string[],
  parameters: string[],
): void {
  const stack: CstNodeLike[] = [classCst];
  let skipRootCheck = true;
  while (stack.length > 0) {
    const cur = stack.pop();
    if (!cur) continue;
    const t = cur.type;
    if (!skipRootCheck && (t === "class_definition" || t === "short_class_definition" || t === "annotation_clause")) {
      continue;
    }
    skipRootCheck = false;
    if (t === "component_clause") {
      let typeSpecText = "";
      const prefixWords: string[] = [];
      const kids = cur.children || [];
      for (const ch of kids) {
        if (ch.type === "type_specifier") {
          typeSpecText = stripLeadingDots((ch.text ?? "").trim());
          break;
        }
        if (ch.type !== "comment" && ch.type !== "line_comment" && ch.type !== "block_comment") {
          prefixWords.push(...tokenizeCommentStrippedWords(ch.text ?? ""));
        }
      }
      if (PRIMITIVE_FMU_TYPES.has(typeSpecText)) {
        const targetList = prefixWords.includes("input")
          ? inputs
          : prefixWords.includes("output")
            ? outputs
            : prefixWords.includes("parameter")
              ? parameters
              : null;
        if (targetList) {
          const declStack: CstNodeLike[] = [cur];
          while (declStack.length > 0) {
            const dCur = declStack.pop();
            if (!dCur) continue;
            if (dCur.type === "declaration") {
              const nameNode =
                Cst.Declaration.name(dCur as SyntaxNode) ?? dCur.children?.find((c) => c.type === "identifier");
              const nm = nameNode?.text?.trim();
              if (nm && !targetList.includes(nm)) targetList.push(nm);
              continue;
            }
            const dKids = dCur.children || [];
            for (let i = dKids.length - 1; i >= 0; i--) {
              if (dKids[i]) declStack.push(dKids[i]!);
            }
          }
        }
      }
      continue;
    }
    const kids = cur.children || [];
    for (let i = kids.length - 1; i >= 0; i--) {
      if (kids[i]) stack.push(kids[i]!);
    }
  }
}

/**
 * Finds an annotation clause that directly belongs to the given class or component,
 * without descending into nested sub-classes or unrelated scopes.
 */
export function findDirectAnnotationClause(cstNode: CstNodeLike | null | undefined, depth = 0): CstNodeLike | null {
  if (!cstNode || depth > 8) return null;
  if (
    Cst.AnnotationClause.is(cstNode as SyntaxNode) ||
    cstNode.typeId === 185 ||
    cstNode.type === "annotation_clause"
  ) {
    return cstNode;
  }
  const children = cstNode.children || cstNode.namedChildren;
  if (Array.isArray(children)) {
    // Check direct children first for AnnotationClause
    for (const child of children) {
      if (Cst.AnnotationClause.is(child as SyntaxNode) || child.typeId === 185 || child.type === "annotation_clause") {
        return child;
      }
    }
    // Only descend into non-nested-class children
    for (const child of children) {
      if (
        Cst.ClassDefinition.is(child as SyntaxNode) ||
        Cst.ShortClassDefinition.is(child as SyntaxNode) ||
        child.type === "class_definition"
      ) {
        continue;
      }
      const found = findDirectAnnotationClause(child, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Extracts FMU metadata properties from an AST node or raw text.
 */
export function extractFmuAnnotation(
  cstNode: any,
  evaluator?: AnnotationEvaluator,
): Partial<FmuInstanceMetadata> | null {
  if (!cstNode) return null;
  const annNode = findDirectAnnotationClause(cstNode);
  if (!annNode) return null;
  const text = typeof annNode.text === "string" ? annNode.text : "";
  if (!text.toLowerCase().includes("__modelscript_fmupath")) {
    return null;
  }
  const structuredAnn =
    typeof annNode.childCount === "number" && annNode.childCount > 0 ? annNode : parseAnnotationClauseCst(text);
  const annMods = collectAnnotationElementMods(structuredAnn);

  // 1. Path to FMU / black-box archive
  let fmuPath = extractStringLiteralFromCst(annMods.get("__modelscript_fmupath"));
  if (!fmuPath && evaluator) {
    const evalRes = evaluator.evaluate(annNode, "__modelscript_fmupath");
    if (typeof evalRes === "string") fmuPath = evalRes;
  }
  if (!fmuPath) return null;

  // 2. FMI Version
  let fmiVersion: string | undefined = extractStringLiteralFromCst(annMods.get("__modelscript_fmiversion"));
  if (!fmiVersion && evaluator) {
    const evalRes = evaluator.evaluate(cstNode, "__modelscript_fmiversion");
    if (typeof evalRes === "string") fmiVersion = evalRes;
  }
  if (!fmiVersion) fmiVersion = "2.0";

  // 3. GUID / UID
  let guid: string | undefined = extractStringLiteralFromCst(annMods.get("__modelscript_guid"));
  if (!guid && evaluator) {
    const evalRes = evaluator.evaluate(cstNode, "__modelscript_guid");
    if (typeof evalRes === "string") guid = evalRes;
  }

  // 4. Preferred Kind ("cs" | "me" | "auto")
  let preferredKindStr = extractStringLiteralFromCst(annMods.get("__modelscript_preferredkind"));
  if (!preferredKindStr && evaluator) {
    const evalRes = evaluator.evaluate(cstNode, "__modelscript_preferredkind");
    if (typeof evalRes === "string") preferredKindStr = evalRes;
  }
  const preferredKind: "cs" | "me" | "auto" | undefined =
    (preferredKindStr as "cs" | "me" | "auto" | undefined) ?? "cs";

  // 5. Model Identifiers
  const csModelIdentifier = extractStringLiteralFromCst(annMods.get("__modelscript_csmodelidentifier"));
  const meModelIdentifier = extractStringLiteralFromCst(annMods.get("__modelscript_memodelidentifier"));

  // 6. Terminal Mappings
  const tmExpr = annMods.get("__modelscript_terminalmapping");
  const terminalMapping = tmExpr ? extractTerminalMappingPairsFromCst(tmExpr) : undefined;

  return {
    fmuPath,
    fmiVersion,
    guid,
    preferredKind,
    csModelIdentifier,
    meModelIdentifier,
    terminalMapping,
  };
}

/**
 * Discovers and registers all root-level or instantiated FMU components in `dae.extensionMetadata.fmuInstances`.
 */
export function extractAndRegisterFmuMetadata(flattener: any, dae: DAEBuilder, rootClassId?: SymbolId): void {
  if (!dae.extensionMetadata.fmuInstances) {
    dae.extensionMetadata.fmuInstances = [];
  }
  const fmuInstances = dae.extensionMetadata.fmuInstances;
  const existingNames = new Set(fmuInstances.map((f: FmuInstanceMetadata) => f.instanceName));

  // 1. Check if the root class itself is an FMU wrapper
  if (rootClassId) {
    const rootCst = flattener.db.cstNode(rootClassId);
    const rootAnn = extractFmuAnnotation(rootCst);
    if (rootAnn && !existingNames.has("")) {
      const inputs: string[] = [];
      const outputs: string[] = [];
      const parameters: string[] = [];

      for (let i = 0; i < dae.getVarCount(); i++) {
        if (dae.isVarRemoved(i)) continue;
        const name = dae.getVarName(i);
        const c = dae.getVarCausality(i);
        const v = dae.getVarVariability(i);
        if (c === Causality.Input) inputs.push(name);
        else if (c === Causality.Output) outputs.push(name);
        else if (v === Variability.Parameter) parameters.push(name);
      }

      fmuInstances.push({
        instanceName: "",
        fmuPath: rootAnn.fmuPath!,
        fmiVersion: rootAnn.fmiVersion,
        guid: rootAnn.guid,
        preferredKind: rootAnn.preferredKind,
        csModelIdentifier: rootAnn.csModelIdentifier,
        meModelIdentifier: rootAnn.meModelIdentifier,
        terminalMapping: rootAnn.terminalMapping,
        inputs,
        outputs,
        parameters,
      });
      existingNames.add("");
    }
  }

  function isFmuClassTarget(flattener: any, classId: SymbolId): boolean {
    if (typeof flattener.isFmuClass === "function") {
      return flattener.isFmuClass(classId);
    }
    const classCst = flattener.db.cstNode(classId);
    const ann = findDirectAnnotationClause(classCst);
    if (!ann) return false;
    const text = typeof ann.text === "string" ? ann.text : "";
    return text.includes("__ModelScript_fmuPath") || text.includes("__modelscript_fmupath");
  }

  function discoverFmuComponents(
    flattener: any,
    classId: SymbolId,
    prefix: string,
    outMap: Map<string, SymbolId>,
    visited = new Set<SymbolId>(),
  ): void {
    if (visited.has(classId)) return;
    visited.add(classId);

    const elements = flattener.db.query("instantiate", classId) as SymbolId[] | undefined;
    if (!elements) return;

    for (const elemId of elements) {
      const sym = flattener.db.symbol(elemId);
      if (!sym || sym.kind !== "Component") continue;
      let targetClassId = flattener.db.query("classInstance", elemId) as SymbolId | undefined;
      if (!targetClassId || targetClassId < 0) {
        const ci = flattener.db.query("componentInstance", elemId) as any;
        if (ci?.classInstance && ci.classInstance > 0) {
          targetClassId = ci.classInstance;
        } else if (ci?.typeSpecifier) {
          const resolved =
            flattener.db.query("resolveSimpleName", classId)?.(ci.typeSpecifier) ??
            flattener.db.query("resolveName", classId)?.(ci.typeSpecifier);
          if (resolved && resolved.kind === "Class") {
            targetClassId = resolved.id;
          }
        }
      }
      if (!targetClassId || targetClassId < 0) continue;

      const fullPath = prefix ? `${prefix}.${sym.name}` : sym.name;
      if (isFmuClassTarget(flattener, targetClassId)) {
        outMap.set(fullPath, targetClassId);
      } else {
        discoverFmuComponents(flattener, targetClassId, fullPath, outMap, visited);
      }
    }
  }

  // 2. Check all instantiated FMU components recorded on flattener or discovered from hierarchy
  let fmuComponents = flattener.fmuComponents as Map<string, SymbolId> | undefined;
  if (!fmuComponents) {
    fmuComponents = new Map<string, SymbolId>();
    flattener.fmuComponents = fmuComponents;
  }
  if (rootClassId) {
    discoverFmuComponents(flattener, rootClassId, "", fmuComponents);
  }

  if (fmuComponents && fmuComponents.size > 0) {
    for (const [instanceName, classId] of fmuComponents) {
      if (existingNames.has(instanceName)) continue;
      const classCst = flattener.db.cstNode(classId);
      const compAnn = extractFmuAnnotation(classCst);
      if (!compAnn) continue;

      const inputs: string[] = [];
      const outputs: string[] = [];
      const parameters: string[] = [];

      // Query component declarations from SymbolIndex
      const childIds = flattener.db.query("instantiate", classId) as SymbolId[] | undefined;
      if (Array.isArray(childIds) && childIds.length > 0) {
        for (const cId of childIds) {
          const sym = flattener.db.symbol(cId);
          if (!sym) continue;
          const cName = sym.name;
          const causality = (sym.metadata as any)?.causality ?? flattener.db.query("causality", cId);
          const variability = (sym.metadata as any)?.variability ?? flattener.db.query("variability", cId);
          if (causality === "input") inputs.push(cName);
          else if (causality === "output") outputs.push(cName);
          else if (variability === "parameter") parameters.push(cName);
        }
      }

      // Fallback: inspect CST component_clause nodes if metadata was not populated
      if (inputs.length === 0 && outputs.length === 0 && classCst) {
        collectDirectPrimitiveIoFromCst(classCst, inputs, outputs, parameters);
      }

      fmuInstances.push({
        instanceName,
        fmuPath: compAnn.fmuPath!,
        fmiVersion: compAnn.fmiVersion,
        guid: compAnn.guid,
        preferredKind: compAnn.preferredKind,
        csModelIdentifier: compAnn.csModelIdentifier,
        meModelIdentifier: compAnn.meModelIdentifier,
        terminalMapping: compAnn.terminalMapping,
        inputs,
        outputs,
        parameters,
      });
      existingNames.add(instanceName);
    }
  }
}
