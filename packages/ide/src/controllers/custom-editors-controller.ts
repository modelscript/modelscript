// SPDX-License-Identifier: AGPL-3.0-or-later

import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/browser.js";
import { AcceleratorLatticeEditorProvider } from "../accelerator-lattice-panel.js";
import { AmlEditorProvider } from "../aml-editor-provider.js";
import { CfgEditorProvider } from "../cfg-editor-provider.js";
import { ClimateRasterEditorProvider } from "../climate-raster-panel.js";
import { CrystallographyEditorProvider } from "../crystallography-panel.js";
import { DiagramEditorProvider } from "../diagram-editor-provider.js";
import { Easy5EditorProvider } from "../easy5-editor-provider.js";
import { NmodlEditorProvider } from "../electrophysiology-panel.js";
import { ElementTableProvider } from "../element-table-provider.js";
import { FitsImageViewerEditorProvider } from "../fits-image-panel.js";
import { FMU_VIEW_SCHEME, FmuContentProvider, FmuEditorProvider } from "../fmu-document-provider.js";
import { GCodeEditorProvider } from "../gcode-editor-provider.js";
import { GtSuiteEditorProvider } from "../gtsuite-editor-provider.js";
import { HepEventViewerEditorProvider } from "../hep-event-panel.js";
import { InpEditorProvider } from "../inp-editor-provider.js";
import { LpsEditorProvider } from "../lps-editor-provider.js";
import { DicomRtEditorProvider, IgtlEditorProvider, OpenSimEditorProvider } from "../medical-editor-provider.js";
import { PdbEditorProvider } from "../molstar-panel.js";
import { NeuralSpikeViewerEditorProvider } from "../neural-spike-panel.js";
import { OlgaEditorProvider } from "../olga-editor-provider.js";
import { OpticalBenchEditorProvider } from "../optical-bench-panel.js";
import { OscalEditorProvider } from "../oscal-editor-provider.js";
import { PsoutEditorProvider } from "../psout-editor-provider.js";
import { QifEditorProvider } from "../qif-editor-provider.js";
import { QuantumChemistryEditorProvider } from "../quantum-chemistry-panel.js";
import { RawEditorProvider } from "../raw-editor-provider.js";
import { ReactionCoordinateEditorProvider } from "../reaction-coordinate-panel.js";
import { RequirementsEditorProvider } from "../requirements-editor-provider.js";
import { RocetsEditorProvider } from "../rocets-editor-provider.js";
import { SeismicViewerEditorProvider } from "../seismic-viewer-panel.js";
import { SimaEditorProvider } from "../sima-editor-provider.js";
import { SSP_VIEW_SCHEME, SspContentProvider, SspEditorProvider } from "../ssp-document-provider.js";
import { StepEditorProvider } from "../step-editor-provider.js";
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

  const qifEditor = new QifEditorProvider(context);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(QifEditorProvider.viewType, qifEditor, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  const oscalEditor = new OscalEditorProvider(context);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(OscalEditorProvider.viewType, oscalEditor, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  const amlEditor = new AmlEditorProvider(context);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(AmlEditorProvider.viewType, amlEditor, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  const opensimEditor = new OpenSimEditorProvider(context);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(OpenSimEditorProvider.viewType, opensimEditor, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  const dicomRtEditor = new DicomRtEditorProvider(context);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(DicomRtEditorProvider.viewType, dicomRtEditor, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  const igtlEditor = new IgtlEditorProvider(context);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(IgtlEditorProvider.viewType, igtlEditor, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  const pdbEditor = new PdbEditorProvider(context);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(PdbEditorProvider.viewType, pdbEditor, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  const nmodlEditor = new NmodlEditorProvider(context);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(NmodlEditorProvider.viewType, nmodlEditor, {
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

  return {
    fmuContentProvider,
    sspContentProvider,
    diagramProvider,
  };
}
