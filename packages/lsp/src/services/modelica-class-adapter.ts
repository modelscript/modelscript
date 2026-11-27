// SPDX-License-Identifier: AGPL-3.0-or-later

import { AnnotationEvaluator } from "@modelscript/modelica/diagram";
import type { QueryEngine, SymbolEntry, SyntaxNode, UnifiedWorkspace } from "@modelscript/runtime";
import { globalLanguageRegistry } from "../registry/LanguageRegistry.js";
import type { CstNodeLike } from "../utils/ast-utils.js";
import { getCompositeName } from "../utils/hierarchy-utils.js";
import { extractModelicaTypeFromDeclLine, extractWithinPackageName, skipWs } from "../utils/lexical-utils.js";
import type { DocumentManager } from "./document-manager.js";

/** Annotation evaluation context passed to class-instance `annotation()` queries. */
export interface AnnotationEvalContext {
  ownOnly?: boolean | undefined;
  classInstance?: WorkspaceClassInstance | null | undefined;
  declaration?: unknown;
  modification?: unknown;
  cstNode?: unknown;
}

/** Resolved component instance adapter attached to a `WorkspaceClassInstance`. */
export interface WorkspaceComponentInstance {
  name: string;
  annotations?: unknown[] | undefined;
  declaration?: SymbolEntry | undefined;
  defaultValue?: unknown;
  unit?: unknown;
  description?: string | null | undefined;
  typeSpecifier?: string | undefined;
  classInstance?: WorkspaceClassInstance | null | undefined;
  parent?: WorkspaceClassInstance | undefined;
  cstNode?: unknown;
  abstractSyntaxNode?: unknown;
  annotation?: ((annName: string) => unknown) | undefined;
  [key: string]: unknown;
}

/** Resolved `extends` base-class adapter entry. */
export interface WorkspaceExtendsInstance {
  name: string;
  classInstance: WorkspaceClassInstance;
}

/** Resolved `connect(a, b)` equation adapter entry. */
export interface WorkspaceConnectEquation {
  lhs: string;
  rhs: string;
  componentReference1: { parts: Array<{ identifier: { text: string } }> };
  componentReference2: { parts: Array<{ identifier: { text: string } }> };
  cstNode: unknown;
  ast: unknown;
  annotation: (annName: string) => unknown;
}

/** Rich class-instance adapter returned by `WorkspaceManager.resolveModelicaClassInstance`. */
export interface WorkspaceClassInstance {
  id: number;
  db?: unknown;
  entry?: SymbolEntry | undefined;
  cstNode?: unknown;
  abstractSyntaxNode?: unknown;
  name: string;
  kind?: string | undefined;
  classKind?: string | undefined;
  compositeName?: string | undefined;
  description?: string | null | undefined;
  isClassInstance?: boolean | undefined;
  _iconOnly?: boolean | undefined;
  components?: WorkspaceComponentInstance[] | undefined;
  elements?: WorkspaceComponentInstance[] | undefined;
  connectEquations?: WorkspaceConnectEquation[] | undefined;
  extendsClassInstances?: WorkspaceExtendsInstance[] | undefined;
  resolveName?: ((parts: string[] | string) => WorkspaceComponentInstance | null) | undefined;
  annotation?: ((name: string, ctx?: AnnotationEvalContext | string) => unknown) | undefined;
  jsSource?: string | undefined;
  context?: unknown;
  uri?: string | undefined;
  instantiate?: (() => void) | undefined;
  [key: string]: unknown;
}

type AnnotationEvaluatorConstructor = new (scope: unknown) => {
  evaluate(node: unknown, annotationName: string): unknown;
};

export type DescendantCstNode = (CstNodeLike | SyntaxNode) & {
  descendantForIndex?(start: number, end?: number): DescendantCstNode | null;
  descendantForByteRange?(start: number, end?: number): DescendantCstNode | null;
  parent?: DescendantCstNode | null;
  children?: readonly DescendantCstNode[];
  child?(index: number): DescendantCstNode | null;
  childForFieldName?(name: string): DescendantCstNode | null;
  lhs?: string | { text?: string };
  rhs?: string | { text?: string };
};

export interface ClassInstanceStore {
  get(uri: string): [WorkspaceClassInstance, ...WorkspaceClassInstance[]] | undefined;
  set(key: string, value: ReadonlyArray<WorkspaceClassInstance | Record<string, unknown>>): unknown;
}

export interface ModelicaClassAdapterHost {
  readonly documentInstances: ClassInstanceStore;
  readonly unifiedWorkspace: UnifiedWorkspace;
  readonly documentManager: DocumentManager | undefined;
  readonly globalModelicaQueryEngine: QueryEngine | null;
  readonly globalSysML2QueryEngine: QueryEngine | null;
  readonly nodeRequire: ((id: string) => unknown) | null;
  getSourceText(resourceId: string): string | null;
  getCstNodeForSymbol(
    entry: (Partial<SymbolEntry> & { cstNode?: DescendantCstNode | null | undefined }) | null | undefined,
  ): DescendantCstNode | null;
  resolveModelicaClassInstance(
    uri: string,
    className?: string,
    options?: { iconOnly?: boolean | undefined },
  ): WorkspaceClassInstance | null;
}

