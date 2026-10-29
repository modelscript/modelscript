// SPDX-License-Identifier: AGPL-3.0-or-later

import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/browser.js";
import { CfgEditorProvider } from "../cfg-editor-provider.js";
import { DiagramEditorProvider } from "../diagram-editor-provider.js";
import { Easy5EditorProvider } from "../easy5-editor-provider.js";
import { ElementTableProvider } from "../element-table-provider.js";
import { FMU_VIEW_SCHEME, FmuContentProvider, FmuEditorProvider } from "../fmu-document-provider.js";
import { GCodeEditorProvider } from "../gcode-editor-provider.js";
import { GtSuiteEditorProvider } from "../gtsuite-editor-provider.js";
import { InpEditorProvider } from "../inp-editor-provider.js";
import { LpsEditorProvider } from "../lps-editor-provider.js";
import { OlgaEditorProvider } from "../olga-editor-provider.js";
import { PsoutEditorProvider } from "../psout-editor-provider.js";
import { RawEditorProvider } from "../raw-editor-provider.js";
import { RequirementsEditorProvider } from "../requirements-editor-provider.js";
import { RocetsEditorProvider } from "../rocets-editor-provider.js";
import { SimaEditorProvider } from "../sima-editor-provider.js";
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
    "adams.diagramEditor",
    "aspen.diagramEditor",
    "autosar.diagramEditor",
    "c.diagramEditor",
    "ccsds.diagramEditor",
    "easy5.diagramEditor",
    "eclipse.diagramEditor",
    "energyplus.diagramEditor",
    "epanet.diagramEditor",
    "fortran.diagramEditor",
    "gensys.diagramEditor",
    "gtsuite.diagramEditor",
    "ibis.diagramEditor",
    "jsbsim.diagramEditor",
    "lps.diagramEditor",
    "olga.diagramEditor",
    "opendrive.diagramEditor",
    "opendss.diagramEditor",
    "openscenario.diagramEditor",
    "plcopen.diagramEditor",
    "psse.diagramEditor",
    "relap5.diagramEditor",
    "reqif.diagramEditor",
    "rocets.diagramEditor",
    "sbml.diagramEditor",
    "sima.diagramEditor",
    "simpack.diagramEditor",
    "simulink.diagramEditor",
    "spice.diagramEditor",
    "swmm.diagramEditor",
    "touchstone.diagramEditor",
    "urdf.diagramEditor",
    "verilog-a.diagramEditor",
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
      supportsMultipleEditorsPerDocument: true,
    }),
    vscode.commands.registerCommand("modelscript.openRawWorkbench", async (uriArg?: string | vscode.Uri) => {
      const targetUri =
        typeof uriArg === "string"
          ? vscode.Uri.parse(uriArg)
          : uriArg instanceof vscode.Uri
            ? uriArg
            : vscode.window.activeTextEditor?.document.uri;
      if (!targetUri) {
        vscode.window.showWarningMessage("No active PSS/E (.raw) document found to open in Grid Workbench.");
        return;
      }
      await vscode.commands.executeCommand(
        "vscode.openWith",
        targetUri,
        RawEditorProvider.viewType,
        vscode.ViewColumn.Beside,
      );
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

  const easy5Editor = new Easy5EditorProvider(context);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(Easy5EditorProvider.viewType, easy5Editor, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  const rocetsEditor = new RocetsEditorProvider(context);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(RocetsEditorProvider.viewType, rocetsEditor, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  const lpsEditor = new LpsEditorProvider(context);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(LpsEditorProvider.viewType, lpsEditor, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  const simaEditor = new SimaEditorProvider(context);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(SimaEditorProvider.viewType, simaEditor, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  const gtsuiteEditor = new GtSuiteEditorProvider(context);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(GtSuiteEditorProvider.viewType, gtsuiteEditor, {
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
