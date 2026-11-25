// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  deduplicateAndSort,
  type ComponentPropertyData,
  type DiagramApplyEditsParams,
  type DiagramApplyEditsResult,
  type DiagramBackend,
  type DiagramData,
  type DiagramDrillDownParams,
  type DiagramDrillDownResult,
  type DiagramGetComponentPropertiesParams,
  type DiagramGetDataParams,
  type EdgeUpdate,
  type PlacementItem,
  type DiagramTextEdit as TextEdit,
} from "@modelscript/diagram/protocol";
import type { SymbolIndex } from "@modelscript/runtime";
import { applyIconEditActions, type IconEditAction, type IconPrimitiveSpec } from "./icon-annotation-edits.js";
import { maskModelicaCommentsAndStrings as maskComments, type ScannedClassLayout } from "./scanner.js";
import type { ModelicaClassInstance } from "./types.js";

function isSimpleIdentifier(s: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(s);
}

export interface ModelicaIconCoordLike {
  extent?: [[number, number], [number, number]] | undefined;
  initialScale?: number | undefined;
}

export interface ModelicaCrossLanguageDropResolution {
  className: string;
  baseName: string;
  importPath?: string | undefined;
  stubBlock?: string | undefined;
  stubName?: string | undefined;
}

export interface ModelicaCrossLanguageDropParams {
  docText: string;
  uri: string;
  rawClassName: string;
  x: number;
  y: number;
  classInstance: ModelicaClassInstance | null | undefined;
  computeComponentInsert?:
    | ((
        ci: ModelicaClassInstance,
        className: string,
        compName: string,
        x: number,
        y: number,
        docText: string,
        componentIconCoord?: ModelicaIconCoordLike | null,
      ) => TextEdit[])
    | undefined;
  unifiedIndex?: SymbolIndex | null | undefined;
  instanceName?: string | undefined;
  componentIconCoord?: ModelicaIconCoordLike | null | undefined;
  getResourceText?: ((uri: string) => string | undefined) | undefined;
}

export interface ModelicaCrossLanguageDropOps {
  resolveCrossLanguageComponentDrop?:
    | ((
        index: SymbolIndex | null | undefined,
        rawClassName: string,
        targetLang: "modelica" | "sysml2",
        docText?: string,
      ) => ModelicaCrossLanguageDropResolution)
    | undefined;
  computeModelicaComponentDropEdits?: ((opts: ModelicaCrossLanguageDropParams) => TextEdit[]) | undefined;
}

interface ModelicaDiagramOps {
  buildDiagramData?: (
    classInstance: ModelicaClassInstance,
    diagramType?: string,
  ) => Promise<DiagramData | null> | DiagramData | null;
  buildComponentProperties?: (
    classInstance: ModelicaClassInstance,
    componentName: string,
  ) => ComponentPropertyData | null;
  buildFallbackClassInstance?: (docText: string, targetClassName?: string) => ModelicaClassInstance | null;
  computeMinimalNonOverlappingEdits?: (oldText: string, newText: string) => TextEdit[];
  maskModelicaCommentsAndStrings?: (text: string) => string;
  scanModelicaClassLayout?: (
    docText: string,
    targetClassName?: string,
    hintStartLine?: number,
  ) => ScannedClassLayout | null;
  deduplicateAndSort?: (edits: TextEdit[]) => TextEdit[];
  computePlacementEdits?: (
    docText: string,
    classInstance: ModelicaClassInstance,
    items: (PlacementItem & { isIconLayer?: boolean })[],
  ) => TextEdit[];
  computeEdgePointEdits?: (lines: string[], classInstance: ModelicaClassInstance, edges: EdgeUpdate[]) => TextEdit[];
  computeConnectInsert?: (
    docText: string,
    classInstance: ModelicaClassInstance,
    source: string,
    target: string,
    points?: { x: number; y: number }[],
    color?: [number, number, number],
  ) => TextEdit[];
  computeConnectRemove?: (
    docText: string,
    classInstance: ModelicaClassInstance,
    source: string,
    target: string,
  ) => TextEdit[];
  computeComponentInsert?: (
    classInstance: ModelicaClassInstance,
    className: string,
    componentName: string,
    x: number,
    y: number,
    docText: string,
    componentIconCoord?: ModelicaIconCoordLike | null,
  ) => TextEdit[];
  computeComponentsDelete?: (docText: string, classInstance: ModelicaClassInstance, names: string[]) => TextEdit[];
  computeNameEdit?: (
    classInstance: ModelicaClassInstance,
    oldName: string,
    newName: string,
    docText?: string,
  ) => TextEdit[];
  computeDescriptionEdit?: (
    docText: string,
    classInstance: ModelicaClassInstance,
    componentName: string,
    newDescription: string,
  ) => TextEdit[];
  computeParameterEdit?: (
    classInstance: ModelicaClassInstance,
    componentName: string,
    parameterName: string,
    newValue: string,
    docText?: string,
  ) => TextEdit[];
  healStrandedClassAnnotationsInText?: (docText: string, targetClassName?: string) => string;
}

