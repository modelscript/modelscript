// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  applyOptimisticPropertyAction,
  DiagramActionQueue,
  isOptimisticDiagramActionBatch,
  SerializedDiagramEditRunner,
  type ComponentPropertyData,
} from "@modelscript/diagram";
import type { DiagramData, DiagramEditAction } from "@modelscript/diagram/protocol";
import type { editor } from "monaco-editor";
import { useCallback, useEffect, useRef } from "react";
import type { CodeEditorHandle } from "../Code";
import type { DiagramEditorHandle } from "../Diagram";
import {
  applyDiagramActionsViaCstWorker,
  isCstEditWorkerSupported,
  notifyCstWorkerSyncText,
} from "../util/cst-edit-client";
import { applyDiagramEdits, applyLspEdits, applyLspTextEditsToString, didChange } from "../util/lsp-bridge";

export interface SidecarHistoryEntry {
  prev: string | undefined;
  next: string | undefined;
  hadTextEdit: boolean;
}

export interface UseAnsatzDiagramEditsOptions {
  content: string;
  dialect: string;
  selectedTreeClassName: string | null;
  documentUriRef: React.RefObject<string>;
  editorRef: React.RefObject<editor.ICodeEditor | null>;
  codeEditorRef: React.RefObject<CodeEditorHandle | null>;
  diagramEditorRef: React.RefObject<DiagramEditorHandle | null>;
  diagramDataRef: React.RefObject<(DiagramData & { isLoading?: boolean }) | null>;
  lastLoadedContentRef: React.RefObject<string>;
  isSpatialEditPending: React.RefObject<boolean>;
  lastDiagramEditTimeRef: React.RefObject<number>;
  sidecarContentRef: React.RefObject<string | undefined>;
  sidecarHistoryRef: React.RefObject<{ undo: SidecarHistoryEntry[]; redo: SidecarHistoryEntry[] }>;
  persistSidecarToProjectFiles: (next: string | undefined) => void;
  setSidecarContent: React.Dispatch<React.SetStateAction<string | undefined>>;
  setLastLoadedContent: React.Dispatch<React.SetStateAction<string>>;
  setIsDiagramLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setContextVersion: React.Dispatch<React.SetStateAction<number>>;
  setSelectedComponentProperties: React.Dispatch<React.SetStateAction<ComponentPropertyData | null>>;
  onCodeChange?: ((code: string) => void) | undefined;
}