function createPredefinedPackageInstance(name = "Package"): WorkspaceClassInstance {
  return {
    id: -1,
    name,
    kind: "Package",
    components: [],
    extendsClassInstances: [],
    connectEquations: [],
    annotation: (annName: string) => {
      if (annName === "Icon") {
        return {
          "@type": "Icon",
          coordinateSystem: {
            "@type": "coordinateSystem",
            preserveAspectRatio: false,
            extent: [
              [-100, -100],
              [100, 100],
            ],
          },
          graphics: [
            {
              "@type": "Rectangle",
              lineColor: [200, 200, 200],
              fillColor: [248, 248, 248],
              fillPattern: "HorizontalCylinder",
              extent: [
                [-100, -100],
                [100, 100],
              ],
              radius: 25,
            },
            {
              "@type": "Rectangle",
              lineColor: [128, 128, 128],
              extent: [
                [-100, -100],
                [100, 100],
              ],
              radius: 25,
            },
          ],
        };
      }
      return null;
    },
  };
}

function isClassLikeSymbol(e: SymbolEntry | null | undefined): boolean {
  return (
    e != null &&
    (e.kind === "Class" ||
      e.kind === "Def" ||
      e.kind === "Package" ||
      e.kind === "Model" ||
      e.kind === "Block" ||
      e.kind === "Connector" ||
      e.kind === "Record" ||
      e.kind === "Function" ||
      e.kind === "Type" ||
      e.kind === "Part")
  );
}

/**
 * Resolves a Modelica or SysML v2 class symbol to a rich class-instance adapter supporting
 * component traversal, `extends` inheritance resolution, `connect` equation extraction,
 * and lazy `AnnotationEvaluator` evaluation for diagram and icon rendering.
 */
