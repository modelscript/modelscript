// SPDX-License-Identifier: AGPL-3.0-or-later

import { atopileLanguage, lintAtopile, parseAtopile } from "@modelscript/atopile";
import { atpLanguage, getAtpDiagnostics, getAtpDocumentSymbols } from "@modelscript/atp";
import { c37118Language, getC37118Diagnostics, getC37118DocumentSymbols } from "@modelscript/c37118";
import {
  cgmesLanguage,
  getCgmesCompletions,
  getCgmesDocumentSymbols,
  getCgmesHover,
  lintCgmesModel,
  parseCgmesRdf,
} from "@modelscript/cgmes";
import { comtradeLanguage, getComtradeDiagnostics, getComtradeDocumentSymbols } from "@modelscript/comtrade";
import { cymeLanguage, getCymeDiagnostics, getCymeDocumentSymbols } from "@modelscript/cyme";
import { dnp3Language, getDnp3Diagnostics, getDnp3DocumentSymbols } from "@modelscript/dnp3";
import { fiberLanguage } from "@modelscript/fiber";
import {
  getGridlabdDiagnostics,
  getGridlabdDocumentSymbols,
  getGridlabdHover,
  gridlabdLanguage,
} from "@modelscript/gridlabd";
import {
  getIbisDocumentSymbols,
  getIbisHover,
  ibisActionHandlers,
  ibisLanguage,
  validateIbis,
} from "@modelscript/ibis";
import { getIec104Diagnostics, getIec104DocumentSymbols, iec104Language } from "@modelscript/iec104";
import {
  kicadLanguage,
  lintKiCadBoard,
  lintKiCadSchematic,
  parseKiCadDocument,
  resolveKiCadHover,
} from "@modelscript/kicad";
import {
  extractMatpowerTheoryConstraints,
  getDiagnostics as getMatpowerDiagnostics,
  getDocumentSymbols as getMatpowerDocumentSymbols,
  matpowerLanguage,
} from "@modelscript/matpower";
import { getOcppDocumentSymbols, getOcppHover, ocppLanguage, validateOcpp } from "@modelscript/ocpp";
import { getOneLinerDiagnostics, getOneLinerDocumentSymbols, onelinerLanguage } from "@modelscript/oneliner";
import { getOpenAdrDocumentSymbols, getOpenAdrHover, openadrLanguage, validateOpenAdr } from "@modelscript/openadr";
import {
  getOpenDssDocumentSymbols,
  getOpenDssHover,
  opendssActionHandlers,
  openDssLanguage,
  validateOpenDss,
} from "@modelscript/opendss";
import { lintOpticalTopology, opticalLanguage, parseOpenRoadmTopology } from "@modelscript/optical";
import { getPlsCaddDiagnostics, getPlsCaddDocumentSymbols, plscaddLanguage } from "@modelscript/plscadd";
import {
  getPowerFactoryCompletions,
  getPowerFactoryDocumentSymbols,
  getPowerFactoryHover,
  lintPowerFactoryModel,
  parsePowerFactoryXml,
  powerFactoryLanguage,
} from "@modelscript/powerfactory";
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
import {
  getPslfCompletions,
  getPslfDocumentSymbols,
  getPslfHover,
  lintPslfDyd,
  lintPslfEpc,
  parsePslfDyd,
  parsePslfEpc,
  pslfLanguage,
} from "@modelscript/pslf";
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
import { lintAntennaPatternDeck, parseNsmaAdf, parsePlanetPat, ranLanguage } from "@modelscript/ran";
import { getRtdsDiagnostics, getRtdsDocumentSymbols, rtdsLanguage } from "@modelscript/rtds";
import { getSclDiagnostics, getSclDocumentSymbols, sclLanguage } from "@modelscript/scl";
import { getSELDiagnostics, getSELDocumentSymbols, selLanguage } from "@modelscript/sel";
import {
  extractSpiceTheoryConstraints,
  getSpiceDocumentSymbols,
  getSpiceHover,
  spiceActionHandlers,
  spiceLanguage,
  validateSpice,
} from "@modelscript/spice";
import {
  getTouchstoneDocumentSymbols,
  getTouchstoneHover,
  touchstoneActionHandlers,
  touchstoneLanguage,
  validateTouchstone,
} from "@modelscript/touchstone";
import {
  getVerilogADocumentSymbols,
  getVerilogAHover,
  validateVerilogA,
  verilogAActionHandlers,
  verilogALanguage,
} from "@modelscript/verilog-a";
import type { Diagnostic, Position, Range } from "vscode-languageserver";
import type { WorkspaceManager } from "../../services/workspace-manager.js";
import { globalLanguageRegistry, type PluginCodeLensContext } from "../LanguageRegistry.js";
import {
  type DocInput,
  docOffsetAt,
  docText,
  docUri,
  offsetToPos,
  registerStandardPlugin,
  toCompletionItems,
  toFoldingKind,
  toHover,
  treeText,
  type TreeWrapperInput,
} from "../standard-plugin.js";

