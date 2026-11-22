// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  adamsLanguage,
  createAdamsActionHandlers,
  getAdamsDocumentSymbols,
  getAdamsHover,
  validateAdams,
} from "@modelscript/adams";
import {
  amplActionHandlers,
  amplLanguage,
  getAmplDocumentSymbols,
  getAmplHover,
  validateAmpl,
} from "@modelscript/ampl";
import {
  antimonyLanguage,
  getAntimonyDocumentSymbols,
  getAntimonyHover,
  validateAntimony,
} from "@modelscript/antimony";
import { asmLanguage, getAsmDiagnostics, getAsmDocumentSymbols } from "@modelscript/asm";
import {
  aspenActionHandlers,
  aspenLanguage,
  getAspenDocumentSymbols,
  getAspenHover,
  validateAspen,
} from "@modelscript/aspen";
import { atopileLanguage, lintAtopile, parseAtopile } from "@modelscript/atopile";
import { atpLanguage, getAtpDiagnostics, getAtpDocumentSymbols } from "@modelscript/atp";
import {
  automationMLLanguage,
  getAutomationMLDocumentSymbols,
  getAutomationMLHover,
  validateAutomationML,
} from "@modelscript/automationml";
import {
  autosarActionHandlers,
  autosarLanguage,
  getAutosarDocumentSymbols,
  getAutosarHover,
  validateAutosar,
} from "@modelscript/autosar";
import { bnglLanguage, getBnglDocumentSymbols, getBnglHover, validateBngl } from "@modelscript/bngl";
import { cActionHandlers, cLanguage } from "@modelscript/c";
import { c37118Language, getC37118Diagnostics, getC37118DocumentSymbols } from "@modelscript/c37118";
import {
  canteraLanguage,
  extractCanteraTheoryConstraints,
  getCanteraDocumentSymbols,
  getCanteraHover,
  validateCantera,
} from "@modelscript/cantera";
import {
  ccsdsActionHandlers,
  ccsdsLanguage,
  getCcsdsDocumentSymbols,
  getCcsdsHover,
  validateCcsds,
} from "@modelscript/ccsds";
import { cellmlLanguage, getCellmlDocumentSymbols, getCellmlHover, validateCellml } from "@modelscript/cellml";
import {
  cfdActionHandlers,
  cfdLanguage,
  computeCfdSemanticTokensData,
  getCfdCodeLenses,
  getCfdDocumentSymbols,
  getCfdHover,
  validateCfd,
} from "@modelscript/cfd";
import { cgmesLanguage, lintCgmesModel, parseCgmesRdf } from "@modelscript/cgmes";
import { comtradeLanguage, getComtradeDiagnostics, getComtradeDocumentSymbols } from "@modelscript/comtrade";
import csvLangFallback from "@modelscript/csv/language";
import { cymeLanguage, getCymeDiagnostics, getCymeDocumentSymbols } from "@modelscript/cyme";
import { dicomRtLanguage, getDicomRtDocumentSymbols, getDicomRtHover, validateDicomRt } from "@modelscript/dicom-rt";
import { dnp3Language, getDnp3Diagnostics, getDnp3DocumentSymbols } from "@modelscript/dnp3";
import {
  easy5ActionHandlers,
  easy5Language,
  getEasy5DocumentSymbols,
  getEasy5Hover,
  validateEasy5,
} from "@modelscript/easy5";
import {
  eclipseActionHandlers,
  eclipseLanguage,
  getEclipseDocumentSymbols,
  getEclipseHover,
  validateEclipse,
} from "@modelscript/eclipse";
import {
  energyplusActionHandlers,
  energyplusLanguage,
  getEnergyPlusDocumentSymbols,
  getEnergyPlusHover,
  validateEnergyPlus,
} from "@modelscript/energyplus";
import {
  epanetActionHandlers,
  epanetLanguage,
  getEpanetDocumentSymbols,
  getEpanetHover,
  validateEpanet,
} from "@modelscript/epanet";
import {
  computeFeaSemanticTokensData,
  feaActionHandlers,
  feaLanguage,
  getFeaCodeLenses,
  getFeaDocumentSymbols,
  getFeaHover,
  validateFea,
} from "@modelscript/fea";
import { febioLanguage, getFebioDocumentSymbols, getFebioHover, validateFebio } from "@modelscript/febio";
import { fiberLanguage } from "@modelscript/fiber";
import { computeFortranSemanticTokensData, fortranActionHandlers, fortranLanguage } from "@modelscript/fortran";
import { genbankLanguage, getGenbankDocumentSymbols, getGenbankHover, validateGenbank } from "@modelscript/genbank";
import {
  createGensysActionHandlers,
  gensysLanguage,
  getGensysDocumentSymbols,
  getGensysHover,
  validateGensys,
} from "@modelscript/gensys";
import { getGpromsDocumentSymbols, getGpromsHover, gpromsLanguage, validateGproms } from "@modelscript/gproms";
import {
  getGridlabdDiagnostics,
  getGridlabdDocumentSymbols,
  getGridlabdHover,
  gridlabdLanguage,
} from "@modelscript/gridlabd";
import { getGtfsDocumentSymbols, getGtfsHover, gtfsLanguage, validateGtfs } from "@modelscript/gtfs";
import {
  getGtsuiteDocumentSymbols,
  getGtsuiteHover,
  gtsuiteActionHandlers,
  gtsuiteLanguage,
  validateGtsuite,
} from "@modelscript/gtsuite";
import {
  getDiagnostics as getHecHmsDiagnostics,
  getDocumentSymbols as getHecHmsDocumentSymbols,
  hecHmsLanguage,
} from "@modelscript/hec-hms";
import { getHecRasDocumentSymbols, getHecRasHover, hecRasLanguage, validateHecRas } from "@modelscript/hec-ras";
import {
  getIbisDocumentSymbols,
  getIbisHover,
  ibisActionHandlers,
  ibisLanguage,
  validateIbis,
} from "@modelscript/ibis";
import { getIec104Diagnostics, getIec104DocumentSymbols, iec104Language } from "@modelscript/iec104";
import { getIgtlDocumentSymbols, getIgtlHover, igtlLanguage, validateIgtl } from "@modelscript/igtl";
import {
  getJsbsimDocumentSymbols,
  getJsbsimHover,
  jsbsimActionHandlers,
  jsbsimLanguage,
  validateJsbsim,
} from "@modelscript/jsbsim";
import {
  kicadLanguage,
  lintKiCadBoard,
  lintKiCadSchematic,
  parseKiCadDocument,
  resolveKiCadHover,
} from "@modelscript/kicad";
import { getLandgemDocumentSymbols, getLandgemHover, landgemLanguage, validateLandgem } from "@modelscript/landgem";
import lasLangFallback from "@modelscript/las/language";
import { getLpsDocumentSymbols, getLpsHover, lpsActionHandlers, lpsLanguage, validateLps } from "@modelscript/lps";
import {
  getMagicDrawDiagnostics,
  getMagicDrawDocumentSymbols,
  getMagicDrawHover,
  magicDrawActionHandlers,
  magicDrawLanguage,
} from "@modelscript/magicdraw";
import {
  extractMatpowerTheoryConstraints,
  getDiagnostics as getMatpowerDiagnostics,
  getDocumentSymbols as getMatpowerDocumentSymbols,
  matpowerLanguage,
} from "@modelscript/matpower";
import { getMlxtranDocumentSymbols, getMlxtranHover, mlxtranLanguage, validateMlxtran } from "@modelscript/mlxtran";
import {
  formatModelicaTree,
  getModelicaCodeLenses,
  modelicaActionHandlers,
  modelicaLanguage,
} from "@modelscript/modelica";
import { createModelicaQueryEngine } from "@modelscript/modelica/factory";
import modelicaLangFallback from "@modelscript/modelica/language";
import modelscriptLangFallback from "@modelscript/modelscript/language";
import { getModflowDocumentSymbols, getModflowHover, modflowLanguage, validateModflow } from "@modelscript/modflow";
import { getNiftiDocumentSymbols, getNiftiHover, niftiLanguage, validateNifti } from "@modelscript/nifti";
import { getNmtranDocumentSymbols, getNmtranHover, nmtranLanguage, validateNmtran } from "@modelscript/nmtran";
import { getOcppDocumentSymbols, getOcppHover, ocppLanguage, validateOcpp } from "@modelscript/ocpp";
import {
  getOlgaCodeLenses,
  getOlgaDocumentSymbols,
  getOlgaHover,
  getOlgaQuickFixes,
  olgaActionHandlers,
  olgaLanguage,
  validateOlga,
} from "@modelscript/olga";
import { getOneLinerDiagnostics, getOneLinerDocumentSymbols, onelinerLanguage } from "@modelscript/oneliner";
import { getOpenAdrDocumentSymbols, getOpenAdrHover, openadrLanguage, validateOpenAdr } from "@modelscript/openadr";
import {
  getOpenDriveDocumentSymbols,
  getOpenDriveHover,
  opendriveActionHandlers,
  opendriveLanguage,
  validateOpenDrive,
} from "@modelscript/opendrive";
import {
  getOpenDssDocumentSymbols,
  getOpenDssHover,
  opendssActionHandlers,
  openDssLanguage,
  validateOpenDss,
} from "@modelscript/opendss";
import {
  getOpenScenarioDocumentSymbols,
  getOpenScenarioHover,
  openscenarioActionHandlers,
  openScenarioLanguage,
  validateOpenScenario,
} from "@modelscript/openscenario";
import { getOpenSimDocumentSymbols, getOpenSimHover, openSimLanguage, validateOpenSim } from "@modelscript/opensim";
import { lintOpticalTopology, opticalLanguage, parseOpenRoadmTopology } from "@modelscript/optical";
import { getOscalDocumentSymbols, getOscalHover, oscalLanguage, validateOscal } from "@modelscript/oscal";
import { computeOwl2SemanticTokensData } from "@modelscript/owl2";
import { createOWL2QueryEngine } from "@modelscript/owl2/factory";
import owl2LangFallback from "@modelscript/owl2/language";
import { getPdbDocumentSymbols, getPdbHover, pdbLanguage, validatePdb } from "@modelscript/pdb";
import { getPhreeqcDocumentSymbols, getPhreeqcHover, phreeqcLanguage, validatePhreeqc } from "@modelscript/phreeqc";
import {
  getPlcopenDocumentSymbols,
  getPlcopenHover,
  plcopenActionHandlers,
  plcopenLanguage,
  validatePlcopen,
} from "@modelscript/plcopen";
import { getPlsCaddDiagnostics, getPlsCaddDocumentSymbols, plscaddLanguage } from "@modelscript/plscadd";
import { lintPowerFactoryModel, parsePowerFactoryXml, powerFactoryLanguage } from "@modelscript/powerfactory";
import { getPowerWorldDiagnostics, getPowerWorldDocumentSymbols, powerworldLanguage } from "@modelscript/powerworld";
import {
  createPscadActionHandlers,
  getPscadCodeLenses,
  getPscadCompletions,
  getPscadDefinitionLocation,
  getPscadDocumentSymbols,
  getPscadFoldingRanges,
  getPscadHover,
  getPscadInlayHints,
  getPscadQuickFixes,
  getPscadReferences,
  getPscadRenameEdits,
  pscadLanguage,
} from "@modelscript/pscad";
import { lintPslfDyd, lintPslfEpc, parsePslfDyd, parsePslfEpc, pslfLanguage } from "@modelscript/pslf";
import {
  createPsseActionHandlers,
  extractPsseTheoryConstraints,
  formatPsseDocument,
  getPsseCodeActions,
  getPsseCompletions,
  getPsseDefinition,
  getPsseDocumentSymbols,
  getPsseHover,
  getPsseInlayHints,
  getPsseReferences,
  getPsseRenameEdits,
  psseLanguage,
  validatePsse,
} from "@modelscript/psse";
import { getPypsaDiagnostics, getPypsaDocumentSymbols, pypsaLanguage } from "@modelscript/pypsa";
import {
  getQifDefinition,
  getQifDocumentSymbols,
  getQifHover,
  getQifReferences,
  qifLanguage,
  validateQif,
} from "@modelscript/qif";
import { lintAntennaPatternDeck, parseNsmaAdf, parsePlanetPat, ranLanguage } from "@modelscript/ran";
import {
  getRelap5DocumentSymbols,
  getRelap5Hover,
  relap5ActionHandlers,
  relap5Language,
  validateRelap5,
} from "@modelscript/relap5";
import {
  getReqifDefinition,
  getReqifDocumentSymbols,
  getReqifHover,
  getReqifReferences,
  reqifActionHandlers,
  reqifLanguage,
  validateReqif,
} from "@modelscript/reqif";
import {
  getRocetsDocumentSymbols,
  getRocetsHover,
  rocetsActionHandlers,
  rocetsLanguage,
  validateRocets,
} from "@modelscript/rocets";
import { getRtdsDiagnostics, getRtdsDocumentSymbols, rtdsLanguage } from "@modelscript/rtds";
import {
  getSbmlDocumentSymbols,
  getSbmlHover,
  sbmlActionHandlers,
  sbmlLanguage,
  validateSbml,
} from "@modelscript/sbml";
import { getSbolDocumentSymbols, getSbolHover, sbolLanguage, validateSbol } from "@modelscript/sbol";
import { getScadCodeLenses, getScadDefinition, getScadReferences } from "@modelscript/scad";
import scadLangFallback from "@modelscript/scad/language";
import { getSclDiagnostics, getSclDocumentSymbols, sclLanguage } from "@modelscript/scl";
import { getSedmlDocumentSymbols, getSedmlHover, sedmlLanguage, validateSedml } from "@modelscript/sedml";
import { getSELDiagnostics, getSELDocumentSymbols, selLanguage } from "@modelscript/sel";
import {
  getSimaDocumentSymbols,
  getSimaHover,
  simaActionHandlers,
  simaLanguage,
  validateSima,
} from "@modelscript/sima";
import {
  createSimpackActionHandlers,
  getSimpackDocumentSymbols,
  getSimpackHover,
  simpackLanguage,
  validateSimpack,
} from "@modelscript/simpack";
import {
  getSimulinkDocumentSymbols,
  getSimulinkHover,
  simulinkActionHandlers,
  simulinkLanguage,
  validateSimulink,
} from "@modelscript/simulink";
import { getSmilesDocumentSymbols, getSmilesHover, smilesLanguage, validateSmiles } from "@modelscript/smiles";
import {
  extractSpiceTheoryConstraints,
  getSpiceDocumentSymbols,
  getSpiceHover,
  spiceActionHandlers,
  spiceLanguage,
  validateSpice,
} from "@modelscript/spice";
import { sspLanguage } from "@modelscript/ssp";
import {
  computeStepSemanticTokensData,
  formatStepDocument,
  getStepCodeLenses,
  getStepDefinition,
  getStepHover,
  getStepReferences,
  getStepSignatureHelp,
  stepLanguage,
} from "@modelscript/step";
import {
  getSwmmDocumentSymbols,
  getSwmmHover,
  swmmActionHandlers,
  swmmLanguage,
  validateSwmm,
} from "@modelscript/swmm";
import { computeSysML2SemanticTokensData, formatSysmlSource, getSysml2CodeLenses } from "@modelscript/sysml2";
import { createSysML2QueryEngine } from "@modelscript/sysml2/factory";
import sysml2LangFallback from "@modelscript/sysml2/language";
import { getThreeMfDocumentSymbols, getThreeMfHover, threeMfLanguage, validateThreeMf } from "@modelscript/three-mf";
import { getTopasDocumentSymbols, getTopasHover, topasLanguage, validateTopas } from "@modelscript/topas";
import {
  getTouchstoneDocumentSymbols,
  getTouchstoneHover,
  touchstoneActionHandlers,
  touchstoneLanguage,
  validateTouchstone,
} from "@modelscript/touchstone";
import { getToughDocumentSymbols, getToughHover, toughLanguage, validateTough } from "@modelscript/tough";
import {
  extractUrdfTheoryConstraints,
  getUrdfDocumentSymbols,
  getUrdfHover,
  urdfActionHandlers,
  urdfLanguage,
  validateUrdf,
} from "@modelscript/urdf";
import { extractUsdCadComponents, usdLanguage, UsdLspService } from "@modelscript/usd";
import {
  getVerilogADocumentSymbols,
  getVerilogAHover,
  validateVerilogA,
  verilogAActionHandlers,
  verilogALanguage,
} from "@modelscript/verilog-a";
import { getWaterMlDiagnostics, getWaterMlDocumentSymbols, watermlLanguage } from "@modelscript/waterml";
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

