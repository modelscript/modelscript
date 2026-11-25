// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sysml2 — Direct Linear-Memory CST Flattener and Lowerer into DAEBuilder.
 *
 * Compiles SysML v2 / KerML syntax trees directly into `DAEBuilder` integer IDs (ExprId, EqId)
 * without intermediate AST wrapper allocations.
 *
 * Supports:
 *   1. Full expression lowering from GLR CST nodes (relational, arithmetic, boolean, invocations, der()).
 *   2. Class inheritance & specialization (`:>`).
 *   3. Array multiplicities (`part wheels : Wheel[4];`).
 *   4. Conjugated physical ports (`~PortDef`) with flow sign inversion in Kirchhoff balance.
 *   5. Hierarchical component elaboration and parameter overrides.
 */

import {
  BinOp,
  Causality,
  DAEBuilder,
  EqKind,
  type LanguageWorkspaceIndex,
  type QueryDB,
  UnaryOp,
  VarAttrKind,
  Variability,
  VarType,
  type WorkspaceIndex,
} from "@modelscript/runtime";
import { lowerDirectCstExpression } from "./expression-lowerer.js";

/**
 * Result produced by lowering a SysML v2 CST into a `DAEBuilder` arena.
 */
export interface LoweredSysml2CstResult {
  /** Populated linear-memory `DAEBuilder` arena containing variables and equations. */
  arena: DAEBuilder;
  /** Resolved top-level component or system definition name. */
  rootName: string;
  /** Flattened parameter variable names. */
  parameters: string[];
  /** Flattened continuous state and algebraic variable names. */
  states: string[];
  /** Derivative expression identifiers (`der(x)`) referenced in equations. */
  derivatives: string[];
  /** Total number of equations emitted into the arena. */
  eqCount: number;
}

/**
 * Configuration options for `SysML2CstFlattener`.
 */
export interface CstFlattenerOptions {
  /** Existing `DAEBuilder` arena to append into; allocates a new arena if omitted. */
  arena?: DAEBuilder | undefined;
  /** Top-level parameter value overrides keyed by attribute name. */
  overrides?: Record<string, number> | undefined;
  /** Explicit root component definition name to elaborate. */
  rootComponentName?: string | undefined;
  /** Raw SysML v2 source text for experiment configuration extraction. */
  sourceText?: string | undefined;
  /** Optional Salsa QueryDB for cross-file multi-package symbol and CST resolution. */
  queryDb?: QueryDB | undefined;
  /** Optional multi-file workspace index for cross-document resolution. */
  workspaceIndex?: WorkspaceIndex | LanguageWorkspaceIndex | undefined;
}

/**
 * Metadata extracted from a `port def` declaration, separating across (potential)
 * and through (flow) physical attributes.
 */
export interface PortMeta {
  /** Port definition type name (e.g. `"Pin"`, `"Flange"`). */
  name: string;
  /** Potential (across) attribute names (e.g. `["v"]`), equated across connected ports. */
  potentialAttrs: string[];
  /** Flow (through) attribute names (e.g. `["i"]`), summed to zero at connection junctions. */
  flowAttrs: string[];
}

/**
 * Elaborated port instance inside a flattened component hierarchy.
 */
export interface ActivePortInstance {
  /** Hierarchical dot-prefixed port path (e.g. `"r1.p"`). */
  fullName: string;
  /** Unconjugated base port definition name. */
  portType: string;
  /** True if the port typing uses the conjugation prefix (`~PortDef`), inverting flow sign. */
  isConjugated: boolean;
  /** Potential (across) attributes declared on the port type. */
  potentialAttrs: string[];
  /** Flow (through) attributes declared on the port type. */
  flowAttrs: string[];
}

import {
  collectCstLeaves,
  type CstLeaf,
  extractLinearNodeText,
  findCstChildren,
  findCstDescendants,
  findFirstDescendant,
  findMatchingBraceLeaf,
  isDigitsOnly,
  isSysmlIdentLeaf,
  parseSignedNumberFromLeaves,
  parseSysmlSource,
  readDottedChainFromLeaves,
  stripLeadingChars,
  type SysmlCstNode,
  type SysmlCstNodeConstructor,
  type SysmlCstTree,
  trimTrailingSemicolon,
} from "../cst-utils.js";

export {
  extractLinearNodeText,
  findCstChildren,
  findCstDescendants,
  findFirstDescendant,
  type SysmlCstNode,
  type SysmlCstNodeConstructor,
  type SysmlCstTree,
};

const SYSML_DECL_KEYWORDS = new Set([
  "attribute",
  "item",
  "part",
  "port",
  "action",
  "calc",
  "constraint",
  "def",
  "import",
  "package",
  "alias",
  "metadata",
]);

const SYSML_VIS_DIR_KEYWORDS = new Set(["in", "out", "inout", "private", "protected", "public"]);
const SYSML_CONFIG_KEYS = new Set(["starttime", "stoptime", "interval", "step", "tolerance"]);

/**
 * Lowers a SysML v2 / KerML CST expression node directly into an integer `ExprId` in `DAEBuilder`.
 */
export function lowerCstExpression(
  node: SysmlCstNode | null | undefined,
  arena: DAEBuilder,
  prefix = "",
  localNames?: Set<string>,
): number {
  return lowerDirectCstExpression(node, arena, prefix, localNames ?? new Set<string>());
}

import {
  lowerSysmlExpr,
  prefixSysmlExpression,
  type SysML2Token,
  SYSML_KEYWORDS,
  SysmlExprParser,
  tokenizeSysml,
} from "./string-expr-parser.js";

export { lowerSysmlExpr, prefixSysmlExpression, SYSML_KEYWORDS, SysmlExprParser, tokenizeSysml, type SysML2Token };

/**
 * Compiles a parsed SysML v2 CST tree directly into a `DAEBuilder` arena.
 */
export class SysML2CstFlattener {
  private arena: DAEBuilder;
  private portDefs = new Map<string, PortMeta>();
  private compDefs = new Map<string, SysmlCstNode>();
  private activePorts = new Map<string, ActivePortInstance>();
  private connections: { p1: string; p2: string }[] = [];
  private parameters: string[] = [];
  private states: string[] = [];
  private derivatives: string[] = [];
  private overrides: Record<string, number>;
  private rootCompName: string;
  private sourceText?: string | undefined;
  private rootNode?: SysmlCstNode | undefined;
  private queryDb?: QueryDB | undefined;
  private workspaceIndex?: WorkspaceIndex | LanguageWorkspaceIndex | undefined;

  /**
   * @param options - Arena instance, parameter overrides, and target root component configuration.
   */
  constructor(options: CstFlattenerOptions = {}) {
    this.arena = options.arena ?? new DAEBuilder();
    this.overrides = options.overrides ?? {};
    this.rootCompName = options.rootComponentName ?? "";
    this.sourceText = options.sourceText;
    this.queryDb = options.queryDb;
    this.workspaceIndex = options.workspaceIndex;
    if (!this.queryDb && this.workspaceIndex) {
      const idx = this.workspaceIndex as {
        getIndex?: (opts: { eager: boolean }) => { toQueryDB?: () => QueryDB | undefined };
      };
      if (typeof idx.getIndex === "function") {
        const unified = idx.getIndex({ eager: true });
        if (typeof unified.toQueryDB === "function") {
          this.queryDb = unified.toQueryDB();
        }
      }
    }
  }

