// SPDX-License-Identifier: AGPL-3.0-or-later

import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/browser.js";
import { CfgEditorProvider } from "../cfg-editor-provider.js";
import { DiagramEditorProvider } from "../diagram-editor-provider.js";
import { ElementTableProvider } from "../element-table-provider.js";
import { FMU_VIEW_SCHEME, FmuContentProvider, FmuEditorProvider } from "../fmu-document-provider.js";
import { GCodeEditorProvider } from "../gcode-editor-provider.js";
import { InpEditorProvider } from "../inp-editor-provider.js";
import { OlgaEditorProvider } from "../olga-editor-provider.js";
import { PsoutEditorProvider } from "../psout-editor-provider.js";
import { RawEditorProvider } from "../raw-editor-provider.js";
import { RequirementsEditorProvider } from "../requirements-editor-provider.js";
import { SSP_VIEW_SCHEME, SspContentProvider, SspEditorProvider } from "../ssp-document-provider.js";
import { StepEditorProvider } from "../step-editor-provider.js";

export interface CustomEditorsControllerResult {
  fmuContentProvider: FmuContentProvider;
  sspContentProvider: SspContentProvider;
  diagramProvider: DiagramEditorProvider;
}

export function registerCustomEditors(
  context: vscode.ExtensionContext,
  client: LanguageClient,
): CustomEditorsControllerResult {
  // 1. Diagram Editor Provider
  const diagramProvider = new DiagramEditorProvider(context, client);
  const diagramViewTypes = [
    DiagramEditorProvider.viewType,
    "modelica.diagramEditor",
    "sysml2.diagramEditor",
    "sysml.diagramEditor",
    "step.diagramEditor",
    "scad.diagramEditor",
    "owl2.diagramEditor",
    "csv.diagramEditor",
    "pscad.diagramEditor",
    "cfd.diagramEditor",
    "fea.diagramEditor",
    "ssp.diagramEditor",
    "modelscript.diagramEditor",
  ];
  for (const vt of diagramViewTypes) {
    context.subscriptions.push(
      vscode.window.registerCustomEditorProvider(vt, diagramProvider, {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: true,
      }),
    );
  }

  // 2. FMU Provider
  const fmuContentProvider = new FmuContentProvider();
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(FMU_VIEW_SCHEME, fmuContentProvider));
  const fmuEditor = new FmuEditorProvider(fmuContentProvider);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(FmuEditorProvider.viewType, fmuEditor, {
      supportsMultipleEditorsPerDocument: false,
      webviewOptions: { retainContextWhenHidden: false },
    }),
  );

  // 3. SSP Provider
  const sspContentProvider = new SspContentProvider();
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(SSP_VIEW_SCHEME, sspContentProvider));
  const sspEditor = new SspEditorProvider(sspContentProvider);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(SspEditorProvider.viewType, sspEditor, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  // 4. STEP, GCode, INP, CFG, RAW, OLGA
  const stepEditor = new StepEditorProvider(context, client);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(StepEditorProvider.viewType, stepEditor, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  const gcodeEditor = new GCodeEditorProvider(context);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(GCodeEditorProvider.viewType, gcodeEditor, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  const inpEditor = new InpEditorProvider(context, client);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(InpEditorProvider.viewType, inpEditor, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  const cfgEditor = new CfgEditorProvider(context, client);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(CfgEditorProvider.viewType, cfgEditor, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  const rawEditor = new RawEditorProvider(context);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(RawEditorProvider.viewType, rawEditor, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  const olgaEditor = new OlgaEditorProvider(context);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(OlgaEditorProvider.viewType, olgaEditor, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  const psoutEditor = new PsoutEditorProvider(context);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(PsoutEditorProvider.viewType, psoutEditor, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  // 5. Requirements & Element Table
  const requirementsProvider = new RequirementsEditorProvider(context.extensionUri, client);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(RequirementsEditorProvider.viewType, requirementsProvider, {
      supportsMultipleEditorsPerDocument: true,
      webviewOptions: { retainContextWhenHidden: false },
    }),
  );

  const elementTableProvider = new ElementTableProvider(context.extensionUri, client);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(ElementTableProvider.viewType, elementTableProvider, {
      supportsMultipleEditorsPerDocument: true,
      webviewOptions: { retainContextWhenHidden: false },
    }),
  );

  return {
    fmuContentProvider,
    sspContentProvider,
    diagramProvider,
  };
}