function getModelicaDiagramOps(): ModelicaDiagramOps {
  return (globalThis as { modelicaDiagramOps?: ModelicaDiagramOps }).modelicaDiagramOps ?? {};
}

export interface ModelicaBackendDeps {
  getDocumentInstances: (uri: string) => ModelicaClassInstance[] | undefined;
  getDocumentText: (uri: string) => string | undefined;

  resolveClassInstance: (uri: string, className?: string) => ModelicaClassInstance | null;
  flushValidation: (uri: string) => Promise<void>;
  isDocumentStale?: ((uri: string) => boolean) | undefined;
  getUnifiedIndex?: (() => SymbolIndex | null | undefined) | undefined;
  crossLanguageDrop?: ModelicaCrossLanguageDropOps | undefined;
}

export class ModelicaDiagramBackend implements DiagramBackend {
  constructor(private readonly deps: ModelicaBackendDeps) {}

  async getData(params: DiagramGetDataParams): Promise<DiagramData | null> {
    const classInstance = this.deps.resolveClassInstance(params.uri, params.className);
    if (!classInstance) return null;

    try {
      const ops = getModelicaDiagramOps();
      return ops.buildDiagramData ? await ops.buildDiagramData(classInstance, params.diagramType) : null;
    } catch (e: unknown) {
      console.error(`[diagram] Error building diagram data: ${e}`);
      return null;
    }
  }

  getComponentProperties(params: DiagramGetComponentPropertiesParams): ComponentPropertyData | null {
    const classInstance = this.deps.resolveClassInstance(params.uri, params.className);
    if (!classInstance) return null;

    try {
      const ops = getModelicaDiagramOps();
      return ops.buildComponentProperties ? ops.buildComponentProperties(classInstance, params.componentName) : null;
    } catch (e: unknown) {
      console.error(`[diagram] Error building component properties: ${e}`);
      return null;
    }
  }

  private resolveTargetInstance(
    uri: string,
    className: string | undefined,
    instances: ModelicaClassInstance[] | undefined,
    docText: string,
  ): ModelicaClassInstance | null {
    if (className) {
      const simpleName = className.split(".").pop()!;
      const matched =
        instances?.find(
          (inst) =>
            inst?.compositeName === className ||
            inst?.name === className ||
            inst?.compositeName?.endsWith(`.${className}`) ||
            inst?.name === simpleName,
        ) ?? this.deps.resolveClassInstance(uri, className);
      if (matched) return matched;
    }

    const primary = instances?.[0] ?? this.deps.resolveClassInstance(uri);
    if (primary) return primary;

    const ops = getModelicaDiagramOps();
    if (typeof ops.buildFallbackClassInstance === "function") {
      return ops.buildFallbackClassInstance(docText, className);
    }
    return null;
  }

