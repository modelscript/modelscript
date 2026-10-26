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

import { Causality, Variability, type DAEBuilder, type FmuInstanceMetadata, type SymbolId } from "@modelscript/runtime";
import { Cst } from "../../../src-gen/bindings.js";
import { AnnotationEvaluator } from "../../diagram/annotation-evaluator.js";

/**
 * Finds an annotation clause that directly belongs to the given class or component,
 * without descending into nested sub-classes or unrelated scopes.
 */
export function findDirectAnnotationClause(cstNode: any, depth = 0): any | null {
  if (!cstNode || depth > 8) return null;
  if (Cst.AnnotationClause.is(cstNode) || cstNode.typeId === 185 || cstNode.type === "annotation_clause") {
    return cstNode;
  }
  const children = cstNode.children || cstNode.namedChildren;
  if (Array.isArray(children)) {
    // Check direct children first for AnnotationClause
    for (const child of children) {
      if (Cst.AnnotationClause.is(child) || child.typeId === 185 || child.type === "annotation_clause") {
        return child;
      }
    }
    // Only descend into non-nested-class children
    for (const child of children) {
      if (Cst.ClassDefinition.is(child) || Cst.ShortClassDefinition.is(child) || child.type === "class_definition") {
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
  if (!text.includes("__ModelScript_fmuPath") && !text.includes("__modelscript_fmupath")) {
    return null;
  }

  // 1. Path to FMU / black-box archive
  let fmuPath: string | undefined;
  const pathMatch = text.match(/__ModelScript_fmuPath\s*=\s*"([^"]+)"/i);
  if (pathMatch && pathMatch[1]) {
    fmuPath = pathMatch[1];
  } else if (evaluator) {
    const evalRes = evaluator.evaluate(annNode, "__modelscript_fmupath");
    if (typeof evalRes === "string") fmuPath = evalRes;
  }
  if (!fmuPath) return null;

  // 2. FMI Version
  let fmiVersion: string | undefined = "2.0";
  const fmiMatch = text.match(/__ModelScript_fmiVersion\s*=\s*"([^"]+)"/i);
  if (fmiMatch && fmiMatch[1]) {
    fmiVersion = fmiMatch[1];
  } else if (evaluator) {
    const evalRes = evaluator.evaluate(cstNode, "__modelscript_fmiversion");
    if (typeof evalRes === "string") fmiVersion = evalRes;
  }

  // 3. GUID / UID
  let guid: string | undefined;
  const guidMatch = text.match(/__ModelScript_guid\s*=\s*"([^"]+)"/i);
  if (guidMatch && guidMatch[1]) {
    guid = guidMatch[1];
  } else if (evaluator) {
    const evalRes = evaluator.evaluate(cstNode, "__modelscript_guid");
    if (typeof evalRes === "string") guid = evalRes;
  }

  // 4. Preferred Kind ("cs" | "me" | "auto")
  let preferredKind: "cs" | "me" | "auto" | undefined = "cs";
  const kindMatch = text.match(/__ModelScript_preferredKind\s*=\s*"([^"]+)"/i);
  if (kindMatch && kindMatch[1]) {
    preferredKind = kindMatch[1] as "cs" | "me" | "auto";
  } else if (evaluator) {
    const evalRes = evaluator.evaluate(cstNode, "__modelscript_preferredkind");
    if (typeof evalRes === "string") preferredKind = evalRes as "cs" | "me" | "auto";
  }

  // 5. Model Identifiers
  let csModelIdentifier: string | undefined;
  const csMatch = text.match(/__ModelScript_csModelIdentifier\s*=\s*"([^"]+)"/i);
  if (csMatch && csMatch[1]) {
    csModelIdentifier = csMatch[1];
  }

  let meModelIdentifier: string | undefined;
  const meMatch = text.match(/__ModelScript_meModelIdentifier\s*=\s*"([^"]+)"/i);
  if (meMatch && meMatch[1]) {
    meModelIdentifier = meMatch[1];
  }

  // 6. Terminal Mappings
  let terminalMapping: { portMember: string; fmuVar: string; terminalName?: string }[] | undefined;
  const tmMatch = text.match(/__ModelScript_terminalMapping\s*=\s*\{([\s\S]*?)\}/i);
  if (tmMatch && tmMatch[1]) {
    terminalMapping = [];
    const pairRe = /\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = pairRe.exec(tmMatch[1])) !== null) {
      terminalMapping.push({ portMember: m[1]!, fmuVar: m[2]! });
    }
  }

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

      // Fallback: inspect raw CST text for declarations if metadata was not populated
      if (inputs.length === 0 && outputs.length === 0 && classCst?.text) {
        const inputRe = /\binput\s+(?:Real|Integer|Boolean|String)\s+([A-Za-z0-9_]+)/g;
        let m: RegExpExecArray | null;
        while ((m = inputRe.exec(classCst.text)) !== null) {
          if (!inputs.includes(m[1]!)) inputs.push(m[1]!);
        }

        const outputRe = /\boutput\s+(?:Real|Integer|Boolean|String)\s+([A-Za-z0-9_]+)/g;
        while ((m = outputRe.exec(classCst.text)) !== null) {
          if (!outputs.includes(m[1]!)) outputs.push(m[1]!);
        }

        const paramRe = /\bparameter\s+(?:Real|Integer|Boolean|String)\s+([A-Za-z0-9_]+)/g;
        while ((m = paramRe.exec(classCst.text)) !== null) {
          if (!parameters.includes(m[1]!)) parameters.push(m[1]!);
        }
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
