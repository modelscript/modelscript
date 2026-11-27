// SPDX-License-Identifier: AGPL-3.0-or-later

import * as vscode from "vscode";
import { workspace } from "vscode";
import type { LanguageClient } from "vscode-languageclient/browser";
import { DiagramEditorProvider } from "../diagram-editor-provider.js";
import { PsoutEditorProvider } from "../psout-editor-provider.js";
import { RequirementsEditorProvider } from "../requirements-editor-provider.js";
import { StepEditorProvider } from "../step-editor-provider.js";
import { TabularPlotEditorProvider } from "../tabular-plot-editor-provider.js";

export type SafeRegisterCommand = (commandId: string, callback: (...args: never[]) => unknown) => vscode.Disposable;

export function resolveTargetDiagramViewType(filePath: string, languageId?: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".step") || lower.endsWith(".stp")) {
    return StepEditorProvider.viewType;
  }
  if (
    (lower.endsWith(".inp") || lower.endsWith(".inpt")) &&
    !lower.endsWith(".swmm.inp") &&
    !lower.endsWith(".epanet.inp") &&
    !lower.endsWith(".sima.inp") &&
    !lower.endsWith(".relap5.inp") &&
    !lower.endsWith(".aspen.inp") &&
    languageId === "fea"
  ) {
    return "modelscript.inpEditor";
  }
  if (lower.endsWith(".cfg") || lower.endsWith(".cfgt")) {
    return "modelscript.cfgEditor";
  }
  if (lower.endsWith(".sysml") || lower.endsWith(".sysml2")) {
    return "sysml2.diagramEditor";
  }
  if (lower.endsWith(".mo")) {
    return "modelica.diagramEditor";
  }
  if (lower.endsWith(".pscx") || lower.endsWith(".pslx") || lower.endsWith(".pswx") || lower.endsWith(".psmx")) {
    return "pscad.diagramEditor";
  }
  if (lower.endsWith(".psout")) {
    return PsoutEditorProvider.viewType;
  }
  if (lower.endsWith(".las") || lower.endsWith(".csv")) {
    return TabularPlotEditorProvider.viewType;
  }
  return DiagramEditorProvider.viewType;
}

