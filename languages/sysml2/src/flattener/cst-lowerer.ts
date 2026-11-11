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

export interface SysmlCstTree {
  sourceCode?: string | undefined;
  _encoding?: number | undefined;
  mem32?: Uint32Array | undefined;
  facade?:
    | {
        getInputEncoding?(): number;
        syntaxNames?: string[] | undefined;
        exports?:
          | {
              getInputBuffer?(): number;
              lsp_getInputBuffer?(): number;
              getFatPaddingPtr?(rawPad: number): number;
            }
          | undefined;
      }
    | undefined;
}

export type SysmlCstNodeConstructor = new (
  tree: SysmlCstTree,
  ptr: number,
  startOffset: number,
  parent: SysmlCstNode | null | undefined,
  pad: number,
  len: number,
  typeId: number,
  fieldId: number,
) => SysmlCstNode;

export interface SysmlCstNode {
  type: string;
  text: string;
  name?: string | undefined;
  ptr?: number | undefined;
  typeId?: number | undefined;
  _startOffset?: number | undefined;
  _cachedPad?: number | undefined;
  _cachedLen?: number | undefined;
  startIndex?: number | undefined;
  endIndex?: number | undefined;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
  startPosition?: { row: number; column: number } | undefined;
  endPosition?: { row: number; column: number } | undefined;
  tree?: SysmlCstTree | undefined;
  parent?: SysmlCstNode | null | undefined;
  childCount?: number | undefined;
  children?: SysmlCstNode[] | undefined;
  child?(index: number): SysmlCstNode | null | undefined;
  childForFieldName?(name: string): SysmlCstNode | null | undefined;
  childrenForFieldName?(name: string): SysmlCstNode[];
  hasError?: boolean | (() => boolean) | undefined;
}

/**
 * Zero-allocation linear-memory CST text extractor from raw `(startOffset, pad, len)` in `Tree`.
 */
export function extractLinearNodeText(tree: SysmlCstTree, startOffset: number, pad: number, len: number): string {
  const enc = tree.facade?.getInputEncoding ? tree.facade.getInputEncoding() : (tree._encoding ?? 1);
  const wasmMemory = (tree.facade as { wasmMemory?: WebAssembly.Memory } | undefined)?.wasmMemory;
  if ((enc === 0 || enc === 3 || enc === 4) && tree.facade && wasmMemory) {
    const getInputBuf = tree.facade.exports?.getInputBuffer || tree.facade.exports?.lsp_getInputBuffer;
    if (getInputBuf) {
      const inputBufPtr = getInputBuf();
      const rawBytes = new Uint8Array(wasmMemory.buffer, inputBufPtr + startOffset + pad, len);
      if (enc === 3 || enc === 4) {
        const view = new DataView(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength);
        const cps: number[] = [];
        for (let k = 0; k + 3 < len; k += 4) {
          cps.push(view.getUint32(k, enc === 3));
        }
        return String.fromCodePoint(...cps);
      }
      return typeof TextDecoder !== "undefined"
        ? new TextDecoder("utf-8").decode(rawBytes)
        : String.fromCharCode(...rawBytes);
    }
  }
  if (!tree.sourceCode) return "";
  const s = startOffset + pad;
  const e = startOffset + pad + len;
  if (enc === 3 || enc === 4) {
    return Array.from(tree.sourceCode).slice(s, e).join("");
  }
  return tree.sourceCode.substring(s, e);
}

/**
 * Helper to recursively search for direct visible CST children of a given type.
 * Uses direct WASM `mem32` pointer iteration when available to avoid allocating
 * `SyntaxNode` wrappers for non-matching children.
 */
