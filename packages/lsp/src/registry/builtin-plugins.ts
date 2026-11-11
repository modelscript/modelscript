// SPDX-License-Identifier: AGPL-3.0-or-later

import { adamsLanguage, getAdamsDocumentSymbols, getAdamsHover, validateAdams } from "@modelscript/adams";
import { amplLanguage, getAmplDocumentSymbols, getAmplHover, validateAmpl } from "@modelscript/ampl";
import {
  antimonyLanguage,
  getAntimonyDocumentSymbols,
  getAntimonyHover,
  validateAntimony,
} from "@modelscript/antimony";
import { aspenLanguage, getAspenDocumentSymbols, getAspenHover, validateAspen } from "@modelscript/aspen";
import {
  automationMLLanguage,
  getAutomationMLDocumentSymbols,
  getAutomationMLHover,
  validateAutomationML,
} from "@modelscript/automationml";
import { autosarLanguage, getAutosarDocumentSymbols, getAutosarHover, validateAutosar } from "@modelscript/autosar";
import { bnglLanguage, getBnglDocumentSymbols, getBnglHover, validateBngl } from "@modelscript/bngl";
import { cLanguage } from "@modelscript/c";
import { canteraLanguage, getCanteraDocumentSymbols, getCanteraHover, validateCantera } from "@modelscript/cantera";
import { ccsdsLanguage, getCcsdsDocumentSymbols, getCcsdsHover, validateCcsds } from "@modelscript/ccsds";
import { cellmlLanguage, getCellmlDocumentSymbols, getCellmlHover, validateCellml } from "@modelscript/cellml";
import { cfdLanguage, getCfdDocumentSymbols, getCfdHover, validateCfd } from "@modelscript/cfd";
import { cgmesLanguage, lintCgmesModel, parseCgmesRdf } from "@modelscript/cgmes";
import csvLangFallback from "@modelscript/csv/language";
import { dicomRtLanguage, getDicomRtDocumentSymbols, getDicomRtHover, validateDicomRt } from "@modelscript/dicom-rt";
import { easy5Language, getEasy5DocumentSymbols, getEasy5Hover, validateEasy5 } from "@modelscript/easy5";
import { eclipseLanguage, getEclipseDocumentSymbols, getEclipseHover, validateEclipse } from "@modelscript/eclipse";
import {
  energyplusLanguage,
  getEnergyPlusDocumentSymbols,
  getEnergyPlusHover,
  validateEnergyPlus,
} from "@modelscript/energyplus";
import { epanetLanguage, getEpanetDocumentSymbols, getEpanetHover, validateEpanet } from "@modelscript/epanet";
import { feaLanguage, getFeaDocumentSymbols, getFeaHover, validateFea } from "@modelscript/fea";
import { febioLanguage, getFebioDocumentSymbols, getFebioHover, validateFebio } from "@modelscript/febio";
import { fiberLanguage } from "@modelscript/fiber";
import { fortranLanguage } from "@modelscript/fortran";
import { genbankLanguage, getGenbankDocumentSymbols, getGenbankHover, validateGenbank } from "@modelscript/genbank";
import { gensysLanguage, getGensysDocumentSymbols, getGensysHover, validateGensys } from "@modelscript/gensys";
import { getGpromsDocumentSymbols, getGpromsHover, gpromsLanguage, validateGproms } from "@modelscript/gproms";
import { getGtfsDocumentSymbols, getGtfsHover, gtfsLanguage, validateGtfs } from "@modelscript/gtfs";
import { getGtsuiteDocumentSymbols, getGtsuiteHover, gtsuiteLanguage, validateGtsuite } from "@modelscript/gtsuite";
import { getHecRasDocumentSymbols, getHecRasHover, hecRasLanguage, validateHecRas } from "@modelscript/hec-ras";
import { getIbisDocumentSymbols, getIbisHover, ibisLanguage, validateIbis } from "@modelscript/ibis";
import { getIgtlDocumentSymbols, getIgtlHover, igtlLanguage, validateIgtl } from "@modelscript/igtl";
import { getJsbsimDocumentSymbols, getJsbsimHover, jsbsimLanguage, validateJsbsim } from "@modelscript/jsbsim";
import { getLandgemDocumentSymbols, getLandgemHover, landgemLanguage, validateLandgem } from "@modelscript/landgem";
import { getLpsDocumentSymbols, getLpsHover, lpsLanguage, validateLps } from "@modelscript/lps";
import { modelicaActionHandlers, modelicaLanguage } from "@modelscript/modelica";
import { createModelicaQueryEngine } from "@modelscript/modelica/factory";
import modelicaLangFallback from "@modelscript/modelica/language";
import modelscriptLangFallback from "@modelscript/modelscript/language";
import { getModflowDocumentSymbols, getModflowHover, modflowLanguage, validateModflow } from "@modelscript/modflow";
import { getNiftiDocumentSymbols, getNiftiHover, niftiLanguage, validateNifti } from "@modelscript/nifti";
import { getNmtranDocumentSymbols, getNmtranHover, nmtranLanguage, validateNmtran } from "@modelscript/nmtran";
import { getOcppDocumentSymbols, getOcppHover, ocppLanguage, validateOcpp } from "@modelscript/ocpp";
import { getOlgaDocumentSymbols, getOlgaHover, olgaLanguage, validateOlga } from "@modelscript/olga";
import { getOpenAdrDocumentSymbols, getOpenAdrHover, openadrLanguage, validateOpenAdr } from "@modelscript/openadr";
import {
  getOpenDriveDocumentSymbols,
  getOpenDriveHover,
  opendriveLanguage,
  validateOpenDrive,
} from "@modelscript/opendrive";
import { getOpenDssDocumentSymbols, getOpenDssHover, openDssLanguage, validateOpenDss } from "@modelscript/opendss";
import {
  getOpenScenarioDocumentSymbols,
  getOpenScenarioHover,
  openScenarioLanguage,
  validateOpenScenario,
} from "@modelscript/openscenario";
import { getOpenSimDocumentSymbols, getOpenSimHover, openSimLanguage, validateOpenSim } from "@modelscript/opensim";
import { lintOpticalTopology, opticalLanguage, parseOpenRoadmTopology } from "@modelscript/optical";
import { getOscalDocumentSymbols, getOscalHover, oscalLanguage, validateOscal } from "@modelscript/oscal";
import { createOWL2QueryEngine } from "@modelscript/owl2/factory";
import owl2LangFallback from "@modelscript/owl2/language";
import { getPdbDocumentSymbols, getPdbHover, pdbLanguage, validatePdb } from "@modelscript/pdb";
import { getPhreeqcDocumentSymbols, getPhreeqcHover, phreeqcLanguage, validatePhreeqc } from "@modelscript/phreeqc";
import { getPlcopenDocumentSymbols, getPlcopenHover, plcopenLanguage, validatePlcopen } from "@modelscript/plcopen";
import { lintPowerFactoryModel, parsePowerFactoryXml, powerFactoryLanguage } from "@modelscript/powerfactory";
import { pscadLanguage } from "@modelscript/pscad";
import { lintPslfDyd, lintPslfEpc, parsePslfDyd, parsePslfEpc, pslfLanguage } from "@modelscript/pslf";
import {
  getMergedPsseCase,
  getPsseCompletions,
  getPsseDefinition,
  getPsseDocumentSymbols,
  getPsseHover,
  getPsseReferences,
  psseLanguage,
  validatePsse,
} from "@modelscript/psse";
import { getQifDocumentSymbols, getQifHover, qifLanguage, validateQif } from "@modelscript/qif";
import { lintAntennaPatternDeck, parseNsmaAdf, parsePlanetPat, ranLanguage } from "@modelscript/ran";
import { getRelap5DocumentSymbols, getRelap5Hover, relap5Language, validateRelap5 } from "@modelscript/relap5";
import { getReqifDocumentSymbols, getReqifHover, reqifLanguage, validateReqif } from "@modelscript/reqif";
import { getRocetsDocumentSymbols, getRocetsHover, rocetsLanguage, validateRocets } from "@modelscript/rocets";
import { getSbmlDocumentSymbols, getSbmlHover, sbmlLanguage, validateSbml } from "@modelscript/sbml";
import { getSbolDocumentSymbols, getSbolHover, sbolLanguage, validateSbol } from "@modelscript/sbol";
import scadLangFallback from "@modelscript/scad/language";
import { getSedmlDocumentSymbols, getSedmlHover, sedmlLanguage, validateSedml } from "@modelscript/sedml";
import { getSimaDocumentSymbols, getSimaHover, simaLanguage, validateSima } from "@modelscript/sima";
import { getSimpackDocumentSymbols, getSimpackHover, simpackLanguage, validateSimpack } from "@modelscript/simpack";
import {
  getSimulinkDocumentSymbols,
  getSimulinkHover,
  simulinkLanguage,
  validateSimulink,
} from "@modelscript/simulink";
import { getSmilesDocumentSymbols, getSmilesHover, smilesLanguage, validateSmiles } from "@modelscript/smiles";
import { getSpiceDocumentSymbols, getSpiceHover, spiceLanguage, validateSpice } from "@modelscript/spice";
import { sspLanguage } from "@modelscript/ssp";
import { stepLanguage } from "@modelscript/step";
import { getSwmmDocumentSymbols, getSwmmHover, swmmLanguage, validateSwmm } from "@modelscript/swmm";
import { createSysML2QueryEngine } from "@modelscript/sysml2/factory";
import sysml2LangFallback from "@modelscript/sysml2/language";
import { getThreeMfDocumentSymbols, getThreeMfHover, threeMfLanguage, validateThreeMf } from "@modelscript/three-mf";
import { getTopasDocumentSymbols, getTopasHover, topasLanguage, validateTopas } from "@modelscript/topas";
import {
  getTouchstoneDocumentSymbols,
  getTouchstoneHover,
  touchstoneLanguage,
  validateTouchstone,
} from "@modelscript/touchstone";
import { getToughDocumentSymbols, getToughHover, toughLanguage, validateTough } from "@modelscript/tough";
import { getUrdfDocumentSymbols, getUrdfHover, urdfLanguage, validateUrdf } from "@modelscript/urdf";
import { usdLanguage, UsdLspService } from "@modelscript/usd";
import {
  getVerilogADocumentSymbols,
  getVerilogAHover,
  validateVerilogA,
  verilogALanguage,
} from "@modelscript/verilog-a";
import {
  createOpenDriveDiagramBackend,
  createPscadDiagramBackend,
  createSimulinkDiagramBackend,
  createSpiceDiagramBackend,
  createSspDiagramBackend,
} from "../diagrams/index.js";
import type { ParserService } from "../services/parser-service.js";
import type { WorkspaceManager } from "../services/workspace-manager.js";
import { globalLanguageRegistry } from "./LanguageRegistry.js";

export interface BuiltinPluginsOptions {
  workspaceManager: WorkspaceManager;
  parserService?: ParserService | undefined;
  connection?:
    | {
        console: {
          info: (msg: string) => void;
          warn: (msg: string) => void;
          error?: (msg: string) => void;
        };
      }
    | undefined;
}

/**
 * Registers all 44 built-in domain language plugins and their associated workspace
 * indexes in `workspaceManager` and `globalLanguageRegistry`.
 */