interface FullTextDocumentLike {
  uri: string;
  lineCount: number;
  getText(): string;
  offsetAt(position: Position): number;
  positionAt(offset: number): Position;
}

export const POWER_ELECTRONICS_PLUGIN_IDS: readonly string[] = [
  "pscad",
  "psse",
  "cgmes",
  "opendss",
  "powerfactory",
  "pslf",
  "ocpp",
  "openadr",
  "spice",
  "atopile",
  "kicad",
  "verilog-a",
  "ibis",
  "touchstone",
  "optical",
  "ran",
  "fiber",
  "matpower",
  "comtrade",
  "scl",
  "atp",
  "dnp3",
  "oneliner",
  "sel",
  "c37118",
  "cyme",
  "gridlabd",
  "iec104",
  "plscadd",
  "powerworld",
  "pypsa",
  "rtds",
];

/**
 * Registers the 32 electrical power grid, RF, telecom, and electronics language plugins.
 */
export function registerPowerElectronicsPlugins(workspaceManager: WorkspaceManager): void {
  // 1. PSCAD
  const collectPscadDocs = (): Array<{ uri: string; text: string }> => {
    const docs: Array<{ uri: string; text: string }> = [];
    const wmDocs = (
      workspaceManager as unknown as {
        documentManager?: { documents?: { all?: () => Array<{ uri?: string; getText?: () => string }> } };
      }
    ).documentManager?.documents?.all?.();
    for (const d of wmDocs ?? []) {
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
      symbols: (treeWrapper: TreeWrapperInput, textArg?: string) => {
        const text = textArg ?? (typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? ""));
        return getPscadDocumentSymbols(text);
      },
      folding: (_tree: unknown, textArg?: string) =>
        getPscadFoldingRanges(textArg ?? "").map((r) => ({
          startLine: r.startLine,
          endLine: r.endLine,
          kind: toFoldingKind(r.kind),
        })),
      hover: (offset: number, text: string) => {
        const h = getPscadHover(text, offset);
        return h ? { contents: { kind: "markdown", value: h.contents } } : null;
      },
      complete: (offset: number, text: string) => toCompletionItems(getPscadCompletions(text, offset)),
      definition: (offset: number, text: string, uri?: string) =>
        getPscadDefinitionLocation(text, offset, uri ?? "", collectPscadDocs(), workspaceManager.unifiedWorkspace),
      references: (offset: number, text: string, uri?: string) =>
        getPscadReferences(text, offset, uri ?? "", collectPscadDocs(), workspaceManager.unifiedWorkspace),
      inlayHints: (doc: DocInput, range?: Range) =>
        getPscadInlayHints(docText(doc), range).map((h) => ({
          position: { line: h.position.line, character: h.position.character },
          label: h.label,
          kind: h.kind === "parameter" ? 2 : 1,
          paddingLeft: h.paddingLeft ?? true,
        })),
      rename: (doc: DocInput, position: Position, newName: string) => {
        const text = docText(doc);
        const offset = docOffsetAt(doc, position);
        const changes = getPscadRenameEdits(text, offset, newName, docUri(doc), collectPscadDocs());
        return changes ? { changes } : null;
      },
      codeActions: (doc: DocInput) =>
        getPscadQuickFixes(docText(doc), docUri(doc)).map((fix) => ({
          title: fix.title,
          kind: "quickfix",
          edit: fix.edit,
        })),
      codeLens: (doc: DocInput, ctx?: PluginCodeLensContext) =>
        getPscadCodeLenses(
          ctx?.text ?? docText(doc),
          ctx?.uri ?? docUri(doc),
          ctx as Parameters<typeof getPscadCodeLenses>[2],
        ),
    },
    actionHandlers: createPscadActionHandlers({
      buildDiagram: async (project, definitionName) => {
        const { buildPscadDiagram } = await import("@modelscript/diagram");
        return buildPscadDiagram(project, definitionName);
      },
      getEmtSolverRunner: async () => {
        try {
          type EmtRunner = NonNullable<
            Awaited<
              ReturnType<
                NonNullable<NonNullable<Parameters<typeof createPscadActionHandlers>[0]>["getEmtSolverRunner"]>
              >
            >
          >;
          const simMod = (await import("@modelscript/simulate" as string)) as {
            EmtSolver?: new (
              circuit: Parameters<EmtRunner>[0],
              opts: {
                timeStepSec: number;
                durationSec: number;
                threePhase: boolean;
                steadyStateInit: boolean;
                maxNonlinearIterations: number;
              },
            ) => { solve(): ReturnType<EmtRunner> };
          };
          if (simMod?.EmtSolver) {
            const EmtSolverCtor = simMod.EmtSolver;
            return (circuit, emtOptions) => {
              const solver = new EmtSolverCtor(circuit, {
                timeStepSec: emtOptions.timeStepSec,
                durationSec: emtOptions.durationSec,
                threePhase: emtOptions.threePhase ?? true,
                steadyStateInit: true,
                maxNonlinearIterations: 6,
              });
              return solver.solve();
            };
          }
        } catch {
          // Optional @modelscript/simulate package not available in this environment.
        }
        return undefined;
      },
    }),
    disposables: [],
  });

  // 2. PSSE
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
      symbols: (treeWrapper: TreeWrapperInput) => {
        const text = typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "");
        const uri =
          typeof treeWrapper !== "string" && typeof treeWrapper?.uri === "string" ? treeWrapper.uri : "model.raw";
        return getPsseDocumentSymbols(text, uri);
      },
      hover: (offset: number, text: string, uri?: string) => {
        const pos = offsetToPos(text, offset);
        return toHover(getPsseHover(text, pos, uri ?? "", workspaceManager.unifiedWorkspace));
      },
      validate: (doc: DocInput, tree?: unknown) => {
        const text = docText(doc);
        const uri = docUri(doc) || "model.raw";
        return validatePsse(text, uri, tree);
      },
      definition: (offset: number, text: string, uri?: string) => {
        const pos = offsetToPos(text, offset);
        return getPsseDefinition(text, pos, uri ?? "", workspaceManager.unifiedWorkspace);
      },
      references: (offset: number, text: string, uri?: string) => {
        const pos = offsetToPos(text, offset);
        return getPsseReferences(text, pos, uri ?? "", workspaceManager.unifiedWorkspace);
      },
      complete: (offset: number, text: string, uri?: string) => {
        const pos = offsetToPos(text, offset);
        return toCompletionItems(getPsseCompletions(text, pos, uri ?? ""));
      },
      inlayHints: (doc: DocInput, range?: Range) => {
        const text = docText(doc);
        const uri = docUri(doc) || "model.raw";
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
      rename: (doc: DocInput, position: Position, newName: string) => {
        const text = docText(doc);
        return getPsseRenameEdits(
          text,
          position,
          newName,
          docUri(doc),
          workspaceManager.unifiedWorkspace as unknown as Parameters<typeof getPsseRenameEdits>[4],
        );
      },
      codeActions: (doc: DocInput, range: Range, diagnostics: Diagnostic[]) =>
        getPsseCodeActions(
          docText(doc),
          range,
          diagnostics as unknown as Parameters<typeof getPsseCodeActions>[2],
          docUri(doc),
        ).map((fix) => ({
          title: fix.title,
          kind: "quickfix",
          edit: fix.edit,
          ...(fix.isPreferred !== undefined ? { isPreferred: fix.isPreferred } : {}),
        })),
      format: (doc: FullTextDocumentLike) => {
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
      codeLens: (_doc: DocInput, ctx?: PluginCodeLensContext) => ({
        appendUniversal: true,
        lenses: ctx?.flags?.["showSimulate"]
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

  // 3. Touchstone
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

  // 4. IBIS
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

  // 5. SPICE
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
        const pos = offsetToPos(text, offset);
        return toHover(getSpiceHover(text, pos.line, pos.character));
      },
    },
    actionHandlers: spiceActionHandlers,
  });

  // 6. Verilog-A
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

  // 7. OpenDSS
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

  // 8. OCPP (Electric Vehicle Smart Charging)
  registerStandardPlugin({
    id: "ocpp",
    name: "OCPP",
    extensions: [".ocpp", ".ocpp.json", ".cpo", ".evse"],
    languageDef: ocppLanguage,
    symbols: getOcppDocumentSymbols,
    hoverPos: getOcppHover,
    customHandlers: {
      validate: (doc: DocInput) => validateOcpp(docText(doc)),
    },
  });

  // 9. OpenADR (Automated Demand Response & Grid Flexibility)
  registerStandardPlugin({
    id: "openadr",
    name: "OpenADR",
    extensions: [".oadr", ".oadr.xml", ".oadr.json", ".oadr.yaml"],
    languageDef: openadrLanguage,
    symbols: getOpenAdrDocumentSymbols,
    hoverPos: getOpenAdrHover,
    customHandlers: {
      validate: (doc: DocInput) => validateOpenAdr(docText(doc)),
    },
  });

  // 10. CGMES
  globalLanguageRegistry.register({
    id: "cgmes",
    name: "CGMES",
    extensions: [".cgmes", ".cim", ".rdf"],
    languageDef: cgmesLanguage,
    customHandlers: {
      validate: (doc: DocInput) => {
        const text = docText(doc);
        const model = parseCgmesRdf(text);
        return lintCgmesModel(model);
      },
      symbols: (treeWrapper: TreeWrapperInput) => getCgmesDocumentSymbols(treeText(treeWrapper)),
      hover: (offset: number, text: string) => toHover(getCgmesHover(text, offsetToPos(text, offset))),
      complete: (offset: number, text: string) =>
        toCompletionItems(getCgmesCompletions(text, offsetToPos(text, offset))),
    },
    disposables: [],
  });

  // 11. Fiber
  globalLanguageRegistry.register({
    id: "fiber",
    name: "Fiber",
    extensions: [".fiber.geojson", ".osp.json"],
    languageDef: fiberLanguage,
    customHandlers: {
      validate: async (doc: DocInput) => {
        const text = docText(doc);
        const { parseFiberGis, lintFiberNetwork } = await import("@modelscript/fiber");
        try {
          const network = parseFiberGis(text);
          const diags = lintFiberNetwork(network);
          return diags.map((d) => {
            const idx = d.elementId ? text.indexOf(d.elementId) : -1;
            const pos = idx >= 0 ? offsetToPos(text, idx) : { line: 0, character: 0 };
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
        } catch (err: unknown) {
          const errMessage = err instanceof Error ? err.message : undefined;
          return [
            {
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
              severity: 1,
              code: "FIBER1000",
              source: "modelscript-fiber",
              message: errMessage ? String(errMessage) : "Invalid Fiber GeoJSON/OSP document.",
            },
          ];
        }
      },
    },
    disposables: [],
  });

  // 12. Optical
  globalLanguageRegistry.register({
    id: "optical",
    name: "Optical",
    extensions: [".sor", ".openroadm.json"],
    languageDef: opticalLanguage,
    customHandlers: {
      validate: (doc: DocInput) => {
        const text = docText(doc);
        if (text.trim().startsWith("{")) {
          return lintOpticalTopology(parseOpenRoadmTopology(text));
        }
        return [];
      },
    },
    disposables: [],
  });

  // 13. PowerFactory
  globalLanguageRegistry.register({
    id: "powerfactory",
    name: "PowerFactory",
    extensions: [".pfd", ".dz", ".dsl"],
    languageDef: powerFactoryLanguage,
    customHandlers: {
      validate: (doc: DocInput) => {
        const text = docText(doc);
        if (text.trim().startsWith("<")) {
          return lintPowerFactoryModel(parsePowerFactoryXml(text));
        }
        return [];
      },
      symbols: (treeWrapper: TreeWrapperInput) => getPowerFactoryDocumentSymbols(treeText(treeWrapper)),
      hover: (offset: number, text: string) => toHover(getPowerFactoryHover(text, offsetToPos(text, offset))),
      complete: (offset: number, text: string) =>
        toCompletionItems(getPowerFactoryCompletions(text, offsetToPos(text, offset))),
    },
    disposables: [],
  });

  // 14. PSLF
  globalLanguageRegistry.register({
    id: "pslf",
    name: "PSLF",
    extensions: [".epc", ".dyd"],
    languageDef: pslfLanguage,
    customHandlers: {
      validate: (doc: DocInput) => {
        const text = docText(doc);
        const uri = docUri(doc);
        if (uri.toLowerCase().endsWith(".dyd") || text.includes("models")) {
          return lintPslfDyd(parsePslfDyd(text));
        }
        return lintPslfEpc(parsePslfEpc(text));
      },
      symbols: (treeWrapper: TreeWrapperInput) => getPslfDocumentSymbols(treeText(treeWrapper)),
      hover: (offset: number, text: string) => toHover(getPslfHover(text, offsetToPos(text, offset))),
      complete: (offset: number, text: string) =>
        toCompletionItems(getPslfCompletions(text, offsetToPos(text, offset))),
    },
    disposables: [],
  });

  // 15. RAN
  globalLanguageRegistry.register({
    id: "ran",
    name: "RAN",
    extensions: [".adf", ".nsma", ".msi", ".planet"],
    languageDef: ranLanguage,
    customHandlers: {
      validate: (doc: DocInput) => {
        const text = docText(doc);
        const isNsma = text.includes("REVNUM:") || text.includes("MANUF:") || text.includes("NOFREQ:");
        const deck = isNsma ? parseNsmaAdf(text) : parsePlanetPat(text);
        return lintAntennaPatternDeck(deck);
      },
    },
    disposables: [],
  });

  // 16. ATP-EMTP
  registerStandardPlugin({
    id: "atp",
    name: "ATP-EMTP",
    extensions: [".atp", ".dat"],
    languageDef: atpLanguage,
    symbols: getAtpDocumentSymbols,
    validate: getAtpDiagnostics,
  });

  // 17. KiCad ECAD
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

  // 18. atopile
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

  // 19. COMTRADE
  registerStandardPlugin({
    id: "comtrade",
    name: "COMTRADE",
    extensions: [".cfg", ".dat", ".cff"],
    languageDef: comtradeLanguage,
    symbols: getComtradeDocumentSymbols,
    validate: getComtradeDiagnostics,
  });

  // 20. DNP3
  registerStandardPlugin({
    id: "dnp3",
    name: "DNP3",
    extensions: [".dnp3", ".xml", ".json"],
    languageDef: dnp3Language,
    symbols: getDnp3DocumentSymbols,
    validate: getDnp3Diagnostics,
  });

  // 21. MATPOWER
  registerStandardPlugin({
    id: "matpower",
    name: "MATPOWER",
    extensions: [".m", ".matpower"],
    languageDef: matpowerLanguage,
    extractTheoryConstraints: extractMatpowerTheoryConstraints,
    symbols: getMatpowerDocumentSymbols,
    validate: getMatpowerDiagnostics,
  });

  // 22. ASPEN OneLiner
  registerStandardPlugin({
    id: "oneliner",
    name: "ASPEN OneLiner",
    extensions: [".olx", ".dxt"],
    languageDef: onelinerLanguage,
    symbols: getOneLinerDocumentSymbols,
    validate: getOneLinerDiagnostics,
  });

  // 23. IEC 61850 SCL
  registerStandardPlugin({
    id: "scl",
    name: "IEC 61850 SCL",
    extensions: [".scd", ".cid", ".icd", ".ssd", ".iid", ".scl"],
    languageDef: sclLanguage,
    symbols: getSclDocumentSymbols,
    validate: getSclDiagnostics,
  });

  // 24. SEL Protection
  registerStandardPlugin({
    id: "sel",
    name: "SEL Protection",
    extensions: [".rcf", ".rdb", ".sel", ".txt"],
    languageDef: selLanguage,
    symbols: getSELDocumentSymbols,
    validate: getSELDiagnostics,
  });

  // 25. GridLAB-D
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
        return toHover(getGridlabdHover(text, lines.length - 1));
      },
    },
  });

  // 26. PowerWorld AUX
  registerStandardPlugin({
    id: "powerworld",
    name: "PowerWorld",
    extensions: [".aux"],
    languageDef: powerworldLanguage,
    symbols: getPowerWorldDocumentSymbols,
    validate: getPowerWorldDiagnostics,
  });

  // 27. IEC 60870-5-104
  registerStandardPlugin({
    id: "iec104",
    name: "IEC 60870-5-104",
    extensions: [".iec104", ".104"],
    languageDef: iec104Language,
    symbols: getIec104DocumentSymbols,
    validate: getIec104Diagnostics,
  });

  // 28. IEEE C37.118
  registerStandardPlugin({
    id: "c37118",
    name: "IEEE C37.118",
    extensions: [".c37118", ".pmu"],
    languageDef: c37118Language,
    symbols: getC37118DocumentSymbols,
    validate: getC37118Diagnostics,
  });

  // 29. PyPSA
  registerStandardPlugin({
    id: "pypsa",
    name: "PyPSA",
    extensions: [".pypsa", ".pypsa.json"],
    languageDef: pypsaLanguage,
    symbols: getPypsaDocumentSymbols,
    validate: getPypsaDiagnostics,
  });

  // 30. CYME
  registerStandardPlugin({
    id: "cyme",
    name: "CYME",
    extensions: [".sxst", ".cyme"],
    languageDef: cymeLanguage,
    symbols: getCymeDocumentSymbols,
    validate: getCymeDiagnostics,
  });

  // 31. RTDS
  registerStandardPlugin({
    id: "rtds",
    name: "RTDS",
    extensions: [".dft", ".rtds"],
    languageDef: rtdsLanguage,
    symbols: getRtdsDocumentSymbols,
    validate: getRtdsDiagnostics,
  });

  // 32. PLS-CADD
  registerStandardPlugin({
    id: "plscadd",
    name: "PLS-CADD",
    extensions: [".pol", ".loa", ".plscadd"],
    languageDef: plscaddLanguage,
    symbols: getPlsCaddDocumentSymbols,
    validate: getPlsCaddDiagnostics,
  });

  if (
    workspaceManager?.unifiedWorkspace &&
    typeof workspaceManager.unifiedWorkspace.registerLanguageDef === "function"
  ) {
    for (const id of POWER_ELECTRONICS_PLUGIN_IDS) {
      const plugin = globalLanguageRegistry.getPluginById(id);
      if (plugin?.languageDef) {
        workspaceManager.unifiedWorkspace.registerLanguageDef(plugin.id, plugin.languageDef);
      }
    }
  }
}