export function findCstChildren(
  node: SysmlCstNode | null | undefined,
  type: string,
  results: SysmlCstNode[] = [],
): SysmlCstNode[] {
  if (!node) return results;
  if (
    typeof node.ptr === "number" &&
    node.ptr > 0 &&
    node.tree?.mem32 &&
    node.tree?.facade?.syntaxNames &&
    !(node as { _cachedChildren?: unknown })._cachedChildren
  ) {
    const mem32: Uint32Array = node.tree.mem32;
    const syntaxNames: string[] = node.tree.facade.syntaxNames;
    const NodeCtor = node.constructor as unknown as SysmlCstNodeConstructor;

    // Linear CST node layout in WASM memory (32 bytes per node):
    //   +0:  typeFlags (bits 0..15 = typeId, bits 16..31 = flags)
    //   +4:  byteLength (full 32-bit u32)
    //   +8:  paddingLength (full 32-bit u32)
    //   +12: firstChildPtr (u32 byte pointer)
    //   +16: nextSiblingPtr (u32 byte pointer)
    const ptrStack: number[] = [];
    const offsetStack: number[] = [];
    let currentChildPtr = mem32[(node.ptr + 12) >>> 2]!;
    let currentOffset = (node._startOffset ?? 0) + (node._cachedPad ?? 0);

    while (true) {
      if (currentChildPtr !== 0) {
        const typeFlags = mem32[currentChildPtr >>> 2]!;
        const typeId = typeFlags & 0xffff;
        const name = syntaxNames[typeId] || "";
        const flags = typeFlags >>> 16;
        const len = mem32[(currentChildPtr + 4) >>> 2]!;
        const pad = mem32[(currentChildPtr + 8) >>> 2]!;
        const isInvisible = (flags & 4) !== 0;

        const nextChildPtr = mem32[(currentChildPtr + 16) >>> 2]!;
        const nextOffset = currentOffset + pad + len;

        // Transparently descend into hidden/inline grammar rules (prefixed with '_' or marked invisible)
        if (name.startsWith("_") || isInvisible) {
          if (nextChildPtr !== 0) {
            ptrStack.push(nextChildPtr);
            offsetStack.push(nextOffset);
          }
          currentChildPtr = mem32[(currentChildPtr + 12) >>> 2]!;
          currentOffset = currentOffset + pad;
          continue;
        } else if (name === type) {
          results.push(new NodeCtor(node.tree, currentChildPtr, currentOffset, node, pad, len, typeId, -1));
        }

        currentOffset = nextOffset;
        currentChildPtr = nextChildPtr;
      } else {
        if (ptrStack.length === 0) break;
        currentChildPtr = ptrStack.pop()!;
        currentOffset = offsetStack.pop()!;
      }
    }
    return results;
  }

  const count = node.childCount ?? node.children?.length ?? 0;
  for (let i = 0; i < count; i++) {
    const child = node.child ? node.child(i) : node.children?.[i];
    if (!child) continue;
    if (child.type === type) {
      results.push(child);
    }
  }
  return results;
}

/**
 * Helper to recursively search all descendants for nodes of a given type.
 * Uses direct WASM linear-memory `u32` pointer traversal when available so only
 * matching nodes allocate a `SyntaxNode` wrapper.
 */