export function registerBuiltinLanguagePlugins(options: BuiltinPluginsOptions): void {
  const { workspaceManager, parserService, connection } = options;

  function ensureWorkspaceIndex<T>(id: string, factory: () => T, langFallback?: any): T {
    let ws = workspaceManager.getWorkspaceIndex(id);
    if (!ws) {
      ws = factory();
      workspaceManager.setWorkspaceIndex(id, ws);
    }
    workspaceManager.unifiedWorkspace.registerWorkspace(id, ws, langFallback ?? { priority: 2 });
    return ws as T;
  }

  // 1. Core Systems & Modeling Languages
  ensureWorkspaceIndex("modelica", () => workspaceManager.getWorkspaceIndex("modelica"), modelicaLangFallback);
  ensureWorkspaceIndex("sysml2", () => workspaceManager.getWorkspaceIndex("sysml2"), sysml2LangFallback);
  ensureWorkspaceIndex("sysml", () => workspaceManager.getWorkspaceIndex("sysml2"), sysml2LangFallback);
  ensureWorkspaceIndex("owl2", () => workspaceManager.getWorkspaceIndex("owl2"), owl2LangFallback);

  globalLanguageRegistry.register({
    id: "modelica",
    name: "Modelica",
    extensions: [".mo", ".mos", ".msim"],
    get parser() {
      return parserService?.getParser("modelica");
    },
    set parser(val: any) {
      if (parserService && parserService.getParser("modelica") !== val) {
        parserService.registerParser("modelica", val);
      }
    },
    get facade() {
      return parserService?.getFacade("modelica");
    },
    set facade(val: any) {
      if (parserService && parserService.getFacade("modelica") !== val) {
        parserService.registerParser("modelica", parserService.getParser("modelica"), val);
      }
    },
    workspaceIndex: workspaceManager.getWorkspaceIndex("modelica"),
    get queryEngine() {
      return workspaceManager.getQueryEngine("modelica") ?? undefined;
    },
    set queryEngine(val) {
      workspaceManager.setQueryEngine("modelica", val ?? null);
    },
    createQueryEngine: (idx: any, tree?: any) => createModelicaQueryEngine(idx, tree),
    languageDef: modelicaLanguage,
    handlers: modelicaLanguage.lsp?.handlers,
    actionHandlers: modelicaActionHandlers,
  });

  globalLanguageRegistry.register({
    id: "sysml",
    name: "SysML v2",
    extensions: [".sysml", ".sysml2"],
    get parser() {
      return parserService?.getParser("sysml2");
    },
    set parser(val: any) {
      if (parserService && parserService.getParser("sysml2") !== val) {
        parserService.registerParser("sysml2", val);
      }
    },
    get facade() {
      return parserService?.getFacade("sysml2");
    },
    set facade(val: any) {
      if (parserService && parserService.getFacade("sysml2") !== val) {
        parserService.registerParser("sysml2", parserService.getParser("sysml2"), val);
      }
    },
    workspaceIndex: workspaceManager.getWorkspaceIndex("sysml2"),
    get queryEngine() {
      return workspaceManager.getQueryEngine("sysml2") ?? undefined;
    },
    set queryEngine(val) {
      workspaceManager.setQueryEngine("sysml2", val ?? null);
    },
    createQueryEngine: (idx: any, tree?: any) => createSysML2QueryEngine(idx, tree),
    languageDef: sysml2LangFallback,
  });

  globalLanguageRegistry.register({
    id: "sysml2",
    name: "SysML v2",
    extensions: [".sysml", ".sysml2"],
    get parser() {
      return parserService?.getParser("sysml2");
    },
    set parser(val: any) {
      if (parserService && parserService.getParser("sysml2") !== val) {
        parserService.registerParser("sysml2", val);
      }
    },
    get facade() {
      return parserService?.getFacade("sysml2");
    },
    set facade(val: any) {
      if (parserService && parserService.getFacade("sysml2") !== val) {
        parserService.registerParser("sysml2", parserService.getParser("sysml2"), val);
      }
    },
    workspaceIndex: workspaceManager.getWorkspaceIndex("sysml2"),
    get queryEngine() {
      return workspaceManager.getQueryEngine("sysml2") ?? undefined;
    },
    set queryEngine(val) {
      workspaceManager.setQueryEngine("sysml2", val ?? null);
    },
    createQueryEngine: (idx: any, tree?: any) => createSysML2QueryEngine(idx, tree),
    languageDef: sysml2LangFallback,
  });

  globalLanguageRegistry.register({
    id: "step",
    name: "STEP",
    extensions: [".step", ".stp", ".p21"],
    get parser() {
      return parserService?.getParser("step");
    },
    set parser(val: any) {
      if (parserService && parserService.getParser("step") !== val) {
        parserService.registerParser("step", val);
      }
    },
    get facade() {
      return parserService?.getFacade("step");
    },
    set facade(val: any) {
      if (parserService && parserService.getFacade("step") !== val) {
        parserService.registerParser("step", parserService.getParser("step"), val);
      }
    },
    get queryEngine() {
      return workspaceManager.getQueryEngine("step") ?? undefined;
    },
    set queryEngine(val) {
      workspaceManager.setQueryEngine("step", val ?? null);
    },
    languageDef: stepLanguage,
    handlers: stepLanguage.lsp?.handlers,
  });

  globalLanguageRegistry.register({
    id: "owl2",
    name: "OWL2",
    extensions: [".owl", ".owl2", ".ttl", ".ofn", ".fss"],
    get parser() {
      return parserService?.getParser("owl2");
    },
    set parser(val: any) {
      if (parserService && parserService.getParser("owl2") !== val) {
        parserService.registerParser("owl2", val);
      }
    },
    get facade() {
      return parserService?.getFacade("owl2");
    },
    set facade(val: any) {
      if (parserService && parserService.getFacade("owl2") !== val) {
        parserService.registerParser("owl2", parserService.getParser("owl2"), val);
      }
    },
    get workspaceIndex() {
      return workspaceManager.getWorkspaceIndex("owl2");
    },
    get queryEngine() {
      return workspaceManager.getQueryEngine("owl2") ?? undefined;
    },
    set queryEngine(val) {
      workspaceManager.setQueryEngine("owl2", val ?? null);
    },
    createQueryEngine: (idx: any, tree?: any) => createOWL2QueryEngine(idx, tree),
    languageDef: owl2LangFallback,
  });

  globalLanguageRegistry.register({
    id: "csv",
    name: "CSV",
    extensions: [".csv"],
    get parser() {
      return parserService?.getParser("csv");
    },
    set parser(val: any) {
      if (parserService && parserService.getParser("csv") !== val) {
        parserService.registerParser("csv", val);
      }
    },
    get facade() {
      return parserService?.getFacade("csv");
    },
    set facade(val: any) {
      if (parserService && parserService.getFacade("csv") !== val) {
        parserService.registerParser("csv", parserService.getParser("csv"), val);
      }
    },
    languageDef: csvLangFallback,
    customHandlers: {
      validate: async (doc: any) => {
        const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
        const { lintCsv } = await import("@modelscript/csv/csv-parser");
        return lintCsv(text);
      },
    },
  });

  globalLanguageRegistry.register({
    id: "scad",
    name: "OpenSCAD",
    extensions: [".scad"],
    get parser() {
      return parserService?.getParser("scad");
    },
    set parser(val: any) {
      if (parserService && parserService.getParser("scad") !== val) {
        parserService.registerParser("scad", val);
      }
    },
    get facade() {
      return parserService?.getFacade("scad");
    },
    set facade(val: any) {
      if (parserService && parserService.getFacade("scad") !== val) {
        parserService.registerParser("scad", parserService.getParser("scad"), val);
      }
    },
    languageDef: scadLangFallback,
    customHandlers: {
      validate: async (doc: any) => {
        const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
        const { lintScadCst, getScadParser } = await import("@modelscript/scad");
        const parser = parserService?.getParser("scad") ?? (await getScadParser());
        if (!parser) return [];
        const tree = parser.parse(text);
        return tree?.rootNode ? lintScadCst(tree.rootNode as any, text) : [];
      },
    },
  });

  globalLanguageRegistry.register({
    id: "modelscript",
    name: "ModelScript",
    extensions: [".modelscript", ".msx"],
    get parser() {
      return parserService?.getParser("modelscript");
    },
    set parser(val: any) {
      if (parserService && parserService.getParser("modelscript") !== val) {
        parserService.registerParser("modelscript", val);
      }
    },
    get facade() {
      return parserService?.getFacade("modelscript");
    },
    set facade(val: any) {
      if (parserService && parserService.getFacade("modelscript") !== val) {
        parserService.registerParser("modelscript", parserService.getParser("modelscript"), val);
      }
    },
    workspaceIndex: workspaceManager.getWorkspaceIndex("modelscript"),
    get queryEngine() {
      return workspaceManager.getQueryEngine("modelscript") ?? undefined;
    },
    set queryEngine(val) {
      workspaceManager.setQueryEngine("modelscript", val ?? null);
    },
    languageDef: modelscriptLangFallback,
    handlers: modelscriptLangFallback.lsp?.handlers,
  });

  // 2. CFD & FEA
  globalLanguageRegistry.register({
    id: "cfd",
    name: "CFD",
    extensions: [".cfd", ".cfg", ".cfgt", ".su2", ".foam"],
    languageDef: cfdLanguage,
    customHandlers: {
      symbols: (treeWrapper: any) => {
        const text = typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "");
        return getCfdDocumentSymbols(text);
      },
      hover: (offset: number, text: string) => {
        const lines = text.slice(0, offset).split("\n");
        const line = lines.length - 1;
        const character = lines[lines.length - 1]!.length;
        return getCfdHover(text, { line, character });
      },
      validate: (doc: any) => {
        const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
        return validateCfd(text);
      },
    },
    actionHandlers: {
      lint_cfd_model: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return [];
        const { parseCfdConfig, lintCfdModel } = await import("@modelscript/cfd");
        const model = parseCfdConfig(text);
        return lintCfdModel(model);
      },
      export_cfd_dae: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseCfdConfig, cfdToDae } = await import("@modelscript/cfd");
        const model = parseCfdConfig(text);
        const dae = cfdToDae(model);
        return {
          variables: dae.varCount,
          equations: dae.eqCount,
        };
      },
      export_cfd_modelica: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return "";
        const { parseCfdConfig, cfdToModelica } = await import("@modelscript/cfd");
        const model = parseCfdConfig(text);
        return cfdToModelica(model);
      },
      solve_cfd: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { executeCfdAction } = await import("@modelscript/cfd");
        return executeCfdAction("solve", { content: text });
      },
    },
    disposables: [],
  });
  globalLanguageRegistry.register({
    id: "fea",
    name: "FEA",
    extensions: [".fea", ".inp", ".inpt", ".bdf", ".dat"],
    languageDef: feaLanguage,
    customHandlers: {
      symbols: (treeWrapper: any) => {
        const text = typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "");
        return getFeaDocumentSymbols(text);
      },
      hover: (offset: number, text: string) => {
        const lines = text.slice(0, offset).split("\n");
        const line = lines.length - 1;
        const character = lines[lines.length - 1]!.length;
        return getFeaHover(text, { line, character });
      },
      validate: (doc: any) => {
        const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
        return validateFea(text);
      },
    },
    actionHandlers: {
      lint_fea_model: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return [];
        const { parseFeaDeck, lintFeaModel } = await import("@modelscript/fea");
        const model = parseFeaDeck(text);
        return lintFeaModel(model);
      },
      export_fea_dae: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseFeaDeck, feaToDae } = await import("@modelscript/fea");
        const model = parseFeaDeck(text);
        const dae = feaToDae(model);
        return {
          variables: dae.varCount,
          equations: dae.eqCount,
        };
      },
      export_fea_modelica: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return "";
        const { parseFeaDeck, feaToModelica } = await import("@modelscript/fea");
        const model = parseFeaDeck(text);
        return feaToModelica(model);
      },
      solve_fea: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { executeFeaAction } = await import("@modelscript/fea");
        return executeFeaAction("solve", { content: text });
      },
    },
    disposables: [],
  });

  // 3. PSCAD
  globalLanguageRegistry.register({
    id: "pscad",
    name: "PSCAD",
    extensions: [".pscx", ".pslx", ".pswx", ".psmx"],
    languageDef: pscadLanguage,
    get diagramBackend() {
      return createPscadDiagramBackend({});
    },
    customHandlers: {
      validate: async (doc: any) => {
        const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
        const { parsePscx, lintPscx } = await import("@modelscript/pscad");
        return lintPscx(parsePscx(text));
      },
    },
    actionHandlers: {
      lint_pscad_project: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return [];
        const { parsePscx, lintPscx } = await import("@modelscript/pscad");
        const project = parsePscx(text);
        return lintPscx(project);
      },
      analyze_pscad_signal_ranges: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return [];
        const { parsePscx, analyzePscadSignalRanges } = await import("@modelscript/pscad");
        return analyzePscadSignalRanges(parsePscx(text));
      },
      inspect_pscad_schematic: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parsePscx, extractEmtNetlist } = await import("@modelscript/pscad");
        const { buildPscadDiagram } = await import("@modelscript/diagram");
        const project = parsePscx(text);
        return {
          netlist: extractEmtNetlist(project),
          diagram: buildPscadDiagram(project, params?.definitionName),
        };
      },
      simulate_hybrid_emt: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { runPscadSimulationPipeline } = await import("@modelscript/pscad");
        let solverRunner: ((circuit: any, options: any) => any) | undefined;
        try {
          const simMod: any = await import("@modelscript/simulate" as string);
          if (simMod?.EmtSolver) {
            solverRunner = (circuit, options) => {
              const solver = new simMod.EmtSolver(circuit, {
                timeStepSec: options.timeStepSec,
                durationSec: options.durationSec,
                threePhase: options.threePhase ?? true,
                steadyStateInit: true,
                maxNonlinearIterations: 6,
              });
              return solver.solve();
            };
          }
        } catch {}
        return runPscadSimulationPipeline({
          documentText: text,
          runSimulation: true,
          durationSec: params?.durationSec,
          timeStepSec: params?.timeStepSec,
          verifyIeee2800: Boolean(params?.verifyIeee2800),
          exportComtrade: params?.exportComtrade ?? true,
          exportOut: params?.exportOut ?? true,
          solverRunner,
        });
      },
    },
    disposables: [],
  });

  // 4. EASY5
  globalLanguageRegistry.register({
    id: "easy5",
    name: "EASY5",
    extensions: [".ez5", ".ezm", ".ezd", ".eas"],
    languageDef: easy5Language,
    customHandlers: {
      symbols: (treeWrapper: any) => {
        const text = typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "");
        return getEasy5DocumentSymbols(text);
      },
      hover: (offset: number, text: string) => {
        const lines = text.slice(0, offset).split("\n");
        const line = lines.length - 1;
        const character = lines[lines.length - 1]!.length;
        return getEasy5Hover(text, { line, character });
      },
      validate: (doc: any) => {
        const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
        return validateEasy5(text);
      },
    },
    actionHandlers: {
      lint_easy5_model: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return [];
        const { parseEasy5, lintEasy5 } = await import("@modelscript/easy5");
        return lintEasy5(parseEasy5(text));
      },
      linearize_easy5_model: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseEasy5, linearizeEasy5 } = await import("@modelscript/easy5");
        return linearizeEasy5(parseEasy5(text), params?.operatingPoint);
      },
      inspect_easy5_bode: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseEasy5, linearizeEasy5, computeEasy5FrequencyResponse } = await import("@modelscript/easy5");
        const model = parseEasy5(text);
        const sys = linearizeEasy5(model, params?.operatingPoint);
        return computeEasy5FrequencyResponse(sys, params?.options);
      },
      export_easy5_modelica: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return "";
        const { parseEasy5, easy5ToModelica } = await import("@modelscript/easy5");
        return easy5ToModelica(parseEasy5(text));
      },
      export_easy5_ssp: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return "";
        const { parseEasy5, easy5ToSsp } = await import("@modelscript/easy5");
        return easy5ToSsp(parseEasy5(text));
      },
      export_easy5_dae: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseEasy5, easy5ToDae } = await import("@modelscript/easy5");
        const dae = easy5ToDae(parseEasy5(text));
        return { varCount: dae.varCount, eqCount: dae.eqCount };
      },
      inspect_easy5_diagram: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseEasy5, buildEasy5DiagramData, renderEasy5SvgDiagram } = await import("@modelscript/easy5");
        const model = parseEasy5(text);
        return {
          graphData: buildEasy5DiagramData(model),
          svg: renderEasy5SvgDiagram(model),
        };
      },
    },
    disposables: [],
  });

  // 5. ROCETS
  globalLanguageRegistry.register({
    id: "rocets",
    name: "ROCETS",
    extensions: [".roc", ".deck"],
    languageDef: rocetsLanguage,
    customHandlers: {
      symbols: (treeWrapper: any) => {
        const text = typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "");
        return getRocetsDocumentSymbols(text);
      },
      hover: (offset: number, text: string) => {
        const lines = text.slice(0, offset).split("\n");
        const line = lines.length - 1;
        const character = lines[lines.length - 1]!.length;
        return getRocetsHover(text, { line, character });
      },
      validate: (doc: any) => {
        const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
        return validateRocets(text);
      },
    },
    actionHandlers: {
      lint_rocets_deck: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return [];
        const { parseRocetsDeck, lintRocets } = await import("@modelscript/rocets");
        const model = parseRocetsDeck(text);
        return lintRocets(model);
      },
      solve_rocets_balance: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseRocetsDeck, solveRocetsBalance } = await import("@modelscript/rocets");
        const model = parseRocetsDeck(text);
        return solveRocetsBalance(model, params?.options);
      },
      simulate_rocets_transient: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseRocetsDeck, simulateRocetsTransient } = await import("@modelscript/rocets");
        const model = parseRocetsDeck(text);
        return simulateRocetsTransient(model, params?.options);
      },
      export_rocets_modelica: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return "";
        const { parseRocetsDeck, rocetsToModelica } = await import("@modelscript/rocets");
        const model = parseRocetsDeck(text);
        return rocetsToModelica(model);
      },
      export_rocets_ssp: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return "";
        const { parseRocetsDeck, rocetsToSsp } = await import("@modelscript/rocets");
        const model = parseRocetsDeck(text);
        return rocetsToSsp(model);
      },
      export_rocets_dae: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseRocetsDeck, rocetsToDae } = await import("@modelscript/rocets");
        const model = parseRocetsDeck(text);
        const dae = rocetsToDae(model);
        return {
          varCount: dae.varCount,
          eqCount: dae.eqCount,
        };
      },
      inspect_rocets_diagram: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseRocetsDeck, buildRocetsDiagramData, renderRocetsPidSvg } = await import("@modelscript/rocets");
        const model = parseRocetsDeck(text);
        return {
          graphData: buildRocetsDiagramData(model),
          svg: renderRocetsPidSvg(model),
        };
      },
    },
    disposables: [],
  });

  // 6. PSSE
  globalLanguageRegistry.register({
    id: "psse",
    name: "PSSE",
    extensions: [".raw", ".dyr", ".sav"],
    languageDef: psseLanguage,
    customHandlers: {
      symbols: (treeWrapper: any) => {
        const text = typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "");
        const uri = typeof treeWrapper?.uri === "string" ? treeWrapper.uri : "model.raw";
        return getPsseDocumentSymbols(text, uri);
      },
      hover: (offset: number, text: string, uri?: string) => {
        const lines = text.slice(0, offset).split("\n");
        const line = lines.length - 1;
        const character = lines[lines.length - 1]!.length;
        return getPsseHover(text, { line, character }, uri ?? "", workspaceManager.unifiedWorkspace);
      },
      validate: (doc: any) => {
        const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
        const uri = typeof doc?.uri === "string" ? doc.uri : "model.raw";
        return validatePsse(text, uri);
      },
      definition: (offset: number, text: string, uri?: string) => {
        const lines = text.slice(0, offset).split("\n");
        const line = lines.length - 1;
        const character = lines[lines.length - 1]!.length;
        return getPsseDefinition(text, { line, character }, uri ?? "", workspaceManager.unifiedWorkspace);
      },
      references: (offset: number, text: string, uri?: string) => {
        const lines = text.slice(0, offset).split("\n");
        const line = lines.length - 1;
        const character = lines[lines.length - 1]!.length;
        return getPsseReferences(text, { line, character }, uri ?? "", workspaceManager.unifiedWorkspace);
      },
      complete: (offset: number, text: string, uri?: string) => {
        const lines = text.slice(0, offset).split("\n");
        const line = lines.length - 1;
        const character = lines[lines.length - 1]!.length;
        return getPsseCompletions(text, { line, character }, uri ?? "");
      },
    },
    actionHandlers: {
      simulate_psse_transient: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { simulatePsseTransient } = await import("@modelscript/psse");
        const parsed = getMergedPsseCase(workspaceManager.unifiedWorkspace, ctx.uri ?? "", text);
        return simulatePsseTransient(parsed, params);
      },
      analyze_n1_contingencies: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseRaw, analyzeN1Contingencies } = await import("@modelscript/psse");
        const parsed = parseRaw(text);
        const caseTitle = parsed.title1 || `PSS/E Grid (Rev ${parsed.header.rev})`;
        return analyzeN1Contingencies(parsed, caseTitle);
      },
      solve_short_circuit: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { calculateShortCircuit } = await import("@modelscript/psse");
        const parsed = getMergedPsseCase(workspaceManager.unifiedWorkspace, ctx.uri ?? "", text);
        const caseTitle = parsed.title1 || `PSS/E Grid (Rev ${parsed.header.rev})`;
        return calculateShortCircuit(parsed, caseTitle);
      },
      lint_psse_case: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return [];
        const { parseRaw, lintPsse } = await import("@modelscript/psse");
        return lintPsse(parseRaw(text));
      },
      extract_powerflow_netlist: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseRaw, extractPowerFlowNetlist, serializePowerFlowNetlist } = await import("@modelscript/psse");
        const parsed = parseRaw(text);
        const netlist = extractPowerFlowNetlist(parsed);
        const caseTitle = parsed.title1 || `PSS/E Grid (Rev ${parsed.header.rev})`;
        return serializePowerFlowNetlist(netlist, caseTitle);
      },
      export_psse_modelica: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return "";
        const { parseRaw, psseToModelica } = await import("@modelscript/psse");
        return psseToModelica(parseRaw(text));
      },
      export_psse_pscad: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseRaw, psseToEmtNetlist } = await import("@modelscript/psse");
        return psseToEmtNetlist(parseRaw(text));
      },
      export_psse_dae: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { lowerPsseToDae } = await import("@modelscript/psse");
        const parsed = getMergedPsseCase(workspaceManager.unifiedWorkspace, ctx.uri ?? "", text);
        const dae = lowerPsseToDae(parsed);
        return { varCount: dae.varCount, eqCount: dae.eqCount };
      },
      solve_powerflow: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseRaw, solvePowerFlow, formatPowerFlowReport } = await import("@modelscript/psse");
        const parsed = parseRaw(text);
        const sol = solvePowerFlow(parsed, params);
        const caseTitle = parsed.title1 || `PSS/E Grid (Rev ${parsed.header.rev})`;
        return { ...sol, reportText: formatPowerFlowReport(sol, caseTitle) };
      },
    },
    disposables: [],
  });

  // 7. Aspen
  globalLanguageRegistry.register({
    id: "aspen",
    name: "Aspen",
    extensions: [".in", ".inp", ".bkp"],
    languageDef: aspenLanguage,
    customHandlers: {
      symbols: (treeWrapper: any) =>
        getAspenDocumentSymbols(typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "")),
      hover: (offset: number, text: string) => {
        const lines = text.slice(0, offset).split("\n");
        return getAspenHover(text, { line: lines.length - 1, character: lines[lines.length - 1]!.length });
      },
      validate: (doc: any) => validateAspen(typeof doc?.getText === "function" ? doc.getText() : String(doc)),
    },
    actionHandlers: {
      lint_aspen_flowsheet: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return [];
        const { parseAspen, lintAspen } = await import("@modelscript/aspen");
        return lintAspen(parseAspen(text));
      },
      aspen_to_dae: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseAspen, lowerAspenToDae } = await import("@modelscript/aspen");
        const dae = lowerAspenToDae(parseAspen(text));
        return {
          modelName: "AspenFlowsheet",
          variableCount: dae.variables().length,
          equationCount: dae.equations().length,
        };
      },
      aspen_to_modelica: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return "";
        const { parseAspen, aspenToModelica } = await import("@modelscript/aspen");
        return aspenToModelica(parseAspen(text));
      },
      aspen_solve_flash: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseAspen, solveFlashRachfordRice } = await import("@modelscript/aspen");
        const deck = parseAspen(text);
        const streamId = params?.streamId ?? deck.streams.keys().next().value ?? "FEED";
        const s = deck.streams.get(streamId);
        const comps = Array.from(s?.moleFractions.keys() ?? deck.components.keys());
        const fracs = comps.map((c) => s?.moleFractions.get(c) ?? 1.0 / comps.length);
        return solveFlashRachfordRice({
          temperature: s?.temperature ?? 75.0,
          pressure: s?.pressure ?? 1.2,
          components: comps,
          moleFractions: fracs,
          totalFlow: s?.moleFlow ?? 100.0,
        });
      },
    },
    disposables: [],
  });

  // 8. SWMM
  globalLanguageRegistry.register({
    id: "swmm",
    name: "SWMM",
    extensions: [".inp"],
    languageDef: swmmLanguage,
    customHandlers: {
      symbols: (treeWrapper: any) =>
        getSwmmDocumentSymbols(typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "")),
      hover: (offset: number, text: string) => {
        const lines = text.slice(0, offset).split("\n");
        return getSwmmHover(text, { line: lines.length - 1, character: lines[lines.length - 1]!.length });
      },
      validate: (doc: any) => validateSwmm(typeof doc?.getText === "function" ? doc.getText() : String(doc)),
    },
    actionHandlers: {
      lint_swmm_network: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return [];
        const { parseSwmm, lintSwmm } = await import("@modelscript/swmm");
        return lintSwmm(parseSwmm(text));
      },
      swmm_to_dae: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseSwmm, lowerSwmmToDae } = await import("@modelscript/swmm");
        const dae = lowerSwmmToDae(parseSwmm(text));
        return {
          modelName: "StormwaterNetwork",
          variableCount: dae.variables().length,
          equationCount: dae.equations().length,
        };
      },
      swmm_to_modelica: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return "";
        const { parseSwmm, swmmToModelica } = await import("@modelscript/swmm");
        return swmmToModelica(parseSwmm(text));
      },
      swmm_route_flow: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseSwmm, routeNetworkFlow } = await import("@modelscript/swmm");
        return routeNetworkFlow(parseSwmm(text));
      },
    },
    disposables: [],
  });

  // AMPL
  globalLanguageRegistry.register({
    id: "ampl",
    name: "AMPL",
    extensions: [".mod", ".dat", ".ampl"],
    languageDef: amplLanguage,
    customHandlers: {
      symbols: (treeWrapper: any) =>
        getAmplDocumentSymbols(typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "")),
      hover: (offset: number, text: string) => {
        const lines = text.slice(0, offset).split("\n");
        return getAmplHover(text, { line: lines.length - 1, character: lines[lines.length - 1]!.length });
      },
      validate: (doc: any) => validateAmpl(typeof doc?.getText === "function" ? doc.getText() : String(doc)),
    },
    actionHandlers: {
      ampl_lint: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return [];
        const { parseAmplModel, lintAmpl } = await import("@modelscript/ampl");
        return lintAmpl(parseAmplModel(text));
      },
      ampl_solve: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseAmplModel, instantiateAmpl, solveAmpl } = await import("@modelscript/ampl");
        const problem = instantiateAmpl(parseAmplModel(text));
        return solveAmpl(problem, params?.options);
      },
      ampl_to_dae: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseAmplModel, instantiateAmpl, lowerAmplToDae } = await import("@modelscript/ampl");
        const problem = instantiateAmpl(parseAmplModel(text));
        const dae = lowerAmplToDae(problem);
        return {
          modelName: problem.name,
          variableCount: dae.variables().length,
          equationCount: dae.equations().length,
        };
      },
      ampl_to_nl: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return "";
        const { parseAmplModel, instantiateAmpl, writeNlProblem } = await import("@modelscript/ampl");
        const problem = instantiateAmpl(parseAmplModel(text));
        return writeNlProblem(problem);
      },
      ampl_to_modelica: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return "";
        const { parseAmplModel, instantiateAmpl, amplToModelica } = await import("@modelscript/ampl");
        const problem = instantiateAmpl(parseAmplModel(text));
        return amplToModelica(problem);
      },
    },
    disposables: [],
  });

  // 9. Touchstone
  globalLanguageRegistry.register({
    id: "touchstone",
    name: "Touchstone",
    extensions: [
      ".s1p",
      ".s2p",
      ".s3p",
      ".s4p",
      ".s5p",
      ".s6p",
      ".s7p",
      ".s8p",
      ".s9p",
      ".s10p",
      ".s12p",
      ".s16p",
      ".s24p",
      ".s32p",
      ".ts2",
    ],
    languageDef: touchstoneLanguage,
    customHandlers: {
      symbols: (treeWrapper: any) =>
        getTouchstoneDocumentSymbols(typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "")),
      hover: (offset: number, text: string) => {
        const lines = text.slice(0, offset).split("\n");
        return getTouchstoneHover(text, { line: lines.length - 1, character: lines[lines.length - 1]!.length });
      },
      validate: (doc: any) => validateTouchstone(typeof doc?.getText === "function" ? doc.getText() : String(doc)),
    },
    actionHandlers: {
      lint_touchstone: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return [];
        const { parseTouchstone, lintTouchstone } = await import("@modelscript/touchstone");
        return lintTouchstone(parseTouchstone(text));
      },
      touchstone_passivity: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseTouchstone, verifyPassivity } = await import("@modelscript/touchstone");
        return verifyPassivity(parseTouchstone(text));
      },
      touchstone_to_dae: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseTouchstone, lowerTouchstoneToDae } = await import("@modelscript/touchstone");
        const dae = lowerTouchstoneToDae(parseTouchstone(text));
        return {
          modelName: "NPortMacromodel",
          variableCount: dae.variables().length,
          equationCount: dae.equations().length,
        };
      },
      touchstone_to_modelica: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return "";
        const { parseTouchstone, touchstoneToModelica } = await import("@modelscript/touchstone");
        return touchstoneToModelica(parseTouchstone(text));
      },
      touchstone_fit_macromodel: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseTouchstone, fitStateSpaceModel } = await import("@modelscript/touchstone");
        return fitStateSpaceModel(parseTouchstone(text));
      },
    },
    disposables: [],
  });

  // 10. IBIS
  globalLanguageRegistry.register({
    id: "ibis",
    name: "IBIS",
    extensions: [".ibs"],
    languageDef: ibisLanguage,
    customHandlers: {
      symbols: (treeWrapper: any) =>
        getIbisDocumentSymbols(typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "")),
      hover: (offset: number, text: string) => {
        const lines = text.slice(0, offset).split("\n");
        return getIbisHover(text, { line: lines.length - 1, character: lines[lines.length - 1]!.length });
      },
      validate: (doc: any) => validateIbis(typeof doc?.getText === "function" ? doc.getText() : String(doc)),
    },
    actionHandlers: {
      lint_ibis: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return [];
        const { parseIbis, lintIbis } = await import("@modelscript/ibis");
        return lintIbis(parseIbis(text));
      },
      ibis_to_dae: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseIbis, lowerIbisToDae } = await import("@modelscript/ibis");
        const dae = lowerIbisToDae(parseIbis(text));
        return {
          modelName: "IbisBufferModule",
          variableCount: dae.variables().length,
          equationCount: dae.equations().length,
        };
      },
      ibis_to_modelica: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return "";
        const { parseIbis, ibisToModelica } = await import("@modelscript/ibis");
        return ibisToModelica(parseIbis(text));
      },
      ibis_eval_buffer: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseIbis, calculateOutputResistance, evaluateBufferCurrent } = await import("@modelscript/ibis");
        const deck = parseIbis(text);
        const firstMod = deck.models.values().next().value;
        if (!firstMod) return null;
        return {
          modelName: firstMod.name,
          resistance: calculateOutputResistance(firstMod),
          currentSample: evaluateBufferCurrent(firstMod, 1.5, 1),
        };
      },
    },
    disposables: [],
  });

  // 11. OLGA
  globalLanguageRegistry.register({
    id: "olga",
    name: "OLGA",
    extensions: [".genkey", ".key", ".opi", ".olga", ".pvt", ".tab"],
    languageDef: olgaLanguage,
    customHandlers: {
      symbols: (treeWrapper: any) =>
        getOlgaDocumentSymbols(typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "")),
      hover: (offset: number, text: string) => {
        const lines = text.slice(0, offset).split("\n");
        return getOlgaHover(text, { line: lines.length - 1, character: lines[lines.length - 1]!.length });
      },
      validate: (doc: any) => validateOlga(typeof doc?.getText === "function" ? doc.getText() : String(doc)),
    },
    actionHandlers: {
      lint_olga_case: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return [];
        const { parseOlga, lintOlgaModel } = await import("@modelscript/olga");
        return lintOlgaModel(parseOlga(text));
      },
      simulate_drift_flux: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseOlga, simulateDriftFlux } = await import("@modelscript/olga");
        return simulateDriftFlux(parseOlga(text), { durationSeconds: params?.durationSeconds });
      },
      project_to_sysml2: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return "";
        const { parseOlga, olgaToSysml2 } = await import("@modelscript/olga");
        return olgaToSysml2(parseOlga(text));
      },
      export_olga_dae: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseOlga, lowerOlgaToDae } = await import("@modelscript/olga");
        const dae = lowerOlgaToDae(parseOlga(text));
        return { varCount: dae.varCount, eqCount: dae.eqCount };
      },
      verify_flow_assurance: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseOlga, simulateDriftFlux, verifyFlowAssuranceTrajectory } = await import("@modelscript/olga");
        const trajectory = simulateDriftFlux(parseOlga(text));
        return verifyFlowAssuranceTrajectory(trajectory);
      },
      inspect_olga_elevation_profile: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseOlga, simulateDriftFlux } = await import("@modelscript/olga");
        const { renderOlgaElevationProfileSvg, renderOlgaSchematicSvg } = await import("@modelscript/diagram");
        const model = parseOlga(text);
        const trajectory = simulateDriftFlux(model, { durationSeconds: 60 });
        return {
          schematicSvg: renderOlgaSchematicSvg(model),
          elevationProfileSvg: renderOlgaElevationProfileSvg(model, trajectory),
        };
      },
    },
    disposables: [],
  });

  // 12. LPS
  globalLanguageRegistry.register({
    id: "lps",
    name: "PipelineStudio",
    extensions: [".lps", ".tgx", ".tlx", ".tgn", ".tln", ".psg", ".psl"],
    languageDef: lpsLanguage,
    customHandlers: {
      symbols: (treeWrapper: any) =>
        getLpsDocumentSymbols(typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "")),
      hover: (offset: number, text: string) => {
        const lines = text.slice(0, offset).split("\n");
        return getLpsHover(text, { line: lines.length - 1, character: lines[lines.length - 1]!.length });
      },
      validate: (doc: any) => validateLps(typeof doc?.getText === "function" ? doc.getText() : String(doc)),
    },
    actionHandlers: {
      lint_lps_network: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return [];
        const { parseLps, lintLpsModel } = await import("@modelscript/lps");
        return lintLpsModel(parseLps(text));
      },
      solve_lps_steady: async (ctx: any) => {
        const text = ctx.documentText;
        if (!text) return null;
        const { parseLps, SteadyNetworkSolver, LinePackEngine, PipelineVerifier } = await import("@modelscript/lps");
        const model = parseLps(text);
        const steady = SteadyNetworkSolver.solve(model);
        const analysis = LinePackEngine.analyze(model, steady);
        const verification = PipelineVerifier.verifySteady(model, steady);
        return { steady, analysis, verification };
      },
      simulate_lps_transient: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseLps, GasEulerDaeSolver } = await import("@modelscript/lps");
        return GasEulerDaeSolver.simulate(parseLps(text), { durationSeconds: params?.durationSeconds });
      },
      project_lps_sysml2: async (ctx: any) => {
        const text = ctx.documentText;
        if (!text) return "";
        const { parseLps, lpsToSysml2 } = await import("@modelscript/lps");
        return lpsToSysml2(parseLps(text));
      },
      export_lps_modelica: async (ctx: any) => {
        const text = ctx.documentText;
        if (!text) return "";
        const { parseLps, lpsToModelica } = await import("@modelscript/lps");
        return lpsToModelica(parseLps(text));
      },
      export_lps_dae: async (ctx: any) => {
        const text = ctx.documentText;
        if (!text) return null;
        const { parseLps, lowerLpsToDae } = await import("@modelscript/lps");
        const dae = lowerLpsToDae(parseLps(text));
        return { varCount: dae.varCount, eqCount: dae.eqCount };
      },
    },
    disposables: [],
  });

  // 13. GENSYS
  globalLanguageRegistry.register({
    id: "gensys",
    name: "GENSYS",
    extensions: [".calc", ".run", ".sub", ".geom", ".trax", ".wheel", ".ins"],
    languageDef: gensysLanguage,
    customHandlers: {
      symbols: (treeWrapper: any) =>
        getGensysDocumentSymbols(typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "")),
      hover: (offset: number, text: string) => getGensysHover(text, offset),
      validate: (doc: any) => validateGensys(typeof doc?.getText === "function" ? doc.getText() : String(doc)),
    },
    actionHandlers: {
      lint_gensys_deck: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return [];
        const { parseGensysDeck, lintGensysModel } = await import("@modelscript/gensys");
        return lintGensysModel(parseGensysDeck(text));
      },
      export_gensys_modelica: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return "";
        const { parseGensysDeck, gensysToModelica } = await import("@modelscript/gensys");
        return gensysToModelica(parseGensysDeck(text));
      },
      evaluate_en14363: async (_ctx: any, params: any) => {
        const { evaluateEn14363 } = await import("@modelscript/gensys");
        return evaluateEn14363(params);
      },
      export_gensys_fmu: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseGensysDeck } = await import("@modelscript/gensys");
        const { exportGensysFmu } = await import("@modelscript/exchange");
        return exportGensysFmu(parseGensysDeck(text), params?.options);
      },
      simulate_gensys: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseGensysDeck, lowerGensysToDae } = await import("@modelscript/gensys");
        const { initBltWasm } = await import("@modelscript/runtime");
        const { simulateArena } = await import("@modelscript/simulate");
        await initBltWasm();
        const dae = lowerGensysToDae(parseGensysDeck(text));
        return simulateArena(dae, {
          startTime: params?.startTime ?? 0,
          stopTime: params?.stopTime ?? 5.0,
          step: params?.step ?? 0.005,
        });
      },
    },
    disposables: [],
  });

  // 14. SIMPACK
  globalLanguageRegistry.register({
    id: "simpack",
    name: "SIMPACK",
    extensions: [".spck", ".sim", ".mbs"],
    languageDef: simpackLanguage,
    customHandlers: {
      symbols: (treeWrapper: any) =>
        getSimpackDocumentSymbols(typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "")),
      hover: (offset: number, text: string) => getSimpackHover(text, offset),
      validate: (doc: any) => validateSimpack(typeof doc?.getText === "function" ? doc.getText() : String(doc)),
    },
    actionHandlers: {
      lint_simpack_model: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return [];
        const { parseSpckXml, parseSimDeck, lintSimpackModel } = await import("@modelscript/simpack");
        const isXml = text.trimStart().startsWith("<");
        const model = isXml ? parseSpckXml(text) : parseSimDeck(text);
        return lintSimpackModel(model);
      },
      analyze_mobility: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseSpckXml, parseSimDeck, analyzeMobility } = await import("@modelscript/simpack");
        const isXml = text.trimStart().startsWith("<");
        const model = isXml ? parseSpckXml(text) : parseSimDeck(text);
        return analyzeMobility(model);
      },
      export_simpack_modelica: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return "";
        const { parseSpckXml, parseSimDeck, simpackToModelica } = await import("@modelscript/simpack");
        const isXml = text.trimStart().startsWith("<");
        const model = isXml ? parseSpckXml(text) : parseSimDeck(text);
        return simpackToModelica(model);
      },
      export_simpack_fmu: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseSpckXml, parseSimDeck } = await import("@modelscript/simpack");
        const { exportSimpackFmu } = await import("@modelscript/exchange");
        const isXml = text.trimStart().startsWith("<");
        const model = isXml ? parseSpckXml(text) : parseSimDeck(text);
        return exportSimpackFmu(model, params?.options);
      },
      simulate_simpack: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseSpckXml, parseSimDeck, lowerSimpackToDae } = await import("@modelscript/simpack");
        const { initBltWasm } = await import("@modelscript/runtime");
        const { simulateArena } = await import("@modelscript/simulate");
        await initBltWasm();
        const isXml = text.trimStart().startsWith("<");
        const model = isXml ? parseSpckXml(text) : parseSimDeck(text);
        const dae = lowerSimpackToDae(model);
        return simulateArena(dae, {
          startTime: params?.startTime ?? 0,
          stopTime: params?.stopTime ?? 5.0,
          step: params?.step ?? 0.005,
        });
      },
    },
    disposables: [],
  });

  // 15. ReqIF
  globalLanguageRegistry.register({
    id: "reqif",
    name: "ReqIF",
    extensions: [".reqif", ".reqifz"],
    languageDef: reqifLanguage,
    customHandlers: {
      symbols: (treeWrapper: any) =>
        getReqifDocumentSymbols(typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "")),
      hover: (offset: number, text: string) => {
        let line = 0;
        let lastLineStart = 0;
        for (let i = 0; i < offset && i < text.length; i++) {
          if (text[i] === "\n") {
            line++;
            lastLineStart = i + 1;
          }
        }
        return getReqifHover(text, line, offset - lastLineStart);
      },
      validate: (doc: any) => validateReqif(typeof doc?.getText === "function" ? doc.getText() : String(doc)),
    },
    actionHandlers: {
      lint_reqif: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return [];
        const { parseReqIf, lintReqIf } = await import("@modelscript/reqif");
        return lintReqIf(parseReqIf(text));
      },
      verify_reqif_entailment: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseReqIf, verifyReqIfEntailment } = await import("@modelscript/reqif");
        return verifyReqIfEntailment(parseReqIf(text));
      },
      export_reqif_sysml2: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return "";
        const { parseReqIf, reqifToSysml2 } = await import("@modelscript/reqif");
        return reqifToSysml2(parseReqIf(text));
      },
      export_reqif_modelica: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return "";
        const { parseReqIf, reqifToModelicaVerifier } = await import("@modelscript/reqif");
        return reqifToModelicaVerifier(parseReqIf(text));
      },
    },
    disposables: [],
  });

  // 16. SPICE
  globalLanguageRegistry.register({
    id: "spice",
    name: "SPICE",
    extensions: [".cir", ".sp", ".net", ".lib"],
    languageDef: spiceLanguage,
    get diagramBackend() {
      return createSpiceDiagramBackend({});
    },
    customHandlers: {
      symbols: (treeWrapper: any) =>
        getSpiceDocumentSymbols(typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "")),
      hover: (offset: number, text: string) => {
        let line = 0;
        let lastLineStart = 0;
        for (let i = 0; i < offset && i < text.length; i++) {
          if (text[i] === "\n") {
            line++;
            lastLineStart = i + 1;
          }
        }
        return getSpiceHover(text, line, offset - lastLineStart);
      },
      validate: (doc: any) => validateSpice(typeof doc?.getText === "function" ? doc.getText() : String(doc)),
    },
    actionHandlers: {
      spice_run_op: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseSpice, solveOp } = await import("@modelscript/spice");
        return solveOp(parseSpice(text));
      },
      spice_run_tran: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseSpice, solveTran } = await import("@modelscript/spice");
        return solveTran(parseSpice(text), params);
      },
      spice_run_ac: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseSpice, solveAc } = await import("@modelscript/spice");
        return solveAc(parseSpice(text), params);
      },
      export_spice_modelica: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return "";
        const { parseSpice, spiceToModelica } = await import("@modelscript/spice");
        return spiceToModelica(parseSpice(text));
      },
      export_spice_ecad: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseSpice, spiceToNetlistGraph } = await import("@modelscript/spice");
        return spiceToNetlistGraph(parseSpice(text));
      },
    },
    disposables: [],
  });

  // 17. Adams
  globalLanguageRegistry.register({
    id: "adams",
    name: "MSC Adams",
    extensions: [".adm", ".cmd", ".acf"],
    languageDef: adamsLanguage,
    customHandlers: {
      symbols: (treeWrapper: any) =>
        getAdamsDocumentSymbols(typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "")),
      hover: (offset: number, text: string) => getAdamsHover(text, offset),
      validate: (doc: any) => validateAdams(typeof doc?.getText === "function" ? doc.getText() : String(doc)),
    },
    actionHandlers: {
      lint_adams_model: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return [];
        const { parseAdams, lintAdamsModel } = await import("@modelscript/adams");
        return lintAdamsModel(parseAdams(text));
      },
      analyze_adams_mobility: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseAdams, analyzeAdamsMobility } = await import("@modelscript/adams");
        return analyzeAdamsMobility(parseAdams(text));
      },
      export_adams_simpack: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseAdams, adamsToSimpack } = await import("@modelscript/adams");
        return adamsToSimpack(parseAdams(text));
      },
      export_adams_modelica: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return "";
        const { parseAdams, adamsToModelica } = await import("@modelscript/adams");
        return adamsToModelica(parseAdams(text));
      },
      simulate_adams: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseAdams, lowerAdamsToDae } = await import("@modelscript/adams");
        const { initBltWasm } = await import("@modelscript/runtime");
        const { simulateArena } = await import("@modelscript/simulate");
        await initBltWasm();
        const dataset = parseAdams(text);
        const dae = lowerAdamsToDae(dataset);
        return simulateArena(dae, {
          startTime: params?.startTime ?? 0,
          stopTime: params?.stopTime ?? dataset.simulation?.endTime ?? 5.0,
          step: params?.step ?? dataset.simulation?.dtOut ?? 0.005,
        });
      },
    },
    disposables: [],
  });

  // 18. URDF
  globalLanguageRegistry.register({
    id: "urdf",
    name: "ROS URDF & SDFormat",
    extensions: [".urdf", ".sdf", ".xacro"],
    languageDef: urdfLanguage,
    customHandlers: {
      symbols: (treeWrapper: any) =>
        getUrdfDocumentSymbols(typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "")),
      hover: (offset: number, text: string) => getUrdfHover(text, offset),
      validate: (doc: any) => validateUrdf(typeof doc?.getText === "function" ? doc.getText() : String(doc)),
    },
    actionHandlers: {
      lint_urdf_robot: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return [];
        const { parseUrdf, lintUrdfRobot } = await import("@modelscript/urdf");
        return lintUrdfRobot(parseUrdf(text));
      },
      compute_urdf_rnea: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseUrdf, computeInverseDynamicsRnea } = await import("@modelscript/urdf");
        const robot = parseUrdf(text);
        const q = new Map<string, number>(Object.entries(params?.q ?? {}));
        const qd = new Map<string, number>(Object.entries(params?.qd ?? {}));
        const qdd = new Map<string, number>(Object.entries(params?.qdd ?? {}));
        const rnea = computeInverseDynamicsRnea(robot, q, qd, qdd, params?.gravity);
        return Object.fromEntries(rnea.jointTorques);
      },
      export_urdf_modelica: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return "";
        const { parseUrdf, urdfToModelica } = await import("@modelscript/urdf");
        return urdfToModelica(parseUrdf(text));
      },
      export_urdf_simpack: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseUrdf, urdfToSimpack } = await import("@modelscript/urdf");
        return urdfToSimpack(parseUrdf(text));
      },
      export_urdf_adams: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseUrdf, urdfToAdams } = await import("@modelscript/urdf");
        return urdfToAdams(parseUrdf(text));
      },
    },
    disposables: [],
  });

  // 19. Verilog-A
  globalLanguageRegistry.register({
    id: "verilog-a",
    name: "Verilog-A / Verilog-AMS",
    extensions: [".va", ".vams"],
    languageDef: verilogALanguage,
    customHandlers: {
      symbols: (treeWrapper: any) =>
        getVerilogADocumentSymbols(typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "")),
      hover: (offset: number, text: string) => getVerilogAHover(text, offset),
      validate: (doc: any) => validateVerilogA(typeof doc?.getText === "function" ? doc.getText() : String(doc)),
    },
    actionHandlers: {
      lint_verilog_a: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return [];
        const { lintVerilogA, parseVerilogA } = await import("@modelscript/verilog-a");
        return lintVerilogA(parseVerilogA(text));
      },
      export_verilog_a_modelica: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return "";
        const { parseVerilogA, verilogAToModelica } = await import("@modelscript/verilog-a");
        const doc = parseVerilogA(text);
        if (doc.modules.length === 0) return "";
        return verilogAToModelica(doc.modules[0]!);
      },
      export_verilog_a_spice: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return "";
        const { parseVerilogA, verilogAToSpice } = await import("@modelscript/verilog-a");
        const doc = parseVerilogA(text);
        if (doc.modules.length === 0) return "";
        return verilogAToSpice(doc.modules[0]!);
      },
      export_verilog_a_dae: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseVerilogA, lowerVerilogAToDae } = await import("@modelscript/verilog-a");
        const doc = parseVerilogA(text);
        if (doc.modules.length === 0) return null;
        const arena = lowerVerilogAToDae(doc.modules[0]!);
        return {
          title: doc.modules[0]!.name,
          variableCount: arena.getVarCount(),
          equationCount: arena.getEqCount(),
        };
      },
    },
    disposables: [],
  });

  // 20. PLCopen
  globalLanguageRegistry.register({
    id: "plcopen",
    name: "IEC 61131-3 PLCopen / Structured Text",
    extensions: [".xml", ".plcopen", ".st"],
    languageDef: plcopenLanguage,
    customHandlers: {
      symbols: (treeWrapper: any) =>
        getPlcopenDocumentSymbols(typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "")),
      hover: (offset: number, text: string) => getPlcopenHover(text, offset),
      validate: (doc: any) => validatePlcopen(typeof doc?.getText === "function" ? doc.getText() : String(doc)),
    },
    actionHandlers: {
      lint_plcopen: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return [];
        const { lintPlcProject, parsePlcopen } = await import("@modelscript/plcopen");
        return lintPlcProject(parsePlcopen(text));
      },
      export_plcopen_modelica: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return "";
        const { parsePlcopen, plcopenToModelica } = await import("@modelscript/plcopen");
        return plcopenToModelica(parsePlcopen(text));
      },
      export_plcopen_sysml: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return "";
        const { parsePlcopen, plcopenToSysML } = await import("@modelscript/plcopen");
        return plcopenToSysML(parsePlcopen(text));
      },
      export_plcopen_dae: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parsePlcopen, lowerPlcopenToDae } = await import("@modelscript/plcopen");
        const arena = lowerPlcopenToDae(parsePlcopen(text));
        return { variableCount: arena.getVarCount(), equationCount: arena.getEqCount() };
      },
      run_plcopen_scan: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parsePlcopen, VirtualPlc } = await import("@modelscript/plcopen");
        const plc = new VirtualPlc(parsePlcopen(text));
        const cycles = params?.cycles ?? 10;
        const dtMs = params?.dtMs ?? 10;
        return { cycles, dtMs, history: plc.runCycles(cycles, dtMs) };
      },
    },
    disposables: [],
  });

  // 21. OpenDRIVE
  globalLanguageRegistry.register({
    id: "opendrive",
    name: "ASAM OpenDRIVE",
    extensions: [".xodr", ".xml"],
    languageDef: opendriveLanguage,
    get diagramBackend() {
      return createOpenDriveDiagramBackend({});
    },
    customHandlers: {
      symbols: (treeWrapper: any) =>
        getOpenDriveDocumentSymbols(typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "")),
      hover: (offset: number, text: string) => getOpenDriveHover(text, offset),
      validate: (doc: any) => validateOpenDrive(typeof doc?.getText === "function" ? doc.getText() : String(doc)),
    },
    actionHandlers: {
      lint_opendrive: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return [];
        const { lintOpenDrive, parseOpenDrive } = await import("@modelscript/opendrive");
        return lintOpenDrive(parseOpenDrive(text));
      },
      export_opendrive_gensys: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return "";
        const { opendriveToGensys, parseOpenDrive } = await import("@modelscript/opendrive");
        return opendriveToGensys(parseOpenDrive(text), params?.step ?? 1.0);
      },
      export_opendrive_dae: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { lowerOpenDriveToDae, parseOpenDrive } = await import("@modelscript/opendrive");
        const arena = lowerOpenDriveToDae(parseOpenDrive(text));
        return { variableCount: arena.getVarCount(), equationCount: arena.getEqCount() };
      },
      sample_opendrive_track: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return [];
        const { parseOpenDrive, sampleRoadTrack } = await import("@modelscript/opendrive");
        const doc = parseOpenDrive(text);
        const step = params?.step ?? 1.0;
        return doc.roads.map((r) => ({ roadId: r.id, name: r.name, points: sampleRoadTrack(r, step) }));
      },
      render_opendrive_svg: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return "";
        const { parseOpenDrive, renderOpenDriveSvg } = await import("@modelscript/opendrive");
        return renderOpenDriveSvg(parseOpenDrive(text), {
          sampleStep: params?.step ?? 1.0,
          theme: params?.theme ?? "dark",
        });
      },
    },
    disposables: [],
  });

  // 22. OpenDSS
  globalLanguageRegistry.register({
    id: "opendss",
    name: "OpenDSS",
    extensions: [".dss"],
    languageDef: openDssLanguage,
    customHandlers: {
      symbols: (treeWrapper: any) =>
        getOpenDssDocumentSymbols(typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "")),
      hover: (offset: number, text: string) => {
        const lines = text.slice(0, offset).split("\n");
        return getOpenDssHover(text, { line: lines.length - 1, character: lines[lines.length - 1]!.length });
      },
      validate: (doc: any) => validateOpenDss(typeof doc?.getText === "function" ? doc.getText() : String(doc)),
    },
    actionHandlers: {
      lint_opendss: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return [];
        const { parseOpenDss, lintOpenDss } = await import("@modelscript/opendss");
        return lintOpenDss(parseOpenDss(text));
      },
      opendss_powerflow: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseOpenDss, solveDistributionPowerFlow } = await import("@modelscript/opendss");
        return solveDistributionPowerFlow(parseOpenDss(text));
      },
      opendss_to_dae: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseOpenDss, lowerOpenDssToDae } = await import("@modelscript/opendss");
        const dae = lowerOpenDssToDae(parseOpenDss(text));
        return {
          modelName: "DistributionGrid",
          variableCount: dae.variables().length,
          equationCount: dae.equations().length,
        };
      },
      opendss_to_modelica: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return "";
        const { parseOpenDss, openDssToModelica } = await import("@modelscript/opendss");
        return openDssToModelica(parseOpenDss(text));
      },
    },
    disposables: [],
  });

  // 23. OpenSCENARIO
  globalLanguageRegistry.register({
    id: "openscenario",
    name: "OpenSCENARIO",
    extensions: [".xosc", ".osc"],
    languageDef: openScenarioLanguage,
    customHandlers: {
      symbols: (treeWrapper: any) =>
        getOpenScenarioDocumentSymbols(typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "")),
      hover: (offset: number, text: string) => {
        const lines = text.slice(0, offset).split("\n");
        return getOpenScenarioHover(text, { line: lines.length - 1, character: lines[lines.length - 1]!.length });
      },
      validate: (doc: any) => validateOpenScenario(typeof doc?.getText === "function" ? doc.getText() : String(doc)),
    },
    actionHandlers: {
      lint_openscenario: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return [];
        const { parseOpenScenario, lintOpenScenario } = await import("@modelscript/openscenario");
        return lintOpenScenario(parseOpenScenario(text));
      },
      openscenario_simulate: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseOpenScenario, simulateScenario } = await import("@modelscript/openscenario");
        return simulateScenario(parseOpenScenario(text), params?.options);
      },
      openscenario_to_dae: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseOpenScenario, lowerOpenScenarioToDae } = await import("@modelscript/openscenario");
        const dae = lowerOpenScenarioToDae(parseOpenScenario(text));
        return {
          modelName: "ScenarioSimulation",
          variableCount: dae.variables().length,
          equationCount: dae.equations().length,
        };
      },
      openscenario_to_modelica: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return "";
        const { parseOpenScenario, openScenarioToModelica } = await import("@modelscript/openscenario");
        return openScenarioToModelica(parseOpenScenario(text), params?.modelName);
      },
    },
    disposables: [],
  });

  // 24. RELAP5
  globalLanguageRegistry.register({
    id: "relap5",
    name: "RELAP5",
    extensions: [".i", ".inp", ".r5"],
    languageDef: relap5Language,
    customHandlers: {
      symbols: (treeWrapper: any) =>
        getRelap5DocumentSymbols(typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "")),
      hover: (offset: number, text: string) => {
        const lines = text.slice(0, offset).split("\n");
        return getRelap5Hover(text, { line: lines.length - 1, character: lines[lines.length - 1]!.length });
      },
      validate: (doc: any) => validateRelap5(typeof doc?.getText === "function" ? doc.getText() : String(doc)),
    },
    actionHandlers: {
      lint_relap5: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return [];
        const { parseRelap5, lintRelap5 } = await import("@modelscript/relap5");
        return lintRelap5(parseRelap5(text));
      },
      relap5_kinetics_solve: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseRelap5, solvePointKinetics } = await import("@modelscript/relap5");
        return solvePointKinetics(parseRelap5(text), params?.options);
      },
      relap5_to_dae: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseRelap5, lowerRelap5ToDae } = await import("@modelscript/relap5");
        const dae = lowerRelap5ToDae(parseRelap5(text));
        return {
          modelName: "Relap5NuclearPlant",
          variableCount: dae.variables().length,
          equationCount: dae.equations().length,
        };
      },
      relap5_to_modelica: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return "";
        const { parseRelap5, relap5ToModelica } = await import("@modelscript/relap5");
        return relap5ToModelica(parseRelap5(text), params?.modelName);
      },
    },
    disposables: [],
  });

  // 25. ECLIPSE
  globalLanguageRegistry.register({
    id: "eclipse",
    name: "ECLIPSE",
    extensions: [".data", ".dat", ".inc"],
    languageDef: eclipseLanguage,
    customHandlers: {
      symbols: (treeWrapper: any) =>
        getEclipseDocumentSymbols(typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "")),
      hover: (offset: number, text: string) => {
        const lines = text.slice(0, offset).split("\n");
        return getEclipseHover(text, { line: lines.length - 1, character: lines[lines.length - 1]!.length });
      },
      validate: (doc: any) => validateEclipse(typeof doc?.getText === "function" ? doc.getText() : String(doc)),
    },
    actionHandlers: {
      lint_eclipse: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return [];
        const { parseEclipse, lintEclipse } = await import("@modelscript/eclipse");
        return lintEclipse(parseEclipse(text));
      },
      eclipse_reservoir_solve: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseEclipse, solveReservoirDepletion } = await import("@modelscript/eclipse");
        return solveReservoirDepletion(parseEclipse(text), params?.options);
      },
      eclipse_to_dae: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseEclipse, lowerEclipseToDae } = await import("@modelscript/eclipse");
        const dae = lowerEclipseToDae(parseEclipse(text));
        return {
          modelName: "EclipseReservoir",
          variableCount: dae.variables().length,
          equationCount: dae.equations().length,
        };
      },
      eclipse_to_modelica: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return "";
        const { parseEclipse, eclipseToModelica } = await import("@modelscript/eclipse");
        return eclipseToModelica(parseEclipse(text), params?.modelName);
      },
    },
    disposables: [],
  });

  // 26. SBML
  globalLanguageRegistry.register({
    id: "sbml",
    name: "SBML",
    extensions: [".sbml", ".xml"],
    languageDef: sbmlLanguage,
    customHandlers: {
      symbols: (treeWrapper: any) =>
        getSbmlDocumentSymbols(typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "")),
      hover: (offset: number, text: string) => {
        const lines = text.slice(0, offset).split("\n");
        return getSbmlHover(text, { line: lines.length - 1, character: lines[lines.length - 1]!.length });
      },
      validate: (doc: any) => validateSbml(typeof doc?.getText === "function" ? doc.getText() : String(doc)),
    },
    actionHandlers: {
      lint_sbml: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return [];
        const { parseSbml, lintSbml } = await import("@modelscript/sbml");
        return lintSbml(parseSbml(text));
      },
      sbml_simulate: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseSbml, solveReactions } = await import("@modelscript/sbml");
        return solveReactions(parseSbml(text), params?.options);
      },
      sbml_to_dae: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseSbml, lowerSbmlToDae } = await import("@modelscript/sbml");
        const dae = lowerSbmlToDae(parseSbml(text));
        return { modelName: "SbmlModel", variableCount: dae.variables().length, equationCount: dae.equations().length };
      },
      sbml_to_modelica: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return "";
        const { parseSbml, sbmlToModelica } = await import("@modelscript/sbml");
        return sbmlToModelica(parseSbml(text), params?.modelName);
      },
    },
    disposables: [],
  });

  // 27. JSBSim
  globalLanguageRegistry.register({
    id: "jsbsim",
    name: "JSBSim Flight Dynamics",
    extensions: [".xml"],
    languageDef: jsbsimLanguage,
    customHandlers: {
      symbols: (treeWrapper: any) =>
        getJsbsimDocumentSymbols(typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "")),
      hover: (offset: number, text: string) => {
        const lines = text.slice(0, offset).split("\n");
        return getJsbsimHover(text, { line: lines.length - 1, character: lines[lines.length - 1]!.length });
      },
      validate: (doc: any) => validateJsbsim(typeof doc?.getText === "function" ? doc.getText() : String(doc)),
    },
    actionHandlers: {
      lint_jsbsim: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return [];
        const { parseJsbsim, lintJsbsim } = await import("@modelscript/jsbsim");
        return lintJsbsim(parseJsbsim(text));
      },
      jsbsim_simulate: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseJsbsim, solveFlightDynamics } = await import("@modelscript/jsbsim");
        return solveFlightDynamics(parseJsbsim(text), params?.options);
      },
      jsbsim_to_dae: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseJsbsim, lowerJsbsimToDae } = await import("@modelscript/jsbsim");
        const dae = lowerJsbsimToDae(parseJsbsim(text));
        return {
          modelName: "JsbsimModel",
          variableCount: dae.variables().length,
          equationCount: dae.equations().length,
        };
      },
      jsbsim_to_modelica: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return "";
        const { parseJsbsim, jsbsimToModelica } = await import("@modelscript/jsbsim");
        return jsbsimToModelica(parseJsbsim(text), params?.modelName);
      },
    },
    disposables: [],
  });

  // 28. EnergyPlus
  globalLanguageRegistry.register({
    id: "energyplus",
    name: "EnergyPlus",
    extensions: [".idf", ".epjson"],
    languageDef: energyplusLanguage,
    customHandlers: {
      symbols: (treeWrapper: any) =>
        getEnergyPlusDocumentSymbols(typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "")),
      hover: (offset: number, text: string) => getEnergyPlusHover(text, offset),
      validate: (doc: any) => validateEnergyPlus(typeof doc?.getText === "function" ? doc.getText() : String(doc)),
    },
    actionHandlers: {
      lint_energyplus: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return [];
        const { lintEnergyPlus, parseEnergyPlus } = await import("@modelscript/energyplus");
        return lintEnergyPlus(parseEnergyPlus(text));
      },
      export_energyplus_modelica: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return "";
        const { energyPlusToModelica, parseEnergyPlus } = await import("@modelscript/energyplus");
        return energyPlusToModelica(parseEnergyPlus(text));
      },
      export_energyplus_dae: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { lowerEnergyPlusToDae, parseEnergyPlus } = await import("@modelscript/energyplus");
        const arena = lowerEnergyPlusToDae(parseEnergyPlus(text));
        return { variableCount: arena.getVarCount(), equationCount: arena.getEqCount() };
      },
    },
    disposables: [],
  });

  // 29. EPANET
  globalLanguageRegistry.register({
    id: "epanet",
    name: "EPANET",
    extensions: [".inp"],
    languageDef: epanetLanguage,
    customHandlers: {
      symbols: (treeWrapper: any) =>
        getEpanetDocumentSymbols(typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "")),
      hover: (offset: number, text: string) => getEpanetHover(text, offset),
      validate: (doc: any) => validateEpanet(typeof doc?.getText === "function" ? doc.getText() : String(doc)),
    },
    actionHandlers: {
      lint_epanet: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return [];
        const { lintEpanet, parseInp } = await import("@modelscript/epanet");
        return lintEpanet(parseInp(text));
      },
      solve_epanet: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseInp, solveHydraulics } = await import("@modelscript/epanet");
        const res = solveHydraulics(parseInp(text));
        return {
          converged: res.converged,
          iterations: res.iterations,
          maxFlowChange: res.maxFlowChange,
          pressures: Object.fromEntries(res.nodePressures),
          flows: Object.fromEntries(res.linkFlows),
        };
      },
      export_epanet_modelica: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return "";
        const { epanetToModelica, parseInp } = await import("@modelscript/epanet");
        return epanetToModelica(parseInp(text));
      },
      export_epanet_dae: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { lowerEpanetToDae, parseInp } = await import("@modelscript/epanet");
        const arena = lowerEpanetToDae(parseInp(text));
        return { variableCount: arena.getVarCount(), equationCount: arena.getEqCount() };
      },
    },
    disposables: [],
  });

  // 30. CCSDS
  globalLanguageRegistry.register({
    id: "ccsds",
    name: "CCSDS",
    extensions: [".ccsds", ".oem", ".opm", ".omm", ".xtce"],
    languageDef: ccsdsLanguage,
    customHandlers: {
      symbols: (treeWrapper: any) =>
        getCcsdsDocumentSymbols(typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "")),
      hover: (offset: number, text: string) => getCcsdsHover(text, offset),
      validate: (doc: any) => validateCcsds(typeof doc?.getText === "function" ? doc.getText() : String(doc)),
    },
    actionHandlers: {
      ccsds_lint: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return [];
        const { lintCcsds, parseCcsds } = await import("@modelscript/ccsds");
        return lintCcsds(parseCcsds(text));
      },
      lint_ccsds: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return [];
        const { lintCcsds, parseCcsds } = await import("@modelscript/ccsds");
        return lintCcsds(parseCcsds(text));
      },
      ccsds_to_modelica: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return "";
        const { ccsdsToModelica, parseCcsds } = await import("@modelscript/ccsds");
        return ccsdsToModelica(parseCcsds(text));
      },
      export_ccsds_modelica: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return "";
        const { ccsdsToModelica, parseCcsds } = await import("@modelscript/ccsds");
        return ccsdsToModelica(parseCcsds(text));
      },
      ccsds_to_sysml: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return "";
        const { ccsdsToSysml, parseCcsds } = await import("@modelscript/ccsds");
        return ccsdsToSysml(parseCcsds(text));
      },
      export_ccsds_sysml: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return "";
        const { ccsdsToSysml, parseCcsds } = await import("@modelscript/ccsds");
        return ccsdsToSysml(parseCcsds(text));
      },
      ccsds_to_dae: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { lowerCcsdsToDae, parseCcsds } = await import("@modelscript/ccsds");
        const arena = lowerCcsdsToDae(parseCcsds(text));
        return { variableCount: arena.getVarCount(), equationCount: arena.getEqCount() };
      },
      export_ccsds_dae: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { lowerCcsdsToDae, parseCcsds } = await import("@modelscript/ccsds");
        const arena = lowerCcsdsToDae(parseCcsds(text));
        return { variableCount: arena.getVarCount(), equationCount: arena.getEqCount() };
      },
    },
    disposables: [],
  });

  // 31. Simulink
  globalLanguageRegistry.register({
    id: "simulink",
    name: "MATLAB Simulink",
    extensions: [".slx", ".mdl"],
    languageDef: simulinkLanguage,
    get diagramBackend() {
      return createSimulinkDiagramBackend({});
    },
    customHandlers: {
      symbols: (treeWrapper: any) =>
        getSimulinkDocumentSymbols(typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "")),
      hover: (offset: number, text: string) => {
        const lines = text.slice(0, offset).split("\n");
        return getSimulinkHover(
          text,
          { line: lines.length - 1, character: lines[lines.length - 1]!.length },
          "model.mdl",
        );
      },
      validate: (doc: any) => validateSimulink(typeof doc?.getText === "function" ? doc.getText() : String(doc)),
    },
    actionHandlers: {
      simulink_lint: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return [];
        const { parseSimulink, lintSimulinkModel } = await import("@modelscript/simulink");
        return lintSimulinkModel(parseSimulink(text));
      },
      lint_simulink_model: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return [];
        const { parseSimulink, lintSimulinkModel } = await import("@modelscript/simulink");
        return lintSimulinkModel(parseSimulink(text));
      },
      simulink_to_modelica: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return "";
        const { parseSimulink, simulinkToModelica } = await import("@modelscript/simulink");
        return simulinkToModelica(parseSimulink(text));
      },
      export_simulink_modelica: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return "";
        const { parseSimulink, simulinkToModelica } = await import("@modelscript/simulink");
        return simulinkToModelica(parseSimulink(text));
      },
      simulink_to_dae: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseSimulink, lowerSimulinkToDae } = await import("@modelscript/simulink");
        const dae = lowerSimulinkToDae(parseSimulink(text));
        return { varCount: dae.varCount, eqCount: dae.eqCount };
      },
      export_simulink_dae: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseSimulink, lowerSimulinkToDae } = await import("@modelscript/simulink");
        const dae = lowerSimulinkToDae(parseSimulink(text));
        return { varCount: dae.varCount, eqCount: dae.eqCount };
      },
    },
    disposables: [],
  });

  // 32. AUTOSAR
  globalLanguageRegistry.register({
    id: "autosar",
    name: "AUTOSAR Classic & Adaptive",
    extensions: [".arxml"],
    languageDef: autosarLanguage,
    customHandlers: {
      symbols: (treeWrapper: any) =>
        getAutosarDocumentSymbols(typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "")),
      hover: (offset: number, text: string) => {
        const lines = text.slice(0, offset).split("\n");
        return getAutosarHover(text, { line: lines.length - 1, character: lines[lines.length - 1]!.length });
      },
      validate: (doc: any) => validateAutosar(typeof doc?.getText === "function" ? doc.getText() : String(doc)),
    },
    actionHandlers: {
      lint_autosar_model: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return [];
        const { parseArxml, lintAutosarModel } = await import("@modelscript/autosar");
        return lintAutosarModel(parseArxml(text));
      },
      export_autosar_modelica: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return "";
        const { parseArxml, autosarToModelica } = await import("@modelscript/autosar");
        return autosarToModelica(parseArxml(text));
      },
      export_autosar_sysml: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return "";
        const { parseArxml, autosarToSysml } = await import("@modelscript/autosar");
        return autosarToSysml(parseArxml(text));
      },
      export_autosar_dae: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseArxml, lowerAutosarToDae } = await import("@modelscript/autosar");
        const dae = lowerAutosarToDae(parseArxml(text));
        return { varCount: dae.varCount, eqCount: dae.eqCount };
      },
      simulate_autosar_rte: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return [];
        const { parseArxml, VirtualRte } = await import("@modelscript/autosar");
        const rte = new VirtualRte(parseArxml(text));
        return rte.runUntil(params?.duration ?? 0.05, params?.step ?? 0.01);
      },
    },
    disposables: [],
  });

  // 33. Fortran
  globalLanguageRegistry.register({
    id: "fortran",
    name: "Fortran",
    extensions: [".f", ".for", ".f77", ".f90", ".f95", ".f03", ".f08"],
    languageDef: fortranLanguage,
    customHandlers: {
      validate: async (doc: any) => {
        const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
        const { lintFortran } = await import("@modelscript/fortran");
        return lintFortran(text);
      },
    },
    actionHandlers: {
      lint_fortran_file: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return [];
        const { lintFortran } = await import("@modelscript/fortran");
        return lintFortran(text);
      },
      simulate_fortran: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { simulateFortranRoutine } = await import("@modelscript/fortran");
        return simulateFortranRoutine(text, {
          startTime: params?.startTime ?? 0,
          stopTime: params?.stopTime ?? 1.0,
          dt: params?.dt ?? 0.01,
        });
      },
      verify_fortran: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { verifyFortranSource } = await import("@modelscript/fortran");
        return verifyFortranSource(text, params?.options);
      },
      lower_fortran_to_dae: async (ctx: any) => {
        const text = ctx.documentText;
        if (!text) return null;
        const { lowerFortranToDae, preprocessFortranSegment, extractFortranSignature } =
          await import("@modelscript/fortran");
        const { DAEBuilder } = await import("@modelscript/runtime");
        const prep = preprocessFortranSegment(text);
        const sig = extractFortranSignature(text);
        const builder = new DAEBuilder();
        const lowered = lowerFortranToDae(builder, prep.lines, sig.name);
        return {
          routineName: sig.name,
          equationCount: lowered.equationCount,
          stateCount: lowered.stateVarIndices.length,
          inputs: sig.inputs,
          outputs: sig.outputs,
          locals: sig.locals,
        };
      },
      export_fortran_fmu: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { exportFortranFmu } = await import("@modelscript/fortran");
        const fmu = exportFortranFmu(text, params?.options);
        return {
          modelIdentifier: fmu.modelIdentifier,
          guid: fmu.guid,
          files: fmu.files,
          variableCount: fmu.variables.length,
          equationCount: fmu.daeSummary.equationCount,
          archiveByteLength: fmu.archive.byteLength,
          modelDescription2Xml: fmu.modelDescription2Xml,
          modelDescription3Xml: fmu.modelDescription3Xml,
          cSources: fmu.cSources,
          daeSummary: fmu.daeSummary,
          formattedSummary: `Exported Fortran FMU '${fmu.modelIdentifier}.fmu' (${fmu.archive.byteLength} bytes, ${fmu.variables.length} FMI variables, ${fmu.files.length} bundled files).`,
        };
      },
    },
    disposables: [],
  });

  // 34. C
  globalLanguageRegistry.register({
    id: "c",
    name: "C",
    extensions: [".c", ".h"],
    languageDef: cLanguage,
    customHandlers: {
      validate: async (doc: any) => {
        const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
        const { lintC } = await import("@modelscript/c");
        return lintC(text);
      },
    },
    actionHandlers: {
      lint_c_file: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return [];
        const { lintC } = await import("@modelscript/c");
        return lintC(text);
      },
    },
    disposables: [],
  });

  // 35. SIMA
  globalLanguageRegistry.register({
    id: "sima",
    name: "SIMA",
    extensions: [".inp", ".sima", ".sys", ".hyd"],
    languageDef: simaLanguage,
    customHandlers: {
      symbols: (treeWrapper: any) =>
        getSimaDocumentSymbols(typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "")),
      hover: (offset: number, text: string) => {
        const lines = text.slice(0, offset).split("\n");
        return getSimaHover(text, { line: lines.length - 1, character: lines[lines.length - 1]!.length });
      },
      validate: (doc: any) => validateSima(typeof doc?.getText === "function" ? doc.getText() : String(doc)),
    },
    actionHandlers: {
      lint_sima_model: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return [];
        const { parseSimaFile, lintSimaProject } = await import("@modelscript/sima");
        return lintSimaProject(parseSimaFile(text, params?.uri));
      },
      verify_dnv_compliance: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseSimaFile, verifyDnvMooringCompliance } = await import("@modelscript/sima");
        return verifyDnvMooringCompliance(parseSimaFile(text, params?.uri), params?.consequenceClass ?? 2);
      },
      evaluate_offset_limits: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseSimaFile, evaluateOffsetLimits } = await import("@modelscript/sima");
        return evaluateOffsetLimits(parseSimaFile(text, params?.uri), params?.options);
      },
      project_sima_modelica: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return "";
        const { parseSimaFile, simaToModelica } = await import("@modelscript/sima");
        return simaToModelica(parseSimaFile(text, params?.uri));
      },
      project_sima_ssp: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return "";
        const { parseSimaFile, simaToSsp } = await import("@modelscript/sima");
        return simaToSsp(parseSimaFile(text, params?.uri));
      },
      project_sima_sysml2: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return "";
        const { parseSimaFile, simaToSysml2 } = await import("@modelscript/sima");
        return simaToSysml2(parseSimaFile(text, params?.uri));
      },
      export_sima_dae: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseSimaFile, lowerSimaToDae } = await import("@modelscript/sima");
        const dae = lowerSimaToDae(parseSimaFile(text, params?.uri));
        return { varCount: dae.varCount, eqCount: dae.eqCount };
      },
    },
    disposables: [],
  });

  // 36. GT-SUITE
  globalLanguageRegistry.register({
    id: "gtsuite",
    name: "GT-SUITE",
    extensions: [".gtm", ".gtd", ".gtx", ".gt"],
    languageDef: gtsuiteLanguage,
    customHandlers: {
      symbols: (treeWrapper: any) =>
        getGtsuiteDocumentSymbols(typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "")),
      hover: (offset: number, text: string) => {
        const lines = text.slice(0, offset).split("\n");
        return getGtsuiteHover(text, { line: lines.length - 1, character: lines[lines.length - 1]!.length });
      },
      validate: (doc: any) => validateGtsuite(typeof doc?.getText === "function" ? doc.getText() : String(doc)),
    },
    actionHandlers: {
      lint_gtsuite_model: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return [];
        const { parseGtmModel, lintGtModel } = await import("@modelscript/gtsuite");
        return lintGtModel(parseGtmModel(text, params?.uri));
      },
      simulate_gtsuite_transient: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseGtmModel, runGtSuiteSimulation } = await import("@modelscript/gtsuite");
        return runGtSuiteSimulation(parseGtmModel(text, params?.uri), params?.options);
      },
      verify_gtsuite_gates: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseGtmModel, runGtSuiteSimulation, verifyEngineGates } = await import("@modelscript/gtsuite");
        const simResult = await runGtSuiteSimulation(parseGtmModel(text, params?.uri), params?.options);
        return verifyEngineGates(simResult, params?.gateOptions);
      },
      project_gtsuite_modelica: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return "";
        const { parseGtmModel, gtsuiteToModelica } = await import("@modelscript/gtsuite");
        return gtsuiteToModelica(parseGtmModel(text, params?.uri));
      },
      project_gtsuite_sysml2: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return "";
        const { parseGtmModel, gtsuiteToSysml2 } = await import("@modelscript/gtsuite");
        return gtsuiteToSysml2(parseGtmModel(text, params?.uri));
      },
      project_gtsuite_ssp: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return "";
        const { parseGtmModel, gtsuiteToSsp } = await import("@modelscript/gtsuite");
        return gtsuiteToSsp(parseGtmModel(text, params?.uri));
      },
      export_gtsuite_dae: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return null;
        const { parseGtmModel, gtsuiteToDae } = await import("@modelscript/gtsuite");
        const dae = gtsuiteToDae(parseGtmModel(text, params?.uri));
        return { varCount: dae.varCount, eqCount: dae.eqCount };
      },
      render_gtsuite_schematic: async (ctx: any, params: any) => {
        const text = params?.documentText ?? ctx.documentText;
        if (!text) return "";
        const { parseGtmModel, renderGtSuiteSchematicSvg } = await import("@modelscript/gtsuite");
        return renderGtSuiteSchematicSvg(parseGtmModel(text, params?.uri));
      },
    },
    disposables: [],
  });

  // 37. SSP (System Structure and Parameterization)
  globalLanguageRegistry.register({
    id: "ssp",
    name: "System Structure and Parameterization",
    extensions: [".ssd", ".ssv", ".ssm", ".ssp"],
    languageDef: sspLanguage,
    get diagramBackend() {
      return createSspDiagramBackend({});
    },
    customHandlers: {
      validate: async (doc: any) => {
        const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
        const uri = typeof doc?.uri === "string" ? doc.uri : "";
        const { lintSsd, lintSsv } = await import("@modelscript/ssp");
        const isSsv = uri.endsWith(".ssv") || text.includes("<ssv:ParameterSet");
        return isSsv ? lintSsv(text) : lintSsd(text);
      },
    },
    disposables: [],
  });

  // 38. HEC-RAS (River Hydraulics & Floodplains)
  globalLanguageRegistry.register({
    id: "hec-ras",
    name: "HEC-RAS",
    extensions: [".g01", ".g02", ".g03", ".rasgeo", ".u01", ".f01", ".prj"],
    languageDef: hecRasLanguage,
    customHandlers: {
      symbols: (treeWrapper: any) => {
        const text = typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "");
        return getHecRasDocumentSymbols(text);
      },
      hover: (offset: number, text: string) => {
        const lines = text.slice(0, offset).split("\n");
        const line = lines.length - 1;
        const character = lines[lines.length - 1]!.length;
        return getHecRasHover(text, { line, character });
      },
      validate: (doc: any) => {
        const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
        return validateHecRas(text);
      },
    },
    disposables: [],
  });

  // 39. OCPP (Electric Vehicle Smart Charging)
  globalLanguageRegistry.register({
    id: "ocpp",
    name: "OCPP",
    extensions: [".ocpp", ".ocpp.json", ".cpo", ".evse"],
    languageDef: ocppLanguage,
    customHandlers: {
      symbols: (treeWrapper: any) => {
        const text = typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "");
        return getOcppDocumentSymbols(text);
      },
      hover: (offset: number, text: string) => {
        const lines = text.slice(0, offset).split("\n");
        const line = lines.length - 1;
        const character = lines[lines.length - 1]!.length;
        return getOcppHover(text, { line, character });
      },
      validate: (doc: any) => {
        const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
        return validateOcpp(text);
      },
    },
    disposables: [],
  });

  // 40. OpenADR (Automated Demand Response & Grid Flexibility)
  globalLanguageRegistry.register({
    id: "openadr",
    name: "OpenADR",
    extensions: [".oadr", ".oadr.xml", ".oadr.json", ".oadr.yaml"],
    languageDef: openadrLanguage,
    customHandlers: {
      symbols: (treeWrapper: any) => {
        const text = typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "");
        return getOpenAdrDocumentSymbols(text);
      },
      hover: (offset: number, text: string) => {
        const lines = text.slice(0, offset).split("\n");
        const line = lines.length - 1;
        const character = lines[lines.length - 1]!.length;
        return getOpenAdrHover(text, { line, character });
      },
      validate: (doc: any) => {
        const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
        return validateOpenAdr(text);
      },
    },
    disposables: [],
  });

  // 41. TOUGH (Deep Geothermal Reservoir & Hydrothermal Flows)
  globalLanguageRegistry.register({
    id: "tough",
    name: "TOUGH",
    extensions: [".tough", ".dat", ".tgh"],
    languageDef: toughLanguage,
    customHandlers: {
      symbols: (treeWrapper: any) => {
        const text = typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "");
        return getToughDocumentSymbols(text);
      },
      hover: (offset: number, text: string) => {
        const lines = text.slice(0, offset).split("\n");
        const line = lines.length - 1;
        const character = lines[lines.length - 1]!.length;
        return getToughHover(text, { line, character });
      },
      validate: (doc: any) => {
        const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
        return validateTough(text);
      },
    },
    disposables: [],
  });

  // 42. MODFLOW (Multi-Layer Groundwater Aquifers)
  globalLanguageRegistry.register({
    id: "modflow",
    name: "MODFLOW",
    extensions: [".dis", ".dis6", ".npf", ".npf6", ".wel", ".wel6", ".riv", ".riv6", ".chd", ".chd6"],
    languageDef: modflowLanguage,
    customHandlers: {
      symbols: (treeWrapper: any) => {
        const text = typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "");
        return getModflowDocumentSymbols(text);
      },
      hover: (offset: number, text: string) => {
        const lines = text.slice(0, offset).split("\n");
        const line = lines.length - 1;
        const character = lines[lines.length - 1]!.length;
        return getModflowHover(text, { line, character });
      },
      validate: (doc: any) => {
        const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
        return validateModflow(text);
      },
    },
    disposables: [],
  });

  // 43. LandGEM (Landfill Gas & ADM1 Anaerobic Digestion)
  globalLanguageRegistry.register({
    id: "landgem",
    name: "LandGEM",
    extensions: [".landgem", ".lfg", ".biogas"],
    languageDef: landgemLanguage,
    customHandlers: {
      symbols: (treeWrapper: any) => {
        const text = typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "");
        return getLandgemDocumentSymbols(text);
      },
      hover: (offset: number, text: string) => {
        const lines = text.slice(0, offset).split("\n");
        const line = lines.length - 1;
        const character = lines[lines.length - 1]!.length;
        return getLandgemHover(text, { line, character });
      },
      validate: (doc: any) => {
        const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
        return validateLandgem(text);
      },
    },
    disposables: [],
  });

  // 44. GTFS (Public Transit Electrification & Traction)
  globalLanguageRegistry.register({
    id: "gtfs",
    name: "GTFS",
    extensions: [".gtfs", ".gtfs.txt", ".gtfs-rt"],
    languageDef: gtfsLanguage,
    customHandlers: {
      symbols: (treeWrapper: any) => {
        const text = typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "");
        return getGtfsDocumentSymbols(text);
      },
      hover: (offset: number, text: string) => {
        const lines = text.slice(0, offset).split("\n");
        const line = lines.length - 1;
        const character = lines[lines.length - 1]!.length;
        return getGtfsHover(text, { line, character });
      },
      validate: (doc: any) => {
        const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
        return validateGtfs(text);
      },
    },
    disposables: [],
  });

  // Helper to convert character offset to 0-based { line, character }
  const offsetToPosition = (text: string, offset: number) => {
    const lines = text.slice(0, offset).split("\n");
    return {
      line: lines.length - 1,
      character: lines[lines.length - 1]!.length,
    };
  };

  // 45. Antimony
  globalLanguageRegistry.register({
    id: "antimony",
    name: "Antimony",
    extensions: [".ant"],
    languageDef: antimonyLanguage,
    customHandlers: {
      symbols: (treeWrapper: any) =>
        getAntimonyDocumentSymbols(typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "")),
      hover: (offset: number, text: string) => getAntimonyHover(text, offsetToPosition(text, offset)),
      validate: (doc: any) => validateAntimony(typeof doc?.getText === "function" ? doc.getText() : String(doc)),
    },
    disposables: [],
  });

  // 46. AutomationML
  globalLanguageRegistry.register({
    id: "automationml",
    name: "AutomationML",
    extensions: [".aml", ".amlx"],
    languageDef: automationMLLanguage,
    customHandlers: {
      symbols: (treeWrapper: any) =>
        getAutomationMLDocumentSymbols(typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "")),
      hover: (offset: number, text: string) => getAutomationMLHover(text, offset),
      validate: (doc: any) => validateAutomationML(typeof doc?.getText === "function" ? doc.getText() : String(doc)),
    },
    disposables: [],
  });

  // 47. BNGL
  globalLanguageRegistry.register({
    id: "bngl",
    name: "BNGL",
    extensions: [".bngl"],
    languageDef: bnglLanguage,
    customHandlers: {
      symbols: (treeWrapper: any) =>
        getBnglDocumentSymbols(typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "")),
      hover: (offset: number, text: string) => getBnglHover(text, offsetToPosition(text, offset)),
      validate: (doc: any) => validateBngl(typeof doc?.getText === "function" ? doc.getText() : String(doc)),
    },
    disposables: [],
  });

  // 48. Cantera
  globalLanguageRegistry.register({
    id: "cantera",
    name: "Cantera",
    extensions: [".cti", ".ctml"],
    languageDef: canteraLanguage,
    customHandlers: {
      symbols: (treeWrapper: any) =>
        getCanteraDocumentSymbols(typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "")),
      hover: (offset: number, text: string) => getCanteraHover(text, offsetToPosition(text, offset)),
      validate: (doc: any) => validateCantera(typeof doc?.getText === "function" ? doc.getText() : String(doc)),
    },
    disposables: [],
  });

  // 49. CellML
  globalLanguageRegistry.register({
    id: "cellml",
    name: "CellML",
    extensions: [".cellml"],
    languageDef: cellmlLanguage,
    customHandlers: {
      symbols: (treeWrapper: any) =>
        getCellmlDocumentSymbols(typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "")),
      hover: (offset: number, text: string) => getCellmlHover(text, offset),
      validate: (doc: any) => validateCellml(typeof doc?.getText === "function" ? doc.getText() : String(doc)),
    },
    disposables: [],
  });

  // 50. CGMES
  globalLanguageRegistry.register({
    id: "cgmes",
    name: "CGMES",
    extensions: [".cgmes", ".cim", ".rdf"],
    languageDef: cgmesLanguage,
    customHandlers: {
      validate: (doc: any) => {
        const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
        const model = parseCgmesRdf(text);
        return lintCgmesModel(model);
      },
    },
    disposables: [],
  });

  // 51. DICOM-RT
  globalLanguageRegistry.register({
    id: "dicom-rt",
    name: "DICOM-RT",
    extensions: [".dcm.json", ".dicom-rt", ".rtplan.json", ".rtdose.json", ".rtstruct.json"],
    languageDef: dicomRtLanguage,
    customHandlers: {
      symbols: (treeWrapper: any) =>
        getDicomRtDocumentSymbols(typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "")),
      hover: (offset: number, text: string) => getDicomRtHover(text, offset),
      validate: (doc: any) => validateDicomRt(typeof doc?.getText === "function" ? doc.getText() : String(doc)),
    },
    disposables: [],
  });

  // 52. FEBio
  globalLanguageRegistry.register({
    id: "febio",
    name: "FEBio",
    extensions: [".feb"],
    languageDef: febioLanguage,
    customHandlers: {
      symbols: (treeWrapper: any) =>
        getFebioDocumentSymbols(typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "")),
      hover: (offset: number, text: string) => getFebioHover(text, offset),
      validate: (doc: any) => validateFebio(typeof doc?.getText === "function" ? doc.getText() : String(doc)),
    },
    disposables: [],
  });

  // 53. Fiber
  globalLanguageRegistry.register({
    id: "fiber",
    name: "Fiber",
    extensions: [".fiber.geojson", ".osp.json"],
    languageDef: fiberLanguage,
    disposables: [],
  });

  // 54. GenBank
  globalLanguageRegistry.register({
    id: "genbank",
    name: "GenBank",
    extensions: [".gb", ".gbk", ".genbank"],
    languageDef: genbankLanguage,
    customHandlers: {
      symbols: (treeWrapper: any) =>
        getGenbankDocumentSymbols(typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "")),
      hover: (offset: number, text: string) => getGenbankHover(text, offsetToPosition(text, offset)),
      validate: (doc: any) => validateGenbank(typeof doc?.getText === "function" ? doc.getText() : String(doc)),
    },
    disposables: [],
  });

  // 55. gPROMS
  globalLanguageRegistry.register({
    id: "gproms",
    name: "gPROMS",
    extensions: [".gPROMS", ".gproms"],
    languageDef: gpromsLanguage,
    customHandlers: {
      symbols: (treeWrapper: any) =>
        getGpromsDocumentSymbols(typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "")),
      hover: (offset: number, text: string) => getGpromsHover(text, offsetToPosition(text, offset)),
      validate: (doc: any) => validateGproms(typeof doc?.getText === "function" ? doc.getText() : String(doc)),
    },
    disposables: [],
  });

  // 56. OpenIGTLink (IGTL)
  globalLanguageRegistry.register({
    id: "igtl",
    name: "OpenIGTLink",
    extensions: [".igtl", ".igtl.json"],
    languageDef: igtlLanguage,
    customHandlers: {
      symbols: (treeWrapper: any) =>
        getIgtlDocumentSymbols(typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "")),
      hover: (offset: number, text: string) => getIgtlHover(text, offset),
      validate: (doc: any) => validateIgtl(typeof doc?.getText === "function" ? doc.getText() : String(doc)),
    },
    disposables: [],
  });

  // 57. NIfTI
  globalLanguageRegistry.register({
    id: "nifti",
    name: "NIfTI",
    extensions: [".nii", ".nii.json"],
    languageDef: niftiLanguage,
    customHandlers: {
      symbols: (treeWrapper: any) =>
        getNiftiDocumentSymbols(typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "")),
      hover: (offset: number, text: string) => getNiftiHover(text, offset),
      validate: (doc: any) => validateNifti(typeof doc?.getText === "function" ? doc.getText() : String(doc)),
    },
    disposables: [],
  });

  // 58. NM-TRAN
  globalLanguageRegistry.register({
    id: "nmtran",
    name: "NM-TRAN",
    extensions: [".ctl", ".nmtran"],
    languageDef: nmtranLanguage,
    customHandlers: {
      symbols: (treeWrapper: any) =>
        getNmtranDocumentSymbols(typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "")),
      hover: (offset: number, text: string) => getNmtranHover(text, offsetToPosition(text, offset)),
      validate: (doc: any) => validateNmtran(typeof doc?.getText === "function" ? doc.getText() : String(doc)),
    },
    disposables: [],
  });

  // 59. OpenSim
  globalLanguageRegistry.register({
    id: "opensim",
    name: "OpenSim",
    extensions: [".osim"],
    languageDef: openSimLanguage,
    customHandlers: {
      symbols: (treeWrapper: any) =>
        getOpenSimDocumentSymbols(typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "")),
      hover: (offset: number, text: string) => getOpenSimHover(text, offset),
      validate: (doc: any) => validateOpenSim(typeof doc?.getText === "function" ? doc.getText() : String(doc)),
    },
    disposables: [],
  });

  // 60. Optical
  globalLanguageRegistry.register({
    id: "optical",
    name: "Optical",
    extensions: [".sor", ".openroadm.json"],
    languageDef: opticalLanguage,
    customHandlers: {
      validate: (doc: any) => {
        const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
        if (text.trim().startsWith("{")) {
          return lintOpticalTopology(parseOpenRoadmTopology(text));
        }
        return [];
      },
    },
    disposables: [],
  });

  // 61. OSCAL
  globalLanguageRegistry.register({
    id: "oscal",
    name: "OSCAL",
    extensions: [".oscal", ".oscal.json", ".oscal.yaml", ".oscal.xml"],
    languageDef: oscalLanguage,
    customHandlers: {
      symbols: (treeWrapper: any) =>
        getOscalDocumentSymbols(typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "")),
      hover: (offset: number, text: string) => getOscalHover(text, offset),
      validate: (doc: any) => validateOscal(typeof doc?.getText === "function" ? doc.getText() : String(doc)),
    },
    disposables: [],
  });

  // 62. PDB
  globalLanguageRegistry.register({
    id: "pdb",
    name: "PDB",
    extensions: [".pdb", ".ent"],
    languageDef: pdbLanguage,
    customHandlers: {
      symbols: (treeWrapper: any) =>
        getPdbDocumentSymbols(typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "")),
      hover: (offset: number, text: string) => getPdbHover(text, offsetToPosition(text, offset)),
      validate: (doc: any) => validatePdb(typeof doc?.getText === "function" ? doc.getText() : String(doc)),
    },
    disposables: [],
  });

  // 63. PHREEQC
  globalLanguageRegistry.register({
    id: "phreeqc",
    name: "PHREEQC",
    extensions: [".pqi", ".phreeqc"],
    languageDef: phreeqcLanguage,
    customHandlers: {
      symbols: (treeWrapper: any) =>
        getPhreeqcDocumentSymbols(typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "")),
      hover: (offset: number, text: string) => getPhreeqcHover(text, offsetToPosition(text, offset)),
      validate: (doc: any) => validatePhreeqc(typeof doc?.getText === "function" ? doc.getText() : String(doc)),
    },
    disposables: [],
  });

  // 64. PowerFactory
  globalLanguageRegistry.register({
    id: "powerfactory",
    name: "PowerFactory",
    extensions: [".pfd", ".dz", ".dsl"],
    languageDef: powerFactoryLanguage,
    customHandlers: {
      validate: (doc: any) => {
        const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
        if (text.trim().startsWith("<")) {
          return lintPowerFactoryModel(parsePowerFactoryXml(text));
        }
        return [];
      },
    },
    disposables: [],
  });

  // 65. PSLF
  globalLanguageRegistry.register({
    id: "pslf",
    name: "PSLF",
    extensions: [".epc", ".dyd"],
    languageDef: pslfLanguage,
    customHandlers: {
      validate: (doc: any) => {
        const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
        const uri = typeof doc?.uri === "string" ? doc.uri : "";
        if (uri.toLowerCase().endsWith(".dyd") || text.includes("models")) {
          return lintPslfDyd(parsePslfDyd(text));
        }
        return lintPslfEpc(parsePslfEpc(text));
      },
    },
    disposables: [],
  });

  // 66. QIF
  globalLanguageRegistry.register({
    id: "qif",
    name: "QIF",
    extensions: [".qif", ".qif.json"],
    languageDef: qifLanguage,
    customHandlers: {
      symbols: (treeWrapper: any) =>
        getQifDocumentSymbols(typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "")),
      hover: (offset: number, text: string) => getQifHover(text, offset),
      validate: (doc: any) => validateQif(typeof doc?.getText === "function" ? doc.getText() : String(doc)),
    },
    disposables: [],
  });

  // 67. RAN
  globalLanguageRegistry.register({
    id: "ran",
    name: "RAN",
    extensions: [".adf", ".nsma", ".msi", ".planet"],
    languageDef: ranLanguage,
    customHandlers: {
      validate: (doc: any) => {
        const text = typeof doc?.getText === "function" ? doc.getText() : String(doc);
        const isNsma = text.includes("REVNUM:") || text.includes("MANUF:") || text.includes("NOFREQ:");
        const deck = isNsma ? parseNsmaAdf(text) : parsePlanetPat(text);
        return lintAntennaPatternDeck(deck);
      },
    },
    disposables: [],
  });

  // 68. SBOL
  globalLanguageRegistry.register({
    id: "sbol",
    name: "SBOL",
    extensions: [".sbol", ".sbol.xml"],
    languageDef: sbolLanguage,
    customHandlers: {
      symbols: (treeWrapper: any) =>
        getSbolDocumentSymbols(typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "")),
      hover: (offset: number, text: string) => getSbolHover(text, offsetToPosition(text, offset)),
      validate: (doc: any) => validateSbol(typeof doc?.getText === "function" ? doc.getText() : String(doc)),
    },
    disposables: [],
  });

  // 69. SED-ML
  globalLanguageRegistry.register({
    id: "sedml",
    name: "SED-ML",
    extensions: [".sedml"],
    languageDef: sedmlLanguage,
    customHandlers: {
      symbols: (treeWrapper: any) =>
        getSedmlDocumentSymbols(typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "")),
      hover: (offset: number, text: string) => getSedmlHover(text, offsetToPosition(text, offset)),
      validate: (doc: any) => validateSedml(typeof doc?.getText === "function" ? doc.getText() : String(doc)),
    },
    disposables: [],
  });

  // 70. SMILES
  globalLanguageRegistry.register({
    id: "smiles",
    name: "SMILES",
    extensions: [".smi", ".smiles"],
    languageDef: smilesLanguage,
    customHandlers: {
      symbols: (treeWrapper: any) =>
        getSmilesDocumentSymbols(typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "")),
      hover: (offset: number, text: string) => getSmilesHover(text, offsetToPosition(text, offset)),
      validate: (doc: any) => validateSmiles(typeof doc?.getText === "function" ? doc.getText() : String(doc)),
    },
    disposables: [],
  });

  // 71. 3MF
  globalLanguageRegistry.register({
    id: "three-mf",
    name: "3MF",
    extensions: [".3mf", ".3mf.model"],
    languageDef: threeMfLanguage,
    customHandlers: {
      symbols: (treeWrapper: any) =>
        getThreeMfDocumentSymbols(typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "")),
      hover: (offset: number, text: string) => getThreeMfHover(text, offset),
      validate: (doc: any) => validateThreeMf(typeof doc?.getText === "function" ? doc.getText() : String(doc)),
    },
    disposables: [],
  });

  // 72. TOPAS
  globalLanguageRegistry.register({
    id: "topas",
    name: "TOPAS",
    extensions: [".topas", ".tps"],
    languageDef: topasLanguage,
    customHandlers: {
      symbols: (treeWrapper: any) =>
        getTopasDocumentSymbols(typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "")),
      hover: (offset: number, text: string) => getTopasHover(text, offset),
      validate: (doc: any) => validateTopas(typeof doc?.getText === "function" ? doc.getText() : String(doc)),
    },
    disposables: [],
  });

  // 73. OpenUSD
  const usdLspService = new UsdLspService();
  globalLanguageRegistry.register({
    id: "usd",
    name: "OpenUSD",
    extensions: [".usda", ".usd", ".usdc", ".usdz"],
    languageDef: usdLanguage,
    customHandlers: {
      symbols: (treeWrapper: any) =>
        usdLspService.getDocumentSymbols(typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "")),
      hover: (offset: number, text: string) => usdLspService.getHover(text, offsetToPosition(text, offset)),
      validate: (doc: any) => usdLspService.validate(typeof doc?.getText === "function" ? doc.getText() : String(doc)),
    },
    disposables: [],
  });

  if (
    workspaceManager?.unifiedWorkspace &&
    typeof workspaceManager.unifiedWorkspace.registerLanguageDef === "function"
  ) {
    for (const plugin of globalLanguageRegistry.getAllPlugins()) {
      if (plugin.languageDef) {
        workspaceManager.unifiedWorkspace.registerLanguageDef(plugin.id, plugin.languageDef);
      }
    }
  }

  if (connection) {
    connection.console.info("[lsp] All 81 built-in domain language plugins registered successfully.");
  }
}
