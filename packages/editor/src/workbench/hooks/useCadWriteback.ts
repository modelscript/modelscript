// SPDX-License-Identifier: AGPL-3.0-or-later

import { patchModelicaCadAnnotation, type DynamicBindingConfig } from "@modelscript/cad";
import {
  type CadComponent,
  type CommitAssemblyJointPayload,
  type CommitDimensionPayload,
  type CommitFaceTagPayload,
  type GizmoCommitPayload,
} from "@modelscript/cad-viewer";
import type { editor } from "monaco-editor";
import type React from "react";
import { useCallback } from "react";
import { useEditorToast as useToast } from "../../host";
import { applyCadEditInAnsatz } from "../util/lsp-bridge";

export interface UseCadWritebackOptions {
  editor: editor.ICodeEditor | null;
  editorValue: string;
  documentUri: string;
  dialect: string;
  setCadComponents: React.Dispatch<React.SetStateAction<CadComponent[]>>;
}

export function useCadWriteback({
  editor,
  editorValue,
  documentUri,
  dialect,
  setCadComponents,
}: UseCadWritebackOptions) {
  const toast = useToast();

  // ── Dynamic CAD geometry binding save & code writeback ──
  const handleSaveCadBindings = useCallback(
    (componentName: string, bindings: DynamicBindingConfig[]) => {
      if (!editor) return;
      const currentCode = editor.getValue();
      const patch = patchModelicaCadAnnotation(currentCode, componentName, { bindings });

      if (patch.updatedSource !== currentCode) {
        editor.setValue(patch.updatedSource);
      }

      setCadComponents((prev) =>
        prev.map((c) =>
          c.name === componentName
            ? {
                ...c,
                dynamicBindings: bindings.map((b) => ({
                  property: b.property as "position" | "rotation" | "scale",
                  index: b.index ?? 0,
                  variable: b.variable,
                  unit: b.unit,
                  scale: b.scale,
                  offset: b.offset,
                  format: b.format,
                })),
              }
            : c,
        ),
      );
    },
    [editor, setCadComponents],
  );

  // ── 3D Direct-Manipulation CAD Edit Writeback (Gizmo / Dimension / Face Tag / Assembly Joint) ──
  const commitCadEdit = useCallback(
    async (
      kind: "gizmo" | "dimension" | "face_tag" | "assembly_joint",
      payload:
        | GizmoCommitPayload
        | CommitDimensionPayload
        | CommitFaceTagPayload
        | CommitAssemblyJointPayload
        | Record<string, unknown>,
    ) => {
      const liveSource = editor?.getValue() ?? editorValue;
      try {
        const res = await applyCadEditInAnsatz({
          uri: documentUri,
          documentText: liveSource,
          languageId: dialect,
          kind,
          payload,
        });
        if (res.locked) {
          const msg = res.lockReason || "This CAD parameter is locked and cannot be edited directly.";
          console.warn("[CAD Direct Edit]", msg);
          toast.warning(msg);
          return;
        }
        if (!res.applied) {
          if (res.error) {
            console.warn("[CAD Direct Edit]", res.error);
            toast.warning(res.error);
          }
          return;
        }
        if (!editor) return;
        const model = editor.getModel();
        if (model && res.replacedRange && typeof res.newText === "string") {
          const startPos = model.getPositionAt(res.replacedRange.startOffset);
          const endPos = model.getPositionAt(res.replacedRange.endOffset);
          editor.pushUndoStop();
          editor.executeEdits("cad-direct-edit", [
            {
              range: {
                startLineNumber: startPos.lineNumber,
                startColumn: startPos.column,
                endLineNumber: endPos.lineNumber,
                endColumn: endPos.column,
              },
              text: res.newText,
              forceMoveMarkers: true,
            },
          ]);
          editor.pushUndoStop();
        } else if (typeof res.updatedSource === "string" && res.updatedSource !== liveSource) {
          if (model) {
            editor.pushUndoStop();
            editor.executeEdits("cad-direct-edit", [
              {
                range: model.getFullModelRange(),
                text: res.updatedSource,
                forceMoveMarkers: true,
              },
            ]);
            editor.pushUndoStop();
          } else {
            editor.setValue(res.updatedSource);
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn("[CAD Direct Edit] Failed to apply edit:", msg);
        toast.error(`CAD edit failed: ${msg}`);
      }
    },
    [editor, editorValue, documentUri, dialect, toast],
  );

  const handleCommitCadGizmoDelta = useCallback(
    (payload: GizmoCommitPayload) => {
      void commitCadEdit("gizmo", payload);
    },
    [commitCadEdit],
  );

  const handleCommitCadDimensionDelta = useCallback(
    (payload: CommitDimensionPayload) => {
      void commitCadEdit("dimension", payload);
    },
    [commitCadEdit],
  );

  const handleCommitCadFaceTag = useCallback(
    (payload: CommitFaceTagPayload) => {
      void commitCadEdit("face_tag", payload);
    },
    [commitCadEdit],
  );

  const handleCommitCadAssemblyJoint = useCallback(
    (payload: CommitAssemblyJointPayload) => {
      void commitCadEdit("assembly_joint", payload);
    },
    [commitCadEdit],
  );

  return {
    handleSaveCadBindings,
    handleCommitCadGizmoDelta,
    handleCommitCadDimensionDelta,
    handleCommitCadFaceTag,
    handleCommitCadAssemblyJoint,
  };
}