function docText(doc: any): string {
  return typeof doc === "string" ? doc : typeof doc?.getText === "function" ? doc.getText() : String(doc ?? "");
}

function treeText(treeWrapper: any): string {
  return typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "");
}

function offsetToPos(text: string, offset: number): { line: number; character: number } {
  const lines = text.slice(0, offset).split("\n");
  return { line: lines.length - 1, character: lines[lines.length - 1]!.length };
}

async function simulateDaeHelper(dae: any, opts: { startTime: number; stopTime: number; step: number }) {
  const [{ initBltWasm }, { simulateArena }] = await Promise.all([
    import("@modelscript/runtime"),
    import("@modelscript/simulate"),
  ]);
  await initBltWasm();
  return simulateArena(dae, opts);
}

interface StandardPluginSpec {
  id: string;
  name: string;
  extensions: string[];
  languageDef: any;
  symbols?: (text: string) => any;
  hoverPos?: (text: string, pos: { line: number; character: number }) => any;
  hoverOffset?: (text: string, offset: number) => any;
  validate?: (text: string) => any;
  validateWithTree?: (text: string, cstTree?: any) => any;
  customHandlers?: Record<string, any>;
  actionHandlers?: Record<string, any>;
  extractTheoryConstraints?: (text: string) => any;
  workspaceIndex?: any;
  handlers?: any;
  disposables?: any[];
}

function registerStandardPlugin(spec: StandardPluginSpec): void {
  const customHandlers: Record<string, any> = {};
  if (spec.symbols) {
    const fn = spec.symbols;
    customHandlers["symbols"] = (treeWrapper: any) => fn(treeText(treeWrapper));
  }
  if (spec.hoverPos) {
    const fn = spec.hoverPos;
    customHandlers["hover"] = (offset: number, text: string) => fn(text, offsetToPos(text, offset));
  } else if (spec.hoverOffset) {
    const fn = spec.hoverOffset;
    customHandlers["hover"] = (offset: number, text: string) => fn(text, offset);
  }
  if (spec.validateWithTree) {
    const fn = spec.validateWithTree;
    customHandlers["validate"] = (doc: any, cstTree?: any) => fn(docText(doc), cstTree);
  } else if (spec.validate) {
    const fn = spec.validate;
    customHandlers["validate"] = (doc: any) => fn(docText(doc));
  }
  if (spec.customHandlers) {
    Object.assign(customHandlers, spec.customHandlers);
  }
  globalLanguageRegistry.register({
    id: spec.id,
    name: spec.name,
    extensions: spec.extensions,
    languageDef: spec.languageDef,
    ...(spec.workspaceIndex !== undefined ? { workspaceIndex: spec.workspaceIndex } : {}),
    ...(spec.handlers !== undefined ? { handlers: spec.handlers } : {}),
    ...(spec.extractTheoryConstraints !== undefined ? { extractTheoryConstraints: spec.extractTheoryConstraints } : {}),
    ...(Object.keys(customHandlers).length > 0 ? { customHandlers } : {}),
    ...(spec.actionHandlers !== undefined ? { actionHandlers: spec.actionHandlers } : {}),
    disposables: spec.disposables ?? [],
  });
}

