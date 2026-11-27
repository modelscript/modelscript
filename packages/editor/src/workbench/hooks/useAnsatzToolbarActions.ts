// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DiagramEditAction } from "@modelscript/diagram/protocol";
import type { editor } from "monaco-editor";
import { useEffect } from "react";
import { getEditorLanguageUi } from "../../host";
import { MODELICA_ICON_SHAPE_TOOLS } from "../constants";
import { AnsatzView as View } from "../panels";
import type { AnsatzOnDemandLintMode } from "../util/lsp-bridge";

export interface UseAnsatzToolbarActionsOptions {
  dialect: string;
  documentUri: string;
  view: View;
  setView: React.Dispatch<React.SetStateAction<View>>;
  setShowResultsView: React.Dispatch<React.SetStateAction<boolean>>;
  setShowCadView: React.Dispatch<React.SetStateAction<boolean>>;
  setShowAnalysisView: React.Dispatch<React.SetStateAction<boolean>>;
  setFlattenedCode: React.Dispatch<React.SetStateAction<string>>;
  setFlattenDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  editorRef: React.RefObject<editor.ICodeEditor | null>;
  lastLoadedContent: string;
  selectedComponent: string | null;
  enqueueDiagramAction: (action: DiagramEditAction | Record<string, unknown>) => void;
  handleAutoLayout: () => Promise<void>;
  handleFlatten: () => Promise<void>;
  handleInsertStencilSnippet: (snippet: string, className?: string) => void;
  handleRunOnDemandLints: (mode?: AnsatzOnDemandLintMode) => Promise<void>;
  handleSelectComponent: (name: string | null) => void;
  handleSimulate: () => Promise<void>;
  toast: {
    info(message: string): void;
    success(message: string): void;
    warning(message: string): void;
    error(message: string): void;
  };
}