export function findCstDescendants(
  node: SysmlCstNode | null | undefined,
  type: string,
  results: SysmlCstNode[] = [],
): SysmlCstNode[] {
  if (!node) return results;
  if (typeof node.ptr === "number" && node.ptr > 0 && node.tree?.mem32 && node.tree?.facade?.syntaxNames) {
    if (node.type === type) results.push(node);
    const mem32: Uint32Array = node.tree.mem32;
    const syntaxNames: string[] = node.tree.facade.syntaxNames;
    const NodeCtor = node.constructor as unknown as SysmlCstNodeConstructor;

    const ptrStack: number[] = [];
    const offsetStack: number[] = [];
    let currentChildPtr = mem32[(node.ptr + 12) >>> 2]!;
    let currentOffset = (node._startOffset ?? 0) + (node._cachedPad ?? 0);

    while (true) {
      if (currentChildPtr !== 0) {
        const typeFlags = mem32[currentChildPtr >>> 2]!;
        const typeId = typeFlags & 0xffff;
        const name = syntaxNames[typeId] || "";
        const flags = typeFlags >>> 16;
        const len = mem32[(currentChildPtr + 4) >>> 2]!;
        const pad = mem32[(currentChildPtr + 8) >>> 2]!;
        const isInvisible = (flags & 4) !== 0;

        if (!isInvisible && name === type) {
          results.push(new NodeCtor(node.tree, currentChildPtr, currentOffset, node, pad, len, typeId, -1));
        }

        const nextChildPtr = mem32[(currentChildPtr + 16) >>> 2]!;
        const nextOffset = currentOffset + pad + len;
        const grandChildPtr = mem32[(currentChildPtr + 12) >>> 2]!;

        if (grandChildPtr !== 0) {
          if (nextChildPtr !== 0) {
            ptrStack.push(nextChildPtr);
            offsetStack.push(nextOffset);
          }
          currentChildPtr = grandChildPtr;
          currentOffset = currentOffset + pad;
        } else {
          currentChildPtr = nextChildPtr;
          currentOffset = nextOffset;
        }
      } else {
        if (ptrStack.length === 0) break;
        currentChildPtr = ptrStack.pop()!;
        currentOffset = offsetStack.pop()!;
      }
    }
    return results;
  }

  if (node.type === type) results.push(node);
  const count = node.childCount ?? node.children?.length ?? 0;
  for (let i = 0; i < count; i++) {
    const child = node.child ? node.child(i) : node.children?.[i];
    if (child) findCstDescendants(child, type, results);
  }
  return results;
}

/**
 * Finds the first descendant of a given type using direct WASM linear-memory `u32` pointer traversal.
 */