  async applyEdits(params: DiagramApplyEditsParams): Promise<DiagramApplyEditsResult> {
    let instances = this.deps.getDocumentInstances(params.uri);
    let docText = this.deps.getDocumentText(params.uri);

    // Flush validation synchronously if instances are not yet available or if the indexed CST is stale
    if (!instances?.[0] || !docText || this.deps.isDocumentStale?.(params.uri)) {
      await this.deps.flushValidation(params.uri);
      instances = this.deps.getDocumentInstances(params.uri);
      docText = this.deps.getDocumentText(params.uri);
    }

    if (docText === undefined) {
      return { seq: params.seq, edits: [], renderHint: "none" };
    }

    const targetInstance = this.resolveTargetInstance(params.uri, params.className, instances, docText);
    if (!targetInstance) {
      const currentText = docText ?? "";
      const strippedText = maskComments(currentText).trim();
      const addActions = params.actions.filter((a) => a.type === "addComponent");
      if (strippedText.length === 0 && addActions.length > 0) {
        const cleanUri = params.uri.split(/[?#]/)[0] ?? "";
        const baseFile =
          cleanUri
            .split(/[/\\]/)
            .pop()
            ?.replace(/\.[^.]+$/, "") ?? "";
        const modelName = isSimpleIdentifier(baseFile) ? baseFile : "Model1";
        const unifiedIndex = this.deps.getUnifiedIndex?.() ?? null;
        const usedNames = new Set<string>();
        const importLines: string[] = [];
        const seenImports = new Set<string>();
        const stubBlocks: string[] = [];
        const seenStubs = new Set<string>();
        const declLines: string[] = [];
        for (const act of addActions) {
          if (act.type !== "addComponent") continue;
          const rawClass = act.className ?? "";
          if (
            !rawClass ||
            rawClass.startsWith("__LOADING__:") ||
            rawClass.startsWith("__ONTOLOGY__:") ||
            (rawClass.startsWith("__LIB__:") && !rawClass.includes("/") && !rawClass.includes("."))
          ) {
            continue;
          }
          const fallbackShort = rawClass.split(".").pop() || "comp";
          const resolved: ModelicaCrossLanguageDropResolution =
            this.deps.crossLanguageDrop?.resolveCrossLanguageComponentDrop?.(
              unifiedIndex,
              rawClass,
              "modelica",
              currentText,
            ) ?? {
              className: rawClass,
              baseName: fallbackShort.charAt(0).toLowerCase() + fallbackShort.slice(1),
            };
          if (resolved.importPath && !seenImports.has(resolved.importPath)) {
            seenImports.add(resolved.importPath);
            importLines.push(`  import ${resolved.importPath};`);
          }
          if (resolved.stubBlock && resolved.stubName && !seenStubs.has(resolved.stubName)) {
            seenStubs.add(resolved.stubName);
            const indentedStub = resolved.stubBlock
              .split("\n")
              .map((l: string) => (l.trim().length > 0 ? `  ${l}` : ""))
              .join("\n");
            stubBlocks.push(indentedStub);
          }
          const baseName =
            (resolved.baseName || resolved.className.split(".").pop() || "comp").replace(/[^A-Za-z0-9_]/g, "") ||
            "comp";
          let uniqueName = act.name || `${baseName}1`;
          let idx = 1;
          if (!act.name) {
            while (usedNames.has(uniqueName)) {
              idx++;
              uniqueName = `${baseName}${idx}`;
            }
          }
          usedNames.add(uniqueName);
          const ox = Math.round(act.x ?? 0);
          const oy = -Math.round(act.y ?? 0);
          declLines.push(
            `  ${resolved.className} ${uniqueName} annotation(Placement(transformation(origin={${ox},${oy}}, extent={{-10,-10},{10,10}})));`,
          );
        }
        if (declLines.length > 0) {
          const lines = currentText.split("\n");
          const endLine = Math.max(0, lines.length - 1);
          const endChar = lines[endLine]?.length ?? 0;
          const prefix = currentText.length > 0 && !currentText.endsWith("\n") ? `${currentText}\n` : currentText;
          const sections = [...importLines, ...stubBlocks, ...declLines];
          const newText = `${prefix}model ${modelName}\n${sections.join("\n")}\nend ${modelName};\n`;
          return {
            seq: params.seq,
            edits: [
              {
                range: {
                  start: { line: 0, character: 0 },
                  end: { line: endLine, character: endChar },
                },
                newText,
              },
            ],
            renderHint: "immediate",
          };
        }
      }
      return { seq: params.seq, edits: [], renderHint: "none" };
    }

    const iconActions: IconEditAction[] = [];
    const remainingActions: DiagramApplyEditsParams["actions"] = [];
    for (const act of params.actions) {
      if (act.type === "addIconPrimitive") {
        iconActions.push({ type: "addIconPrimitive", primitive: act.primitive as unknown as IconPrimitiveSpec });
      } else if (act.type === "updateIconPrimitive") {
        iconActions.push({
          type: "updateIconPrimitive",
          index: act.index,
          patch: act.patch as Partial<IconPrimitiveSpec>,
        });
      } else if (act.type === "deleteIconPrimitive") {
        iconActions.push({ type: "deleteIconPrimitive", index: act.index });
      } else if (act.type === "reorderIconPrimitive") {
        iconActions.push({ type: "reorderIconPrimitive", fromIndex: act.fromIndex, toIndex: act.toIndex });
      } else if (act.type === "move") {
        const normalItems = [];
        for (const item of act.items) {
          const m = /^__icon_gfx_(\d+)$/.exec(item.name);
          if (m) {
            const idx = Number(m[1]);
            const x1 = item.x;
            const y2 = -item.y;
            const x2 = item.x + item.width;
            const y1 = -(item.y + item.height);
            iconActions.push({
              type: "updateIconPrimitive",
              index: idx,
              patch: {
                extent: [
                  [x1, y1],
                  [x2, y2],
                ],
                ...(typeof item.rotation === "number" ? { rotation: -item.rotation } : {}),
              },
            });
          } else {
            normalItems.push(item);
          }
        }
        if (normalItems.length > 0) remainingActions.push({ ...act, items: normalItems });
      } else if (act.type === "resize") {
        const m = /^__icon_gfx_(\d+)$/.exec(act.item.name);
        if (m) {
          const idx = Number(m[1]);
          iconActions.push({
            type: "updateIconPrimitive",
            index: idx,
            patch: {
              extent: [
                [act.item.x, -(act.item.y + act.item.height)],
                [act.item.x + act.item.width, -act.item.y],
              ],
              ...(typeof act.item.rotation === "number" ? { rotation: -act.item.rotation } : {}),
            },
          });
        } else {
          remainingActions.push(act);
        }
      } else if (act.type === "deleteComponents") {
        const gfxIndices: number[] = [];
        const normalNames: string[] = [];
        for (const n of act.names) {
          const m = /^__icon_gfx_(\d+)$/.exec(n);
          if (m) gfxIndices.push(Number(m[1]));
          else normalNames.push(n);
        }
        gfxIndices.sort((a, b) => b - a);
        for (const idx of gfxIndices) {
          iconActions.push({ type: "deleteIconPrimitive", index: idx });
        }
        if (normalNames.length > 0) remainingActions.push({ ...act, names: normalNames });
      } else {
        remainingActions.push(act);
      }
    }

    const needsUnifiedIndex = params.actions.some((a) => a.type === "addComponent");

    if (iconActions.length > 0) {
      const workingText = applyIconEditActions(docText, targetInstance.name ?? params.className ?? "", iconActions);
      const ops = getModelicaDiagramOps();
      if (remainingActions.length === 0) {
        if (workingText !== docText) {
          const lines = docText.split("\n");
          return {
            seq: params.seq,
            edits: [
              {
                range: {
                  start: { line: 0, character: 0 },
                  end: { line: lines.length - 1, character: lines[lines.length - 1]?.length ?? 0 },
                },
                newText: workingText,
              },
            ],
            renderHint: "immediate",
          };
        }
        return { seq: params.seq, edits: [], renderHint: "none" };
      }

      // Mixed batch: apply remaining non-icon edits on top of the updated icon text
      const updatedTarget =
        (typeof ops.buildFallbackClassInstance === "function"
          ? ops.buildFallbackClassInstance(workingText, targetInstance.name)
          : null) ?? targetInstance;
      const effectiveParams: DiagramApplyEditsParams = { ...params, actions: remainingActions };
      const unifiedIndex = needsUnifiedIndex ? (this.deps.getUnifiedIndex?.() ?? null) : null;
      const dropIconOptions = {
        crossLanguageDrop: this.deps.crossLanguageDrop,
        getResourceText: this.deps.getDocumentText,
        resolveComponentIconCoord: (clsName: string): ModelicaIconCoordLike | null =>
          (
            this.deps.resolveClassInstance?.(params.uri, clsName)?.annotation?.("Icon") as
              { coordinateSystem?: ModelicaIconCoordLike | null | undefined } | null | undefined
          )?.coordinateSystem ?? null,
      };
      const remResult = processDiagramEditBatch(
        effectiveParams,
        updatedTarget,
        workingText,
        unifiedIndex,
        dropIconOptions,
      );
      const finalText = remResult.edits.length > 0 ? applyTextEditsInMemory(workingText, remResult.edits) : workingText;
      if (finalText !== docText) {
        const lines = docText.split("\n");
        const edits =
          typeof ops.computeMinimalNonOverlappingEdits === "function"
            ? ops.computeMinimalNonOverlappingEdits(docText, finalText)
            : [
                {
                  range: {
                    start: { line: 0, character: 0 },
                    end: { line: lines.length - 1, character: lines[lines.length - 1]?.length ?? 0 },
                  },
                  newText: finalText,
                },
              ];
        return { seq: params.seq, edits, renderHint: "immediate" };
      }
      return { seq: params.seq, edits: [], renderHint: "none" };
    }

    const effectiveParams =
      remainingActions.length !== params.actions.length ? { ...params, actions: remainingActions } : params;
    const unifiedIndex = needsUnifiedIndex ? (this.deps.getUnifiedIndex?.() ?? null) : null;
    const dropIconOptions = {
      crossLanguageDrop: this.deps.crossLanguageDrop,
      getResourceText: this.deps.getDocumentText,
      resolveComponentIconCoord: (clsName: string): ModelicaIconCoordLike | null =>
        (
          this.deps.resolveClassInstance?.(params.uri, clsName)?.annotation?.("Icon") as
            { coordinateSystem?: ModelicaIconCoordLike | null | undefined } | null | undefined
        )?.coordinateSystem ?? null,
    };
    let result = processDiagramEditBatch(effectiveParams, targetInstance, docText, unifiedIndex, dropIconOptions);

    // If no edits could be produced (e.g. stale AST where component ranges no longer match),
    // flush validation once to synchronize AST and retry.
    if (
      result.edits.length === 0 &&
      effectiveParams.actions.some(
        (a) =>
          a.type === "move" ||
          a.type === "resize" ||
          a.type === "rotate" ||
          a.type === "moveEdge" ||
          a.type === "updateParameter" ||
          a.type === "updateProperty" ||
          a.type === "updateName" ||
          a.type === "updateDescription",
      )
    ) {
      await this.deps.flushValidation(params.uri);
      const freshInstances = this.deps.getDocumentInstances(params.uri);
      const freshDocText = this.deps.getDocumentText(params.uri);
      if (freshDocText) {
        const freshTarget = this.resolveTargetInstance(params.uri, params.className, freshInstances, freshDocText);
        if (freshTarget) {
          result = processDiagramEditBatch(effectiveParams, freshTarget, freshDocText, unifiedIndex, dropIconOptions);
        }
      }
    }

    return result;
  }

  async drillDown(params: DiagramDrillDownParams): Promise<DiagramDrillDownResult | null> {
    const targetName = params.className || params.componentName;
    if (!targetName) return null;
    const classInstance = this.deps.resolveClassInstance(params.uri, targetName);
    if (!classInstance) return null;
    const ops = getModelicaDiagramOps();
    const childData = ops.buildDiagramData ? await ops.buildDiagramData(classInstance) : null;
    return {
      targetUri: params.uri,
      targetClassName: targetName,
      breadcrumbs: [
        { id: "root", label: "Root", uri: params.uri },
        { id: params.nodeId || targetName, label: targetName, uri: params.uri },
      ],
      data: childData ?? null,
    };
  }
}

function applyTextEditsInMemory(baseText: string, edits: TextEdit[]): string {
  if (edits.length === 0) return baseText;

  const lineStarts = [0];
  for (let i = 0; i < baseText.length; i++) {
    if (baseText[i] === "\n") lineStarts.push(i + 1);
  }
  const toOffset = (line: number, character: number): number => {
    if (line < 0) return 0;
    if (line >= lineStarts.length) return baseText.length;
    return Math.min(baseText.length, lineStarts[line]! + Math.max(0, character));
  };

  const indexed = edits.map((edit, idx) => ({
    idx,
    start: toOffset(edit.range.start.line, edit.range.start.character),
    end: toOffset(edit.range.end.line, edit.range.end.character),
    newText: edit.newText,
  }));

  indexed.sort((a, b) => {
    if (a.start !== b.start) return b.start - a.start;
    if (a.end !== b.end) return b.end - a.end;
    return b.idx - a.idx;
  });

  let result = baseText;
  for (const item of indexed) {
    result = result.slice(0, item.start) + item.newText + result.slice(item.end);
  }
  return result;
}

function computeDelimiterImbalance(maskedText: string): { paren: number; brace: number; bracket: number } {
  let paren = 0;
  let brace = 0;
  let bracket = 0;
  for (let i = 0; i < maskedText.length; i++) {
    const ch = maskedText[i];
    if (ch === "(") paren++;
    else if (ch === ")") paren--;
    else if (ch === "{") brace++;
    else if (ch === "}") brace--;
    else if (ch === "[") bracket++;
    else if (ch === "]") bracket--;
  }
  return { paren, brace, bracket };
}

function validatePostEditBalance(
  beforeText: string,
  edits: TextEdit[],
  targetClassName: string | undefined,
  ops: ModelicaDiagramOps,
): boolean {
  if (edits.length === 0) return true;
  const afterText = applyTextEditsInMemory(beforeText, edits);
  const maskFn =
    typeof ops?.maskModelicaCommentsAndStrings === "function" ? ops.maskModelicaCommentsAndStrings : (s: string) => s;

  const beforeImp = computeDelimiterImbalance(maskFn(beforeText));
  const afterImp = computeDelimiterImbalance(maskFn(afterText));

  // Diagram-generated edits must never increase net delimiter imbalance
  if (
    Math.abs(afterImp.paren) > Math.abs(beforeImp.paren) ||
    Math.abs(afterImp.brace) > Math.abs(beforeImp.brace) ||
    Math.abs(afterImp.bracket) > Math.abs(beforeImp.bracket)
  ) {
    return false;
  }

  // If the enclosing class structure was scannable before, it must remain scannable after
  if (typeof ops?.scanModelicaClassLayout === "function") {
    const beforeLayout = ops.scanModelicaClassLayout(beforeText, targetClassName);
    if (beforeLayout) {
      const afterLayout = ops.scanModelicaClassLayout(afterText, beforeLayout.className);
      if (!afterLayout) return false;
    }
  }

  return true;
}

// ── Modelica Batch Processor ──

export function processDiagramEditBatch(
  request: DiagramApplyEditsParams,
  classInstance: ModelicaClassInstance | null | undefined,
  docText: string,
  unifiedIndex?: SymbolIndex | null | undefined,
  dropIconOptions?: {
    getResourceText?: ((uri: string) => string | undefined) | undefined;
    crossLanguageDrop?: ModelicaCrossLanguageDropOps | undefined;
    resolveComponentIconCoord?: ((className: string) => ModelicaIconCoordLike | null | undefined) | undefined;
  },
): DiagramApplyEditsResult {
  const ops = getModelicaDiagramOps();
  const sortFn: (edits: TextEdit[]) => TextEdit[] = ops.deduplicateAndSort ?? deduplicateAndSort;
  let needsRender: "none" | "immediate" | "debounced" = "none";
  const createdComponentNames = new Set<string>();

  const targetClassName: string | undefined =
    request.className || classInstance?.compositeName || classInstance?.name || undefined;

  // Preserve Diagram coordinateSystem metadata across lightweight fallback class refreshes
  const preservedDiagramAnnotation =
    typeof classInstance?.annotation === "function" ? classInstance.annotation("Diagram") : null;

  const attachPreservedDiagram = (
    inst: ModelicaClassInstance | null | undefined,
  ): ModelicaClassInstance | null | undefined => {
    if (!inst || !preservedDiagramAnnotation) return inst;
    const origAnnot = typeof inst.annotation === "function" ? inst.annotation.bind(inst) : null;
    if (origAnnot && origAnnot("Diagram")) return inst;
    return {
      ...inst,
      annotation: (key?: string) => {
        const own = origAnnot ? origAnnot(key) : null;
        if (own) return own;
        return key === "Diagram" ? preservedDiagramAnnotation : null;
      },
    };
  };

  let initialInstance: ModelicaClassInstance | null | undefined = classInstance;
  if (!initialInstance && typeof ops.buildFallbackClassInstance === "function") {
    initialInstance = ops.buildFallbackClassInstance(docText, targetClassName);
  }

  // Record renderHint across all requested actions
  for (const action of request.actions) {
    switch (action.type) {
      case "connect":
      case "disconnect":
      case "reconnect":
      case "addComponent":
      case "deleteComponents":
      case "resize":
        needsRender = "immediate";
        break;
      case "updateName":
      case "updateDescription":
        if (needsRender !== "immediate") needsRender = "debounced";
        break;
      case "updateParameter":
      case "updateProperty":
        if (needsRender === "none") needsRender = "debounced";
        break;
      default:
        break;
    }
  }

  // Expand `reconnect` into sequential `[disconnect, connect]` steps so removing the old
  // connection and inserting the new connection never emit conflicting edits or duplicate `equation`.
  type StepAction = Exclude<DiagramApplyEditsParams["actions"][number], { type: "reconnect" }>;
  const expandedActions: StepAction[] = [];
  for (const action of request.actions) {
    if (action.type === "reconnect") {
      expandedActions.push({
        type: "disconnect",
        source: action.oldSource,
        target: action.oldTarget,
      });
      expandedActions.push({
        type: "connect",
        source: action.newSource,
        target: action.newTarget,
        ...(action.points ? { points: action.points } : {}),
        ...(action.color ? { color: action.color } : {}),
      });
    } else {
      expandedActions.push(action);
    }
  }

  const runSingleAction = (
    action: StepAction,
    currentText: string,
    currentInstance: ModelicaClassInstance | null | undefined,
  ): TextEdit[] => {
    const execWithInstance = (ci: ModelicaClassInstance | null | undefined): TextEdit[] => {
      if (!ci) return [];
      switch (action.type) {
        case "move": {
          const isIconLayer = request.diagramType === "icon";
          const items = isIconLayer ? action.items.map((it) => ({ ...it, isIconLayer: true })) : action.items;
          return ops.computePlacementEdits ? ops.computePlacementEdits(currentText, ci, items) : [];
        }
        case "resize":
        case "rotate": {
          const item = request.diagramType === "icon" ? { ...action.item, isIconLayer: true } : action.item;
          return ops.computePlacementEdits ? ops.computePlacementEdits(currentText, ci, [item]) : [];
        }
        case "moveEdge": {
          const lines = currentText.split("\n");
          return ops.computeEdgePointEdits ? ops.computeEdgePointEdits(lines, ci, action.edges) : [];
        }
        case "connect":
          return ops.computeConnectInsert
            ? ops.computeConnectInsert(currentText, ci, action.source, action.target, action.points, action.color)
            : [];
        case "disconnect":
          return ops.computeConnectRemove
            ? ops.computeConnectRemove(currentText, ci, action.source, action.target)
            : [];
        case "addComponent": {
          const fallbackShort = action.className.split(".").pop() || "comp";
          const resolved = dropIconOptions?.crossLanguageDrop?.resolveCrossLanguageComponentDrop?.(
            unifiedIndex,
            action.className,
            "modelica",
            currentText,
          ) ?? {
            className: action.className,
            baseName: fallbackShort.charAt(0).toLowerCase() + fallbackShort.slice(1),
          };
          const baseName = resolved.baseName || resolved.className.split(".").pop() || "comp";
          let uniqueName = action.name || baseName + "1";
          let counter = 1;

          const existingNames = new Set<string>(Array.from(ci.components || []).map((c) => c.name));
          if (typeof ops.scanModelicaClassLayout === "function") {
            const scanned = ops.scanModelicaClassLayout(currentText, targetClassName || ci.name);
            for (const c of scanned?.components ?? []) {
              existingNames.add(c.name);
            }
          }
          for (const n of createdComponentNames) existingNames.add(n);
          if (!action.name) {
            while (existingNames.has(uniqueName)) {
              counter++;
              uniqueName = baseName + counter;
            }
          }
          createdComponentNames.add(uniqueName);
          const componentIconCoord = dropIconOptions?.resolveComponentIconCoord?.(action.className) ?? null;
          return (
            dropIconOptions?.crossLanguageDrop?.computeModelicaComponentDropEdits?.({
              docText: currentText,
              uri: request.uri,
              rawClassName: action.className,
              x: action.x,
              y: action.y,
              classInstance: ci,
              computeComponentInsert: ops.computeComponentInsert,
              unifiedIndex,
              instanceName: uniqueName,
              componentIconCoord,
              getResourceText: dropIconOptions?.getResourceText,
            }) ?? []
          );
        }
        case "deleteComponents":
          return ops.computeComponentsDelete ? ops.computeComponentsDelete(currentText, ci, action.names) : [];
        case "updateName":
          return ops.computeNameEdit ? ops.computeNameEdit(ci, action.oldName, action.newName, currentText) : [];
        case "updateDescription":
          return ops.computeDescriptionEdit
            ? ops.computeDescriptionEdit(currentText, ci, action.name, action.description)
            : [];
        case "updateParameter":
          return ops.computeParameterEdit
            ? ops.computeParameterEdit(ci, action.name, action.parameter, action.value, currentText)
            : [];
        case "updateProperty":
          return ops.computeParameterEdit
            ? ops.computeParameterEdit(ci, action.name, action.key, String(action.value), currentText)
            : [];
        default:
          return [];
      }
    };

    let edits = execWithInstance(currentInstance);
    // If CST-backed edit returned empty or invalid on a syntax-errored AST, retry with scanner fallback instance
    if (
      (edits.length === 0 || !validatePostEditBalance(currentText, sortFn([...edits]), targetClassName, ops)) &&
      typeof ops.buildFallbackClassInstance === "function"
    ) {
      const fallbackCi = attachPreservedDiagram(
        ops.buildFallbackClassInstance(currentText, targetClassName || currentInstance?.name),
      );
      if (fallbackCi && fallbackCi !== currentInstance) {
        const retryEdits = execWithInstance(fallbackCi);
        if (
          retryEdits.length > 0 &&
          validatePostEditBalance(currentText, sortFn([...retryEdits]), targetClassName, ops)
        ) {
          edits = retryEdits;
        }
      }
    }

    return sortFn(edits);
  };

  // Auto-heal stranded top-level class `annotation(...);` clauses placed above components/equations
  const healedBaseText =
    typeof ops.healStrandedClassAnnotationsInText === "function"
      ? ops.healStrandedClassAnnotationsInText(docText, targetClassName || initialInstance?.name)
      : docText;
  const didHealStrandedAnnotation = healedBaseText !== docText;

  // Fast surgical path: single action and no stranded class annotation relocation needed
  if (!didHealStrandedAnnotation && expandedActions.length === 1) {
    const singleEdits = runSingleAction(expandedActions[0]!, docText, initialInstance);
    if (validatePostEditBalance(docText, singleEdits, targetClassName, ops)) {
      return {
        seq: request.seq,
        edits: singleEdits,
        renderHint: needsRender,
      };
    }
    return {
      seq: request.seq,
      edits: [],
      renderHint: "none",
    };
  }

  // Sequential multi-step path: apply each step onto `workingText` and refresh `workingInstance`
  // so subsequent actions in the same batch see accurate line numbers, new `equation` sections,
  // renamed endpoints, and healed class annotations with zero overlapping or dropped edits.
  let workingText = healedBaseText;
  let workingInstance =
    didHealStrandedAnnotation && typeof ops.buildFallbackClassInstance === "function"
      ? attachPreservedDiagram(
          ops.buildFallbackClassInstance(workingText, targetClassName || initialInstance?.name) ?? initialInstance,
        )
      : initialInstance;

  for (const stepAction of expandedActions) {
    const stepEdits = runSingleAction(stepAction, workingText, workingInstance);
    if (stepEdits.length > 0) {
      workingText = applyTextEditsInMemory(workingText, stepEdits);
      if (typeof ops.buildFallbackClassInstance === "function") {
        const refreshed = ops.buildFallbackClassInstance(workingText, targetClassName || workingInstance?.name);
        if (refreshed) {
          workingInstance = attachPreservedDiagram(refreshed);
        }
      }
    }
  }

  if (workingText === docText) {
    return {
      seq: request.seq,
      edits: [],
      renderHint: needsRender,
    };
  }

  const finalEdits: TextEdit[] =
    typeof ops.computeMinimalNonOverlappingEdits === "function"
      ? ops.computeMinimalNonOverlappingEdits(docText, workingText)
      : [
          {
            range: {
              start: { line: 0, character: 0 },
              end: {
                line: Math.max(0, docText.split("\n").length - 1),
                character: docText.split("\n").pop()?.length ?? 0,
              },
            },
            newText: workingText,
          },
        ];

  if (!validatePostEditBalance(docText, finalEdits, targetClassName, ops)) {
    return {
      seq: request.seq,
      edits: [],
      renderHint: "none",
    };
  }

  return {
    seq: request.seq,
    edits: finalEdits,
    renderHint: needsRender,
  };
}
