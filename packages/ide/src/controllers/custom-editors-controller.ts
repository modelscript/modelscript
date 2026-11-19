// SPDX-License-Identifier: AGPL-3.0-or-later

import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/browser.js";
import { AcceleratorLatticeEditorProvider } from "../accelerator-lattice-panel.js";
import { ClimateRasterEditorProvider } from "../climate-raster-panel.js";
import { CrystallographyEditorProvider } from "../crystallography-panel.js";
import { DiagramEditorProvider } from "../diagram-editor-provider.js";
import { registerDslUiPanels } from "../dsl-custom-editor-provider.js";
import { ElementTableProvider } from "../element-table-provider.js";
import { FitsImageViewerEditorProvider } from "../fits-image-panel.js";
import { FMU_VIEW_SCHEME, FmuContentProvider, FmuEditorProvider } from "../fmu-document-provider.js";
import { GCodeEditorProvider } from "../gcode-editor-provider.js";
import { HepEventViewerEditorProvider } from "../hep-event-panel.js";
import { NeuralSpikeViewerEditorProvider } from "../neural-spike-panel.js";
import { OpticalBenchEditorProvider } from "../optical-bench-panel.js";
import { PsoutEditorProvider } from "../psout-editor-provider.js";
import { QuantumChemistryEditorProvider } from "../quantum-chemistry-panel.js";
import { ReactionCoordinateEditorProvider } from "../reaction-coordinate-panel.js";
import { RequirementsEditorProvider } from "../requirements-editor-provider.js";
import { SeismicViewerEditorProvider } from "../seismic-viewer-panel.js";
import type { StepCompilationService } from "../services/step-compilation-service.js";
import { SSP_VIEW_SCHEME, SspContentProvider, SspEditorProvider } from "../ssp-document-provider.js";
import { StepEditorProvider } from "../step-editor-provider.js";
import { TabularPlotEditorProvider } from "../tabular-plot-editor-provider.js";
import { TokamakEquilibriumEditorProvider } from "../tokamak-equilibrium-panel.js";
import { WaterDiffEditorProvider } from "../water-diff-panel.js";

export interface CustomEditorsControllerResult {
  fmuContentProvider: FmuContentProvider;
  sspContentProvider: SspContentProvider;
  diagramProvider: DiagramEditorProvider;
}

export function registerCustomEditors(
  context: vscode.ExtensionContext,
  client: LanguageClient,
  stepCompilationService?: StepCompilationService,
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
    "mlxtran.diagramEditor",
    "nmodl.diagramEditor",
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
    "qif.diagramEditor",
    "oscal.diagramEditor",
    "automationml.diagramEditor",
    "usd.diagramEditor",
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
  const stepEditor = new StepEditorProvider(context, client, stepCompilationService);
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

  const psoutEditor = new PsoutEditorProvider(context);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(PsoutEditorProvider.viewType, psoutEditor, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  const tabularPlotEditor = new TabularPlotEditorProvider(context);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(TabularPlotEditorProvider.viewType, tabularPlotEditor, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  const reactionCoordinateEditor = new ReactionCoordinateEditorProvider(context);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(ReactionCoordinateEditorProvider.viewType, reactionCoordinateEditor, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  const climateRasterEditor = new ClimateRasterEditorProvider(context);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(ClimateRasterEditorProvider.viewType, climateRasterEditor, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  const seismicViewerEditor = new SeismicViewerEditorProvider(context);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(SeismicViewerEditorProvider.viewType, seismicViewerEditor, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  const waterDiffEditor = new WaterDiffEditorProvider(context);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(WaterDiffEditorProvider.viewType, waterDiffEditor, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  const crystallographyEditor = new CrystallographyEditorProvider(context);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(CrystallographyEditorProvider.viewType, crystallographyEditor, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  const tokamakEditor = new TokamakEquilibriumEditorProvider(context);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(TokamakEquilibriumEditorProvider.viewType, tokamakEditor, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  const fitsEditor = new FitsImageViewerEditorProvider(context);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(FitsImageViewerEditorProvider.viewType, fitsEditor, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  const acceleratorEditor = new AcceleratorLatticeEditorProvider(context);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(AcceleratorLatticeEditorProvider.viewType, acceleratorEditor, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  const hepEventEditor = new HepEventViewerEditorProvider(context);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(HepEventViewerEditorProvider.viewType, hepEventEditor, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  const qcEditor = new QuantumChemistryEditorProvider(context);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(QuantumChemistryEditorProvider.viewType, qcEditor, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  const neuralEditor = new NeuralSpikeViewerEditorProvider(context);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(NeuralSpikeViewerEditorProvider.viewType, neuralEditor, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  const optEditor = new OpticalBenchEditorProvider(context);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(OpticalBenchEditorProvider.viewType, optEditor, {
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

  // 6. Declarative Language DSL UI Panels (`languages/<lang>/src/ui/*`)
  void registerDslUiPanels(context, client).catch((err) => {
    console.warn("[ide-client] Failed to register DSL UI panels:", err);
  });

  return {
    fmuContentProvider,
    sspContentProvider,
    diagramProvider,
  };
}