export function findFirstDescendant(node: SysmlCstNode | null | undefined, type: string): SysmlCstNode | null {
  if (!node) return null;
  if (typeof node.ptr === "number" && node.ptr > 0 && node.tree?.mem32 && node.tree?.facade?.syntaxNames) {
    if (node.type === type) return node;
    const mem32: Uint32Array = node.tree.mem32;
    const syntaxNames: string[] = node.tree.facade.syntaxNames;
    const NodeCtor = node.constructor as unknown as SysmlCstNodeConstructor;

    const ptrStack: number[] = [];
    const offsetStack: number[] = [];
    let currentChildPtr = mem32[(node.ptr + 12) >>> 2]!;
    let currentOffset = (node._startOffset ?? 0) + (node._cachedPad ?? 0);

    while (true) {
      if (currentChildPtr !== 0) {
        const typeFlags = mem32[currentChildPtr >>> 2]!;
        const typeId = typeFlags & 0xffff;
        const name = syntaxNames[typeId] || "";
        const flags = typeFlags >>> 16;
        const len = mem32[(currentChildPtr + 4) >>> 2]!;
        const pad = mem32[(currentChildPtr + 8) >>> 2]!;
        const isInvisible = (flags & 4) !== 0;

        if (!isInvisible && name === type) {
          return new NodeCtor(node.tree, currentChildPtr, currentOffset, node, pad, len, typeId, -1);
        }

        const nextChildPtr = mem32[(currentChildPtr + 16) >>> 2]!;
        const nextOffset = currentOffset + pad + len;
        const grandChildPtr = mem32[(currentChildPtr + 12) >>> 2]!;

        if (grandChildPtr !== 0) {
          if (nextChildPtr !== 0) {
            ptrStack.push(nextChildPtr);
            offsetStack.push(nextOffset);
          }
          currentChildPtr = grandChildPtr;
          currentOffset = currentOffset + pad;
        } else {
          currentChildPtr = nextChildPtr;
          currentOffset = nextOffset;
        }
      } else {
        if (ptrStack.length === 0) break;
        currentChildPtr = ptrStack.pop()!;
        currentOffset = offsetStack.pop()!;
      }
    }
    return null;
  }

  if (node.type === type) return node;
  const count = node.childCount ?? node.children?.length ?? 0;
  for (let i = 0; i < count; i++) {
    const child = node.child ? node.child(i) : node.children?.[i];
    const found = findFirstDescendant(child, type);
    if (found) return found;
  }
  return null;
}

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
      const idx = this.workspaceIndex as any;
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
    const initialEqCount = this.arena.eqCount;

    // 0. Extract experiment configs from root text if present
    const cleanSource = this.sourceText || rootNode.text || "";
    const startMatch = /\bstartTime\s*(?::\s*[A-Za-z0-9_:]+\s*)?=\s*([0-9.eE+-]+)/.exec(cleanSource);
    if (startMatch) this.arena.experiment.startTime = parseFloat(startMatch[1]!);
    const stopMatch = /\bstopTime\s*(?::\s*[A-Za-z0-9_:]+\s*)?=\s*([0-9.eE+-]+)/.exec(cleanSource);
    if (stopMatch) this.arena.experiment.stopTime = parseFloat(stopMatch[1]!);
    const intervalMatch = /\b(?:interval|step)\s*(?::\s*[A-Za-z0-9_:]+\s*)?=\s*([0-9.eE+-]+)/.exec(cleanSource);
    if (intervalMatch) this.arena.experiment.interval = parseFloat(intervalMatch[1]!);
    const tolMatch = /\btolerance\s*(?::\s*[A-Za-z0-9_:]+\s*)?=\s*([0-9.eE+-]+)/.exec(cleanSource);
    if (tolMatch) this.arena.experiment.tolerance = parseFloat(tolMatch[1]!);

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
        const typeName = typeNode?.text?.replace(/^[:\s]+/, "").trim();
        if (typeName) instantiatedTypes.add(typeName);
      }

      const subclassificationNodes = findCstDescendants(compNode, "OwnedSubclassification");
      for (const sc of subclassificationNodes) {
        const superName = sc.text.replace(/^[:>\s]+/, "").trim();
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
    const reg = new RegExp(`\\b(?:part|constraint|model|package)\\s+(?:def\\s+)?${compName}\\b[^{]*\\{`, "g");
    const m = reg.exec(sourceText);
    if (!m) return null;
    const openBrace = sourceText.indexOf("{", m.index);
    let depth = 1;
    let i = openBrace + 1;
    while (i < sourceText.length && depth > 0) {
      if (sourceText[i] === "{") depth++;
      else if (sourceText[i] === "}") depth--;
      i++;
    }
    return sourceText.slice(m.index, i);
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
          const match = /^der\s*\(\s*([^()]+)\s*\)/.exec(inv.text?.trim() || "");
          if (match) argText = match[1]?.trim();
        }
        if (argText) {
          const dotIdx = argText.indexOf(".");
          const baseName = dotIdx === -1 ? argText : argText.slice(0, dotIdx);
          derStateNames.add(baseName);
        }
      }
    }

    // Robust fallback: if naked differential equations der(x) == ... are located directly inside
    // a part def or error recovery node, extract state names via regex scan over component text.
    if (compNode.text && compNode.text.includes("der(")) {
      const derRegex = /\bder\s*\(\s*([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)\s*\)/g;
      let match: RegExpExecArray | null;
      while ((match = derRegex.exec(compNode.text)) !== null) {
        const fullArg = match[1]!;
        const dotIdx = fullArg.indexOf(".");
        const baseName = dotIdx === -1 ? fullArg : fullArg.slice(0, dotIdx);
        derStateNames.add(baseName);
      }
    }

    // 1. Process Inheritance (:>)
    const subclassificationNodes = findCstChildren(compNode, "OwnedSubclassification");
    for (const sc of subclassificationNodes) {
      const superName = sc.text.replace(/^[:>\s]+/, "").trim();
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
      const rawType = typeNode?.text?.replace(/^[:\s]+/, "").trim() || "";
      const isConjugated = pu.text.includes("~") || rawType.startsWith("~");
      const cleanType = rawType.replace(/^~\s*/, "");

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
        const rawVal = valNode.text.replace(/^[=:\s]+/, "").trim();
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
      let localBody = this.getCompText(compNode);
      // Strip subpart blocks with { ... } so inline attribute overrides aren't treated as parent attributes
      const subpartBraceRegex = /\bpart\s+[A-Za-z_][A-Za-z0-9_]*\s*:\s*[A-Za-z_][A-Za-z0-9_]*\s*\{/g;
      let sbm: RegExpExecArray | null;
      while ((sbm = subpartBraceRegex.exec(localBody)) !== null) {
        const openBrace = localBody.indexOf("{", sbm.index);
        let depth = 1;
        let i = openBrace + 1;
        while (i < localBody.length && depth > 0) {
          if (localBody[i] === "{") depth++;
          else if (localBody[i] === "}") depth--;
          i++;
        }
        localBody = localBody.slice(0, sbm.index) + "/* subpart */" + localBody.slice(i);
        subpartBraceRegex.lastIndex = sbm.index + 13;
      }

      // Strip action/calc blocks with { ... } so local action parameters aren't treated as component attributes
      const actionBraceRegex = /\b(?:action|calc)\s+(?:def\s+)?[A-Za-z_][A-Za-z0-9_]*\s*\{/g;
      let abm: RegExpExecArray | null;
      while ((abm = actionBraceRegex.exec(localBody)) !== null) {
        const openBrace = localBody.indexOf("{", abm.index);
        let depth = 1;
        let i = openBrace + 1;
        while (i < localBody.length && depth > 0) {
          if (localBody[i] === "{") depth++;
          else if (localBody[i] === "}") depth--;
          i++;
        }
        localBody = localBody.slice(0, abm.index) + "/* action */" + localBody.slice(i);
        actionBraceRegex.lastIndex = abm.index + 12;
      }

      const attrRegex =
        /\b(?:(in|out)\s+)?attribute\s+(?:item\s+)?([A-Za-z_][A-Za-z0-9_]*)(?:\s*:\s*([A-Za-z0-9_:]+))?(?:\s*=\s*([^;]+))?/g;
      let am: RegExpExecArray | null;
      while ((am = attrRegex.exec(localBody)) !== null) {
        const isInput = am[1] === "in";
        const isOutput = am[1] === "out";
        const attrName = am[2]!;
        if (localNames.has(attrName)) continue;
        localNames.add(attrName);
        const fullName = prefix + attrName;

        let defaultVal = 0.0;
        const rawVal = am[4]?.trim();
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
      const subTypeName = typeNode?.text?.replace(/^[:\s]+/, "").trim() || "";

      // Extract multiplicity: e.g. [4], [1..4], [0..4]
      let multiplicity = 1;
      const multNode = findFirstDescendant(pu, "OwnedMultiplicity") || findFirstDescendant(pu, "MultiplicityRange");
      if (multNode) {
        const numMatch = multNode.text.match(/\[\s*(?:\d+\s*\.\.\s*)?(\d+)\s*\]/);
        if (numMatch) {
          multiplicity = parseInt(numMatch[1]!, 10);
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
          const rawVal = valNode.text.replace(/^[=:\s]+/, "").trim();
          const parsed = parseFloat(rawVal);
          if (!isNaN(parsed) && isFinite(parsed)) {
            subOverrides[sauName] = parsed;
          }
        }
      }
      const subRedefRegex =
        /\b(?:attribute\s+|redefines\s+|:>>\s*)([A-Za-z_][A-Za-z0-9_]*)\s*(?::\s*[A-Za-z0-9_:]+\s*)?=\s*([+-]?[0-9.]+(?:[eE][+-]?[0-9]+)?)/g;
      let srm: RegExpExecArray | null;
      const puText = pu.text || "";
      while ((srm = subRedefRegex.exec(puText)) !== null) {
        const attrKey = srm[1]!;
        if (subOverrides[attrKey] === undefined) {
          const parsed = parseFloat(srm[2]!);
          if (!isNaN(parsed) && isFinite(parsed)) {
            subOverrides[attrKey] = parsed;
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
      const trimmedText = re.text.replace(/;$/, "").trim();
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
    let scrubbedBody = this.getCompText(compNode);

    // Scrub nested subpart braces so child equations aren't duplicated at parent level
    const subpartRegex = /\bpart\s+[A-Za-z_][A-Za-z0-9_]*\s*:\s*[A-Za-z_][A-Za-z0-9_]*/g;
    let spm: RegExpExecArray | null;
    while ((spm = subpartRegex.exec(scrubbedBody)) !== null) {
      let nextPos = spm.index + spm[0].length;
      while (nextPos < scrubbedBody.length && /\s/.test(scrubbedBody[nextPos]!)) nextPos++;
      if (nextPos < scrubbedBody.length && scrubbedBody[nextPos] === "{") {
        let depth = 1;
        let i = nextPos + 1;
        while (i < scrubbedBody.length && depth > 0) {
          if (scrubbedBody[i] === "{") depth++;
          else if (scrubbedBody[i] === "}") depth--;
          i++;
        }
        scrubbedBody = scrubbedBody.slice(0, spm.index) + "/* subpart */" + scrubbedBody.slice(i);
        subpartRegex.lastIndex = spm.index + 13;
      }
    }

    // Scrub when blocks
    const whenRegex = /\bwhen\b/g;
    let wm: RegExpExecArray | null;
    while ((wm = whenRegex.exec(scrubbedBody)) !== null) {
      const openBrace = scrubbedBody.indexOf("{", wm.index);
      if (openBrace !== -1) {
        let depth = 1;
        let i = openBrace + 1;
        while (i < scrubbedBody.length && depth > 0) {
          if (scrubbedBody[i] === "{") depth++;
          else if (scrubbedBody[i] === "}") depth--;
          i++;
        }
        scrubbedBody = scrubbedBody.slice(0, wm.index) + "/* when */" + scrubbedBody.slice(i);
        whenRegex.lastIndex = wm.index + 10;
      }
    }

    // Scrub nested action/calc blocks so imperative statements are not treated as continuous equations
    const actionBlockRegex = /\b(?:action|calc)\s+(?:def\s+)?[A-Za-z_][A-Za-z0-9_]*\s*\{/g;
    let abm: RegExpExecArray | null;
    while ((abm = actionBlockRegex.exec(scrubbedBody)) !== null) {
      const openBrace = scrubbedBody.indexOf("{", abm.index);
      if (openBrace !== -1) {
        let depth = 1;
        let i = openBrace + 1;
        while (i < scrubbedBody.length && depth > 0) {
          if (scrubbedBody[i] === "{") depth++;
          else if (scrubbedBody[i] === "}") depth--;
          i++;
        }
        scrubbedBody = scrubbedBody.slice(0, abm.index) + "/* action */" + scrubbedBody.slice(i);
        actionBlockRegex.lastIndex = abm.index + 12;
      }
    }

    const statements = scrubbedBody
      .split(";")
      .map((s) => s.replace(/^[\s{}]+/, "").trim())
      .filter((s) => s.length > 0);

    for (const stmt of statements) {
      if (
        /^\b(?:(?:in|out|inout|private|protected|public)\s+)?(?:attribute|item|part|port|action|calc|constraint|def|import|package|alias|metadata)\b/.test(
          stmt,
        )
      ) {
        continue;
      }
      if (/^(?:startTime|stopTime|interval|step|tolerance)\s*=/i.test(stmt)) {
        continue;
      }
      if (/^\bconnect\b/.test(stmt)) {
        continue;
      }

      let eqSplitIndex = -1;
      let eqOpLen = 0;

      const dblEqIdx = stmt.indexOf("==");
      if (dblEqIdx !== -1) {
        eqSplitIndex = dblEqIdx;
        eqOpLen = 2;
      } else {
        const singleEqMatch = /(?:^|[^:<>!])=(?!=)/.exec(stmt);
        if (singleEqMatch && singleEqMatch.index !== undefined) {
          eqSplitIndex = singleEqMatch.index + (singleEqMatch[0].startsWith("=") ? 0 : 1);
          eqOpLen = 1;
        }
      }

      if (eqSplitIndex !== -1) {
        let lhsText = stmt.slice(0, eqSplitIndex).trim();
        lhsText = lhsText.replace(/^(?:assert\s+constraint\s*\{?\s*|\{\s*)/, "").trim();
        const rhsText = stmt
          .slice(eqSplitIndex + eqOpLen)
          .trim()
          .replace(/\}$/, "")
          .trim();

        if (lhsText && rhsText) {
          if (emittedFromCst > 0 && assertUsages.length > 0) {
            continue;
          }
          if (emittedFromCst > 0 && directResultExprs.length > 0) {
            const isDup = directResultExprs.some((re) => {
              if (this.isDescendantOfError(re, compNode)) return false;
              const reText = re.text.replace(/;$/, "").trim();
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
    let searchIdx = 0;
    while (searchIdx < compText.length) {
      const match = /\bwhen\b/.exec(compText.slice(searchIdx));
      if (!match) break;
      const whenStart = searchIdx + match.index;
      const openBrace = compText.indexOf("{", whenStart);
      if (openBrace === -1) break;
      const condStr = compText.slice(whenStart + 4, openBrace).trim();
      const rawCond = condStr.startsWith("(") && condStr.endsWith(")") ? condStr.slice(1, -1).trim() : condStr;
      let depth = 1;
      let i = openBrace + 1;
      while (i < compText.length && depth > 0) {
        if (compText[i] === "{") depth++;
        else if (compText[i] === "}") depth--;
        i++;
      }
      const whenBody = compText.slice(openBrace + 1, i - 1);
      searchIdx = i;

      const prefixedCond = prefixSysmlExpression(rawCond, prefix, localNames);
      const condExprId = lowerSysmlExpr(prefixedCond, this.arena);
      const whenIdx = this.arena.addWhenEquation(condExprId);

      const assignRegex = /(?:assign\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*(?::=|=)\s*([^;]+);/g;
      let asm: RegExpExecArray | null;
      while ((asm = assignRegex.exec(whenBody)) !== null) {
        const rawTarget = asm[1]!.trim();
        const rawExpr = asm[2]!.trim();
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
  }

  /**
   * Extracts `ConnectionUsage` endpoint pairs (`connect p1 to p2;`) for global Kirchhoff synthesis.
   */
  private elaborateConnections(compNode: SysmlCstNode, prefix: string): void {
    const connUsages = findCstDescendants(compNode, "ConnectionUsage");
    for (const cu of connUsages) {
      if (this.isDescendantOfPartUsage(cu, compNode)) continue;

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
      }
    }

    // Also scan compNode text for bare connect statements if any were missed by CST due to parse errors
    const compText = this.getCompText(compNode);
    const connectRegex = /\bconnect\s+([A-Za-z0-9_.]+)\s+to\s+([A-Za-z0-9_.]+)\s*;/g;
    let cm: RegExpExecArray | null;
    while ((cm = connectRegex.exec(compText)) !== null) {
      const p1 = prefix + cm[1]!.trim();
      const p2 = prefix + cm[2]!.trim();
      if (!this.connections.some((c) => c.p1 === p1 && c.p2 === p2)) {
        this.connections.push({ p1, p2 });
      }
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