export function registerDiagramNavigationCommands(
  context: vscode.ExtensionContext,
  getClient: () => LanguageClient | undefined,
  safeRegisterCommand: SafeRegisterCommand,
): vscode.Disposable[] {
  return [
    safeRegisterCommand("modelscript.openDiagram", async (uriArg?: unknown) => {
      const activeEditor = vscode.window.activeTextEditor;
      let docUri: vscode.Uri | undefined;
      if (typeof uriArg === "string") {
        docUri = vscode.Uri.parse(uriArg);
      } else if (uriArg instanceof vscode.Uri) {
        docUri = uriArg;
      } else if (uriArg && typeof (uriArg as { uri?: unknown }).uri === "string") {
        docUri = vscode.Uri.parse((uriArg as { uri: string }).uri);
      } else if (activeEditor?.document && activeEditor.document.uri.scheme !== "output") {
        docUri = activeEditor.document.uri;
      }

      if (docUri) {
        try {
          if (docUri.scheme === "memfs" && activeEditor?.document.uri.toString() === docUri.toString()) {
            const content = new TextEncoder().encode(activeEditor.document.getText());
            await workspace.fs.writeFile(docUri, content);
          }
          const targetViewType = resolveTargetDiagramViewType(docUri.path, activeEditor?.document.languageId);
          try {
            await vscode.commands.executeCommand("vscode.openWith", docUri, targetViewType, vscode.ViewColumn.Beside);
          } catch {
            await vscode.commands.executeCommand(
              "vscode.openWith",
              docUri,
              DiagramEditorProvider.viewType,
              vscode.ViewColumn.Beside,
            );
          }
        } catch (e: unknown) {
          vscode.window.showErrorMessage(`Failed to open diagram: ${(e as Error)?.message || e}`);
        }
      }
    }),

    safeRegisterCommand("modelscript.openDiagramSource", () => {
      const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
      if (
        tab?.input instanceof vscode.TabInputCustom &&
        (tab.input.viewType === DiagramEditorProvider.viewType ||
          tab.input.viewType === TabularPlotEditorProvider.viewType ||
          tab.input.viewType.endsWith(".diagramEditor"))
      ) {
        vscode.window.showTextDocument(tab.input.uri, { viewColumn: vscode.ViewColumn.One });
      }
    }),

    safeRegisterCommand("modelscript.addToDiagram", async (firstArg: unknown) => {
      const client = getClient();
      if (!client) return;

      let className: string | undefined;
      if (firstArg && typeof firstArg === "object" && "info" in firstArg) {
        const item = firstArg as { info: { compositeName: string } };
        className = item.info.compositeName;
      } else if (firstArg && typeof firstArg === "object" && "elementInfo" in firstArg) {
        const item = firstArg as { elementInfo: { type: string; element?: { elementType: string } | undefined } };
        if (item.elementInfo.type === "element" && item.elementInfo.element) {
          className = item.elementInfo.element.elementType;
        }
      } else if (typeof firstArg === "string") {
        className = firstArg;
      }

      if (!className) return;

      let docUri = vscode.window.activeTextEditor?.document.uri.toString();
      if (!docUri) {
        const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
        if (
          tab?.input instanceof vscode.TabInputCustom &&
          (tab.input.viewType === DiagramEditorProvider.viewType || tab.input.viewType.endsWith(".diagramEditor"))
        ) {
          docUri = tab.input.uri.toString();
        }
      }
      if (!docUri) {
        vscode.window.showWarningMessage("Open a diagram or model file first.");
        return;
      }

      try {
        const response = await client.sendRequest<{
          edits?:
            | {
                range: {
                  start: { line: number; character: number };
                  end: { line: number; character: number };
                };
                newText: string;
              }[]
            | undefined;
        }>("modelscript/diagram.applyEdits", {
          uri: docUri,
          seq: 0,
          actions: [{ type: "addComponent", className, x: 0, y: 0 }],
        });
        const edits = response?.edits;
        if (edits && edits.length > 0) {
          const workspaceEdit = new vscode.WorkspaceEdit();
          const uri = vscode.Uri.parse(docUri);
          for (const edit of edits) {
            const range = new vscode.Range(
              edit.range.start.line,
              edit.range.start.character,
              edit.range.end.line,
              edit.range.end.character,
            );
            workspaceEdit.replace(uri, range, edit.newText);
          }
          await vscode.workspace.applyEdit(workspaceEdit);
          const displayName = className.split(".").pop() || className;
          vscode.window.showInformationMessage(`Added ${displayName} to model.`);
          setTimeout(() => {
            vscode.commands.executeCommand("modelscript.autoLayout");
          }, 600);
        }
      } catch (e) {
        vscode.window.showErrorMessage(`Failed to add component: ${e}`);
      }
    }),

    safeRegisterCommand("modelscript.openRequirements", async () => {
      const editor = vscode.window.activeTextEditor;
      if (editor?.document) {
        await vscode.commands.executeCommand(
          "vscode.openWith",
          editor.document.uri,
          RequirementsEditorProvider.viewType,
        );
      } else {
        vscode.window.showWarningMessage("Open a model file first.");
      }
    }),

    safeRegisterCommand("modelscript.owl2.goToDeclaration", async (iri: string) => {
      if (!iri) return;
      const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
        "vscode.executeWorkspaceSymbolProvider",
        iri,
      );
      const match = symbols?.find((s) => s.name === iri || s.containerName === iri) ?? symbols?.[0];
      if (match?.location) {
        const doc = await vscode.workspace.openTextDocument(match.location.uri);
        const editor = await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One });
        editor.selection = new vscode.Selection(match.location.range.start, match.location.range.end);
        editor.revealRange(match.location.range, vscode.TextEditorRevealType.InCenter);
      } else {
        vscode.window.showInformationMessage(`Navigating to OWL2 IRI: ${iri}`);
      }
    }),

    safeRegisterCommand("modelscript.decomposeRegions", async (uri?: string, actionName?: string) => {
      const client = getClient();
      if (!client) return;
      const targetUri = uri || vscode.window.activeTextEditor?.document.uri.toString();
      if (!targetUri) return;
      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Computing symbolic region decomposition for ${actionName || "action"}...`,
          cancellable: false,
        },
        async () => {
          try {
            const res = await client.sendRequest<{
              success?: boolean | undefined;
              result?: { regions?: unknown[] | undefined } | undefined;
            }>("modelscript/decomposeRegions", {
              uri: targetUri,
            });
            if (res?.success) {
              vscode.window.showInformationMessage(
                `Decomposed ${res.result?.regions?.length ?? 0} non-overlapping invariant regions with Octagon difference bounds.`,
              );
            }
          } catch (e: unknown) {
            vscode.window.showErrorMessage(
              `Region decomposition failed: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        },
      );
    }),

    safeRegisterCommand("modelscript.openSimulationView", async (uri?: vscode.Uri | string, className?: string) => {
      await vscode.commands.executeCommand("modelscript.runSimulation", uri, className);
    }),

    safeRegisterCommand(
      "modelscript.runPhysicsSimulation",
      async (args?: { uri: string; className?: string | undefined }) => {
        const client = getClient();
        if (!client) return;
        const uri = args?.uri || vscode.window.activeTextEditor?.document.uri.toString();
        if (!uri) return;
        const className = args?.className;

        vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Running multi-physics simulation for ${className || "study"}...`,
            cancellable: false,
          },
          async () => {
            try {
              const { CadViewerPanel } = await import("../cad-viewer-panel.js");
              CadViewerPanel.createOrShow(context.extensionUri, client);

              const result = await client.sendRequest<{ error?: string | undefined }>("modelscript/simulatePhysics", {
                uri,
                className,
                physicsType: "FEA",
              });

              if (result?.error) {
                vscode.window.showErrorMessage(`Simulation failed: ${result.error}`);
              } else {
                vscode.window.showInformationMessage("Physics co-simulation completed successfully.");
              }
            } catch (err: unknown) {
              vscode.window.showErrorMessage(
                `Failed to run physics simulation: ${err instanceof Error ? err.message : String(err)}`,
              );
            }
          },
        );
      },
    ),

    safeRegisterCommand("modelscript.openChat", () => {
      vscode.commands.executeCommand("modelscript.chat.focus");
    }),

    safeRegisterCommand("modelscript.openMultibodyAnimation", async (args?: { uri?: string | undefined }) => {
      const client = getClient();
      if (!client) return;
      const uri = args?.uri || vscode.window.activeTextEditor?.document.uri.toString();
      if (!uri) return;

      const docText = vscode.window.activeTextEditor?.document.getText();
      const { MultiBodyAnimationPanel } = await import("../multibody-animation-panel.js");
      MultiBodyAnimationPanel.createOrShow(
        context.extensionUri,
        client,
        { t: [0], y: [[0]], states: ["time"] },
        uri,
        docText,
      );
    }),
  ];
}
