// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  amplActionHandlers,
  amplLanguage,
  getAmplDocumentSymbols,
  getAmplHover,
  getAmplSemanticTokens,
  validateAmpl,
} from "@modelscript/ampl";
import { cActionHandlers, cLanguage, getCCompletions, getCDocumentSymbols, getCHover } from "@modelscript/c";
import {
  computeFortranSemanticTokensData,
  fortranActionHandlers,
  fortranLanguage,
  getFortranCompletions,
  getFortranDocumentSymbols,
  getFortranHover,
} from "@modelscript/fortran";
import {
  getMagicDrawDiagnostics,
  getMagicDrawDocumentSymbols,
  getMagicDrawHover,
  magicDrawActionHandlers,
  magicDrawLanguage,
} from "@modelscript/magicdraw";
import { getOscalDocumentSymbols, getOscalHover, oscalLanguage, validateOscal } from "@modelscript/oscal";
import {
  getReqifDefinition,
  getReqifDocumentSymbols,
  getReqifHover,
  getReqifReferences,
  reqifActionHandlers,
  reqifLanguage,
  validateReqif,
} from "@modelscript/reqif";
import { lintSparqlDocument, sparqlLanguage } from "@modelscript/sparql";
import { sspLanguage } from "@modelscript/ssp";
import type { WorkspaceManager } from "../../services/workspace-manager.js";
import { globalLanguageRegistry } from "../LanguageRegistry.js";
import {
  type DocInput,
  docText,
  docUri,
  offsetToPos,
  registerStandardPlugin,
  toCompletionItems,
  toHover,
  treeText,
  type TreeWrapperInput,
} from "../standard-plugin.js";

export const SYSTEMS_SCIENTIFIC_PLUGIN_IDS: readonly string[] = [
  "ampl",
  "reqif",
  "magicdraw",
  "fortran",
  "c",
  "ssp",
  "oscal",
  "sparql",
];

/**
 * Registers the 8 systems engineering, optimization, semantic web, and scientific code language plugins.
 */