  /**
   * Main entry point to flatten a parsed SysML v2 root CST node into the DAE arena.
   *
   * @param rootNode - Root CST node returned by the SysML v2 WASM GLR parser.
   * @returns Lowered DAE arena and variable/equation summary metadata.
   */
  public flatten(rootNode: SysmlCstNode): LoweredSysml2CstResult {
    this.rootNode = rootNode;
    const initialEqCount = this.arena.eqCount;

    // 0. Extract experiment configs from CST leaves if present
    const rawRootLeaves = collectCstLeaves(rootNode);
    const rootLeaves =
      rawRootLeaves.length > 0 ? rawRootLeaves : collectCstLeaves(parseSysmlSource(this.sourceText || ""));
    const seenCfg = new Set<"start" | "stop" | "interval" | "tol">();
    for (let i = 0; i < rootLeaves.length; i++) {
      const key = rootLeaves[i]!.text;
      let cfgKind: "start" | "stop" | "interval" | "tol" | undefined;
      if (key === "startTime") cfgKind = "start";
      else if (key === "stopTime") cfgKind = "stop";
      else if (key === "interval" || key === "step") cfgKind = "interval";
      else if (key === "tolerance") cfgKind = "tol";
      if (!cfgKind || seenCfg.has(cfgKind)) continue;

      let j = i + 1;
      if (rootLeaves[j]?.text === ":") {
        j++;
        while (
          j < rootLeaves.length &&
          rootLeaves[j]!.text !== "=" &&
          rootLeaves[j]!.text !== ";" &&
          rootLeaves[j]!.text !== "{" &&
          rootLeaves[j]!.text !== "}"
        ) {
          j++;
        }
      }
      if (rootLeaves[j]?.text === "=") {
        const parsedNum = parseSignedNumberFromLeaves(rootLeaves, j + 1);
        if (parsedNum) {
          seenCfg.add(cfgKind);
          if (cfgKind === "start") this.arena.experiment.startTime = parsedNum.value;
          else if (cfgKind === "stop") this.arena.experiment.stopTime = parsedNum.value;
          else if (cfgKind === "interval") this.arena.experiment.interval = parsedNum.value;
          else this.arena.experiment.tolerance = parsedNum.value;
        }
      }
    }

    // 1. Ingest port definitions
    this.collectPortDefinitions(rootNode);

    // 2. Ingest all part/constraint definitions
    this.collectComponentDefinitions(rootNode);

    // 3. Determine root component
    if (!this.rootCompName) {
      this.rootCompName = this.determineRootComponent(rootNode);
    }

    const rootDefNode = this.compDefs.get(this.rootCompName);
    if (rootDefNode) {
      this.elaborateComponent(rootDefNode, "", this.overrides);
    } else {
      this.elaborateComponent(rootNode, "", this.overrides);
    }

    // 4. Resolve global connection topology and Kirchhoff port conservation
    this.processGlobalConnections();

    return {
      arena: this.arena,
      rootName: this.rootCompName,
      parameters: this.parameters,
      states: this.states,
      derivatives: this.derivatives,
      eqCount: this.arena.eqCount - initialEqCount,
    };
  }

  /**
   * Scans the CST for `PortDefinition` nodes and classifies their attributes into
   * potential (across) and `flow` (through) variables.
   */
  private collectPortDefinitions(rootNode: SysmlCstNode | null | undefined): void {
    const portDefNodes = findCstDescendants(rootNode, "PortDefinition");
    for (const pNode of portDefNodes) {
      const nameNode = findFirstDescendant(pNode, "Name") || findFirstDescendant(pNode, "ID");
      const name = nameNode?.text?.trim();
      if (!name) continue;

      const potentialAttrs: string[] = [];
      const flowAttrs: string[] = [];

      const attrNodes = findCstDescendants(pNode, "AttributeUsage");
      for (const an of attrNodes) {
        const attrNameNode = findFirstDescendant(an, "Name") || findFirstDescendant(an, "ID");
        const attrName = attrNameNode?.text?.trim();
        if (!attrName) continue;

        // Check if marked as flow
        const isFlow = an.text.includes("flow");
        if (isFlow) {
          flowAttrs.push(attrName);
        } else {
          potentialAttrs.push(attrName);
        }
      }

      const flowUsageNodes = findCstDescendants(pNode, "FlowUsage");
      for (const fn of flowUsageNodes) {
        const flowNameNode = findFirstDescendant(fn, "Name") || findFirstDescendant(fn, "ID");
        const flowName = flowNameNode?.text?.trim();
        if (flowName) flowAttrs.push(flowName);
      }

      this.portDefs.set(name, {
        name,
        potentialAttrs: potentialAttrs.length > 0 ? potentialAttrs : ["v"],
        flowAttrs: flowAttrs.length > 0 ? flowAttrs : ["i"],
      });
    }

    if (this.queryDb) {
      const allEntries = Array.from(this.queryDb.allEntries());
      const portEntries = allEntries.filter(
        (e) => e.ruleName === "PortDefinition" || (e.metadata && e.metadata["defKind"] === "port"),
      );
      for (const pe of portEntries) {
        if (!this.portDefs.has(pe.name)) {
          const cstNode = this.queryDb.cstNode(pe.id) as SysmlCstNode | null;
          if (cstNode) {
            const potentialAttrs: string[] = [];
            const flowAttrs: string[] = [];

            const attrNodes = findCstDescendants(cstNode, "AttributeUsage");
            for (const an of attrNodes) {
              const attrNameNode = findFirstDescendant(an, "Name") || findFirstDescendant(an, "ID");
              const attrName = attrNameNode?.text?.trim();
              if (!attrName) continue;
              if (an.text.includes("flow")) {
                flowAttrs.push(attrName);
              } else {
                potentialAttrs.push(attrName);
              }
            }

            const flowUsageNodes = findCstDescendants(cstNode, "FlowUsage");
            for (const fn of flowUsageNodes) {
              const flowNameNode = findFirstDescendant(fn, "Name") || findFirstDescendant(fn, "ID");
              const flowName = flowNameNode?.text?.trim();
              if (flowName) flowAttrs.push(flowName);
            }

            this.portDefs.set(pe.name, {
              name: pe.name,
              potentialAttrs: potentialAttrs.length > 0 ? potentialAttrs : ["v"],
              flowAttrs: flowAttrs.length > 0 ? flowAttrs : ["i"],
            });
          }
        }
      }
    }
  }

  /**
   * Indexes all `PartDefinition` and `ConstraintDefinition` CST nodes by declared name.
   */
  private collectComponentDefinitions(rootNode: SysmlCstNode | null | undefined): void {
    const partDefNodes = findCstDescendants(rootNode, "PartDefinition");
    const constraintDefNodes = findCstDescendants(rootNode, "ConstraintDefinition");

    for (const node of [...partDefNodes, ...constraintDefNodes]) {
      const nameNode = findFirstDescendant(node, "Name") || findFirstDescendant(node, "ID");
      const name = nameNode?.text?.trim();
      if (name) {
        this.compDefs.set(name, node);
      }
    }

    if (this.queryDb) {
      const allEntries = Array.from(this.queryDb.allEntries());
      const compEntries = allEntries.filter(
        (e) =>
          e.ruleName === "PartDefinition" ||
          e.ruleName === "ConstraintDefinition" ||
          (e.metadata && (e.metadata["defKind"] === "part" || e.metadata["defKind"] === "constraint")),
      );
      for (const ce of compEntries) {
        if (!this.compDefs.has(ce.name)) {
          const cstNode = this.queryDb.cstNode(ce.id) as SysmlCstNode | null;
          if (cstNode) {
            this.compDefs.set(ce.name, cstNode);
          }
        }
      }
    }
  }