export function useAnsatzDiagramEdits({
  content,
  dialect,
  selectedTreeClassName,
  documentUriRef,
  editorRef,
  codeEditorRef,
  diagramEditorRef,
  diagramDataRef,
  lastLoadedContentRef,
  isSpatialEditPending,
  lastDiagramEditTimeRef,
  sidecarContentRef,
  sidecarHistoryRef,
  persistSidecarToProjectFiles,
  setSidecarContent,
  setLastLoadedContent,
  setIsDiagramLoading,
  setContextVersion,
  setSelectedComponentProperties,
  onCodeChange,
}: UseAnsatzDiagramEditsOptions) {
  const diagramActionQueueRef = useRef<DiagramActionQueue<DiagramEditAction> | null>(null);
  const diagramEditRunnerRef = useRef<SerializedDiagramEditRunner>(new SerializedDiagramEditRunner());
  const inFlightLspDiagramEditsRef = useRef<number>(0);
  const dialectRef = useRef<string>(dialect);
  dialectRef.current = dialect;
  const selectedTreeClassNameRef = useRef<string | null>(selectedTreeClassName);
  selectedTreeClassNameRef.current = selectedTreeClassName;
  const onCodeChangeRef = useRef(onCodeChange);
  onCodeChangeRef.current = onCodeChange;

  const flushDiagramActionBatch = useCallback(
    (actions: DiagramEditAction[]) => {
      if (actions.length === 0) return;

      // Dedicated CST Edit Worker fast-lane (~1-3ms off main thread, never queued behind LSP validation/sim).
      // Uses Monaco versionId guards with automatic single-retry if the user typed mid-flight.
      const activeLang = dialectRef.current;
      if (isCstEditWorkerSupported(activeLang) && inFlightLspDiagramEditsRef.current === 0) {
        diagramEditRunnerRef.current.enqueue(
          async () => {
            const runCstAttempt = async (attempt: number): Promise<boolean> => {
              const ed = editorRef.current;
              const model = ed?.getModel();
              const reqVersion = model ? model.getVersionId() : 0;
              const liveCode = ed ? ed.getValue() : lastLoadedContentRef.current || content;
              const res = await applyDiagramActionsViaCstWorker({
                uri: documentUriRef.current,
                langId: activeLang,
                actions: actions as never,
                version: reqVersion,
                fallbackText: liveCode,
                className: selectedTreeClassNameRef.current ?? undefined,
              });
              if (!res.handled || res.edits.length === 0) {
                return false;
              }
              const curModel = editorRef.current?.getModel();
              if (curModel && curModel.getVersionId() !== reqVersion) {
                if (attempt === 0) {
                  notifyCstWorkerSyncText(
                    documentUriRef.current,
                    activeLang,
                    curModel.getValue(),
                    curModel.getVersionId(),
                  );
                  return runCstAttempt(1);
                }
                return false;
              }

              isSpatialEditPending.current = true;
              lastDiagramEditTimeRef.current = Date.now();
              if (editorRef.current) {
                applyLspEdits(editorRef.current, res.edits, actions[0]!.type);
                const updatedCode = editorRef.current.getValue();
                lastLoadedContentRef.current = updatedCode;
                setLastLoadedContent(updatedCode);
                if (codeEditorRef.current) {
                  void codeEditorRef.current.sync();
                } else {
                  void didChange(documentUriRef.current, updatedCode);
                }
                onCodeChangeRef.current?.(updatedCode);
              } else {
                const updatedCode = applyLspTextEditsToString(liveCode, res.edits);
                lastLoadedContentRef.current = updatedCode;
                setLastLoadedContent(updatedCode);
                notifyCstWorkerSyncText(documentUriRef.current, activeLang, updatedCode, reqVersion + 1);
                void didChange(documentUriRef.current, updatedCode);
                onCodeChangeRef.current?.(updatedCode);
              }
              if (res.renderHint === "none") {
                setIsDiagramLoading(false);
              } else {
                setContextVersion((v) => v + 1);
              }
              return true;
            };

            const handledByCstWorker = await runCstAttempt(0);
            if (handledByCstWorker) return;

            // Fall back to LSP Worker only when an action requires workspace-wide context (e.g. pasteSubgraph)
            inFlightLspDiagramEditsRef.current += 1;
            try {
              const seq = diagramEditRunnerRef.current.nextSeq();
              const response = await applyDiagramEdits(
                documentUriRef.current,
                actions,
                seq,
                selectedTreeClassNameRef.current ?? undefined,
              );
              if (response && response.edits && response.edits.length > 0) {
                isSpatialEditPending.current = true;
                lastDiagramEditTimeRef.current = Date.now();
                if (editorRef.current) {
                  applyLspEdits(editorRef.current, response.edits, actions[0]!.type);
                  const updatedCode = editorRef.current.getValue();
                  lastLoadedContentRef.current = updatedCode;
                  setLastLoadedContent(updatedCode);
                  if (codeEditorRef.current) {
                    await codeEditorRef.current.sync();
                  } else {
                    await didChange(documentUriRef.current, updatedCode);
                  }
                  onCodeChangeRef.current?.(updatedCode);
                } else {
                  const baseText = lastLoadedContentRef.current || content;
                  const updatedCode = applyLspTextEditsToString(baseText, response.edits);
                  lastLoadedContentRef.current = updatedCode;
                  setLastLoadedContent(updatedCode);
                  await didChange(documentUriRef.current, updatedCode);
                  onCodeChangeRef.current?.(updatedCode);
                }
                if (response.renderHint === "none") {
                  setIsDiagramLoading(false);
                } else {
                  setContextVersion((v) => v + 1);
                }
              } else {
                setIsDiagramLoading(false);
              }
            } finally {
              inFlightLspDiagramEditsRef.current = Math.max(0, inFlightLspDiagramEditsRef.current - 1);
            }
          },
          (err) => {
            console.error("Failed to apply diagram edit batch via CST worker:", err);
            setIsDiagramLoading(false);
          },
        );
        return;
      }

      inFlightLspDiagramEditsRef.current += 1;
      diagramEditRunnerRef.current.enqueue(
        async (seq) => {
          try {
            // Flush any pending/debounced live Monaco edits before computing LSP diagram TextEdits
            if (editorRef.current) {
              const liveCode = editorRef.current.getValue();
              if (liveCode !== lastLoadedContentRef.current) {
                lastLoadedContentRef.current = liveCode;
                setLastLoadedContent(liveCode);
                if (codeEditorRef.current) {
                  await codeEditorRef.current.sync();
                } else {
                  await didChange(documentUriRef.current, liveCode);
                }
              }
            }
            const response = await applyDiagramEdits(
              documentUriRef.current,
              actions,
              seq,
              selectedTreeClassNameRef.current ?? undefined,
            );
            if (response?.sidecarContent !== undefined) {
              if (response.sidecarContent !== sidecarContentRef.current) {
                const stack = sidecarHistoryRef.current;
                stack.undo.push({
                  prev: sidecarContentRef.current,
                  next: response.sidecarContent,
                  hadTextEdit: Boolean(response?.edits && response.edits.length > 0),
                });
                if (stack.undo.length > 100) stack.undo.shift();
                stack.redo.length = 0;
                persistSidecarToProjectFiles(response.sidecarContent);
              }
              setSidecarContent(response.sidecarContent);
            }
            if (response && response.edits && response.edits.length > 0) {
              isSpatialEditPending.current = true;
              lastDiagramEditTimeRef.current = Date.now();
              if (editorRef.current) {
                applyLspEdits(editorRef.current, response.edits, actions[0]!.type);
                const updatedCode = editorRef.current.getValue();
                lastLoadedContentRef.current = updatedCode;
                setLastLoadedContent(updatedCode);
                if (codeEditorRef.current) {
                  await codeEditorRef.current.sync();
                } else {
                  await didChange(documentUriRef.current, updatedCode);
                }
                onCodeChangeRef.current?.(updatedCode);
              } else {
                const baseText = lastLoadedContentRef.current || content;
                const updatedCode = applyLspTextEditsToString(baseText, response.edits);
                lastLoadedContentRef.current = updatedCode;
                setLastLoadedContent(updatedCode);
                await didChange(documentUriRef.current, updatedCode);
                onCodeChangeRef.current?.(updatedCode);
              }
              if (response.renderHint === "none") {
                setIsDiagramLoading(false);
              } else {
                setContextVersion((v) => v + 1);
              }
            } else if (response?.sidecarContent !== undefined) {
              setIsDiagramLoading(false);
              setContextVersion((v) => v + 1);
            } else {
              setIsDiagramLoading(false);
            }
          } finally {
            inFlightLspDiagramEditsRef.current = Math.max(0, inFlightLspDiagramEditsRef.current - 1);
          }
        },
        (err) => {
          console.error("Failed to apply diagram edit batch:", err);
          setIsDiagramLoading(false);
        },
      );
    },
    [
      codeEditorRef,
      content,
      documentUriRef,
      editorRef,
      isSpatialEditPending,
      lastDiagramEditTimeRef,
      lastLoadedContentRef,
      persistSidecarToProjectFiles,
      setContextVersion,
      setIsDiagramLoading,
      setLastLoadedContent,
      setSidecarContent,
      sidecarContentRef,
      sidecarHistoryRef,
    ],
  );

  const flushDiagramActionBatchRef = useRef(flushDiagramActionBatch);
  flushDiagramActionBatchRef.current = flushDiagramActionBatch;

  useEffect(() => {
    const queue = new DiagramActionQueue<DiagramEditAction>({
      spatialDelayMs: 8,
      structuralDelayMs: 0,
      onFlush: (actions) => flushDiagramActionBatchRef.current(actions),
    });
    diagramActionQueueRef.current = queue;
    return () => {
      queue.dispose();
      diagramActionQueueRef.current = null;
    };
  }, []);

  const enqueueDiagramAction = useCallback(
    (rawAction: DiagramEditAction | Record<string, unknown>) => {
      const action = rawAction as DiagramEditAction;
      // Optimistically update selectedComponentProperties so Property Panel stays in sync immediately
      if (
        action.type === "updateParameter" ||
        action.type === "updateProperty" ||
        action.type === "updateName" ||
        action.type === "updateDescription"
      ) {
        setSelectedComponentProperties((prev) => applyOptimisticPropertyAction(prev, action) ?? null);
        if (action.type === "updateParameter" || action.type === "updateProperty") {
          const paramKey = action.type === "updateParameter" ? action.parameter : action.key;
          const paramVal = String(action.value ?? "");
          const oldVal = (action as { oldValue?: string }).oldValue ?? "";
          diagramEditorRef.current?.updateParameterText?.(action.name, paramKey, oldVal, paramVal);
        }
      }

      const isOptimisticOnly =
        isOptimisticDiagramActionBatch([action]) || action.type === "updateName" || action.type === "updateDescription";
      if (!isOptimisticOnly && !diagramDataRef.current) {
        setIsDiagramLoading(true);
      }

      if (diagramActionQueueRef.current) {
        diagramActionQueueRef.current.enqueue(action);
      } else {
        flushDiagramActionBatchRef.current([action]);
      }
    },
    [diagramDataRef, diagramEditorRef, setIsDiagramLoading, setSelectedComponentProperties],
  );

  const onResetSpatialCooldown = useCallback(() => {
    lastDiagramEditTimeRef.current = 0;
    isSpatialEditPending.current = false;
  }, [isSpatialEditPending, lastDiagramEditTimeRef]);

  const onDiagramUndo = useCallback(() => {
    lastDiagramEditTimeRef.current = 0;
    isSpatialEditPending.current = false;
    const entry = sidecarHistoryRef.current.undo.pop();
    if (!entry) return true;
    sidecarHistoryRef.current.redo.push(entry);
    setSidecarContent(entry.prev);
    persistSidecarToProjectFiles(entry.prev);
    setContextVersion((v) => v + 1);
    return entry.hadTextEdit;
  }, [
    isSpatialEditPending,
    lastDiagramEditTimeRef,
    persistSidecarToProjectFiles,
    setContextVersion,
    setSidecarContent,
    sidecarHistoryRef,
  ]);

  const onDiagramRedo = useCallback(() => {
    lastDiagramEditTimeRef.current = 0;
    isSpatialEditPending.current = false;
    const entry = sidecarHistoryRef.current.redo.pop();
    if (!entry) return true;
    sidecarHistoryRef.current.undo.push(entry);
    setSidecarContent(entry.next);
    persistSidecarToProjectFiles(entry.next);
    setContextVersion((v) => v + 1);
    return entry.hadTextEdit;
  }, [
    isSpatialEditPending,
    lastDiagramEditTimeRef,
    persistSidecarToProjectFiles,
    setContextVersion,
    setSidecarContent,
    sidecarHistoryRef,
  ]);

  return {
    enqueueDiagramAction,
    onResetSpatialCooldown,
    onDiagramUndo,
    onDiagramRedo,
  };
}