export function resolveModelicaClassInstanceWithHost(
  host: ModelicaClassAdapterHost,
  uri: string,
  className?: string,
  options?: { iconOnly?: boolean | undefined },
): WorkspaceClassInstance | null {
  // 1. Check documentInstances first for rich AST models
  const docInsts = host.documentInstances.get(uri);
  if (docInsts && docInsts.length > 0) {
    const richInsts = docInsts.filter(
      (ci: WorkspaceClassInstance) =>
        (options?.iconOnly || !ci._iconOnly) &&
        (typeof ci.annotation === "function" || (Array.isArray(ci.components) && ci.components.length > 0)),
    );
    if (richInsts.length > 0) {
      if (className) {
        const found = richInsts.find(
          (ci: WorkspaceClassInstance) =>
            ci.name === className || ci.compositeName === className || ci.compositeName?.endsWith(`.${className}`),
        );
        if (found) return found;
      } else {
        return richInsts[richInsts.length - 1] ?? null;
      }
    }
  }

  const annotationCache = new Map<number, Map<string, unknown>>();
  const adapterByEntryId = new Map<number, WorkspaceClassInstance>();

  const getSourceText = (resourceId: string): string | null => host.getSourceText(resourceId);

  const resolveEvaluatorClass = (resourceId?: string): AnnotationEvaluatorConstructor | undefined => {
    let evaluatorClass: AnnotationEvaluatorConstructor | undefined =
      (AnnotationEvaluator as unknown as AnnotationEvaluatorConstructor) ??
      (resourceId
        ? (globalLanguageRegistry.getPluginForUri(resourceId)?.annotationEvaluator as
            AnnotationEvaluatorConstructor | undefined)
        : undefined);
    if (!evaluatorClass && host.nodeRequire) {
      try {
        const mod = host.nodeRequire("@modelscript/modelica/diagram") as
          { AnnotationEvaluator?: AnnotationEvaluatorConstructor } | undefined;
        evaluatorClass = mod?.AnnotationEvaluator;
      } catch {
        // ignore
      }
    }
    return evaluatorClass;
  };

  interface AdapterDb {
    childrenOf?: (id: number) => SymbolEntry[];
    symbol?: (id: number) => SymbolEntry | null | undefined;
    query?: (name: string, id: number) => unknown;
    cstNode?: (id: number) => unknown;
  }

  type SymbolWithOptionalCst = SymbolEntry & { cstNode?: DescendantCstNode | null | undefined };

  const buildAdapter = (entry: SymbolWithOptionalCst, db: AdapterDb, compositeName: string): WorkspaceClassInstance => {
    if (entry?.id != null && adapterByEntryId.has(entry.id)) {
      return adapterByEntryId.get(entry.id)!;
    }
    const children: SymbolWithOptionalCst[] = db.childrenOf ? (db.childrenOf(entry.id) ?? []) : [];
    const components: WorkspaceComponentInstance[] = [];
    const extendsClassInstances: WorkspaceExtendsInstance[] = [];
    const connectEquations: WorkspaceConnectEquation[] = [];

    let classInstance!: WorkspaceClassInstance;

    for (const child of children) {
      if (child.kind === "Component" || child.kind === "Variable") {
        let componentClassInstance: WorkspaceClassInstance | null | undefined = undefined;
        let childCst: unknown = undefined;
        const getChildCst = (): unknown => {
          if (childCst === undefined) {
            childCst = (db.cstNode ? db.cstNode(child.id) : null) ?? host.getCstNodeForSymbol(child) ?? null;
          }
          return childCst;
        };
        const getComponentClassInstance = (): WorkspaceClassInstance | null => {
          if (componentClassInstance !== undefined) {
            return componentClassInstance;
          }
          if (options?.iconOnly) {
            componentClassInstance = null;
            return null;
          }
          const childMeta = child.metadata as Record<string, unknown> | undefined;
          const metaTypeSpec: string | null =
            typeof childMeta?.["typeSpecifier"] === "string" ? childMeta["typeSpecifier"] : null;
          let typeSpec: string | null = null;
          if (db.query) {
            try {
              const queried = db.query("typeSpecifier", child.id);
              typeSpec = typeof queried === "string" ? queried : null;
            } catch {
              // Salsa typeSpecifier query unavailable; fall back to symbol metadata and CST below.
            }
          }
          if (!typeSpec) {
            typeSpec = metaTypeSpec;
          }
          if (
            typeSpec === "Real" ||
            typeSpec === "Integer" ||
            typeSpec === "Boolean" ||
            typeSpec === "String" ||
            typeSpec === "StateSelect" ||
            typeSpec === "ExternalObject" ||
            typeSpec === "Clock" ||
            (typeSpec &&
              (typeSpec.startsWith("SI.") ||
                typeSpec.startsWith("Modelica.SIunits.") ||
                typeSpec.startsWith("Modelica.Units.")))
          ) {
            componentClassInstance = null;
            return null;
          }
          const childClassId = db.query ? (db.query("classInstance", child.id) as number | null | undefined) : null;
          const childClassEntry = typeof childClassId === "number" && db.symbol ? db.symbol(childClassId) : null;
          componentClassInstance = childClassEntry
            ? buildAdapter(childClassEntry, db, typeSpec || childClassEntry.name)
            : null;
          if (!componentClassInstance) {
            if (!typeSpec) {
              let p = (child.cstNode || getChildCst()) as DescendantCstNode | null | undefined;
              while (p) {
                if (p.type === "component_clause" || p.type === "ComponentClause") {
                  const ts = p.children?.find(
                    (c: DescendantCstNode) => c.type === "type_specifier" || c.type === "TypeSpecifier",
                  );
                  if (ts) {
                    typeSpec = ts.text?.trim() ?? null;
                    break;
                  }
                }
                p = p.parent;
              }
            }
            if (!typeSpec && entry.resourceId) {
              try {
                const cachedTree = host.documentManager?.documentTrees?.get(entry.resourceId);
                const root = cachedTree?.tree?.rootNode as DescendantCstNode | undefined;
                if (root && child.startOffset != null && child.endOffset != null) {
                  const findInCst = (n: DescendantCstNode | null | undefined): string | null => {
                    if (!n) return null;
                    if (
                      (n.type === "component_clause" || n.type === "ComponentClause") &&
                      typeof n.startIndex === "number" &&
                      typeof n.endIndex === "number" &&
                      n.startIndex <= child.startOffset &&
                      n.endIndex >= child.endOffset
                    ) {
                      const ts = (n.children || []).find(
                        (c: DescendantCstNode) => c.type === "type_specifier" || c.type === "TypeSpecifier",
                      );
                      if (ts?.text) return ts.text.trim();
                    }
                    for (const ch of n.children || []) {
                      const res = findInCst(ch);
                      if (res) return res;
                    }
                    return null;
                  };
                  typeSpec = findInCst(root) ?? null;
                }
                if (!typeSpec) {
                  const text = getSourceText(entry.resourceId);
                  const sOff = child.startOffset;
                  const eOff = child.endOffset;
                  if (text && sOff != null && eOff != null) {
                    const lineStart = text.lastIndexOf("\n", sOff);
                    const declLine = text.substring(lineStart === -1 ? 0 : lineStart + 1, eOff);
                    const parsedType = extractModelicaTypeFromDeclLine(declLine);
                    if (parsedType) {
                      typeSpec = parsedType;
                    }
                  }
                }
              } catch {
                // Best-effort CST and source-line type specifier recovery failed; leave typeSpec unresolved.
              }
            }
            if (
              typeSpec &&
              typeSpec !== "Real" &&
              typeSpec !== "Integer" &&
              typeSpec !== "Boolean" &&
              typeSpec !== "String" &&
              !typeSpec.startsWith("SI.") &&
              !typeSpec.startsWith("Modelica.SIunits.") &&
              !typeSpec.startsWith("Modelica.Units.")
            ) {
              componentClassInstance = host.resolveModelicaClassInstance(entry.resourceId ?? uri, typeSpec, options);
            }
          }
          return componentClassInstance ?? null;
        };
        const compAnnCache = new Map<string, unknown>();
        const childMeta = child.metadata as Record<string, unknown> | undefined;
        const compObj: WorkspaceComponentInstance = {
          name: child.name,
          annotations: [],
          declaration: child,
          defaultValue: childMeta?.["defaultValue"],
          unit: childMeta?.["unit"],
          description: (typeof childMeta?.["description"] === "string" ? childMeta["description"] : null) ?? null,
          get classInstance() {
            return getComponentClassInstance();
          },
          set classInstance(v: WorkspaceClassInstance | null | undefined) {
            componentClassInstance = v;
          },
          get cstNode() {
            return getChildCst();
          },
          get abstractSyntaxNode() {
            return getChildCst();
          },
          annotation: (annName: string): unknown => {
            if (compAnnCache.has(annName)) {
              return compAnnCache.get(annName);
            }
            try {
              if ((annName === "Placement" || annName === "placement") && db.query && child.id != null) {
                try {
                  const salsaPlacement = db.query("componentPlacement", child.id);
                  if (salsaPlacement != null) {
                    compAnnCache.set(annName, salsaPlacement);
                    return salsaPlacement;
                  }
                } catch {
                  // Salsa placement query unavailable; fall back to metadata and evaluator below.
                }
              }
              if ((annName === "Placement" || annName === "placement") && childMeta?.["placementAnnotation"] != null) {
                const metaPlacement = childMeta["placementAnnotation"];
                compAnnCache.set(annName, metaPlacement);
                return metaPlacement;
              }
              const evaluatorClass = resolveEvaluatorClass();
              const cst = getChildCst();
              if (cst && evaluatorClass) {
                const evaluator = new evaluatorClass(classInstance);
                const res = evaluator.evaluate(cst, annName);
                compAnnCache.set(annName, res);
                return res;
              }
            } catch {
              // Annotation evaluation failed; cache null so component renders without optional annotation.
            }
            compAnnCache.set(annName, null);
            return null;
          },
        };
        components.push(compObj);
      } else if (child.kind === "Extends" && child.name) {
        if (child.name !== entry.name && child.name !== compositeName) {
          const entryResId = entry.resourceId ?? uri;
          let baseInstance = host.resolveModelicaClassInstance(entryResId, child.name, options);
          if (!baseInstance && entry.parentId != null) {
            // Try resolving relative to parent scopes (e.g. child.name is "Icons.Package" in "Modelica.Electrical")
            let currParent = db.symbol ? db.symbol(entry.parentId) : null;
            while (currParent && !baseInstance) {
              const qualifiedParentName = currParent.name ? `${currParent.name}.${child.name}` : child.name;
              baseInstance = host.resolveModelicaClassInstance(entryResId, qualifiedParentName, options);
              currParent = currParent.parentId != null && db.symbol ? db.symbol(currParent.parentId) : null;
            }
          }
          if (!baseInstance) {
            // Try resolving relative to package hierarchy from compositeName or resourceId
            const scopeParts = (compositeName ? compositeName.split(".") : []).slice(0, -1);
            if (scopeParts.length === 0 && entry.resourceId) {
              try {
                const text = getSourceText(entry.resourceId);
                if (text) {
                  const withinPkg = extractWithinPackageName(text.slice(0, 1000));
                  if (withinPkg) {
                    scopeParts.push(...withinPkg.split("."));
                  }
                }
              } catch {
                // Source text unavailable for within-clause scan; fall back to path segments below.
              }
            }
            if (scopeParts.length === 0 && entry.resourceId) {
              const clean = entry.resourceId.replace(/^[a-z]+:\/*(?:lib\/)?/, "").replace(/\/[^/]+$/, "");
              const segments = clean.split("/").filter(Boolean);
              const mIdx = segments.findIndex((s: string) => s === "Modelica" || s.startsWith("Modelica"));
              if (mIdx !== -1) {
                scopeParts.push(...segments.slice(mIdx));
                if (scopeParts[0]?.startsWith("Modelica")) scopeParts[0] = "Modelica";
              } else {
                scopeParts.push(...segments);
              }
            }
            while (scopeParts.length > 0 && !baseInstance) {
              const qualifiedParentName = `${scopeParts.join(".")}.${child.name}`;
              baseInstance = host.resolveModelicaClassInstance(entryResId, qualifiedParentName, options);
              scopeParts.pop();
            }
          }
          if (
            !baseInstance &&
            (child.name === "Modelica.Icons.Package" ||
              child.name === "Icons.Package" ||
              child.name.endsWith(".Icons.Package") ||
              child.name.endsWith(".Package") ||
              child.name === "Package")
          ) {
            baseInstance = createPredefinedPackageInstance(child.name.split(".").pop() || "Package");
          }
          if (baseInstance) {
            let effectiveBaseInstance: WorkspaceClassInstance = baseInstance;
            if (db.query && child.id != null) {
              try {
                const extMods = db.query("extendsModificationParsed", child.id) as
                  | {
                      args?: Array<{
                        name?: string;
                        isRedeclaration?: boolean;
                        redeclaredKind?: string;
                        redeclaredTypeSpecifier?: string;
                      }>;
                    }
                  | null
                  | undefined;
                const redeclares = new Map<string, string>();
                for (const arg of extMods?.args ?? []) {
                  if (
                    arg?.isRedeclaration &&
                    arg.name &&
                    arg.redeclaredTypeSpecifier &&
                    arg.redeclaredKind !== "class"
                  ) {
                    redeclares.set(arg.name, arg.redeclaredTypeSpecifier);
                  }
                }
                if (redeclares.size > 0) {
                  const wrapRedeclared = (
                    inst: WorkspaceClassInstance,
                    visited = new Set<object>(),
                  ): WorkspaceClassInstance => {
                    if (!inst || typeof inst !== "object" || visited.has(inst)) return inst;
                    visited.add(inst);
                    const wrappedComponents = (inst.components ?? []).map((comp: WorkspaceComponentInstance) => {
                      const overrideType = comp?.name ? redeclares.get(comp.name) : undefined;
                      if (!overrideType) return comp;
                      let resolvedOverride: WorkspaceClassInstance | null | undefined = undefined;
                      const resolveOverrideInstance = () =>
                        host.resolveModelicaClassInstance(entryResId, overrideType, options);
                      return {
                        ...comp,
                        typeSpecifier: overrideType,
                        get classInstance() {
                          if (resolvedOverride === undefined) {
                            resolvedOverride = resolveOverrideInstance();
                          }
                          return resolvedOverride;
                        },
                        annotation: (annName: string) =>
                          typeof comp.annotation === "function" ? comp.annotation(annName) : null,
                      };
                    });
                    const wrappedExtends = (inst.extendsClassInstances ?? []).map((ext: WorkspaceExtendsInstance) => ({
                      ...ext,
                      classInstance: ext?.classInstance
                        ? wrapRedeclared(ext.classInstance, visited)
                        : ext?.classInstance,
                    }));
                    return {
                      ...inst,
                      components: wrappedComponents,
                      extendsClassInstances: wrappedExtends,
                      annotation: (annName: string, compCtx?: AnnotationEvalContext | string) =>
                        typeof inst.annotation === "function" ? inst.annotation(annName, compCtx) : null,
                    };
                  };
                  effectiveBaseInstance = wrapRedeclared(baseInstance);
                }
              } catch {
                // Redeclaration wrapping failed; keep baseInstance unmodified.
              }
            }
            extendsClassInstances.push({ name: child.name, classInstance: effectiveBaseInstance });
          }
        }
      } else if (
        child.kind === "ConnectEquation" ||
        child.ruleName === "ConnectEquation" ||
        child.ruleName === "connect_equation"
      ) {
        const childMeta = child.metadata as Record<string, unknown> | undefined;
        let lhsStr = (typeof childMeta?.["lhs"] === "string" ? childMeta["lhs"] : undefined) ?? child.name ?? "";
        let rhsStr = (typeof childMeta?.["rhs"] === "string" ? childMeta["rhs"] : undefined) ?? "";
        const connCst = ((db.cstNode ? db.cstNode(child.id) : null) ??
          host.getCstNodeForSymbol(child)) as DescendantCstNode | null;
        if ((!lhsStr || !rhsStr) && connCst) {
          try {
            // 1. CST-native resolution of connect equation endpoints
            const compRefs: DescendantCstNode[] = [];
            const collectCompRefs = (node: DescendantCstNode | null | undefined) => {
              if (!node) return;
              if (node.type === "component_reference" || node.type === "ComponentReference") {
                compRefs.push(node);
                return;
              }
              for (const c of node.children || []) {
                collectCompRefs(c);
              }
            };
            collectCompRefs(connCst);
            if (compRefs.length >= 2) {
              lhsStr = compRefs[0]?.text?.trim() ?? lhsStr;
              rhsStr = compRefs[1]?.text?.trim() ?? rhsStr;
            } else if (connCst.lhs && connCst.rhs) {
              lhsStr = (typeof connCst.lhs === "string" ? connCst.lhs : connCst.lhs.text)?.trim() ?? lhsStr;
              rhsStr = (typeof connCst.rhs === "string" ? connCst.rhs : connCst.rhs.text)?.trim() ?? rhsStr;
            }
          } catch {
            // CST endpoint traversal failed; fall back to text-based connect(...) extraction below.
          }

          // 2. Degraded text-based fallback only if CST lacked endpoints
          if (!lhsStr || !rhsStr) {
            try {
              const cstText = connCst.text ?? "";
              const cIdx = cstText.indexOf("connect");
              const openIdx = cIdx !== -1 ? skipWs(cstText, cIdx + 7) : -1;
              if (cIdx !== -1 && cstText[openIdx] === "(") {
                const start = openIdx + 1;
                const closeIdx = cstText.lastIndexOf(")");
                if (closeIdx > start) {
                  const inner = cstText.slice(start, closeIdx);
                  const commaIdx = inner.indexOf(",");
                  if (commaIdx !== -1) {
                    lhsStr = inner.slice(0, commaIdx).trim();
                    rhsStr = inner.slice(commaIdx + 1).trim();
                  }
                }
              }
            } catch {
              // ignore
            }
          }
        }
        if (lhsStr && rhsStr) {
          const targetEquationNode =
            connCst?.parent && (connCst.parent.type === "some_equation" || connCst.parent.type === "SomeEquation")
              ? connCst.parent
              : connCst;
          const connAnnCache = new Map<string, unknown>();
          connectEquations.push({
            lhs: lhsStr,
            rhs: rhsStr,
            componentReference1: {
              parts: lhsStr.split(".").map((id: string) => ({ identifier: { text: id } })),
            },
            componentReference2: {
              parts: rhsStr.split(".").map((id: string) => ({ identifier: { text: id } })),
            },
            cstNode: targetEquationNode,
            ast: targetEquationNode,
            annotation: (annName: string): unknown => {
              if (connAnnCache.has(annName)) {
                return connAnnCache.get(annName);
              }
              try {
                const evaluatorClass = resolveEvaluatorClass();
                if (targetEquationNode && evaluatorClass) {
                  const evaluator = new evaluatorClass(classInstance);
                  const res = evaluator.evaluate(targetEquationNode, annName);
                  connAnnCache.set(annName, res);
                  return res;
                }
              } catch {
                // Connect annotation evaluation failed; cache null so edge renders with default routing.
              }
              connAnnCache.set(annName, null);
              return null;
            },
          });
        }
      }
    }

    const classCstNode = (db.cstNode ? db.cstNode(entry.id) : null) ?? host.getCstNodeForSymbol(entry);
    const entryMeta = entry.metadata as Record<string, unknown> | undefined;
    const resolvedClassKind =
      typeof entryMeta?.["classKind"] === "string"
        ? entryMeta["classKind"]
        : typeof entryMeta?.["classPrefixes"] === "string"
          ? entryMeta["classPrefixes"]
          : "class";
    const resolvedDescription = typeof entryMeta?.["description"] === "string" ? entryMeta["description"] : null;

    classInstance = {
      id: entry.id,
      db,
      entry,
      cstNode: classCstNode,
      abstractSyntaxNode: classCstNode,
      name: entry.name ?? "",
      kind: entry.kind ?? "Class",
      classKind: resolvedClassKind,
      compositeName,
      description: resolvedDescription,
      isClassInstance: true,
      _iconOnly: Boolean(options?.iconOnly),
      components,
      connectEquations,
      extendsClassInstances,
      resolveName: (parts: string[] | string): WorkspaceComponentInstance | null => {
        const partsArray = Array.isArray(parts) ? parts : typeof parts === "string" ? parts.split(".") : [];
        if (partsArray.length === 0) return null;
        const target = partsArray[0];
        const found = components.find((c) => c.name === target);
        if (found) return found;
        for (const ext of extendsClassInstances) {
          const extFound = ext.classInstance?.resolveName?.(partsArray);
          if (extFound) return extFound;
        }
        return null;
      },
      annotation: (() => {
        const ctxAnnCache = new WeakMap<object, Map<string, unknown>>();
        return (name: string, rawCtx?: AnnotationEvalContext | string): unknown => {
          const _ctx: AnnotationEvalContext | undefined =
            typeof rawCtx === "object" && rawCtx !== null ? rawCtx : undefined;
          if (!annotationCache.has(entry.id)) {
            annotationCache.set(entry.id, new Map());
          }
          const classAnnCache = annotationCache.get(entry.id)!;

          const hasCtxInstance = Boolean(
            _ctx && (_ctx.classInstance !== undefined || _ctx.declaration || _ctx.modification || _ctx.cstNode),
          );
          let ctxMap: Map<string, unknown> | undefined;
          if (hasCtxInstance && _ctx) {
            ctxMap = ctxAnnCache.get(_ctx);
            if (ctxMap && ctxMap.has(name)) {
              return ctxMap.get(name);
            }
          }

          const cacheKey = `${name}${_ctx?.ownOnly ? ":own" : ""}`;
          if (!hasCtxInstance && classAnnCache.has(cacheKey)) {
            return classAnnCache.get(cacheKey);
          }

          const setCache = (val: unknown): unknown => {
            if (hasCtxInstance && _ctx) {
              if (!ctxMap) {
                ctxMap = new Map();
                ctxAnnCache.set(_ctx, ctxMap);
              }
              ctxMap.set(name, val);
            } else {
              classAnnCache.set(cacheKey, val);
            }
            return val;
          };

          const cstNode: unknown =
            classCstNode ?? (db.cstNode ? db.cstNode(entry.id) : null) ?? host.getCstNodeForSymbol(entry);

          try {
            if ((name === "Icon" || name === "Diagram") && (!hasCtxInstance || !cstNode) && db.query) {
              try {
                const qName = name === "Icon" ? "classIconGraphics" : "classDiagramGraphics";
                const salsaLayer = db.query(qName, entry.id);
                if (salsaLayer) {
                  return setCache(salsaLayer);
                }
              } catch {
                // fall through to metadata / evaluator
              }
            }

            if (!cstNode && entryMeta) {
              if (name === "Icon" && entryMeta["iconAnnotation"] != null) {
                return setCache(entryMeta["iconAnnotation"]);
              }
              if (name === "Diagram" && entryMeta["diagramAnnotation"] != null) {
                return setCache(entryMeta["diagramAnnotation"]);
              }
              if (name === "defaultComponentName" && entryMeta["defaultComponentName"] != null) {
                return setCache(entryMeta["defaultComponentName"]);
              }
            }

            if (cstNode) {
              const evaluatorClass = resolveEvaluatorClass(entry.resourceId || "");
              if (evaluatorClass) {
                const evalScope = hasCtxInstance ? { componentInstance: _ctx, classInstance } : classInstance;
                const evaluator = new evaluatorClass(evalScope);
                const evaluated = evaluator.evaluate(cstNode, name);
                if (evaluated) {
                  return setCache(evaluated);
                }
              }
            }

            // Fall back to inherited annotations from extends clauses unless caller requested own annotations only
            if (!_ctx?.ownOnly) {
              for (const ext of extendsClassInstances) {
                const inherited = ext.classInstance?.annotation?.(name, _ctx);
                if (inherited) {
                  return setCache(inherited);
                }
              }
            }

            return setCache(null);
          } catch {
            return setCache(null);
          }
        };
      })(),
    };

    for (const comp of components) {
      comp.parent = classInstance;
    }

    if (entry?.id != null) {
      adapterByEntryId.set(entry.id, classInstance);
    }

    return classInstance;
  };

  if (className) {
    const uwObj: unknown = host.unifiedWorkspace;
    const uwIndexed =
      uwObj && typeof uwObj === "object"
        ? (uwObj as {
            ensureFQNIndexed?: (fqn: string) => void;
            ensureChildrenIndexed?: (fqn: string) => void;
            getQueryEngine?: (lang: string) => QueryEngine | null | undefined;
          })
        : undefined;
    if (className.includes("Icons")) {
      uwIndexed?.ensureFQNIndexed?.("Modelica.Icons");
      uwIndexed?.ensureFQNIndexed?.("Icons");
      uwIndexed?.ensureChildrenIndexed?.("Modelica");
    }
    if (typeof uwIndexed?.ensureFQNIndexed === "function") {
      uwIndexed.ensureFQNIndexed(className);
    }
    if (typeof uwIndexed?.ensureChildrenIndexed === "function") {
      uwIndexed.ensureChildrenIndexed(className);
    }

    const idx = host.unifiedWorkspace.getIndex();
    const rawSymbolIds = idx.byName.get(className) || [];
    // Prefer actual Class/Def symbols over Extends or Import references
    let symbolIds = rawSymbolIds.filter((id: number) => {
      const e = idx.symbols.get(id);
      return isClassLikeSymbol(e);
    });

    // Try multi-part resolution for fully qualified names ("A.B.C")
    if (symbolIds.length === 0 && className.includes(".")) {
      const parts = className.split(".");

      // 1. Try resolving starting from longest matched prefix in byName (e.g. "Modelica.Icons" -> "Package")
      for (let prefixLen = parts.length - 1; prefixLen >= 1 && symbolIds.length === 0; prefixLen--) {
        const prefix = parts.slice(0, prefixLen).join(".");
        let currentIds = (idx.byName.get(prefix) || []).filter((id: number) => {
          const e = idx.symbols.get(id);
          return isClassLikeSymbol(e);
        });
        if (currentIds.length === 0) continue;

        for (let i = prefixLen; i < parts.length && currentIds.length > 0; i++) {
          const part = parts[i];
          const nextIds: number[] = [];
          for (const parentId of currentIds) {
            const children = idx.childrenOf.get(parentId);
            if (children) {
              for (const childId of children) {
                const childEntry = idx.symbols.get(childId);
                if (childEntry && childEntry.name === part && isClassLikeSymbol(childEntry)) {
                  nextIds.push(childId);
                }
              }
            }
          }
          currentIds = nextIds;
        }
        if (currentIds.length > 0) {
          symbolIds = currentIds;
          break;
        }
      }

      // 2. Fall back to part-by-part traversal from each segment
      if (symbolIds.length === 0) {
        for (let startIdx = 0; startIdx < parts.length && symbolIds.length === 0; startIdx++) {
          let currentIds = (idx.byName.get(parts[startIdx]!) || []).filter((id: number) => {
            const e = idx.symbols.get(id);
            return isClassLikeSymbol(e);
          });
          if (currentIds.length === 0) continue;
          for (let i = startIdx + 1; i < parts.length && currentIds.length > 0; i++) {
            const part = parts[i];
            const nextIds: number[] = [];
            for (const parentId of currentIds) {
              const children = idx.childrenOf.get(parentId);
              if (children) {
                for (const childId of children) {
                  const childEntry = idx.symbols.get(childId);
                  if (childEntry && childEntry.name === part && isClassLikeSymbol(childEntry)) {
                    nextIds.push(childId);
                  }
                }
              }
            }
            currentIds = nextIds;
          }
          if (currentIds.length > 0) {
            symbolIds = currentIds;
            break;
          }
        }
      }
    }

    // If still not found, try matching by composite name
    if (symbolIds.length === 0) {
      let bestMatchLen = 0;
      let bestMatchId: number | null = null;
      for (const [id, e] of idx.symbols) {
        if (isClassLikeSymbol(e) && e.name === className.split(".").pop()) {
          const fqn = getCompositeName(e, idx);
          if (fqn === className) {
            bestMatchId = id;
            bestMatchLen = fqn.length;
            break;
          } else if (fqn.endsWith(`.${className}`) || className.endsWith(`.${fqn}`)) {
            if (fqn.length > bestMatchLen) {
              bestMatchLen = fqn.length;
              bestMatchId = id;
            }
          }
        }
      }
      if (bestMatchId != null) {
        symbolIds = [bestMatchId];
      }
    }

    const fallbackDb: AdapterDb = {
      childrenOf: (id: number) => {
        const childIds = idx.childrenOf.get(id) || [];
        return childIds.map((cid: number) => idx.symbols.get(cid)).filter((e): e is SymbolEntry => Boolean(e));
      },
      symbol: (id: number) => idx.symbols.get(id) || null,
      query: (_name: string, _id: number) => null,
      cstNode: (id: number) => host.getCstNodeForSymbol(idx.symbols.get(id)),
    };

    const targetId = symbolIds[0];
    if (targetId == null) return null;
    const entry = idx.symbols.get(targetId);
    if (entry && entry.resourceId) {
      let engine =
        entry.resourceId.endsWith(".sysml") || entry.resourceId.endsWith(".sysml2")
          ? (host.globalSysML2QueryEngine ?? uwIndexed?.getQueryEngine?.("sysml2"))
          : (host.globalModelicaQueryEngine ?? uwIndexed?.getQueryEngine?.("modelica"));
      if (!engine) {
        engine = host.globalModelicaQueryEngine ?? uwIndexed?.getQueryEngine?.("modelica");
      }
      const db: AdapterDb = {
        childrenOf: (id: number) => {
          const res = engine ? engine.toQueryDB().childrenOf(id) : [];
          if (res && res.length > 0) return res;
          return fallbackDb.childrenOf!(id);
        },
        symbol: (id: number) => (engine ? engine.toQueryDB().symbol(id) : null) ?? fallbackDb.symbol!(id),
        query: (name: string, id: number) => (engine ? engine.toQueryDB().query?.(name, id) : null),
        cstNode: (id: number) => (engine ? engine.toQueryDB().cstNode?.(id) : null) ?? fallbackDb.cstNode!(id),
      };
      const inst = buildAdapter(entry, db, className);
      if (inst && entry.resourceId) {
        const existing: WorkspaceClassInstance[] = host.documentInstances.get(entry.resourceId) ?? [];
        const existingIdx = existing.findIndex((x: WorkspaceClassInstance) => x.id === inst.id);
        if (existingIdx >= 0) {
          if (!inst._iconOnly || existing[existingIdx]?._iconOnly) {
            existing[existingIdx] = inst;
          }
        } else {
          existing.push(inst);
        }
        host.documentInstances.set(entry.resourceId, existing);
      }
      return inst;
    }
    return null;
  }

  const idx = host.unifiedWorkspace.getIndex();
  const fallbackDb: AdapterDb = {
    childrenOf: (id: number) => {
      const childIds = idx.childrenOf.get(id) || [];
      return childIds.map((cid: number) => idx.symbols.get(cid)).filter((e): e is SymbolEntry => Boolean(e));
    },
    symbol: (id: number) => idx.symbols.get(id) || null,
    query: (_name: string, _id: number) => null,
    cstNode: (id: number) => host.getCstNodeForSymbol(idx.symbols.get(id)),
  };

  const normUri = (u: string) => u.replace(/^([a-z0-9+-]+):\/{1,3}/i, "$1:///");
  const targetNorm = normUri(uri);
  for (const entry of idx.symbols.values()) {
    if (
      (entry.resourceId === uri || (entry.resourceId && normUri(entry.resourceId) === targetNorm)) &&
      isClassLikeSymbol(entry) &&
      entry.parentId === null
    ) {
      let engine =
        entry.resourceId.endsWith(".sysml") || entry.resourceId.endsWith(".sysml2")
          ? host.globalSysML2QueryEngine
          : host.globalModelicaQueryEngine;
      if (!engine) engine = host.globalModelicaQueryEngine;
      const db: AdapterDb = {
        childrenOf: (id: number) => {
          const res = engine ? engine.toQueryDB().childrenOf(id) : [];
          if (res && res.length > 0) return res;
          return fallbackDb.childrenOf!(id);
        },
        symbol: (id: number) => (engine ? engine.toQueryDB().symbol(id) : null) ?? fallbackDb.symbol!(id),
        query: (name: string, id: number) => (engine ? engine.toQueryDB().query?.(name, id) : null),
        cstNode: (id: number) => (engine ? engine.toQueryDB().cstNode?.(id) : null) ?? fallbackDb.cstNode!(id),
      };
      const inst = buildAdapter(entry, db, entry.name ?? "");
      if (inst) {
        const existing: WorkspaceClassInstance[] = host.documentInstances.get(uri) ?? [];
        const existingIdx = existing.findIndex((x: WorkspaceClassInstance) => x.id === inst.id);
        if (existingIdx >= 0) {
          if (!inst._iconOnly || existing[existingIdx]?._iconOnly) {
            existing[existingIdx] = inst;
          }
        } else {
          existing.push(inst);
        }
        host.documentInstances.set(uri, existing);
      }
      return inst;
    }
  }

  return null;
}
