// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LspContext } from "../lsp-context.js";

export interface ApplyCadEditSourceMetadata {
  uri?: string | undefined;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
  primitiveStartOffset?: number | undefined;
  primitiveEndOffset?: number | undefined;
  parameterName?: string | undefined;
  transformMethod?: string | undefined;
  translateRange?: { startOffset: number; endOffset: number } | undefined;
  rotateRange?: { startOffset: number; endOffset: number } | undefined;
  scaleRange?: { startOffset: number; endOffset: number } | undefined;
  dimensions?: [number, number, number] | undefined;
  dimensionParams?: [string | undefined, string | undefined, string | undefined] | undefined;
  position?: [number, number, number] | undefined;
  rotation?: [number, number, number] | undefined;
  scale?: [number, number, number] | undefined;
  primitiveType?: string | undefined;
}

export interface ApplyCadEditParams {
  uri: string;
  documentText?: string | undefined;
  languageId?: string | undefined;
  kind: "gizmo" | "dimension" | "face_tag" | "assembly_joint";
  payload: Record<string, unknown>;
}

export interface ApplyCadEditResult {
  applied: boolean;
  updatedSource?: string | undefined;
  replacedRange?: { startOffset: number; endOffset: number } | undefined;
  newText?: string | undefined;
  locked?: boolean | undefined;
  lockReason?: string | undefined;
  error?: string | undefined;
}

interface CadEditPayload {
  sourceMetadata?: ApplyCadEditSourceMetadata | undefined;
  mode?: "translate" | "rotate" | "scale" | undefined;
  newPosition?: [number, number, number] | undefined;
  newRotation?: [number, number, number] | undefined;
  newScale?: [number, number, number] | undefined;
  dimensionIndex?: number | string | undefined;
  newValue?: number | string | undefined;
  primitiveType?: string | undefined;
  portName?: string | undefined;
  portType?: string | undefined;
  normal?: [number, number, number] | undefined;
  componentName?: string | undefined;
  worldPos?: [number, number, number] | undefined;
}

/**
 * Applies a 3D CAD direct-manipulation edit (gizmo transform, parametric dimension drag,
 * face/port tag, or assembly joint) back into the active source document using CST-backed patchers.
 */