export function useAnsatzToolbarActions({
  dialect,
  documentUri,
  view,
  setView,
  setShowResultsView,
  setShowCadView,
  setShowAnalysisView,
  setFlattenedCode,
  setFlattenDialogOpen,
  editorRef,
  lastLoadedContent,
  selectedComponent,
  enqueueDiagramAction,
  handleAutoLayout,
  handleFlatten,
  handleInsertStencilSnippet,
  handleRunOnDemandLints,
  handleSelectComponent,
  handleSimulate,
  toast,
}: UseAnsatzToolbarActionsOptions): void {
  useEffect(() => {
    const handleToolbarAction = (ev: Event) => {
      const detail = (
        ev as CustomEvent<
          | {
              button?: {
                id: string;
                label: string;
                command?: string;
                actionId?: string;
              };
              languageId?: string;
              view?: string;
            }
          | undefined
        >
      ).detail;
      const btn = detail?.button;
      if (!btn) return;

      switch (btn.command) {
        case "ansatz:autoLayout":
          void handleAutoLayout();
          return;
        case "ansatz:flatten":
          void handleFlatten();
          return;
        case "ansatz:runLints":
          void handleRunOnDemandLints("all");
          return;
        case "ansatz:runFormalLints":
          void handleRunOnDemandLints("formal");
          return;
        case "ansatz:runCompilerLints":
          void handleRunOnDemandLints("compiler");
          return;
        case "ansatz:simulate":
          void handleSimulate();
          return;
        case "ansatz:deleteIconPrimitive": {
          const match = /^__icon_gfx_(\d+)$/.exec(selectedComponent ?? "");
          if (!match) {
            toast.info("Select an icon shape first");
            return;
          }
          const idx = Number(match[1]);
          handleSelectComponent(null);
          enqueueDiagramAction({ type: "deleteIconPrimitive", index: idx });
          return;
        }
        default:
          if (btn.command?.startsWith("ansatz:addIconPrimitive:")) {
            const shapeId = btn.command.slice("ansatz:addIconPrimitive:".length);
            const tool = MODELICA_ICON_SHAPE_TOOLS.find((t) => t.id === shapeId);
            if (tool) {
              enqueueDiagramAction({
                type: "addIconPrimitive",
                primitive: tool.primitive,
              });
            }
            return;
          }
          if (btn.command?.startsWith("ansatz:reorderIconPrimitive:")) {
            const dir = btn.command.slice("ansatz:reorderIconPrimitive:".length);
            const match = /^__icon_gfx_(\d+)$/.exec(selectedComponent ?? "");
            if (!match) {
              toast.info("Select an icon shape first");
              return;
            }
            const fromIndex = Number(match[1]);
            const toIndex = dir === "forward" ? fromIndex + 1 : Math.max(0, fromIndex - 1);
            if (toIndex !== fromIndex) {
              enqueueDiagramAction({ type: "reorderIconPrimitive", fromIndex, toIndex });
            }
            return;
          }
          if (btn.command?.startsWith("ansatz:insertStencil:")) {
            const stencilLabel = btn.command.slice("ansatz:insertStencil:".length);
            const langId = detail?.languageId || dialect || "modelica";
            const stencils = getEditorLanguageUi().stencils[langId] ?? [];
            const match = stencils.find((s) => s.label === stencilLabel);
            if (match?.snippet) {
              handleInsertStencilSnippet(match.snippet, match.className);
            }
            return;
          }
          break;
      }

      if (btn.actionId === "flatten") {
        void handleFlatten();
        return;
      }
      if (btn.actionId && btn.actionId.startsWith("simulate")) {
        void handleSimulate();
        return;
      }
      if (btn.actionId) {
        const langId = detail?.languageId || dialect || "modelica";
        const actionId = btn.actionId;
        const label = btn.label || actionId;
        void (async () => {
          try {
            toast.info(`Running ${label}…`);
            const { executeLspAction } = await import("../util/lsp-bridge");
            const documentText = editorRef.current?.getValue() ?? lastLoadedContent;
            const res = await executeLspAction(actionId, langId, documentUri, { documentText });
            window.dispatchEvent(
              new CustomEvent("ansatz:toolbar-action-result", {
                detail: { button: btn, languageId: langId, actionId, result: res },
              }),
            );
            if (res && typeof res === "object" && "error" in res && res.error) {
              toast.error(`${label} failed: ${String(res.error)}`);
              return;
            }
            if (
              langId === "owl2" &&
              (actionId === "validate_consistency" || actionId === "explain_inferences" || actionId === "query_sparql")
            ) {
              setShowResultsView(false);
              setShowCadView(false);
              setShowAnalysisView(true);
              if (view === View.CODE) setView(View.SPLIT_COLUMNS);
              const rec = res && typeof res === "object" ? (res as Record<string, unknown>) : null;
              const summary =
                typeof rec?.["formattedSummary"] === "string" ? rec["formattedSummary"] : `${label} completed`;
              if (rec?.["consistent"] === false) {
                toast.error(summary);
              } else if (Array.isArray(rec?.["unsatisfiableClasses"]) && rec["unsatisfiableClasses"].length > 0) {
                toast.warning(summary);
              } else {
                toast.success(summary);
              }
              return;
            }
            const outputText =
              typeof res === "string"
                ? res
                : res && typeof res === "object"
                  ? typeof (res as Record<string, unknown>).text === "string"
                    ? ((res as Record<string, unknown>).text as string)
                    : typeof (res as Record<string, unknown>).report === "string"
                      ? ((res as Record<string, unknown>).report as string)
                      : typeof (res as Record<string, unknown>).output === "string"
                        ? ((res as Record<string, unknown>).output as string)
                        : JSON.stringify(res, null, 2)
                  : "";
            if (outputText) {
              setFlattenedCode(outputText);
              setFlattenDialogOpen(true);
              toast.success(`${label} completed`);
            } else {
              toast.success(`${label} completed`);
            }
          } catch (err) {
            console.error(`[Ansatz] Action '${actionId}' failed:`, err);
            toast.error(`${label} failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        })();
      }
    };

    window.addEventListener("ansatz:toolbar-action", handleToolbarAction);
    return () => window.removeEventListener("ansatz:toolbar-action", handleToolbarAction);
  }, [
    dialect,
    documentUri,
    editorRef,
    enqueueDiagramAction,
    handleAutoLayout,
    handleFlatten,
    handleInsertStencilSnippet,
    handleRunOnDemandLints,
    handleSelectComponent,
    handleSimulate,
    lastLoadedContent,
    selectedComponent,
    setFlattenDialogOpen,
    setFlattenedCode,
    setShowAnalysisView,
    setShowCadView,
    setShowResultsView,
    setView,
    toast,
    view,
  ]);
}