/**
 * Registers all built-in domain language plugins and their associated workspace
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

  function registerParserBackedPlugin(
    plugin: any,
    opts?: { parserKey?: string; queryEngineKey?: string | false },
  ): void {
    const parserKey = opts?.parserKey ?? plugin.id;
    const descriptors: PropertyDescriptorMap = {
      parser: {
        enumerable: true,
        configurable: true,
        get() {
          return parserService?.getParser(parserKey);
        },
        set(val: any) {
          if (parserService && parserService.getParser(parserKey) !== val) {
            parserService.registerParser(parserKey, val);
          }
        },
      },
      facade: {
        enumerable: true,
        configurable: true,
        get() {
          return parserService?.getFacade(parserKey);
        },
        set(val: any) {
          if (parserService && parserService.getFacade(parserKey) !== val) {
            parserService.registerParser(parserKey, parserService.getParser(parserKey), val);
          }
        },
      },
    };
    if (opts?.queryEngineKey !== false && opts?.queryEngineKey !== undefined) {
      const qeKey = opts.queryEngineKey;
      descriptors["queryEngine"] = {
        enumerable: true,
        configurable: true,
        get() {
          return workspaceManager.getQueryEngine(qeKey) ?? undefined;
        },
        set(val: any) {
          workspaceManager.setQueryEngine(qeKey, val ?? null);
        },
      };
    }
    Object.defineProperties(plugin, descriptors);
    globalLanguageRegistry.register(plugin);
  }

  // 1. Core Systems & Modeling Languages
  ensureWorkspaceIndex("modelica", () => workspaceManager.getWorkspaceIndex("modelica"), modelicaLangFallback);
  ensureWorkspaceIndex("sysml2", () => workspaceManager.getWorkspaceIndex("sysml2"), sysml2LangFallback);
  ensureWorkspaceIndex("sysml", () => workspaceManager.getWorkspaceIndex("sysml2"), sysml2LangFallback);
  ensureWorkspaceIndex("owl2", () => workspaceManager.getWorkspaceIndex("owl2"), owl2LangFallback);

  const fullDocReplaceEdit = (doc: any, newText: string) => {
    const lastLine = doc.lineCount - 1;
    const lastChar = doc.getText().length - doc.offsetAt({ line: lastLine, character: 0 });
    return [{ range: { start: { line: 0, character: 0 }, end: { line: lastLine, character: lastChar } }, newText }];
  };

  registerParserBackedPlugin(
    {
      id: "modelica",
      name: "Modelica",
      extensions: [".mo", ".mos", ".msim"],
      workspaceIndex: workspaceManager.getWorkspaceIndex("modelica"),
      createQueryEngine: (idx: any, tree?: any) => createModelicaQueryEngine(idx, tree),
      languageDef: modelicaLanguage,
      handlers: modelicaLanguage.lsp?.handlers,
      customHandlers: {
        codeLens: (doc: any, ctx?: any) => getModelicaCodeLenses(doc, ctx),
        format: (doc: any, _options?: any, ctx?: any) => {
          if (ctx?.isParserReady && !ctx.isParserReady()) return [];
          const tree = ctx?.getDocumentTree?.(doc.uri);
          if (!tree) return [];
          return fullDocReplaceEdit(doc, formatModelicaTree(tree, doc.getText()));
        },
      },
      actionHandlers: modelicaActionHandlers,
    },
    { queryEngineKey: "modelica" },
  );

  for (const sysmlId of ["sysml", "sysml2"] as const) {
    registerParserBackedPlugin(
      {
        id: sysmlId,
        name: "SysML v2",
        extensions: [".sysml", ".sysml2", ".kerml"],
        workspaceIndex: workspaceManager.getWorkspaceIndex("sysml2"),
        createQueryEngine: (idx: any, tree?: any) => createSysML2QueryEngine(idx, tree),
        languageDef: sysml2LangFallback,
        customHandlers: {
          codeLens: (doc: any, ctx?: any) =>
            getSysml2CodeLenses(ctx?.text ?? docText(doc), ctx?.uri ?? doc?.uri ?? "", ctx),
          format: (doc: any, options?: any) =>
            fullDocReplaceEdit(
              doc,
              formatSysmlSource(doc.getText(), {
                tabSize: options?.tabSize,
                insertSpaces: options?.insertSpaces,
              }),
            ),
          rangeFormat: (doc: any, range: any, options?: any) =>
            fullDocReplaceEdit(
              doc,
              formatSysmlSource(doc.getText(), {
                tabSize: options?.tabSize,
                insertSpaces: options?.insertSpaces,
                startLine: range?.start?.line,
                endLine: range?.end?.line,
              }),
            ),
          semanticTokens: (doc: any, tree?: any) =>
            computeSysML2SemanticTokensData(docText(doc), tree, parserService?.getParser("sysml2")),
        },
      },
      { parserKey: "sysml2", queryEngineKey: "sysml2" },
    );
  }

  registerParserBackedPlugin(
    {
      id: "step",
      name: "STEP",
      extensions: [".step", ".stp", ".p21"],
      languageDef: stepLanguage,
      handlers: stepLanguage.lsp?.handlers,
      customHandlers: {
        definition: (offset: number, text: string, uri?: string) =>
          getStepDefinition(text, offset, uri ?? "", workspaceManager.unifiedWorkspace),
        references: (offset: number, text: string, uri?: string) =>
          getStepReferences(text, offset, uri ?? "", workspaceManager.unifiedWorkspace),
        hover: (offset: number, text: string, uri?: string) => getStepHover(offset, text, uri),
        signatureHelp: (doc: any, position: any) => getStepSignatureHelp(doc, position),
        format: (doc: any) => formatStepDocument(doc),
        codeLens: (doc: any, ctx?: any) =>
          getStepCodeLenses(ctx?.text ?? docText(doc), ctx?.uri ?? doc?.uri ?? "", ctx),
        semanticTokens: (doc: any, tree?: any) => computeStepSemanticTokensData(docText(doc), tree),
      },
    },
    { queryEngineKey: "step" },
  );

  registerParserBackedPlugin(
    {
      id: "owl2",
      name: "OWL2",
      extensions: [".owl", ".owl2", ".ttl", ".ofn", ".fss", ".owx"],
      get workspaceIndex() {
        return workspaceManager.getWorkspaceIndex("owl2");
      },
      createQueryEngine: (idx: any, tree?: any) => createOWL2QueryEngine(idx, tree),
      languageDef: owl2LangFallback,
      customHandlers: {
        codeLens: (_doc: any, ctx?: any) => ({
          appendUniversal: true,
          lenses: ctx?.flags?.showVerification
            ? [
                {
                  range: ctx.headerRange ?? { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
                  command: {
                    title: "✓ Verify Ontology Consistency (Description Logic Tableau)",
                    command: "modelscript.openContractExplorer",
                    arguments: [ctx?.uri ?? ""],
                  },
                },
              ]
            : [],
        }),
        semanticTokens: (doc: any, tree?: any) => computeOwl2SemanticTokensData(docText(doc), tree, doc?.uri),
      },
    },
    { queryEngineKey: "owl2" },
  );

  registerParserBackedPlugin({
    id: "csv",
    name: "CSV",
    extensions: [".csv"],
    languageDef: csvLangFallback,
    customHandlers: {
      codeLens: (_doc: any, ctx?: any) => ({
        appendUniversal: true,
        lenses: ctx?.flags?.showSimulate
          ? [
              {
                range: ctx.headerRange ?? { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
                command: {
                  title: "📊 Plot CSV Telemetry Series",
                  command: "modelscript.openSimulationView",
                  arguments: [ctx?.uri ?? ""],
                },
              },
            ]
          : [],
      }),
      validate: async (doc: any) => {
        const { lintCsv } = await import("@modelscript/csv/csv-parser");
        return lintCsv(docText(doc));
      },
    },
  });

  registerParserBackedPlugin({
    id: "las",
    name: "LAS Well Log",
    extensions: [".las"],
    languageDef: lasLangFallback,
    customHandlers: {
      validate: async (doc: { getText?(): string } | string) => {
        const { lintLas } = await import("@modelscript/las/las-parser");
        return lintLas(docText(doc));
      },
    },
  });

  registerParserBackedPlugin({
    id: "scad",
    name: "OpenSCAD",
    extensions: [".scad"],
    languageDef: scadLangFallback,
    customHandlers: {
      definition: (offset: number, text: string, uri?: string) =>
        getScadDefinition(text, offset, uri ?? "", workspaceManager.unifiedWorkspace),
      references: (offset: number, text: string, uri?: string) =>
        getScadReferences(text, offset, uri ?? "", workspaceManager.unifiedWorkspace),
      codeLens: (doc: any, ctx?: any) => getScadCodeLenses(ctx?.text ?? docText(doc), ctx?.uri ?? doc?.uri ?? "", ctx),
    },
  });

  registerParserBackedPlugin(
    {
      id: "modelscript",
      name: "ModelScript",
      extensions: [".modelscript", ".msx"],
      workspaceIndex: workspaceManager.getWorkspaceIndex("modelscript"),
      languageDef: modelscriptLangFallback,
      handlers: modelscriptLangFallback.lsp?.handlers,
      customHandlers: {
        codeLens: (_doc: any, ctx?: any) => {
          const range = ctx?.headerRange ?? { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
          const uri = ctx?.uri ?? "";
          const out: any[] = [];
          if (ctx?.flags?.showSimulate) {
            out.push({
              range,
              command: {
                title: "▶ Simulate ModelScript Study",
                command: "modelscript.action.simulate",
                arguments: [uri],
              },
            });
          }
          if (ctx?.flags?.showVerification) {
            out.push({
              range,
              command: {
                title: "✓ Verify Formal Contracts",
                command: "modelscript.openContractExplorer",
                arguments: [uri],
              },
            });
          }
          return { appendUniversal: true, lenses: out };
        },
      },
    },
    { queryEngineKey: "modelscript" },
  );

  // 2. CFD & FEA
  registerStandardPlugin({
    id: "cfd",
    name: "CFD",
    extensions: [".cfd", ".cfg", ".cfgt", ".su2", ".foam"],
    languageDef: cfdLanguage,
    symbols: getCfdDocumentSymbols,
    hoverPos: getCfdHover,
    validate: validateCfd,
    customHandlers: {
      codeLens: (doc: any, ctx?: any) => {
        const text = ctx?.text ?? (typeof doc?.getText === "function" ? doc.getText() : String(doc ?? ""));
        const uri = ctx?.uri ?? doc?.uri ?? "";
        return getCfdCodeLenses(text, uri, ctx);
      },
      semanticTokens: (doc: any, tree?: any) => {
        const text = typeof doc?.getText === "function" ? doc.getText() : String(doc ?? "");
        return computeCfdSemanticTokensData(text, tree, doc?.uri);
      },
    },
    actionHandlers: cfdActionHandlers,
  });
  registerStandardPlugin({
    id: "fea",
    name: "FEA",
    extensions: [".fea", ".inp", ".inpt", ".bdf", ".dat"],
    languageDef: feaLanguage,
    symbols: getFeaDocumentSymbols,
    hoverPos: getFeaHover,
    validate: validateFea,
    customHandlers: {
      codeLens: (doc: any, ctx?: any) => {
        const text = ctx?.text ?? (typeof doc?.getText === "function" ? doc.getText() : String(doc ?? ""));
        const uri = ctx?.uri ?? doc?.uri ?? "";
        return getFeaCodeLenses(text, uri, ctx);
      },
      semanticTokens: (doc: any, tree?: any) => {
        const text = typeof doc?.getText === "function" ? doc.getText() : String(doc ?? "");
        return computeFeaSemanticTokensData(text, tree, doc?.uri);
      },
    },
    actionHandlers: feaActionHandlers,
  });

  // 3. PSCAD
  const collectPscadDocs = (): Array<{ uri: string; text: string }> => {
    const docs: Array<{ uri: string; text: string }> = [];
    for (const d of (workspaceManager as any).documentManager?.documents?.all?.() ?? []) {
      if (typeof d?.uri === "string" && /\.(pscx|pslx|pswx|psmx)$/i.test(d.uri) && typeof d.getText === "function") {
        docs.push({ uri: d.uri, text: d.getText() });
      }
    }
    return docs;
  };
  globalLanguageRegistry.register({
    id: "pscad",
    name: "PSCAD",
    extensions: [".pscx", ".pslx", ".pswx", ".psmx"],
    languageDef: pscadLanguage,
    customHandlers: {
      symbols: (treeWrapper: any, textArg?: string) => {
        const text = textArg ?? (typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? ""));
        return getPscadDocumentSymbols(text);
      },
      folding: (_tree: any, textArg?: string) => getPscadFoldingRanges(textArg ?? ""),
      hover: (offset: number, text: string) => {
        const h = getPscadHover(text, offset);
        return h ? { contents: { kind: "markdown", value: h.contents } } : null;
      },
      complete: (offset: number, text: string) => getPscadCompletions(text, offset),
      definition: (offset: number, text: string, uri?: string) =>
        getPscadDefinitionLocation(text, offset, uri ?? "", collectPscadDocs(), workspaceManager.unifiedWorkspace),
      references: (offset: number, text: string, uri?: string) =>
        getPscadReferences(text, offset, uri ?? "", collectPscadDocs(), workspaceManager.unifiedWorkspace),
      inlayHints: (doc: any, range?: any) =>
        getPscadInlayHints(docText(doc), range).map((h) => ({
          position: { line: h.position.line, character: h.position.character },
          label: h.label,
          kind: h.kind === "parameter" ? 2 : 1,
          paddingLeft: h.paddingLeft ?? true,
        })),
      rename: (doc: any, position: any, newName: string) => {
        const text = docText(doc);
        const offset = typeof doc?.offsetAt === "function" ? doc.offsetAt(position) : 0;
        const changes = getPscadRenameEdits(text, offset, newName, doc?.uri ?? "", collectPscadDocs());
        return changes ? { changes } : null;
      },
      codeActions: (doc: any) =>
        getPscadQuickFixes(docText(doc), doc?.uri ?? "").map((fix) => ({
          title: fix.title,
          kind: "quickfix",
          edit: fix.edit,
        })),
      codeLens: (doc: any, ctx?: any) => getPscadCodeLenses(ctx?.text ?? docText(doc), ctx?.uri ?? doc?.uri ?? "", ctx),
    },
    actionHandlers: createPscadActionHandlers({
      buildDiagram: async (project, definitionName) => {
        const { buildPscadDiagram } = await import("@modelscript/diagram");
        return buildPscadDiagram(project, definitionName);
      },
      getEmtSolverRunner: async () => {
        try {
          const simMod: any = await import("@modelscript/simulate" as string);
          if (simMod?.EmtSolver) {
            return (circuit: any, options: any) => {
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
        return undefined;
      },
    }),
    disposables: [],
  });

  // 4. EASY5
  registerStandardPlugin({
    id: "easy5",
    name: "EASY5",
    extensions: [".ez5", ".ezm", ".ezd", ".eas"],
    languageDef: easy5Language,
    symbols: getEasy5DocumentSymbols,
    hoverPos: getEasy5Hover,
    validate: validateEasy5,
    actionHandlers: easy5ActionHandlers,
  });

  // 5. ROCETS
  registerStandardPlugin({
    id: "rocets",
    name: "ROCETS",
    extensions: [".roc", ".deck"],
    languageDef: rocetsLanguage,
    symbols: getRocetsDocumentSymbols,
    hoverPos: getRocetsHover,
    validate: validateRocets,
    actionHandlers: rocetsActionHandlers,
  });

  // 6. PSSE
  void import("@modelscript/psse").then((m) => m.ensureBuiltInPsseLibraryRegistered?.());
  globalLanguageRegistry.register({
    id: "psse",
    name: "PSSE",
    extensions: [".raw", ".dyr", ".seq", ".con", ".mon", ".sub", ".sav", ".out"],
    languageDef: psseLanguage,
    get workspaceIndex() {
      return workspaceManager.unifiedWorkspace;
    },
    extractTheoryConstraints: extractPsseTheoryConstraints,
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
      validate: (doc: any, tree?: unknown) => {
        const text = docText(doc);
        const uri = typeof doc?.uri === "string" ? doc.uri : "model.raw";
        return validatePsse(text, uri, tree);
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
      inlayHints: (doc: any, range?: any) => {
        const text = docText(doc);
        const uri = typeof doc?.uri === "string" ? doc.uri : "model.raw";
        return getPsseInlayHints(text, uri)
          .filter((h) => !range || (h.position.line >= range.start.line && h.position.line <= range.end.line))
          .map((h) => ({
            position: { line: h.position.line, character: h.position.character },
            label: h.label,
            kind: h.kind === 2 ? 2 : 1,
            paddingLeft: h.paddingLeft ?? false,
            paddingRight: h.paddingRight ?? true,
          }));
      },
      rename: (doc: any, position: any, newName: string) => {
        const text = docText(doc);
        return getPsseRenameEdits(
          text,
          position,
          newName,
          doc?.uri ?? "",
          workspaceManager.unifiedWorkspace as unknown as Parameters<typeof getPsseRenameEdits>[4],
        );
      },
      codeActions: (doc: any, range: any, diagnostics: any[]) =>
        getPsseCodeActions(
          docText(doc),
          range,
          diagnostics as unknown as Parameters<typeof getPsseCodeActions>[2],
          doc?.uri ?? "",
        ).map((fix) => ({
          title: fix.title,
          kind: "quickfix",
          edit: fix.edit,
          ...(fix.isPreferred !== undefined ? { isPreferred: fix.isPreferred } : {}),
        })),
      format: (doc: any) => {
        const formatted = formatPsseDocument(doc.getText(), doc.uri);
        const lastLine = doc.lineCount - 1;
        const lastChar = doc.getText().length - doc.offsetAt({ line: lastLine, character: 0 });
        return [
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: lastLine, character: lastChar },
            },
            newText: formatted,
          },
        ];
      },
      codeLens: (_doc: any, ctx?: any) => ({
        appendUniversal: true,
        lenses: ctx?.flags?.showSimulate
          ? [
              {
                range: ctx.headerRange ?? { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
                command: {
                  title: "⊞ Open PSS/E Grid Workbench & Tables",
                  command: "modelscript.openRawWorkbench",
                  arguments: [ctx?.uri ?? ""],
                },
              },
            ]
          : [],
      }),
    },
    actionHandlers: createPsseActionHandlers(() => workspaceManager.unifiedWorkspace),
    disposables: [],
  });

  // 7. Aspen
  registerStandardPlugin({
    id: "aspen",
    name: "Aspen",
    extensions: [".in", ".inp", ".bkp"],
    languageDef: aspenLanguage,
    symbols: getAspenDocumentSymbols,
    hoverPos: getAspenHover,
    validate: validateAspen,
    actionHandlers: aspenActionHandlers,
  });

  // 8. SWMM
  registerStandardPlugin({
    id: "swmm",
    name: "SWMM",
    extensions: [".inp"],
    languageDef: swmmLanguage,
    symbols: getSwmmDocumentSymbols,
    hoverPos: getSwmmHover,
    validate: validateSwmm,
    actionHandlers: swmmActionHandlers,
  });

  // AMPL
  registerStandardPlugin({
    id: "ampl",
    name: "AMPL",
    extensions: [".mod", ".dat", ".ampl"],
    languageDef: amplLanguage,
    symbols: getAmplDocumentSymbols,
    hoverPos: getAmplHover,
    validate: validateAmpl,
    actionHandlers: amplActionHandlers,
  });

  // 9. Touchstone
  registerStandardPlugin({
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
    symbols: getTouchstoneDocumentSymbols,
    hoverPos: getTouchstoneHover,
    validate: validateTouchstone,
    actionHandlers: touchstoneActionHandlers,
  });

  // 10. IBIS
  registerStandardPlugin({
    id: "ibis",
    name: "IBIS",
    extensions: [".ibs"],
    languageDef: ibisLanguage,
    symbols: getIbisDocumentSymbols,
    hoverPos: getIbisHover,
    validate: validateIbis,
    actionHandlers: ibisActionHandlers,
  });

  // 11. OLGA
  registerStandardPlugin({
    id: "olga",
    name: "OLGA",
    extensions: [".genkey", ".key", ".opi", ".olga", ".pvt", ".tab"],
    languageDef: olgaLanguage,
    symbols: getOlgaDocumentSymbols,
    hoverPos: getOlgaHover,
    validate: validateOlga,
    customHandlers: {
      codeLens: (doc: any, ctx?: any) => getOlgaCodeLenses(ctx?.text ?? docText(doc), ctx?.uri ?? doc?.uri ?? "", ctx),
      codeActions: (doc: any) =>
        getOlgaQuickFixes(docText(doc), doc?.uri ?? "").map((fix) => ({
          title: fix.title,
          kind: "quickfix",
          edit: fix.edit,
          ...(fix.isPreferred !== undefined ? { isPreferred: fix.isPreferred } : {}),
        })),
    },
    actionHandlers: olgaActionHandlers,
  });

  // 12. LPS
  registerStandardPlugin({
    id: "lps",
    name: "PipelineStudio",
    extensions: [".lps", ".tgx", ".tlx", ".tgn", ".tln", ".psg", ".psl"],
    languageDef: lpsLanguage,
    symbols: getLpsDocumentSymbols,
    hoverPos: getLpsHover,
    validateWithTree: validateLps,
    actionHandlers: lpsActionHandlers,
  });

  // 13. GENSYS
  registerStandardPlugin({
    id: "gensys",
    name: "GENSYS",
    extensions: [".calc", ".run", ".sub", ".geom", ".trax", ".wheel", ".ins"],
    languageDef: gensysLanguage,
    symbols: getGensysDocumentSymbols,
    hoverOffset: getGensysHover,
    validate: validateGensys,
    actionHandlers: createGensysActionHandlers({
      exportFmu: async (model, options) => {
        const { exportGensysFmu } = await import("@modelscript/exchange");
        return exportGensysFmu(
          model as Parameters<typeof exportGensysFmu>[0],
          options as Parameters<typeof exportGensysFmu>[1],
        );
      },
      simulateDae: simulateDaeHelper,
    }),
  });

  // 14. SIMPACK
  registerStandardPlugin({
    id: "simpack",
    name: "SIMPACK",
    extensions: [".spck", ".sim", ".mbs"],
    languageDef: simpackLanguage,
    symbols: getSimpackDocumentSymbols,
    hoverOffset: getSimpackHover,
    validate: validateSimpack,
    actionHandlers: createSimpackActionHandlers({
      exportFmu: async (model, options) => {
        const { exportSimpackFmu } = await import("@modelscript/exchange");
        return exportSimpackFmu(
          model as Parameters<typeof exportSimpackFmu>[0],
          options as Parameters<typeof exportSimpackFmu>[1],
        );
      },
      simulateDae: simulateDaeHelper,
    }),
  });

  // 15. ReqIF
  registerStandardPlugin({
    id: "reqif",
    name: "ReqIF",
    extensions: [".reqif", ".reqifz"],
    languageDef: reqifLanguage,
    symbols: getReqifDocumentSymbols,
    validateWithTree: validateReqif,
    customHandlers: {
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
      definition: (offset: number, text: string, uri?: string) =>
        getReqifDefinition(text, offset, uri ?? "file:///requirements.reqif", workspaceManager.unifiedWorkspace),
      references: (offset: number, text: string, uri?: string) =>
        getReqifReferences(text, offset, uri ?? "file:///requirements.reqif", workspaceManager.unifiedWorkspace),
    },
    actionHandlers: reqifActionHandlers,
  });

  // 15b. MagicDraw / Cameo (.mdzip, .mdxml, .xmi)
  registerStandardPlugin({
    id: "magicdraw",
    name: "MagicDraw / Cameo",
    extensions: [".mdzip", ".mdxml", ".xmi"],
    languageDef: magicDrawLanguage,
    symbols: getMagicDrawDocumentSymbols,
    validate: (text: string) => getMagicDrawDiagnostics(text),
    customHandlers: {
      hover: (offset: number, text: string) => getMagicDrawHover(text, offset),
    },
    actionHandlers: magicDrawActionHandlers,
  });

  // 16. SPICE
  registerStandardPlugin({
    id: "spice",
    name: "SPICE",
    extensions: [".cir", ".sp", ".net", ".lib"],
    languageDef: spiceLanguage,
    extractTheoryConstraints: extractSpiceTheoryConstraints,
    symbols: getSpiceDocumentSymbols,
    validate: validateSpice,
    customHandlers: {
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
    },
    actionHandlers: spiceActionHandlers,
  });

  // 17. Adams
  registerStandardPlugin({
    id: "adams",
    name: "MSC Adams",
    extensions: [".adm", ".cmd", ".acf"],
    languageDef: adamsLanguage,
    symbols: getAdamsDocumentSymbols,
    hoverOffset: getAdamsHover,
    validate: validateAdams,
    actionHandlers: createAdamsActionHandlers({ simulateDae: simulateDaeHelper }),
  });

  // 18. URDF
  registerStandardPlugin({
    id: "urdf",
    name: "ROS URDF & SDFormat",
    extensions: [".urdf", ".sdf", ".xacro"],
    languageDef: urdfLanguage,
    extractTheoryConstraints: extractUrdfTheoryConstraints,
    symbols: getUrdfDocumentSymbols,
    hoverOffset: getUrdfHover,
    validateWithTree: validateUrdf,
    actionHandlers: urdfActionHandlers,
    handlers: {
      "modelscript/getCadComponents": async (context: any, params: any) => {
        const text =
          params?.documentText ??
          params?.text ??
          context?.documentManager?.documents?.get(params?.uri)?.getText() ??
          "";
        if (typeof text !== "string" || !text.trim()) return [];
        const [{ parseUrdf, urdfToCadShapes }, cad] = await Promise.all([
          import("@modelscript/urdf"),
          import("@modelscript/cad"),
        ]);
        const shapes = urdfToCadShapes(parseUrdf(text));
        return shapes.map((s) => {
          const solid =
            s.type === "cylinder"
              ? cad.cylinder({ radius: Math.max(1e-4, s.dimensions.x / 2), height: Math.max(1e-4, s.dimensions.z) })
              : s.type === "sphere"
                ? cad.sphere({ radius: Math.max(1e-4, s.dimensions.x / 2) })
                : cad.box({
                    width: Math.max(1e-4, s.dimensions.x),
                    height: Math.max(1e-4, s.dimensions.y),
                    depth: Math.max(1e-4, s.dimensions.z),
                  });
          const mesh = cad.ManifoldWorker.evaluateSolid(solid);
          return {
            name: s.linkName,
            shapeType: s.type,
            cad: {
              uri: params?.uri ?? "urdf://robot",
              position: [s.origin.x, s.origin.y, s.origin.z] as [number, number, number],
            },
            proceduralMesh: {
              vertices: Array.from(mesh.vertices),
              indices: Array.from(mesh.indices),
              normals: Array.from(mesh.normals),
              ...(s.color
                ? { color: [s.color.r, s.color.g, s.color.b, s.color.a] as [number, number, number, number] }
                : {}),
            },
          };
        });
      },
    },
  });

  // 19. Verilog-A
  registerStandardPlugin({
    id: "verilog-a",
    name: "Verilog-A / Verilog-AMS",
    extensions: [".va", ".vams"],
    languageDef: verilogALanguage,
    symbols: getVerilogADocumentSymbols,
    hoverOffset: getVerilogAHover,
    validate: validateVerilogA,
    actionHandlers: verilogAActionHandlers,
  });

  // 20. PLCopen
  registerStandardPlugin({
    id: "plcopen",
    name: "IEC 61131-3 PLCopen / Structured Text",
    extensions: [".xml", ".plcopen", ".st"],
    languageDef: plcopenLanguage,
    symbols: getPlcopenDocumentSymbols,
    hoverOffset: getPlcopenHover,
    validateWithTree: validatePlcopen,
    actionHandlers: plcopenActionHandlers,
  });

  // 21. OpenDRIVE
  registerStandardPlugin({
    id: "opendrive",
    name: "ASAM OpenDRIVE",
    extensions: [".xodr", ".xml"],
    languageDef: opendriveLanguage,
    symbols: getOpenDriveDocumentSymbols,
    hoverOffset: getOpenDriveHover,
    validateWithTree: validateOpenDrive,
    actionHandlers: opendriveActionHandlers,
  });

  // 22. OpenDSS
  registerStandardPlugin({
    id: "opendss",
    name: "OpenDSS",
    extensions: [".dss"],
    languageDef: openDssLanguage,
    symbols: getOpenDssDocumentSymbols,
    hoverPos: getOpenDssHover,
    validate: validateOpenDss,
    actionHandlers: opendssActionHandlers,
  });

  // 23. OpenSCENARIO
  registerStandardPlugin({
    id: "openscenario",
    name: "OpenSCENARIO",
    extensions: [".xosc", ".osc"],
    languageDef: openScenarioLanguage,
    symbols: getOpenScenarioDocumentSymbols,
    hoverPos: getOpenScenarioHover,
    validateWithTree: validateOpenScenario,
    actionHandlers: openscenarioActionHandlers,
  });

  // 24. RELAP5
  registerStandardPlugin({
    id: "relap5",
    name: "RELAP5",
    extensions: [".i", ".inp", ".r5"],
    languageDef: relap5Language,
    symbols: getRelap5DocumentSymbols,
    hoverPos: getRelap5Hover,
    validate: validateRelap5,
    actionHandlers: relap5ActionHandlers,
  });

  // 25. ECLIPSE
  registerStandardPlugin({
    id: "eclipse",
    name: "ECLIPSE",
    extensions: [".data", ".dat", ".inc"],
    languageDef: eclipseLanguage,
    symbols: getEclipseDocumentSymbols,
    hoverPos: getEclipseHover,
    validate: validateEclipse,
    actionHandlers: eclipseActionHandlers,
  });

  // 26. SBML
  registerStandardPlugin({
    id: "sbml",
    name: "SBML",
    extensions: [".sbml", ".xml"],
    languageDef: sbmlLanguage,
    symbols: getSbmlDocumentSymbols,
    hoverPos: getSbmlHover,
    validateWithTree: validateSbml,
    actionHandlers: sbmlActionHandlers,
  });

  // 27. JSBSim
  registerStandardPlugin({
    id: "jsbsim",
    name: "JSBSim Flight Dynamics",
    extensions: [".xml"],
    languageDef: jsbsimLanguage,
    symbols: getJsbsimDocumentSymbols,
    hoverPos: getJsbsimHover,
    validateWithTree: validateJsbsim,
    actionHandlers: jsbsimActionHandlers,
  });

  // 28. EnergyPlus
  registerStandardPlugin({
    id: "energyplus",
    name: "EnergyPlus",
    extensions: [".idf", ".epjson"],
    languageDef: energyplusLanguage,
    symbols: getEnergyPlusDocumentSymbols,
    hoverOffset: getEnergyPlusHover,
    validate: validateEnergyPlus,
    actionHandlers: energyplusActionHandlers,
  });

  // 29. EPANET
  registerStandardPlugin({
    id: "epanet",
    name: "EPANET",
    extensions: [".inp"],
    languageDef: epanetLanguage,
    symbols: getEpanetDocumentSymbols,
    hoverOffset: getEpanetHover,
    validate: validateEpanet,
    actionHandlers: epanetActionHandlers,
  });

  // 30. CCSDS
  registerStandardPlugin({
    id: "ccsds",
    name: "CCSDS",
    extensions: [".ccsds", ".oem", ".opm", ".omm", ".xtce"],
    languageDef: ccsdsLanguage,
    symbols: getCcsdsDocumentSymbols,
    hoverOffset: getCcsdsHover,
    validate: validateCcsds,
    actionHandlers: ccsdsActionHandlers,
  });

  // 31. Simulink
  registerStandardPlugin({
    id: "simulink",
    name: "MATLAB Simulink",
    extensions: [".slx", ".mdl"],
    languageDef: simulinkLanguage,
    symbols: getSimulinkDocumentSymbols,
    validateWithTree: validateSimulink,
    customHandlers: {
      hover: (offset: number, text: string) => {
        const lines = text.slice(0, offset).split("\n");
        return getSimulinkHover(
          text,
          { line: lines.length - 1, character: lines[lines.length - 1]!.length },
          "model.mdl",
        );
      },
    },
    actionHandlers: simulinkActionHandlers,
  });

  // 32. AUTOSAR
  registerStandardPlugin({
    id: "autosar",
    name: "AUTOSAR Classic & Adaptive",
    extensions: [".arxml"],
    languageDef: autosarLanguage,
    symbols: getAutosarDocumentSymbols,
    hoverPos: getAutosarHover,
    validateWithTree: validateAutosar,
    actionHandlers: autosarActionHandlers,
  });

  // 33. Fortran
  globalLanguageRegistry.register({
    id: "fortran",
    name: "Fortran",
    extensions: [".f", ".for", ".f77", ".f90", ".f95", ".f03", ".f08"],
    languageDef: fortranLanguage,
    customHandlers: {
      validate: async (doc: any) => {
        const text = docText(doc);
        const { validateFortran } = await import("@modelscript/fortran");
        return validateFortran(text);
      },
      semanticTokens: (doc: any, tree?: any) => {
        const text = typeof doc?.getText === "function" ? doc.getText() : String(doc ?? "");
        return computeFortranSemanticTokensData(text, tree);
      },
    },
    actionHandlers: fortranActionHandlers,
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
        const text = docText(doc);
        const { lintC } = await import("@modelscript/c");
        return lintC(text);
      },
    },
    actionHandlers: cActionHandlers,
    disposables: [],
  });

  // 35. SIMA
  registerStandardPlugin({
    id: "sima",
    name: "SIMA",
    extensions: [".inp", ".sima", ".sys", ".hyd"],
    languageDef: simaLanguage,
    symbols: getSimaDocumentSymbols,
    hoverPos: getSimaHover,
    validate: validateSima,
    actionHandlers: simaActionHandlers,
  });

  // 36. GT-SUITE
  registerStandardPlugin({
    id: "gtsuite",
    name: "GT-SUITE",
    extensions: [".gtm", ".gtd", ".gtx", ".gt"],
    languageDef: gtsuiteLanguage,
    symbols: getGtsuiteDocumentSymbols,
    hoverPos: getGtsuiteHover,
    validate: validateGtsuite,
    actionHandlers: gtsuiteActionHandlers,
  });

  // 37. SSP (System Structure and Parameterization)
  globalLanguageRegistry.register({
    id: "ssp",
    name: "System Structure and Parameterization",
    extensions: [".ssd", ".ssv", ".ssm", ".ssp"],
    languageDef: sspLanguage,
    customHandlers: {
      validate: async (doc: any) => {
        const text = docText(doc);
        const uri = typeof doc?.uri === "string" ? doc.uri : "";
        const { lintSsd, lintSsv } = await import("@modelscript/ssp");
        const isSsv = uri.endsWith(".ssv") || text.includes("<ssv:ParameterSet");
        return isSsv ? lintSsv(text) : lintSsd(text);
      },
    },
    disposables: [],
  });

  // 38. HEC-RAS (River Hydraulics & Floodplains)
  registerStandardPlugin({
    id: "hec-ras",
    name: "HEC-RAS",
    extensions: [".g01", ".g02", ".g03", ".rasgeo", ".u01", ".f01", ".prj"],
    languageDef: hecRasLanguage,
    symbols: getHecRasDocumentSymbols,
    hoverPos: getHecRasHover,
    customHandlers: {
      validate: (doc: any) => {
        const text = docText(doc);
        return validateHecRas(text);
      },
    },
  });

  // 39. OCPP (Electric Vehicle Smart Charging)
  registerStandardPlugin({
    id: "ocpp",
    name: "OCPP",
    extensions: [".ocpp", ".ocpp.json", ".cpo", ".evse"],
    languageDef: ocppLanguage,
    symbols: getOcppDocumentSymbols,
    hoverPos: getOcppHover,
    customHandlers: {
      validate: (doc: any) => {
        const text = docText(doc);
        return validateOcpp(text);
      },
    },
  });

  // 40. OpenADR (Automated Demand Response & Grid Flexibility)
  registerStandardPlugin({
    id: "openadr",
    name: "OpenADR",
    extensions: [".oadr", ".oadr.xml", ".oadr.json", ".oadr.yaml"],
    languageDef: openadrLanguage,
    symbols: getOpenAdrDocumentSymbols,
    hoverPos: getOpenAdrHover,
    customHandlers: {
      validate: (doc: any) => {
        const text = docText(doc);
        return validateOpenAdr(text);
      },
    },
  });

  // 41. TOUGH (Deep Geothermal Reservoir & Hydrothermal Flows)
  registerStandardPlugin({
    id: "tough",
    name: "TOUGH",
    extensions: [".tough", ".dat", ".tgh"],
    languageDef: toughLanguage,
    symbols: getToughDocumentSymbols,
    hoverPos: getToughHover,
    customHandlers: {
      validate: (doc: any) => {
        const text = docText(doc);
        return validateTough(text);
      },
    },
  });

  // 42. MODFLOW (Multi-Layer Groundwater Aquifers)
  registerStandardPlugin({
    id: "modflow",
    name: "MODFLOW",
    extensions: [".dis", ".dis6", ".npf", ".npf6", ".wel", ".wel6", ".riv", ".riv6", ".chd", ".chd6"],
    languageDef: modflowLanguage,
    symbols: getModflowDocumentSymbols,
    hoverPos: getModflowHover,
    customHandlers: {
      validate: (doc: any) => {
        const text = docText(doc);
        return validateModflow(text);
      },
    },
  });

  // 43. LandGEM (Landfill Gas & ADM1 Anaerobic Digestion)
  registerStandardPlugin({
    id: "landgem",
    name: "LandGEM",
    extensions: [".landgem", ".lfg", ".biogas"],
    languageDef: landgemLanguage,
    symbols: getLandgemDocumentSymbols,
    hoverPos: getLandgemHover,
    customHandlers: {
      validate: (doc: any) => {
        const text = docText(doc);
        return validateLandgem(text);
      },
    },
  });

  // 44. GTFS (Public Transit Electrification & Traction)
  registerStandardPlugin({
    id: "gtfs",
    name: "GTFS",
    extensions: [".gtfs", ".gtfs.txt", ".gtfs-rt"],
    languageDef: gtfsLanguage,
    symbols: getGtfsDocumentSymbols,
    hoverPos: getGtfsHover,
    customHandlers: {
      validate: (doc: any) => {
        const text = docText(doc);
        return validateGtfs(text);
      },
    },
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
  registerStandardPlugin({
    id: "antimony",
    name: "Antimony",
    extensions: [".ant"],
    languageDef: antimonyLanguage,
    symbols: getAntimonyDocumentSymbols,
    validate: validateAntimony,
    customHandlers: {
      hover: (offset: number, text: string) => getAntimonyHover(text, offsetToPosition(text, offset)),
    },
  });

  // 46. AutomationML
  registerStandardPlugin({
    id: "automationml",
    name: "AutomationML",
    extensions: [".aml", ".amlx"],
    languageDef: automationMLLanguage,
    symbols: getAutomationMLDocumentSymbols,
    hoverOffset: getAutomationMLHover,
    validate: validateAutomationML,
  });

  // 47. BNGL
  registerStandardPlugin({
    id: "bngl",
    name: "BNGL",
    extensions: [".bngl"],
    languageDef: bnglLanguage,
    symbols: getBnglDocumentSymbols,
    validate: validateBngl,
    customHandlers: {
      hover: (offset: number, text: string) => getBnglHover(text, offsetToPosition(text, offset)),
    },
  });

  // 48. Cantera
  registerStandardPlugin({
    id: "cantera",
    name: "Cantera",
    extensions: [".cti", ".ctml"],
    languageDef: canteraLanguage,
    extractTheoryConstraints: extractCanteraTheoryConstraints,
    symbols: getCanteraDocumentSymbols,
    validate: validateCantera,
    customHandlers: {
      hover: (offset: number, text: string) => getCanteraHover(text, offsetToPosition(text, offset)),
    },
  });

  // 49. CellML
  registerStandardPlugin({
    id: "cellml",
    name: "CellML",
    extensions: [".cellml"],
    languageDef: cellmlLanguage,
    symbols: getCellmlDocumentSymbols,
    hoverOffset: getCellmlHover,
    validateWithTree: validateCellml,
  });

  // 50. CGMES
  globalLanguageRegistry.register({
    id: "cgmes",
    name: "CGMES",
    extensions: [".cgmes", ".cim", ".rdf"],
    languageDef: cgmesLanguage,
    customHandlers: {
      validate: (doc: any) => {
        const text = docText(doc);
        const model = parseCgmesRdf(text);
        return lintCgmesModel(model);
      },
    },
    disposables: [],
  });

  // 51. DICOM-RT
  registerStandardPlugin({
    id: "dicom-rt",
    name: "DICOM-RT",
    extensions: [".dcm.json", ".dicom-rt", ".rtplan.json", ".rtdose.json", ".rtstruct.json"],
    languageDef: dicomRtLanguage,
    symbols: getDicomRtDocumentSymbols,
    hoverOffset: getDicomRtHover,
    validateWithTree: validateDicomRt,
  });

  // 52. FEBio
  registerStandardPlugin({
    id: "febio",
    name: "FEBio",
    extensions: [".feb"],
    languageDef: febioLanguage,
    symbols: getFebioDocumentSymbols,
    hoverOffset: getFebioHover,
    validateWithTree: validateFebio,
  });

  // 53. Fiber
  globalLanguageRegistry.register({
    id: "fiber",
    name: "Fiber",
    extensions: [".fiber.geojson", ".osp.json"],
    languageDef: fiberLanguage,
    customHandlers: {
      validate: async (doc: any) => {
        const text = docText(doc);
        const { parseFiberGis, lintFiberNetwork } = await import("@modelscript/fiber");
        try {
          const network = parseFiberGis(text);
          const diags = lintFiberNetwork(network);
          return diags.map((d) => {
            const idx = d.elementId ? text.indexOf(d.elementId) : -1;
            const pos = idx >= 0 ? offsetToPosition(text, idx) : { line: 0, character: 0 };
            return {
              range: {
                start: pos,
                end: { line: pos.line, character: pos.character + Math.max(1, d.elementId?.length ?? 1) },
              },
              severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
              code: d.code,
              source: "modelscript-fiber",
              message: d.message,
            };
          });
        } catch (err: any) {
          return [
            {
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
              severity: 1,
              code: "FIBER1000",
              source: "modelscript-fiber",
              message: err?.message ? String(err.message) : "Invalid Fiber GeoJSON/OSP document.",
            },
          ];
        }
      },
    },
    disposables: [],
  });

  // 54. GenBank
  registerStandardPlugin({
    id: "genbank",
    name: "GenBank",
    extensions: [".gb", ".gbk", ".genbank"],
    languageDef: genbankLanguage,
    symbols: getGenbankDocumentSymbols,
    validate: validateGenbank,
    customHandlers: {
      hover: (offset: number, text: string) => getGenbankHover(text, offsetToPosition(text, offset)),
    },
  });

  // 55. gPROMS
  registerStandardPlugin({
    id: "gproms",
    name: "gPROMS",
    extensions: [".gPROMS", ".gproms"],
    languageDef: gpromsLanguage,
    symbols: getGpromsDocumentSymbols,
    validate: validateGproms,
    customHandlers: {
      hover: (offset: number, text: string) => getGpromsHover(text, offsetToPosition(text, offset)),
    },
  });

  // 56. OpenIGTLink (IGTL)
  registerStandardPlugin({
    id: "igtl",
    name: "OpenIGTLink",
    extensions: [".igtl", ".igtl.json"],
    languageDef: igtlLanguage,
    symbols: getIgtlDocumentSymbols,
    hoverOffset: getIgtlHover,
    validateWithTree: validateIgtl,
  });

  // 57. NIfTI
  registerStandardPlugin({
    id: "nifti",
    name: "NIfTI",
    extensions: [".nii", ".nii.json"],
    languageDef: niftiLanguage,
    symbols: getNiftiDocumentSymbols,
    hoverOffset: getNiftiHover,
    validate: validateNifti,
  });

  // 58. NM-TRAN
  registerStandardPlugin({
    id: "nmtran",
    name: "NM-TRAN",
    extensions: [".ctl", ".nmtran"],
    languageDef: nmtranLanguage,
    symbols: getNmtranDocumentSymbols,
    validate: validateNmtran,
    customHandlers: {
      hover: (offset: number, text: string) => getNmtranHover(text, offsetToPosition(text, offset)),
    },
  });

  // 59. OpenSim
  registerStandardPlugin({
    id: "opensim",
    name: "OpenSim",
    extensions: [".osim"],
    languageDef: openSimLanguage,
    symbols: getOpenSimDocumentSymbols,
    hoverOffset: getOpenSimHover,
    validateWithTree: validateOpenSim,
  });

  // 60. Optical
  globalLanguageRegistry.register({
    id: "optical",
    name: "Optical",
    extensions: [".sor", ".openroadm.json"],
    languageDef: opticalLanguage,
    customHandlers: {
      validate: (doc: any) => {
        const text = docText(doc);
        if (text.trim().startsWith("{")) {
          return lintOpticalTopology(parseOpenRoadmTopology(text));
        }
        return [];
      },
    },
    disposables: [],
  });

  // 61. OSCAL
  registerStandardPlugin({
    id: "oscal",
    name: "OSCAL",
    extensions: [".oscal", ".oscal.json", ".oscal.yaml", ".oscal.xml"],
    languageDef: oscalLanguage,
    symbols: getOscalDocumentSymbols,
    hoverOffset: getOscalHover,
    validateWithTree: validateOscal,
  });

  // 62. PDB
  registerStandardPlugin({
    id: "pdb",
    name: "PDB",
    extensions: [".pdb", ".ent"],
    languageDef: pdbLanguage,
    symbols: getPdbDocumentSymbols,
    validate: validatePdb,
    customHandlers: {
      hover: (offset: number, text: string) => getPdbHover(text, offsetToPosition(text, offset)),
    },
  });

  // 63. PHREEQC
  registerStandardPlugin({
    id: "phreeqc",
    name: "PHREEQC",
    extensions: [".pqi", ".phreeqc"],
    languageDef: phreeqcLanguage,
    symbols: getPhreeqcDocumentSymbols,
    validate: validatePhreeqc,
    customHandlers: {
      hover: (offset: number, text: string) => getPhreeqcHover(text, offsetToPosition(text, offset)),
    },
  });

  // 64. PowerFactory
  globalLanguageRegistry.register({
    id: "powerfactory",
    name: "PowerFactory",
    extensions: [".pfd", ".dz", ".dsl"],
    languageDef: powerFactoryLanguage,
    customHandlers: {
      validate: (doc: any) => {
        const text = docText(doc);
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
        const text = docText(doc);
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
  registerStandardPlugin({
    id: "qif",
    name: "QIF",
    extensions: [".qif", ".qif.xml", ".qif.json"],
    languageDef: qifLanguage,
    symbols: getQifDocumentSymbols,
    hoverOffset: getQifHover,
    validate: validateQif,
    customHandlers: {
      definition: (offset: number, text: string, uri?: string) =>
        getQifDefinition(text, offset, uri ?? "file:///document.qif", workspaceManager.unifiedWorkspace),
      references: (offset: number, text: string, uri?: string) =>
        getQifReferences(text, offset, uri ?? "file:///document.qif", workspaceManager.unifiedWorkspace),
    },
  });

  // 67. RAN
  globalLanguageRegistry.register({
    id: "ran",
    name: "RAN",
    extensions: [".adf", ".nsma", ".msi", ".planet"],
    languageDef: ranLanguage,
    customHandlers: {
      validate: (doc: any) => {
        const text = docText(doc);
        const isNsma = text.includes("REVNUM:") || text.includes("MANUF:") || text.includes("NOFREQ:");
        const deck = isNsma ? parseNsmaAdf(text) : parsePlanetPat(text);
        return lintAntennaPatternDeck(deck);
      },
    },
    disposables: [],
  });

  // 68. SBOL
  registerStandardPlugin({
    id: "sbol",
    name: "SBOL",
    extensions: [".sbol", ".sbol.xml"],
    languageDef: sbolLanguage,
    symbols: getSbolDocumentSymbols,
    validateWithTree: validateSbol,
    customHandlers: {
      hover: (offset: number, text: string) => getSbolHover(text, offsetToPosition(text, offset)),
    },
  });

  // 69. SED-ML
  registerStandardPlugin({
    id: "sedml",
    name: "SED-ML",
    extensions: [".sedml"],
    languageDef: sedmlLanguage,
    symbols: getSedmlDocumentSymbols,
    validateWithTree: validateSedml,
    customHandlers: {
      hover: (offset: number, text: string) => getSedmlHover(text, offsetToPosition(text, offset)),
    },
  });

  // 70. SMILES
  registerStandardPlugin({
    id: "smiles",
    name: "SMILES",
    extensions: [".smi", ".smiles"],
    languageDef: smilesLanguage,
    symbols: getSmilesDocumentSymbols,
    validate: validateSmiles,
    customHandlers: {
      hover: (offset: number, text: string) => getSmilesHover(text, offsetToPosition(text, offset)),
    },
  });

  // 71. 3MF
  registerStandardPlugin({
    id: "three-mf",
    name: "3MF",
    extensions: [".3mf", ".3mf.model"],
    languageDef: threeMfLanguage,
    symbols: getThreeMfDocumentSymbols,
    hoverOffset: getThreeMfHover,
    validateWithTree: validateThreeMf,
  });

  // 72. TOPAS
  registerStandardPlugin({
    id: "topas",
    name: "TOPAS",
    extensions: [".topas", ".tps"],
    languageDef: topasLanguage,
    symbols: getTopasDocumentSymbols,
    hoverOffset: getTopasHover,
    validate: validateTopas,
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
      validate: (doc: any) => usdLspService.validate(docText(doc)),
    },
    handlers: {
      "modelscript/getCadComponents": (context: any, params: any) => {
        const text =
          params?.documentText ??
          params?.text ??
          context?.documentManager?.documents?.get(params?.uri)?.getText() ??
          "";
        return typeof text === "string" && text.trim() ? extractUsdCadComponents(text) : [];
      },
    },
    disposables: [],
  });

  // 74. ASM (Activated Sludge Model)
  registerStandardPlugin({
    id: "asm",
    name: "ASM",
    extensions: [".asm", ".bsm", ".wrrf"],
    languageDef: asmLanguage,
    symbols: getAsmDocumentSymbols,
    validate: getAsmDiagnostics,
  });

  // 75. ATP-EMTP
  registerStandardPlugin({
    id: "atp",
    name: "ATP-EMTP",
    extensions: [".atp", ".dat"],
    languageDef: atpLanguage,
    symbols: getAtpDocumentSymbols,
    validate: getAtpDiagnostics,
  });

  // KiCad ECAD (.kicad_pcb, .kicad_sch, .kicad_sym, .kicad_mod)
  registerStandardPlugin({
    id: "kicad",
    name: "KiCad ECAD",
    extensions: [".kicad_pcb", ".kicad_sch", ".kicad_sym", ".kicad_mod"],
    languageDef: kicadLanguage,
    validate: (text: string) => {
      const doc = parseKiCadDocument(text);
      const diags =
        doc.kind === "kicad_pcb"
          ? lintKiCadBoard(doc)
          : doc.kind === "kicad_sch"
            ? lintKiCadSchematic(doc)
            : doc.diagnostics;
      return diags.map((d) => ({
        message: `[${d.code}] ${d.message}`,
        severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
        startOffset: d.span?.startOffset ?? 0,
        endOffset: d.span?.endOffset ?? 0,
      }));
    },
    customHandlers: {
      hover: (offset: number, text: string) => {
        const doc = parseKiCadDocument(text);
        const h = resolveKiCadHover(doc, offset);
        return h ? { contents: { kind: "markdown", value: h.markdown } } : null;
      },
    },
  });

  // atopile (.ato) Code-First Hardware DSL
  registerStandardPlugin({
    id: "atopile",
    name: "atopile",
    extensions: [".ato"],
    languageDef: atopileLanguage,
    validate: (text: string) => {
      const diags = lintAtopile(parseAtopile(text));
      return diags.map((d) => ({
        message: `[${d.code}] ${d.message}`,
        severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
        startOffset: d.span?.startOffset ?? 0,
        endOffset: d.span?.endOffset ?? 0,
      }));
    },
  });

  // 76. COMTRADE
  registerStandardPlugin({
    id: "comtrade",
    name: "COMTRADE",
    extensions: [".cfg", ".dat", ".cff"],
    languageDef: comtradeLanguage,
    symbols: getComtradeDocumentSymbols,
    validate: getComtradeDiagnostics,
  });

  // 77. DNP3
  registerStandardPlugin({
    id: "dnp3",
    name: "DNP3",
    extensions: [".dnp3", ".xml", ".json"],
    languageDef: dnp3Language,
    symbols: getDnp3DocumentSymbols,
    validate: getDnp3Diagnostics,
  });

  // 78. HEC-HMS
  registerStandardPlugin({
    id: "hec-hms",
    name: "HEC-HMS",
    extensions: [".basin", ".hms", ".met", ".control"],
    languageDef: hecHmsLanguage,
    symbols: getHecHmsDocumentSymbols,
    validate: getHecHmsDiagnostics,
  });

  // 79. MATPOWER
  registerStandardPlugin({
    id: "matpower",
    name: "MATPOWER",
    extensions: [".m", ".matpower"],
    languageDef: matpowerLanguage,
    extractTheoryConstraints: extractMatpowerTheoryConstraints,
    symbols: getMatpowerDocumentSymbols,
    validate: getMatpowerDiagnostics,
  });

  // 80. ASPEN OneLiner
  registerStandardPlugin({
    id: "oneliner",
    name: "ASPEN OneLiner",
    extensions: [".olx", ".dxt"],
    languageDef: onelinerLanguage,
    symbols: getOneLinerDocumentSymbols,
    validate: getOneLinerDiagnostics,
  });

  // 81. IEC 61850 SCL
  registerStandardPlugin({
    id: "scl",
    name: "IEC 61850 SCL",
    extensions: [".scd", ".cid", ".icd", ".ssd", ".iid", ".scl"],
    languageDef: sclLanguage,
    symbols: getSclDocumentSymbols,
    validate: getSclDiagnostics,
  });

  // 82. SEL Protection
  registerStandardPlugin({
    id: "sel",
    name: "SEL Protection",
    extensions: [".rcf", ".rdb", ".sel", ".txt"],
    languageDef: selLanguage,
    symbols: getSELDocumentSymbols,
    validate: getSELDiagnostics,
  });

  // 83. WaterML
  registerStandardPlugin({
    id: "waterml",
    name: "WaterML",
    extensions: [".waterml", ".wml2", ".xml", ".json"],
    languageDef: watermlLanguage,
    symbols: getWaterMlDocumentSymbols,
    validate: getWaterMlDiagnostics,
  });

  // 84. GridLAB-D
  registerStandardPlugin({
    id: "gridlabd",
    name: "GridLAB-D",
    extensions: [".glm"],
    languageDef: gridlabdLanguage,
    symbols: getGridlabdDocumentSymbols,
    validate: getGridlabdDiagnostics,
    customHandlers: {
      hover: (offset: number, text: string) => {
        const lines = text.slice(0, offset).split("\n");
        return getGridlabdHover(text, lines.length - 1);
      },
    },
  });

  // 85. PowerWorld AUX
  registerStandardPlugin({
    id: "powerworld",
    name: "PowerWorld",
    extensions: [".aux"],
    languageDef: powerworldLanguage,
    symbols: getPowerWorldDocumentSymbols,
    validate: getPowerWorldDiagnostics,
  });

  // 86. IEC 60870-5-104
  registerStandardPlugin({
    id: "iec104",
    name: "IEC 60870-5-104",
    extensions: [".iec104", ".104"],
    languageDef: iec104Language,
    symbols: getIec104DocumentSymbols,
    validate: getIec104Diagnostics,
  });

  // 87. IEEE C37.118
  registerStandardPlugin({
    id: "c37118",
    name: "IEEE C37.118",
    extensions: [".c37118", ".pmu"],
    languageDef: c37118Language,
    symbols: getC37118DocumentSymbols,
    validate: getC37118Diagnostics,
  });

  // 88. PyPSA
  registerStandardPlugin({
    id: "pypsa",
    name: "PyPSA",
    extensions: [".pypsa", ".pypsa.json"],
    languageDef: pypsaLanguage,
    symbols: getPypsaDocumentSymbols,
    validate: getPypsaDiagnostics,
  });

  // 89. CYME
  registerStandardPlugin({
    id: "cyme",
    name: "CYME",
    extensions: [".sxst", ".cyme"],
    languageDef: cymeLanguage,
    symbols: getCymeDocumentSymbols,
    validate: getCymeDiagnostics,
  });

  // 90. RTDS
  registerStandardPlugin({
    id: "rtds",
    name: "RTDS",
    extensions: [".dft", ".rtds"],
    languageDef: rtdsLanguage,
    symbols: getRtdsDocumentSymbols,
    validate: getRtdsDiagnostics,
  });

  // 91. PLS-CADD
  registerStandardPlugin({
    id: "plscadd",
    name: "PLS-CADD",
    extensions: [".pol", ".loa", ".plscadd"],
    languageDef: plscaddLanguage,
    symbols: getPlsCaddDocumentSymbols,
    validate: getPlsCaddDiagnostics,
  });

  // 92. Monolix MLXTRAN
  registerStandardPlugin({
    id: "mlxtran",
    name: "MLXTRAN",
    extensions: [".mlxtran"],
    languageDef: mlxtranLanguage,
    symbols: getMlxtranDocumentSymbols,
    validate: validateMlxtran,
    customHandlers: {
      hover: (offset: number, text: string) => getMlxtranHover(text, offsetToPosition(text, offset)),
    },
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
    connection.console.info("[lsp] All built-in domain language plugins registered successfully.");
  }
}