export async function handleApplyCadEdit(context: LspContext, params: ApplyCadEditParams): Promise<ApplyCadEditResult> {
  if (!params || !params.uri || !params.payload) {
    return { applied: false, error: "Invalid CAD edit request." };
  }

  const doc = context.documents.get(params.uri);
  const source = params.documentText ?? doc?.getText() ?? "";
  if (!source) {
    return { applied: false, error: "Empty document source." };
  }

  const lowerUri = params.uri.split(/[?#]/)[0]?.toLowerCase() ?? "";
  const langId = (params.languageId ?? doc?.languageId ?? "").toLowerCase();
  const isScad = langId === "scad" || lowerUri.endsWith(".scad");
  const isModelica = langId === "modelica" || langId === "modelscript" || lowerUri.endsWith(".mo");

  const payload = params.payload as CadEditPayload;
  const sourceMetadata = payload.sourceMetadata;

  // ── 1. OpenSCAD (.scad) CST-backed writeback via ScadPatcher ──
  if (isScad) {
    try {
      await context.parserService?.ensureLanguageParserLoaded?.("scad");
      const { getScadParser, ScadPatcher } = await import("@modelscript/scad");
      const parser = context.parserService?.getParser?.("scad") ?? (await getScadParser());
      const tree = parser?.parse(source);
      if (!tree?.rootNode) {
        return { applied: false, error: "Failed to parse OpenSCAD CST." };
      }

      try {
        const scadRoot = tree.rootNode as Parameters<typeof ScadPatcher.patchVariable>[1];
        if (params.kind === "gizmo") {
          const mode: "translate" | "rotate" | "scale" = payload.mode ?? "translate";
          const newPosition: [number, number, number] = payload.newPosition ?? [0, 0, 0];
          const newRotation: [number, number, number] | undefined = payload.newRotation;
          const newScale: [number, number, number] | undefined = payload.newScale;

          let patchRes:
            | ReturnType<typeof ScadPatcher.patchVariable>
            | ReturnType<typeof ScadPatcher.patchOrInsertTransform>
            | null = null;
          if (mode === "scale") {
            const scaleFactors = newScale ?? [1, 1, 1];
            const dimParams = sourceMetadata?.dimensionParams;
            const dims = sourceMetadata?.dimensions;
            if (dimParams && dims) {
              for (let axis = 0; axis < 3; axis++) {
                const paramName = dimParams[axis];
                const baseDim = dims[axis];
                if (paramName && baseDim !== undefined && Math.abs(scaleFactors[axis]! - 1) > 1e-3) {
                  const newDimVal = Number((baseDim * scaleFactors[axis]!).toFixed(4));
                  patchRes = ScadPatcher.patchVariable(source, scadRoot, paramName, newDimVal);
                  if (patchRes) break;
                }
              }
            }
            if (!patchRes) {
              const baseScale = sourceMetadata?.scale ?? [1, 1, 1];
              const targetScale: [number, number, number] = [
                Number((baseScale[0] * scaleFactors[0]).toFixed(4)),
                Number((baseScale[1] * scaleFactors[1]).toFixed(4)),
                Number((baseScale[2] * scaleFactors[2]).toFixed(4)),
              ];
              patchRes = ScadPatcher.patchOrInsertTransform(
                source,
                scadRoot,
                "scale",
                targetScale,
                sourceMetadata as Parameters<typeof ScadPatcher.patchOrInsertTransform>[4],
              );
            }
          } else if (mode === "rotate") {
            patchRes = ScadPatcher.patchOrInsertTransform(
              source,
              scadRoot,
              "rotate",
              newRotation ?? [0, 0, 0],
              sourceMetadata as Parameters<typeof ScadPatcher.patchOrInsertTransform>[4],
            );
          } else {
            // translate
            if (
              sourceMetadata?.translateRange ||
              sourceMetadata?.primitiveStartOffset !== undefined ||
              sourceMetadata?.transformMethod === "translate"
            ) {
              patchRes = ScadPatcher.patchOrInsertTransform(
                source,
                scadRoot,
                "translate",
                newPosition,
                sourceMetadata as Parameters<typeof ScadPatcher.patchOrInsertTransform>[4],
              );
            } else if (sourceMetadata?.parameterName) {
              patchRes = ScadPatcher.patchVariable(source, scadRoot, sourceMetadata.parameterName, newPosition[0]);
            } else {
              patchRes = ScadPatcher.patchOrInsertTransform(
                source,
                scadRoot,
                "translate",
                newPosition,
                sourceMetadata as Parameters<typeof ScadPatcher.patchOrInsertTransform>[4],
              );
            }
          }

          if (patchRes?.locked) {
            return {
              applied: false,
              locked: true,
              lockReason: patchRes.lockReason ?? "Transform expression is locked (multi-variable or non-affine).",
            };
          }
          if (patchRes?.replacedRange) {
            const { startOffset, endOffset } = patchRes.replacedRange;
            const newText = String(patchRes.newValue);
            return {
              applied: true,
              replacedRange: { startOffset, endOffset },
              newText,
              updatedSource: source.slice(0, startOffset) + newText + source.slice(endOffset),
            };
          }
          return { applied: false };
        }

        if (params.kind === "dimension") {
          const dimensionIndex = Number(payload.dimensionIndex ?? 0);
          const newValue = Number(payload.newValue);
          const primitiveType = payload.primitiveType ?? sourceMetadata?.primitiveType;
          const targetRange =
            sourceMetadata?.primitiveStartOffset !== undefined && sourceMetadata?.primitiveEndOffset !== undefined
              ? { startOffset: sourceMetadata.primitiveStartOffset, endOffset: sourceMetadata.primitiveEndOffset }
              : undefined;
          const paramName = sourceMetadata?.dimensionParams?.[dimensionIndex] ?? sourceMetadata?.parameterName;

          const patchRes = ScadPatcher.patchPrimitiveDimension(
            source,
            scadRoot,
            dimensionIndex,
            newValue,
            targetRange,
            paramName,
            primitiveType,
          );
          if (patchRes?.locked) {
            return {
              applied: false,
              locked: true,
              lockReason:
                patchRes.lockReason ?? "Dimension expression is locked (multi-variable or non-affine). Edit in source.",
            };
          }
          if (patchRes?.replacedRange) {
            const { startOffset, endOffset } = patchRes.replacedRange;
            const newText = String(patchRes.newValue);
            return {
              applied: true,
              replacedRange: { startOffset, endOffset },
              newText,
              updatedSource: source.slice(0, startOffset) + newText + source.slice(endOffset),
            };
          }
          return { applied: false };
        }

        if (params.kind === "face_tag") {
          const startOffset = sourceMetadata?.primitiveStartOffset ?? sourceMetadata?.startOffset;
          const endOffset = sourceMetadata?.primitiveEndOffset ?? sourceMetadata?.endOffset;
          if (startOffset !== undefined && endOffset !== undefined && endOffset > startOffset) {
            const patchRes = ScadPatcher.wrapSolidWithTagPort(
              source,
              { startOffset, endOffset },
              String(payload.portName ?? "port_1"),
              String(payload.portType ?? "fixed_support"),
              payload.normal,
            );
            if (patchRes?.replacedRange) {
              const rs = patchRes.replacedRange.startOffset;
              const re = patchRes.replacedRange.endOffset;
              const newText = String(patchRes.newValue);
              return {
                applied: true,
                replacedRange: { startOffset: rs, endOffset: re },
                newText,
                updatedSource: source.slice(0, rs) + newText + source.slice(re),
              };
            }
          }
          return { applied: false };
        }
      } finally {
        (tree as { delete?: () => void }).delete?.();
      }
    } catch (err: unknown) {
      return { applied: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // ── 2. Modelica (.mo) CST-backed writeback via @modelscript/cad ──
  if (isModelica) {
    try {
      const cachedTree = context.documentManager?.documentTrees?.get(params.uri)?.tree;
      const rootCst = cachedTree && "edit" in cachedTree ? cachedTree.rootNode : undefined;
      const { patchModelicaCadAnnotation, patchModelicaCadPortAnnotation, patchModelicaAssemblyJoint } =
        await import("@modelscript/cad");

      if (params.kind === "gizmo") {
        const mode: "translate" | "rotate" | "scale" = payload.mode ?? "translate";
        const propName = mode === "rotate" ? "rotation" : mode === "scale" ? "scale" : "position";
        const vec =
          mode === "rotate"
            ? (payload.newRotation ?? [0, 0, 0])
            : mode === "scale"
              ? (payload.newScale ?? [1, 1, 1])
              : (payload.newPosition ?? [0, 0, 0]);
        const patch = patchModelicaCadAnnotation(
          source,
          String(payload.componentName ?? ""),
          { [propName]: vec },
          { rootCst },
        );
        if (patch.updatedSource !== source) {
          return {
            applied: true,
            updatedSource: patch.updatedSource,
            ...(patch.replacedRange
              ? {
                  replacedRange: { startOffset: patch.replacedRange.start, endOffset: patch.replacedRange.end },
                  newText: patch.newText,
                }
              : {}),
          };
        }
        return { applied: false };
      }

      if (params.kind === "face_tag") {
        const patch = patchModelicaCadPortAnnotation(
          source,
          String(payload.componentName ?? ""),
          {
            feature: String(payload.portName ?? "port_1"),
            offsetPosition: payload.worldPos,
          },
          { rootCst },
        );
        if (patch.updatedSource !== source) {
          return {
            applied: true,
            updatedSource: patch.updatedSource,
            ...(patch.replacedRange
              ? {
                  replacedRange: { startOffset: patch.replacedRange.start, endOffset: patch.replacedRange.end },
                  newText: patch.newText,
                }
              : {}),
          };
        }
        return { applied: false };
      }

      if (params.kind === "assembly_joint") {
        const patch = patchModelicaAssemblyJoint(source, payload as Parameters<typeof patchModelicaAssemblyJoint>[1], {
          rootCst,
        });
        if (patch.updatedSource !== source) {
          return {
            applied: true,
            updatedSource: patch.updatedSource,
            ...(patch.replacedRange
              ? {
                  replacedRange: { startOffset: patch.replacedRange.start, endOffset: patch.replacedRange.end },
                  newText: patch.newText,
                }
              : {}),
          };
        }
        return { applied: false };
      }
    } catch (err: unknown) {
      return { applied: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  return { applied: false };
}