  /**
   * Heuristically selects the top-level system definition by finding a component that is
   * neither instantiated as a child `PartUsage` nor specialized as a superclass (`:>`).
   */
  private determineRootComponent(rootNode?: SysmlCstNode | null): string {
    if (this.compDefs.size === 0) {
      const nameNode = findFirstDescendant(rootNode, "Name") || findFirstDescendant(rootNode, "ID");
      return nameNode?.text?.trim() || "SysmlModel";
    }
    if (this.compDefs.size === 1) return Array.from(this.compDefs.keys())[0]!;

    // Find component not instantiated as subpart in others
    const instantiatedTypes = new Set<string>();
    const superclasses = new Set<string>();

    for (const compNode of this.compDefs.values()) {
      const partUsages = findCstDescendants(compNode, "PartUsage");
      for (const pu of partUsages) {
        const typeNode = findFirstDescendant(pu, "FeatureTyping") || findFirstDescendant(pu, "OwnedFeatureTyping");
        const typeName = stripLeadingChars(typeNode?.text, ": \t\r\n");
        if (typeName) instantiatedTypes.add(typeName);
      }

      const subclassificationNodes = findCstDescendants(compNode, "OwnedSubclassification");
      for (const sc of subclassificationNodes) {
        const superName = stripLeadingChars(sc.text, ":> \t\r\n");
        if (superName) superclasses.add(superName);
      }
    }

    // Prefer components that are neither subparts nor superclasses
    for (const name of this.compDefs.keys()) {
      if (!instantiatedTypes.has(name) && !superclasses.has(name)) {
        return name;
      }
    }

    for (const name of this.compDefs.keys()) {
      if (!instantiatedTypes.has(name)) {
        return name;
      }
    }

    return Array.from(this.compDefs.keys())[0]!;
  }

  private extractComponentFullText(sourceText: string, compName: string): string | null {
    const leaves = collectCstLeaves(parseSysmlSource(sourceText));
    for (let i = 0; i < leaves.length; i++) {
      const kw = leaves[i]!.text;
      if (kw !== "part" && kw !== "constraint" && kw !== "model" && kw !== "package") continue;
      let j = i + 1;
      if (leaves[j]?.text === "def") j++;
      if (leaves[j]?.text !== compName) continue;
      let k = j + 1;
      while (k < leaves.length && leaves[k]!.text !== "{" && leaves[k]!.text !== ";") {
        k++;
      }
      if (leaves[k]?.text === "{") {
        const closeIdx = findMatchingBraceLeaf(leaves, k);
        return sourceText.slice(leaves[i]!.start, leaves[closeIdx]!.end);
      }
    }
    return null;
  }

  private getCompText(compNode: SysmlCstNode): string {
    const compNameNode = findFirstDescendant(compNode, "Name") || findFirstDescendant(compNode, "ID");
    const compName = compNameNode?.text?.trim() || compNode.name;
    if (compName && this.sourceText) {
      const full = this.extractComponentFullText(this.sourceText, compName);
      if (full && full.length > (compNode.text?.length || 0)) {
        return full;
      }
    }
    return compNode.text || "";
  }