export function registerSystemsScientificPlugins(workspaceManager: WorkspaceManager): void {
  // 1. AMPL
  registerStandardPlugin({
    id: "ampl",
    name: "AMPL",
    extensions: [".mod", ".dat", ".ampl"],
    languageDef: amplLanguage,
    symbols: getAmplDocumentSymbols,
    hoverPos: getAmplHover,
    validate: validateAmpl,
    actionHandlers: amplActionHandlers,
    customHandlers: {
      semanticTokens: (doc: DocInput) => getAmplSemanticTokens(docText(doc)),
    },
  });

  // 2. ReqIF
  registerStandardPlugin({
    id: "reqif",
    name: "ReqIF",
    extensions: [".reqif", ".reqifz"],
    languageDef: reqifLanguage,
    symbols: getReqifDocumentSymbols,
    validateWithTree: validateReqif,
    customHandlers: {
      hover: (offset: number, text: string) => {
        const pos = offsetToPos(text, offset);
        return toHover(getReqifHover(text, pos.line, pos.character));
      },
      definition: (offset: number, text: string, uri?: string) =>
        getReqifDefinition(text, offset, uri ?? "file:///requirements.reqif", workspaceManager.unifiedWorkspace),
      references: (offset: number, text: string, uri?: string) =>
        getReqifReferences(text, offset, uri ?? "file:///requirements.reqif", workspaceManager.unifiedWorkspace),
    },
    actionHandlers: reqifActionHandlers,
  });

  // 3. MagicDraw / Cameo
  registerStandardPlugin({
    id: "magicdraw",
    name: "MagicDraw / Cameo",
    extensions: [".mdzip", ".mdxml", ".xmi"],
    languageDef: magicDrawLanguage,
    symbols: getMagicDrawDocumentSymbols,
    validate: (text: string) => getMagicDrawDiagnostics(text),
    customHandlers: {
      hover: (offset: number, text: string) => toHover(getMagicDrawHover(text, offset)),
    },
    actionHandlers: magicDrawActionHandlers,
  });

  // 4. Fortran
  globalLanguageRegistry.register({
    id: "fortran",
    name: "Fortran",
    extensions: [".f", ".for", ".f77", ".f90", ".f95", ".f03", ".f08"],
    languageDef: fortranLanguage,
    customHandlers: {
      validate: async (doc: DocInput) => {
        const text = docText(doc);
        const { validateFortran } = await import("@modelscript/fortran");
        return validateFortran(text);
      },
      symbols: (treeWrapper: TreeWrapperInput) => getFortranDocumentSymbols(treeText(treeWrapper)),
      hover: (offset: number, text: string) => toHover(getFortranHover(text, offsetToPos(text, offset))),
      complete: (offset: number, text: string) =>
        toCompletionItems(getFortranCompletions(text, offsetToPos(text, offset))),
      semanticTokens: (doc: DocInput, tree?: unknown) => {
        const text = docText(doc);
        return computeFortranSemanticTokensData(text, tree as Parameters<typeof computeFortranSemanticTokensData>[1]);
      },
    },
    actionHandlers: fortranActionHandlers,
    disposables: [],
  });

  // 5. C
  globalLanguageRegistry.register({
    id: "c",
    name: "C",
    extensions: [".c", ".h"],
    languageDef: cLanguage,
    customHandlers: {
      validate: async (doc: DocInput) => {
        const text = docText(doc);
        const { lintC } = await import("@modelscript/c");
        return lintC(text);
      },
      symbols: (treeWrapper: TreeWrapperInput) => getCDocumentSymbols(treeText(treeWrapper)),
      hover: (offset: number, text: string) => toHover(getCHover(text, offsetToPos(text, offset))),
      complete: (offset: number, text: string) => toCompletionItems(getCCompletions(text, offsetToPos(text, offset))),
    },
    actionHandlers: cActionHandlers,
    disposables: [],
  });

  // 6. SSP (System Structure and Parameterization)
  globalLanguageRegistry.register({
    id: "ssp",
    name: "System Structure and Parameterization",
    extensions: [".ssd", ".ssv", ".ssm", ".ssp"],
    languageDef: sspLanguage,
    customHandlers: {
      validate: async (doc: DocInput) => {
        const text = docText(doc);
        const uri = docUri(doc);
        const { lintSsd, lintSsv } = await import("@modelscript/ssp");
        const isSsv = uri.endsWith(".ssv") || text.includes("<ssv:ParameterSet");
        return isSsv ? lintSsv(text) : lintSsd(text);
      },
    },
    disposables: [],
  });

  // 7. OSCAL
  registerStandardPlugin({
    id: "oscal",
    name: "OSCAL",
    extensions: [".oscal", ".oscal.json", ".oscal.yaml", ".oscal.xml"],
    languageDef: oscalLanguage,
    symbols: getOscalDocumentSymbols,
    hoverOffset: getOscalHover,
    validateWithTree: validateOscal,
  });

  // 8. SPARQL 1.1
  registerStandardPlugin({
    id: "sparql",
    name: "SPARQL 1.1",
    extensions: [".rq", ".sparql"],
    languageDef: sparqlLanguage,
    validateWithTree: (text: string, tree?: { rootNode?: Parameters<typeof lintSparqlDocument>[0] }) =>
      tree?.rootNode ? lintSparqlDocument(tree.rootNode, text) : [],
  });

  if (
    workspaceManager?.unifiedWorkspace &&
    typeof workspaceManager.unifiedWorkspace.registerLanguageDef === "function"
  ) {
    for (const id of SYSTEMS_SCIENTIFIC_PLUGIN_IDS) {
      const plugin = globalLanguageRegistry.getPluginById(id);
      if (plugin?.languageDef) {
        workspaceManager.unifiedWorkspace.registerLanguageDef(plugin.id, plugin.languageDef);
      }
    }
  }
}
