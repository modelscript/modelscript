// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  cfdActionHandlers,
  cfdLanguage,
  computeCfdSemanticTokensData,
  getCfdCodeLenses,
  getCfdDocumentSymbols,
  getCfdHover,
  validateCfd,
} from "@modelscript/cfd";
import {
  computeFeaSemanticTokensData,
  feaActionHandlers,
  feaLanguage,
  getFeaCodeLenses,
  getFeaDocumentSymbols,
  getFeaHover,
  validateFea,
} from "@modelscript/fea";
import {
  getQifDefinition,
  getQifDocumentSymbols,
  getQifHover,
  getQifReferences,
  qifLanguage,
  validateQif,
} from "@modelscript/qif";
import {
  extractThreeMfCadComponents,
  getThreeMfDocumentSymbols,
  getThreeMfHover,
  threeMfLanguage,
  validateThreeMf,
} from "@modelscript/three-mf";
import { extractUsdCadComponents, usdLanguage, UsdLspService } from "@modelscript/usd";
import type { WorkspaceManager } from "../../services/workspace-manager.js";
import { globalLanguageRegistry, type PluginCodeLensContext } from "../LanguageRegistry.js";
import {
  type DocInput,
  docText,
  docUri,
  offsetToPos,
  registerStandardPlugin,
  toCodeLenses,
  toHover,
  type TreeWrapperInput,
} from "../standard-plugin.js";

type CadHandlerContext =
  | { documentManager?: { documents?: { get?: (uri: string) => { getText?: () => string } | undefined } } }
  | null
  | undefined;
type CadHandlerParams = { documentText?: string; text?: string; uri?: string } | null | undefined;

export const CAD_CONTINUUM_PLUGIN_IDS: readonly string[] = ["cfd", "fea", "qif", "three-mf", "usd"];

/**
 * Registers the 5 3D CAD, digital metrology, and continuum physics language plugins.
 */
export function registerCadContinuumPlugins(workspaceManager: WorkspaceManager): void {
  // 1. CFD
  registerStandardPlugin({
    id: "cfd",
    name: "CFD",
    extensions: [".cfd", ".cfg", ".cfgt", ".su2", ".foam"],
    languageDef: cfdLanguage,
    symbols: getCfdDocumentSymbols,
    hoverPos: getCfdHover,
    validate: validateCfd,
    customHandlers: {
      codeLens: (doc: DocInput, ctx?: PluginCodeLensContext) => {
        const text = ctx?.text ?? docText(doc);
        const uri = ctx?.uri ?? docUri(doc);
        return toCodeLenses(getCfdCodeLenses(text, uri, ctx as Parameters<typeof getCfdCodeLenses>[2]));
      },
      semanticTokens: (doc: DocInput, tree?: unknown) => {
        const text = docText(doc);
        return computeCfdSemanticTokensData(
          text,
          tree as Parameters<typeof computeCfdSemanticTokensData>[1],
          docUri(doc) || undefined,
        );
      },
    },
    actionHandlers: cfdActionHandlers,
  });

  // 2. FEA
  registerStandardPlugin({
    id: "fea",
    name: "FEA",
    extensions: [".fea", ".inp", ".inpt", ".bdf", ".dat"],
    languageDef: feaLanguage,
    symbols: getFeaDocumentSymbols,
    hoverPos: getFeaHover,
    validate: validateFea,
    customHandlers: {
      codeLens: (doc: DocInput, ctx?: PluginCodeLensContext) => {
        const text = ctx?.text ?? docText(doc);
        const uri = ctx?.uri ?? docUri(doc);
        return toCodeLenses(getFeaCodeLenses(text, uri, ctx as Parameters<typeof getFeaCodeLenses>[2]));
      },
      semanticTokens: (doc: DocInput, tree?: unknown) => {
        const text = docText(doc);
        return computeFeaSemanticTokensData(
          text,
          tree as Parameters<typeof computeFeaSemanticTokensData>[1],
          docUri(doc) || undefined,
        );
      },
    },
    actionHandlers: feaActionHandlers,
  });

  // 3. QIF
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

  // 4. 3MF
  registerStandardPlugin({
    id: "three-mf",
    name: "3MF",
    extensions: [".3mf", ".3mf.model"],
    languageDef: threeMfLanguage,
    symbols: getThreeMfDocumentSymbols,
    hoverOffset: getThreeMfHover,
    validateWithTree: validateThreeMf,
    handlers: {
      "modelscript/getCadComponents": (context: CadHandlerContext, params: CadHandlerParams) => {
        const text =
          params?.documentText ??
          params?.text ??
          context?.documentManager?.documents?.get?.(params?.uri ?? "")?.getText?.() ??
          "";
        return typeof text === "string" && text.trim() ? extractThreeMfCadComponents(text) : [];
      },
    },
  });

  // 5. OpenUSD
  const usdLspService = new UsdLspService();
  globalLanguageRegistry.register({
    id: "usd",
    name: "OpenUSD",
    extensions: [".usda", ".usd", ".usdc", ".usdz"],
    languageDef: usdLanguage,
    customHandlers: {
      symbols: (treeWrapper: TreeWrapperInput) =>
        usdLspService.getDocumentSymbols(typeof treeWrapper === "string" ? treeWrapper : (treeWrapper?.text ?? "")),
      hover: (offset: number, text: string) => toHover(usdLspService.getHover(text, offsetToPos(text, offset))),
      validate: (doc: DocInput) => usdLspService.validate(docText(doc)),
    },
    handlers: {
      "modelscript/getCadComponents": (context: CadHandlerContext, params: CadHandlerParams) => {
        const text =
          params?.documentText ??
          params?.text ??
          context?.documentManager?.documents?.get?.(params?.uri ?? "")?.getText?.() ??
          "";
        return typeof text === "string" && text.trim() ? extractUsdCadComponents(text) : [];
      },
    },
    disposables: [],
  });

  if (
    workspaceManager?.unifiedWorkspace &&
    typeof workspaceManager.unifiedWorkspace.registerLanguageDef === "function"
  ) {
    for (const id of CAD_CONTINUUM_PLUGIN_IDS) {
      const plugin = globalLanguageRegistry.getPluginById(id);
      if (plugin?.languageDef) {
        workspaceManager.unifiedWorkspace.registerLanguageDef(plugin.id, plugin.languageDef);
      }
    }
  }
}