  /**
   * Elaborates a component definition: attributes, ports, subparts, inheritance, equations.
   * Uses visitedDefs set to prevent unbounded recursion on circular inheritance cycles.
   */
  private elaborateComponent(
    compNode: SysmlCstNode,
    prefix: string,
    overrides: Record<string, number>,
    visitedDefs = new Set<string>(),
  ): void {
    const compNameNode = findFirstDescendant(compNode, "Name") || findFirstDescendant(compNode, "ID");
    const compName = compNameNode?.text?.trim() || "";
    const visitKey = `${prefix}::${compName}`;
    if (visitedDefs.has(visitKey)) return;
    visitedDefs.add(visitKey);

    const localNames = new Set<string>();

    // Collect all state variables referenced via der(x) in CST equations (zero-regex)
    const derStateNames = new Set<string>();
    const invNodes = findCstDescendants(compNode, "InvocationExpression");
    for (const inv of invNodes) {
      const fnNode = findFirstDescendant(inv, "ID") || inv.childForFieldName?.("instantiatedType");
      if (fnNode?.text?.trim() === "der" || inv.text?.trim().startsWith("der(")) {
        const argNode = findFirstDescendant(inv, "Argument") || findFirstDescendant(inv, "FeatureReferenceExpression");
        let argText = argNode?.text?.trim();
        if (!argText) {
          const invLeaves = collectCstLeaves(inv);
          if (invLeaves[0]?.text === "der" && invLeaves[1]?.text === "(" && isSysmlIdentLeaf(invLeaves[2]?.text)) {
            argText = invLeaves[2]!.text;
          }
        }
        if (argText) {
          const dotIdx = argText.indexOf(".");
          const baseName = dotIdx === -1 ? argText : argText.slice(0, dotIdx);
          derStateNames.add(baseName);
        }
      }
    }

    // Fallback: if naked differential equations der(x) == ... are located inside
    // a part def or error recovery node, extract base state names directly from CST leaves.
    const scanNode = prefix === "" && this.rootNode ? this.rootNode : compNode;
    const compLeaves = collectCstLeaves(scanNode);
    for (let i = 0; i + 2 < compLeaves.length; i++) {
      if (
        compLeaves[i]!.text === "der" &&
        compLeaves[i + 1]!.text === "(" &&
        isSysmlIdentLeaf(compLeaves[i + 2]!.text)
      ) {
        derStateNames.add(compLeaves[i + 2]!.text);
      }
    }

    // 1. Process Inheritance (:>)
    const subclassificationNodes = findCstChildren(compNode, "OwnedSubclassification");
    for (const sc of subclassificationNodes) {
      const superName = stripLeadingChars(sc.text, ":> \t\r\n");
      let superDefNode = this.compDefs.get(superName);
      if (!superDefNode && this.queryDb) {
        const matches = this.queryDb.byName(superName);
        const match = matches.find(
          (m) =>
            m.ruleName === "PartDefinition" ||
            m.ruleName === "ConstraintDefinition" ||
            (m.metadata && (m.metadata["defKind"] === "part" || m.metadata["defKind"] === "constraint")),
        );
        if (match) {
          const node = this.queryDb.cstNode(match.id) as SysmlCstNode | null;
          if (node) {
            this.compDefs.set(superName, node);
            superDefNode = node;
          }
        }
      }
      if (superDefNode && superDefNode !== compNode) {
        // Inherit members of superclass first with cycle guard
        this.elaborateComponent(superDefNode, prefix, overrides, visitedDefs);
      }
    }

    // 2. Process Ports
    const portUsages = findCstDescendants(compNode, "PortUsage");
    for (const pu of portUsages) {
      // Don't process ports of nested subparts here
      if (this.isDescendantOfPartUsage(pu, compNode)) continue;

      const nameNode = findFirstDescendant(pu, "Name") || findFirstDescendant(pu, "ID");
      const portName = nameNode?.text?.trim();
      if (!portName) continue;

      localNames.add(portName);
      const portFullName = prefix + portName;

      const typeNode = findFirstDescendant(pu, "FeatureTyping") || findFirstDescendant(pu, "OwnedFeatureTyping");
      const rawType = stripLeadingChars(typeNode?.text, ": \t\r\n");
      const isConjugated = pu.text.includes("~") || rawType.startsWith("~");
      const cleanType = stripLeadingChars(rawType, "~ \t\r\n");

      let pDef = this.portDefs.get(cleanType);
      if (!pDef && this.queryDb) {
        const matches = this.queryDb.byName(cleanType);
        const match = matches.find(
          (m) => m.ruleName === "PortDefinition" || (m.metadata && m.metadata["defKind"] === "port"),
        );
        if (match) {
          const pNode = this.queryDb.cstNode(match.id) as SysmlCstNode | null;
          if (pNode) {
            const potentialAttrs: string[] = [];
            const flowAttrs: string[] = [];

            const attrNodes = findCstDescendants(pNode, "AttributeUsage");
            for (const an of attrNodes) {
              const attrNameNode = findFirstDescendant(an, "Name") || findFirstDescendant(an, "ID");
              const attrName = attrNameNode?.text?.trim();
              if (!attrName) continue;
              if (an.text.includes("flow")) flowAttrs.push(attrName);
              else potentialAttrs.push(attrName);
            }

            const flowUsageNodes = findCstDescendants(pNode, "FlowUsage");
            for (const fn of flowUsageNodes) {
              const flowNameNode = findFirstDescendant(fn, "Name") || findFirstDescendant(fn, "ID");
              const flowName = flowNameNode?.text?.trim();
              if (flowName) flowAttrs.push(flowName);
            }

            pDef = {
              name: cleanType,
              potentialAttrs: potentialAttrs.length > 0 ? potentialAttrs : ["v"],
              flowAttrs: flowAttrs.length > 0 ? flowAttrs : ["i"],
            };
            this.portDefs.set(cleanType, pDef);
          }
        }
      }
      if (!pDef) {
        pDef = {
          name: cleanType,
          potentialAttrs: ["v"],
          flowAttrs: ["i"],
        };
      }

      for (const pot of pDef.potentialAttrs) {
        const varName = `${portFullName}.${pot}`;
        this.arena.addVariable(varName, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
      }
      for (const fl of pDef.flowAttrs) {
        const varName = `${portFullName}.${fl}`;
        this.arena.addVariable(varName, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
      }

      this.activePorts.set(portFullName, {
        fullName: portFullName,
        portType: cleanType,
        isConjugated,
        potentialAttrs: pDef.potentialAttrs,
        flowAttrs: pDef.flowAttrs,
      });
    }

    // 3. Process Attributes
    const attrUsages = findCstDescendants(compNode, "AttributeUsage");
    for (const au of attrUsages) {
      if (this.isDescendantOfPartUsage(au, compNode)) continue;
      if (this.isDescendantOfActionOrCalc(au, compNode)) continue;

      const nameNode = findFirstDescendant(au, "Name") || findFirstDescendant(au, "ID");
      const attrName = nameNode?.text?.trim();
      if (!attrName) continue;

      localNames.add(attrName);
      const fullName = prefix + attrName;

      // Extract default value
      const valNode = findFirstDescendant(au, "FeatureValue") || findFirstDescendant(au, "OwnedExpression");
      let defaultVal = 0.0;
      if (valNode) {
        const rawVal = stripLeadingChars(valNode.text, "=: \t\r\n");
        const parsed = parseFloat(rawVal);
        if (!isNaN(parsed) && isFinite(parsed)) defaultVal = parsed;
      }
      if (overrides[attrName] !== undefined) {
        defaultVal = overrides[attrName]!;
      }

      const isInput = au.text.includes("in ");
      const isOutput = au.text.includes("out ");
      const causality = isInput ? Causality.Input : isOutput ? Causality.Output : Causality.Local;

      // Check if state variable: der(attrName) referenced in equations
      const isState = derStateNames.has(attrName);
      const isParam = !isState && (isInput || valNode !== null || overrides[attrName] !== undefined);
      const variability = isParam ? Variability.Parameter : Variability.Continuous;

      if (isParam) {
        this.parameters.push(fullName);
      } else {
        this.states.push(fullName);
      }

      const existingIdx = this.arena.lookupVariable(fullName);
      const varIdx =
        existingIdx !== -1
          ? existingIdx
          : this.arena.addVariable(fullName, VarType.Real, variability, causality, defaultVal);

      if (isState) {
        const startExpr = this.arena.addRealLiteral(defaultVal);
        this.arena.setVarAttrExpr(varIdx, VarAttrKind.Start, startExpr);
        const fixedExpr = this.arena.addBoolLiteral(true);
        this.arena.setVarAttrExpr(varIdx, VarAttrKind.Fixed, fixedExpr);
        this.arena.setVarFixed(varIdx, true);
        this.derivatives.push(`der(${fullName})`);
      }
    }

    // Fallback attribute scanning for flattened/recovered CST nodes
    if (attrUsages.length === 0) {
      const localBody = this.getCompText(compNode);
      const leaves = collectCstLeaves(parseSysmlSource(localBody));
      for (let i = 0; i < leaves.length; i++) {
        const tok = leaves[i]!.text;
        // Skip braced subpart `part name : Type { ... }`
        if (
          tok === "part" &&
          isSysmlIdentLeaf(leaves[i + 1]?.text) &&
          leaves[i + 2]?.text === ":" &&
          isSysmlIdentLeaf(leaves[i + 3]?.text) &&
          leaves[i + 4]?.text === "{"
        ) {
          i = findMatchingBraceLeaf(leaves, i + 4);
          continue;
        }
        // Skip braced `(action | calc) [def] name { ... }`
        if (tok === "action" || tok === "calc") {
          let k = i + 1;
          if (leaves[k]?.text === "def") k++;
          if (isSysmlIdentLeaf(leaves[k]?.text) && leaves[k + 1]?.text === "{") {
            i = findMatchingBraceLeaf(leaves, k + 1);
            continue;
          }
        }
        if (tok !== "attribute") continue;

        const dirTok = i > 0 ? leaves[i - 1]!.text : undefined;
        const isInput = dirTok === "in";
        const isOutput = dirTok === "out";
        let j = i + 1;
        if (leaves[j]?.text === "item") j++;
        const attrName = leaves[j]?.text;
        if (!isSysmlIdentLeaf(attrName)) continue;
        j++;

        if (leaves[j]?.text === ":") {
          j++;
          while (
            j < leaves.length &&
            leaves[j]!.text !== "=" &&
            leaves[j]!.text !== ";" &&
            leaves[j]!.text !== "{" &&
            leaves[j]!.text !== "}"
          ) {
            j++;
          }
        }

        let rawVal: string | undefined;
        if (leaves[j]?.text === "=") {
          const valStartIdx = j + 1;
          let valEndIdx = valStartIdx;
          while (valEndIdx < leaves.length && leaves[valEndIdx]!.text !== ";" && leaves[valEndIdx]!.text !== "}") {
            valEndIdx++;
          }
          if (valEndIdx > valStartIdx) {
            rawVal = localBody.slice(leaves[valStartIdx]!.start, leaves[valEndIdx - 1]!.end).trim();
          }
          i = valEndIdx;
        } else {
          i = j - 1;
        }

        if (localNames.has(attrName)) continue;
        localNames.add(attrName);
        const fullName = prefix + attrName;

        let defaultVal = 0.0;
        if (rawVal !== undefined) {
          const parsed = parseFloat(rawVal);
          if (!isNaN(parsed) && isFinite(parsed)) defaultVal = parsed;
        }
        if (overrides[attrName] !== undefined) {
          defaultVal = overrides[attrName]!;
        }

        const causality = isInput ? Causality.Input : isOutput ? Causality.Output : Causality.Local;
        const isState = derStateNames.has(attrName);
        const isParam = !isState && (isInput || rawVal !== undefined || overrides[attrName] !== undefined);
        const variability = isParam ? Variability.Parameter : Variability.Continuous;

        if (isParam) {
          this.parameters.push(fullName);
        } else {
          this.states.push(fullName);
        }

        const existingIdx = this.arena.lookupVariable(fullName);
        const varIdx =
          existingIdx !== -1
            ? existingIdx
            : this.arena.addVariable(fullName, VarType.Real, variability, causality, defaultVal);

        if (isState) {
          const startExpr = this.arena.addRealLiteral(defaultVal);
          this.arena.setVarAttrExpr(varIdx, VarAttrKind.Start, startExpr);
          const fixedExpr = this.arena.addBoolLiteral(true);
          this.arena.setVarAttrExpr(varIdx, VarAttrKind.Fixed, fixedExpr);
          this.arena.setVarFixed(varIdx, true);
          this.derivatives.push(`der(${fullName})`);
        }
      }
    }

    // 4. Process Subparts & Multiplicities
    const partUsages = findCstDescendants(compNode, "PartUsage");
    for (const pu of partUsages) {
      if (this.isDescendantOfPartUsage(pu, compNode)) continue;

      const nameNode = findFirstDescendant(pu, "Name") || findFirstDescendant(pu, "ID");
      const partName = nameNode?.text?.trim();
      if (!partName) continue;

      localNames.add(partName);

      const typeNode = findFirstDescendant(pu, "FeatureTyping") || findFirstDescendant(pu, "OwnedFeatureTyping");
      const subTypeName = stripLeadingChars(typeNode?.text, ": \t\r\n");

      // Extract multiplicity: e.g. [4], [1..4], [0..4]
      let multiplicity = 1;
      const multNode = findFirstDescendant(pu, "OwnedMultiplicity") || findFirstDescendant(pu, "MultiplicityRange");
      if (multNode) {
        const multLeaves = collectCstLeaves(multNode);
        const openBr = multLeaves.findIndex((lf) => lf.text === "[");
        if (openBr !== -1) {
          let lastDigits: string | undefined;
          for (let m = openBr + 1; m < multLeaves.length && multLeaves[m]!.text !== "]"; m++) {
            if (isDigitsOnly(multLeaves[m]!.text)) lastDigits = multLeaves[m]!.text;
          }
          if (lastDigits !== undefined) {
            multiplicity = parseInt(lastDigits, 10);
          }
        }
      }

      // Extract subpart overrides from child AttributeUsage CST nodes and redefinitions
      const subOverrides: Record<string, number> = {};
      const subAttrUsages = findCstDescendants(pu, "AttributeUsage");
      for (const sau of subAttrUsages) {
        if (this.isDescendantOfPartUsage(sau, pu)) continue;
        const sauNameNode = findFirstDescendant(sau, "Name") || findFirstDescendant(sau, "ID");
        const sauName = sauNameNode?.text?.trim();
        if (!sauName) continue;
        const valNode = findFirstDescendant(sau, "FeatureValue") || findFirstDescendant(sau, "OwnedExpression");
        if (valNode) {
          const rawVal = stripLeadingChars(valNode.text, "=: \t\r\n");
          const parsed = parseFloat(rawVal);
          if (!isNaN(parsed) && isFinite(parsed)) {
            subOverrides[sauName] = parsed;
          }
        }
      }
      const puLeaves = collectCstLeaves(pu);
      for (let i = 0; i < puLeaves.length; i++) {
        const tok = puLeaves[i]!.text;
        let nameIdx = -1;
        if (tok === "attribute" || tok === "redefines" || tok === ":>>") {
          nameIdx = i + 1;
        } else if (tok === ":" && puLeaves[i + 1]?.text === ">>") {
          nameIdx = i + 2;
        } else if (tok === ":" && puLeaves[i + 1]?.text === ">" && puLeaves[i + 2]?.text === ">") {
          nameIdx = i + 3;
        }
        if (nameIdx === -1) continue;
        const attrKey = puLeaves[nameIdx]?.text;
        if (!isSysmlIdentLeaf(attrKey)) continue;
        let j = nameIdx + 1;
        if (puLeaves[j]?.text === ":") {
          j++;
          while (
            j < puLeaves.length &&
            puLeaves[j]!.text !== "=" &&
            puLeaves[j]!.text !== ";" &&
            puLeaves[j]!.text !== "{" &&
            puLeaves[j]!.text !== "}"
          ) {
            j++;
          }
        }
        if (puLeaves[j]?.text === "=" && subOverrides[attrKey] === undefined) {
          const parsedNum = parseSignedNumberFromLeaves(puLeaves, j + 1);
          if (parsedNum) {
            subOverrides[attrKey] = parsedNum.value;
          }
        }
      }
      let subCompDef = this.compDefs.get(subTypeName);
      if (!subCompDef && this.queryDb) {
        const matches = this.queryDb.byName(subTypeName);
        const match = matches.find(
          (m) =>
            m.ruleName === "PartDefinition" ||
            m.ruleName === "ConstraintDefinition" ||
            (m.metadata && (m.metadata["defKind"] === "part" || m.metadata["defKind"] === "constraint")),
        );
        if (match) {
          const node = this.queryDb.cstNode(match.id) as SysmlCstNode | null;
          if (node) {
            this.compDefs.set(subTypeName, node);
            subCompDef = node;
          }
        }
      }

      if (subCompDef) {
        if (multiplicity > 1) {
          // Instantiate array elements: wheels[1], wheels[2], ..., wheels[N]
          for (let i = 1; i <= multiplicity; i++) {
            const subPrefix = `${prefix}${partName}[${i}].`;
            this.elaborateComponent(subCompDef, subPrefix, subOverrides, new Set<string>());
          }
        } else {
          const subPrefix = `${prefix}${partName}.`;
          this.elaborateComponent(subCompDef, subPrefix, subOverrides, new Set<string>());
        }
      }
    }

    // 5. Process Equations & Assert Constraints
    this.elaborateEquations(compNode, prefix, localNames);

    // 5b. Process When Clauses
    this.elaborateWhenClauses(compNode, prefix, localNames);

    // 6. Collect Connections
    this.elaborateConnections(compNode, prefix);
  }

  private getNodeSpan(node: SysmlCstNode): [number, number] {
    const start = node.startOffset ?? node.startIndex ?? node._startOffset ?? 0;
    const len = node._cachedLen ?? (node.endOffset !== undefined ? node.endOffset - start : 0);
    const end = node.endOffset ?? node.endIndex ?? start + (node._cachedPad ?? 0) + len;
    return [start, end];
  }

  /**
   * Returns true if `node` is nested inside a child `PartUsage` of `currentComp`
   * (so it isn't double-processed during the parent's traversal).
   */
  private isDescendantOfPartUsage(node: SysmlCstNode, currentComp: SysmlCstNode): boolean {
    let p = node.parent;
    while (p && p !== currentComp) {
      if (p.type === "PartUsage") return true;
      p = p.parent;
    }
    const [nStart, nEnd] = this.getNodeSpan(node);
    if (nEnd > nStart) {
      const partUsages = findCstDescendants(currentComp, "PartUsage");
      for (const pu of partUsages) {
        if (pu === node || (pu.ptr && node.ptr && pu.ptr === node.ptr)) continue;
        const [puStart, puEnd] = this.getNodeSpan(pu);
        const isStrictDescendant = (nStart > puStart && nEnd <= puEnd) || (nStart >= puStart && nEnd < puEnd);
        if (isStrictDescendant) {
          return true;
        }
      }
    }
    return false;
  }

  private isDescendantOfActionOrCalc(node: SysmlCstNode, currentComp: SysmlCstNode): boolean {
    let p = node.parent;
    while (p && p !== currentComp) {
      if (
        p.type === "ActionDefinition" ||
        p.type === "ActionUsage" ||
        p.type === "CalculationDefinition" ||
        p.type === "CalculationUsage"
      ) {
        return true;
      }
      p = p.parent;
    }
    const [nStart, nEnd] = this.getNodeSpan(node);
    if (nEnd > nStart) {
      const actionNodes = [
        ...findCstDescendants(currentComp, "ActionDefinition"),
        ...findCstDescendants(currentComp, "ActionUsage"),
        ...findCstDescendants(currentComp, "CalculationDefinition"),
        ...findCstDescendants(currentComp, "CalculationUsage"),
      ];
      for (const an of actionNodes) {
        if (an === node || (an.ptr && node.ptr && an.ptr === node.ptr)) continue;
        const [anStart, anEnd] = this.getNodeSpan(an);
        const isStrictDescendant = (nStart > anStart && nEnd <= anEnd) || (nStart >= anStart && nEnd < anEnd);
        if (isStrictDescendant) {
          return true;
        }
      }
    }
    return false;
  }

  private isDescendantOfError(node: SysmlCstNode, currentComp: SysmlCstNode): boolean {
    const nodeHasError = (n: SysmlCstNode) =>
      n.type === "ERROR" || (typeof n.hasError === "function" ? n.hasError() : Boolean(n.hasError));
    if (nodeHasError(node)) return true;
    let p = node.parent;
    while (p && p !== currentComp) {
      if (nodeHasError(p)) return true;
      p = p.parent;
    }
    return false;
  }

  private isDescendantOf(node: SysmlCstNode, ancestor: SysmlCstNode): boolean {
    let p = node.parent;
    while (p) {
      if (p === ancestor) return true;
      p = p.parent;
    }
    return false;
  }

  /**
   * Lowers `AssertConstraintUsage`, `ConstraintUsage`, `ResultExpressionMember`, and bare equations
   * within `compNode` into simple equations (`lhs == rhs`) inside `this.arena`.
   */
  private elaborateEquations(compNode: SysmlCstNode, prefix: string, localNames: Set<string>): void {
    const initialEqCount = this.arena.eqCount;

    // 1. Process official SysML v2 AssertConstraintUsage and ConstraintUsage
    const assertUsages = [
      ...findCstDescendants(compNode, "AssertConstraintUsage"),
      ...findCstDescendants(compNode, "ConstraintUsage"),
    ];
    for (const au of assertUsages) {
      if (this.isDescendantOfPartUsage(au, compNode)) continue;
      if (this.isDescendantOfActionOrCalc(au, compNode)) continue;

      const eqNodes = findCstDescendants(au, "EqualityExpression");
      if (eqNodes.length > 0) {
        for (const eqNode of eqNodes) {
          if ((eqNode.childCount ?? 0) >= 3) {
            const lhsNode = eqNode.child ? eqNode.child(0) : eqNode.children?.[0];
            const rhsNode = eqNode.child ? eqNode.child(2) : eqNode.children?.[2];

            const lhsId = lowerCstExpression(lhsNode, this.arena, prefix, localNames);
            const rhsId = lowerCstExpression(rhsNode, this.arena, prefix, localNames);
            this.arena.addEquation(EqKind.Simple, lhsId, rhsId);
          }
        }
      } else {
        const resultExpr =
          findFirstDescendant(au, "ResultExpressionMember") || findFirstDescendant(au, "OwnedExpression");
        if (resultExpr) {
          const exprId = lowerCstExpression(resultExpr, this.arena, prefix, localNames);
          const trueId = this.arena.addBoolLiteral(true);
          this.arena.addEquation(EqKind.Simple, exprId, trueId);
        }
      }
    }

    // 2. Direct ResultExpressionMember in ConstraintDefinition
    const directResultExprs = findCstDescendants(compNode, "ResultExpressionMember");
    for (const re of directResultExprs) {
      if (this.isDescendantOfPartUsage(re, compNode)) continue;
      if (this.isDescendantOfActionOrCalc(re, compNode)) continue;
      if (this.isDescendantOfError(re, compNode)) continue;
      const trimmedText = trimTrailingSemicolon(re.text);
      if (!trimmedText || trimmedText === ";") continue;
      if (assertUsages.some((au) => this.isDescendantOf(re, au) || (au.text && re.text && au.text.includes(re.text))))
        continue;

      const eqNode = findFirstDescendant(re, "EqualityExpression");
      if (eqNode && (eqNode.childCount ?? 0) >= 3) {
        const lhsNode = eqNode.child ? eqNode.child(0) : eqNode.children?.[0];
        const rhsNode = eqNode.child ? eqNode.child(2) : eqNode.children?.[2];

        const lhsId = lowerCstExpression(lhsNode, this.arena, prefix, localNames);
        const rhsId = lowerCstExpression(rhsNode, this.arena, prefix, localNames);
        this.arena.addEquation(EqKind.Simple, lhsId, rhsId);
      } else if (trimmedText.includes("==")) {
        const dblEqIdx = trimmedText.indexOf("==");
        const lhs = trimmedText.slice(0, dblEqIdx).trim();
        const rhs = trimmedText.slice(dblEqIdx + 2).trim();
        const lhsId = lowerSysmlExpr(prefixSysmlExpression(lhs, prefix, localNames), this.arena);
        const rhsId = lowerSysmlExpr(prefixSysmlExpression(rhs, prefix, localNames), this.arena);
        this.arena.addEquation(EqKind.Simple, lhsId, rhsId);
      } else {
        const exprId = lowerCstExpression(re, this.arena, prefix, localNames);
        const trueId = this.arena.addBoolLiteral(true);
        this.arena.addEquation(EqKind.Simple, exprId, trueId);
      }
    }

    // 3. Fallback / Bare Equations (e.g. in Resistor or physical definitions without assert constraint wrapper)
    const emittedFromCst = this.arena.eqCount - initialEqCount;
    const compText = this.getCompText(compNode);
    const leaves = collectCstLeaves(parseSysmlSource(compText));

    // Partition leaves into top-level `;` statements while skipping braced subparts, `when`, and `action`/`calc` blocks
    const stmts: CstLeaf[][] = [];
    let curStmt: CstLeaf[] = [];
    for (let i = 0; i < leaves.length; i++) {
      const lf = leaves[i]!;
      const tok = lf.text;
      // Skip braced subpart `part name : Type { ... }`
      if (
        tok === "part" &&
        isSysmlIdentLeaf(leaves[i + 1]?.text) &&
        leaves[i + 2]?.text === ":" &&
        isSysmlIdentLeaf(leaves[i + 3]?.text) &&
        leaves[i + 4]?.text === "{"
      ) {
        curStmt = [];
        i = findMatchingBraceLeaf(leaves, i + 4);
        continue;
      }
      // Skip `when ... { ... }` blocks
      if (tok === "when") {
        let openIdx = -1;
        for (let k = i + 1; k < leaves.length; k++) {
          if (leaves[k]!.text === "{") {
            openIdx = k;
            break;
          }
        }
        if (openIdx !== -1) {
          curStmt = [];
          i = findMatchingBraceLeaf(leaves, openIdx);
          continue;
        }
      }
      // Skip braced `(action | calc) [def] name { ... }` blocks
      if (tok === "action" || tok === "calc") {
        let j = i + 1;
        if (leaves[j]?.text === "def") j++;
        if (isSysmlIdentLeaf(leaves[j]?.text) && leaves[j + 1]?.text === "{") {
          curStmt = [];
          i = findMatchingBraceLeaf(leaves, j + 1);
          continue;
        }
      }
      if (tok === ";") {
        if (curStmt.length > 0) {
          stmts.push(curStmt);
          curStmt = [];
        }
        continue;
      }
      curStmt.push(lf);
    }
    if (curStmt.length > 0) {
      stmts.push(curStmt);
    }

    for (const rawStmtLeaves of stmts) {
      let start = 0;
      while (
        start < rawStmtLeaves.length &&
        (rawStmtLeaves[start]!.text === "{" || rawStmtLeaves[start]!.text === "}")
      ) {
        start++;
      }
      if (start >= rawStmtLeaves.length) continue;
      const stmtLeaves = rawStmtLeaves.slice(start);
      const stmt = compText.slice(stmtLeaves[0]!.start, stmtLeaves[stmtLeaves.length - 1]!.end).trim();
      if (!stmt) continue;

      const k0 = stmtLeaves[0]!.text;
      const k1 = stmtLeaves[1]?.text;
      if (SYSML_DECL_KEYWORDS.has(k0) || (SYSML_VIS_DIR_KEYWORDS.has(k0) && k1 && SYSML_DECL_KEYWORDS.has(k1))) {
        continue;
      }
      if (SYSML_CONFIG_KEYS.has(k0.toLowerCase()) && k1 === "=") {
        continue;
      }
      if (k0 === "connect") {
        continue;
      }

      let eqLeafIdx = stmtLeaves.findIndex((lf) => lf.text === "==");
      if (eqLeafIdx === -1) {
        eqLeafIdx = stmtLeaves.findIndex((lf, idx) => {
          if (lf.text !== "=") return false;
          const prev = stmtLeaves[idx - 1]?.text;
          const next = stmtLeaves[idx + 1]?.text;
          return prev !== ":" && prev !== "<" && prev !== ">" && prev !== "!" && next !== "=" && next !== ">";
        });
      }

      if (eqLeafIdx > 0 && eqLeafIdx < stmtLeaves.length - 1) {
        let lhsStart = 0;
        if (stmtLeaves[0]!.text === "assert" && stmtLeaves[1]?.text === "constraint") {
          lhsStart = 2;
        }
        while (lhsStart < eqLeafIdx && stmtLeaves[lhsStart]!.text === "{") {
          lhsStart++;
        }
        let rhsEnd = stmtLeaves.length - 1;
        while (rhsEnd > eqLeafIdx && stmtLeaves[rhsEnd]!.text === "}") {
          rhsEnd--;
        }

        const lhsText =
          lhsStart < eqLeafIdx
            ? compText.slice(stmtLeaves[lhsStart]!.start, stmtLeaves[eqLeafIdx - 1]!.end).trim()
            : "";
        const rhsText =
          rhsEnd > eqLeafIdx ? compText.slice(stmtLeaves[eqLeafIdx + 1]!.start, stmtLeaves[rhsEnd]!.end).trim() : "";

        if (
          lhsText &&
          rhsText &&
          !lhsText.includes("{") &&
          !lhsText.includes("}") &&
          !rhsText.includes("{") &&
          !rhsText.includes("}")
        ) {
          if (emittedFromCst > 0 && assertUsages.length > 0) {
            const normTarget = `${lhsText}==${rhsText}`.replace(/\s+/g, "");
            const isDupAssert = assertUsages.some((au) => {
              if (au.text.replace(/\s+/g, "").includes(normTarget)) return true;
              const eqNodes = findCstDescendants(au, "EqualityExpression");
              return eqNodes.some((eq) => {
                const eqText = trimTrailingSemicolon(eq.text);
                return (
                  stmt === eqText || `${lhsText} == ${rhsText}` === eqText || eqText.replace(/\s+/g, "") === normTarget
                );
              });
            });
            if (isDupAssert) {
              continue;
            }
          }
          if (emittedFromCst > 0 && directResultExprs.length > 0) {
            const isDup = directResultExprs.some((re) => {
              if (this.isDescendantOfError(re, compNode)) return false;
              const reText = trimTrailingSemicolon(re.text);
              return stmt === reText || `${lhsText} == ${rhsText}` === reText;
            });
            if (isDup) {
              continue;
            }
          }

          const prefixedLhs = prefixSysmlExpression(lhsText, prefix, localNames);
          const prefixedRhs = prefixSysmlExpression(rhsText, prefix, localNames);
          const lhsExprId = lowerSysmlExpr(prefixedLhs, this.arena);
          const rhsExprId = lowerSysmlExpr(prefixedRhs, this.arena);
          this.arena.addEquation(EqKind.Simple, lhsExprId, rhsExprId);
        }
      }
    }
  }

  /**
   * Lowers hybrid continuous-discrete `when` event blocks directly into `DAEBuilder` when equations.
   */
  private elaborateWhenClauses(compNode: SysmlCstNode, prefix: string, localNames: Set<string>): void {
    const compText = this.getCompText(compNode);
    const leaves = collectCstLeaves(parseSysmlSource(compText));
    for (let i = 0; i < leaves.length; i++) {
      if (leaves[i]!.text !== "when") continue;
      let openBraceIdx = -1;
      for (let k = i + 1; k < leaves.length; k++) {
        if (leaves[k]!.text === "{") {
          openBraceIdx = k;
          break;
        }
      }
      if (openBraceIdx === -1) break;
      const closeBraceIdx = findMatchingBraceLeaf(leaves, openBraceIdx);
      const condLeaves = leaves.slice(i + 1, openBraceIdx);
      let condStr =
        condLeaves.length > 0
          ? compText.slice(condLeaves[0]!.start, condLeaves[condLeaves.length - 1]!.end).trim()
          : "";
      if (condStr.startsWith("(") && condStr.endsWith(")")) {
        condStr = condStr.slice(1, -1).trim();
      }

      const prefixedCond = prefixSysmlExpression(condStr, prefix, localNames);
      const condExprId = lowerSysmlExpr(prefixedCond, this.arena);
      const whenIdx = this.arena.addWhenEquation(condExprId);

      const bodyLeaves = leaves.slice(openBraceIdx + 1, closeBraceIdx);
      let stmtStart = 0;
      for (let b = 0; b < bodyLeaves.length; b++) {
        if (bodyLeaves[b]!.text !== ";") continue;
        let sIdx = stmtStart;
        if (bodyLeaves[sIdx]?.text === "assign") sIdx++;
        const targetChain = readDottedChainFromLeaves(bodyLeaves, sIdx);
        const assignOp = targetChain ? bodyLeaves[targetChain.nextIdx]?.text : undefined;
        if (targetChain && (assignOp === ":=" || assignOp === "=") && targetChain.nextIdx + 1 < b) {
          const rhsStart = bodyLeaves[targetChain.nextIdx + 1]!.start;
          const rhsEnd = bodyLeaves[b - 1]!.end;
          const rawTarget = targetChain.text;
          const rawExpr = compText.slice(rhsStart, rhsEnd).trim();
          if (rawTarget && rawExpr) {
            const target = prefixSysmlExpression(rawTarget, prefix, localNames);
            const expr = prefixSysmlExpression(rawExpr, prefix, localNames);

            const targetNameId = this.arena.interner.intern(target);
            const targetExprId = this.arena.addName(targetNameId);
            const rhsExprId = lowerSysmlExpr(expr, this.arena);
            this.arena.addWhenBodyEquation(whenIdx, EqKind.Simple, targetExprId, rhsExprId);

            if (!this.states.includes(target) && !this.parameters.includes(target)) {
              this.states.push(target);
            }
          }
        }
        stmtStart = b + 1;
      }

      i = closeBraceIdx;
    }
  }

  /**
   * Extracts `ConnectionUsage` endpoint pairs (`connect p1 to p2;`) for global Kirchhoff synthesis.
   */
  private elaborateConnections(compNode: SysmlCstNode, prefix: string): void {
    const searchNode = prefix === "" && this.rootNode ? this.rootNode : compNode;
    const connUsages = findCstDescendants(searchNode, "ConnectionUsage");
    for (const cu of connUsages) {
      if (this.isDescendantOfPartUsage(cu, searchNode)) continue;

      // Form: connect p1 to p2; or connect a = b;
      let refNodes = findCstDescendants(cu, "ConnectorEnd");
      if (refNodes.length < 2) {
        refNodes = findCstDescendants(cu, "ConnectorEndMember");
      }
      if (refNodes.length < 2) {
        refNodes = findCstDescendants(cu, "FeatureReferenceExpression");
      }
      if (refNodes.length >= 2) {
        for (let i = 0; i < refNodes.length - 1; i++) {
          const p1Raw = refNodes[i]!.text.trim();
          const p2Raw = refNodes[i + 1]!.text.trim();

          const p1 = prefix + p1Raw;
          const p2 = prefix + p2Raw;

          this.connections.push({ p1, p2 });
        }
      } else {
        const m = cu.text.trim().match(/^connect\s+([A-Za-z_][\w.]*)\s+to\s+([A-Za-z_][\w.]*)\s*;?$/);
        if (m) {
          this.connections.push({ p1: prefix + m[1]!, p2: prefix + m[2]! });
        }
      }
    }

    // Also scan compNode (or rootNode at root level) leaves for bare connect statements if any were missed by CST due to parse errors
    const leaves = collectCstLeaves(
      parseSysmlSource(prefix === "" && this.sourceText ? this.sourceText : this.getCompText(compNode)),
    );
    for (let i = 0; i < leaves.length; i++) {
      if (leaves[i]!.text !== "connect") continue;
      const c1 = readDottedChainFromLeaves(leaves, i + 1);
      if (!c1 || leaves[c1.nextIdx]?.text !== "to") continue;
      const c2 = readDottedChainFromLeaves(leaves, c1.nextIdx + 1);
      if (!c2 || leaves[c2.nextIdx]?.text !== ";") continue;
      const p1 = prefix + c1.text;
      const p2 = prefix + c2.text;
      if (!this.connections.some((c) => c.p1 === p1 && c.p2 === p2)) {
        this.connections.push({ p1, p2 });
      }
      i = c2.nextIdx;
    }
  }

  /**
   * Post-processes all connections across the model using a Disjoint Set (Union-Find)
   * to strictly balance Kirchhoff potential equalities and multi-port sum-to-zero flow conservation.
   */
  private processGlobalConnections(): void {
    const unionMap = new Map<string, string>();
    const findRoot = (x: string): string => {
      let curr = x;
      while (unionMap.has(curr)) curr = unionMap.get(curr)!;
      return curr;
    };
    const union = (a: string, b: string) => {
      const ra = findRoot(a);
      const rb = findRoot(b);
      if (ra !== rb) unionMap.set(rb, ra);
    };

    for (const conn of this.connections) {
      const port1 = this.activePorts.get(conn.p1);
      const port2 = this.activePorts.get(conn.p2);

      if (port1 && port2) {
        // 1. Potential attributes equal: p1.v == p2.v
        for (const pot of port1.potentialAttrs) {
          if (port2.potentialAttrs.includes(pot)) {
            const v1Name = this.arena.interner.intern(`${conn.p1}.${pot}`);
            const v2Name = this.arena.interner.intern(`${conn.p2}.${pot}`);
            const v1Expr = this.arena.addName(v1Name);
            const v2Expr = this.arena.addName(v2Name);
            this.arena.addEquation(EqKind.Simple, v1Expr, v2Expr);
          }
        }

        // 2. Group flow terminals into the same junction equivalence class
        for (const fl of port1.flowAttrs) {
          if (port2.flowAttrs.includes(fl)) {
            union(`${conn.p1}.${fl}`, `${conn.p2}.${fl}`);
          }
        }
      } else {
        // Direct scalar variable connection
        const n1 = this.arena.interner.intern(conn.p1);
        const n2 = this.arena.interner.intern(conn.p2);
        const e1 = this.arena.addName(n1);
        const e2 = this.arena.addName(n2);
        this.arena.addEquation(EqKind.Simple, e1, e2);
      }
    }

    // Group flow pins by junction root
    const junctionGroups = new Map<string, string[]>();
    for (const port of this.activePorts.values()) {
      for (const fl of port.flowAttrs) {
        const pinName = `${port.fullName}.${fl}`;
        const root = findRoot(pinName);
        if (!junctionGroups.has(root)) junctionGroups.set(root, []);
        junctionGroups.get(root)!.push(pinName);
      }
    }

    // Emit single Kirchhoff flow sum-to-zero conservation equation per junction (with conjugation sign)
    for (const pins of junctionGroups.values()) {
      if (pins.length >= 2) {
        let sumExpr: number | null = null;
        for (const pinName of pins) {
          const dotIdx = pinName.lastIndexOf(".");
          const portFullName = dotIdx !== -1 ? pinName.slice(0, dotIdx) : pinName;
          const port = this.activePorts.get(portFullName);
          const nameId = this.arena.interner.intern(pinName);
          const exprId = this.arena.addName(nameId);
          const signedExpr = port?.isConjugated ? this.arena.addUnaryExpr(UnaryOp.Negate, exprId) : exprId;

          if (sumExpr === null) {
            sumExpr = signedExpr;
          } else {
            sumExpr = this.arena.addBinaryExpr(BinOp.Add, sumExpr, signedExpr);
          }
        }
        if (sumExpr !== null) {
          const zeroExpr = this.arena.addRealLiteral(0.0);
          this.arena.addEquation(EqKind.Simple, sumExpr, zeroExpr);
        }
      }
    }
  }
}
