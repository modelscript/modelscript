// SPDX-License-Identifier: AGPL-3.0-or-later

import { registerActionRouter } from "./handlers/actionRouter.js";
import { registerAnalysisEndpoints } from "./handlers/analysisEndpoints.js";
import { registerClassQueryEndpoints } from "./handlers/classqueryEndpoints.js";
import { registerDiagramHandlers } from "./handlers/diagramHandler.js";
import { registerInteropEndpoints } from "./handlers/interopEndpoints.js";
import { registerMiscEndpoints } from "./handlers/miscEndpoints.js";
import { registerOwl2Endpoints } from "./handlers/owl2Endpoints.js";
import { registerPolyglotEndpoints } from "./handlers/polyglotEndpoints.js";
import { registerReplEndpoints } from "./handlers/replEndpoints.js";
import { registerRtmEndpoints } from "./handlers/rtmEndpoints.js";
import { registerSimulationEndpoints } from "./handlers/simulationEndpoints.js";
import { registerTreeHandlers } from "./handlers/treeHandler.js";
import type { LspContext } from "./lsp-context.js";
import { registerCodeLensProvider } from "./providers/codeLensProvider.js";
import { registerColorProvider } from "./providers/colorProvider.js";
import { registerCompletionProvider } from "./providers/completionProvider.js";
import { registerDefinitionProvider } from "./providers/definitionProvider.js";
import { registerDocumentFeaturesProvider } from "./providers/documentFeaturesProvider.js";
import { registerFormattingProvider } from "./providers/formattingProvider.js";
import { registerHoverProvider } from "./providers/hoverProvider.js";
import { registerInlayHintProvider } from "./providers/inlayHintProvider.js";
import { registerSemanticTokensProvider } from "./providers/semanticTokensProvider.js";
import { registerSignatureHelpProvider } from "./providers/signatureHelpProvider.js";
import { registerWorkspaceFeaturesProvider } from "./providers/workspaceFeaturesProvider.js";
import { globalLanguageRegistry } from "./registry/index.js";

/**
 * Registers all core LSP language feature providers (semantic tokens, completion,
 * hover, definition, formatting, color, document symbols, workspace symbols,
 * signature help, code lenses, inlay hints).
 */
export function registerAllLspProviders(context: LspContext): void {
  const { connection, documents, parserService, validationService, documentManager, workspaceManager } = context;

  globalLanguageRegistry.setDocumentsStore(documents);

  registerSemanticTokensProvider(
    connection,
    documents,
    parserService.getDocumentTree.bind(parserService),
    () => parserService.getParser("sysml2"),
    () => parserService.isParserReady("sysml2"),
    (ext, text) =>
      parserService.sharedContext?.parse(ext, text) ??
      parserService.getParserForUri(ext)?.parse(text) ??
      parserService.getParser("modelica")?.parse(text),
  );

  registerCompletionProvider(connection, documents, validationService.documentLSPBridges);

  registerHoverProvider(connection, documents, validationService, context);

  registerDefinitionProvider(
    connection,
    documents,
    validationService.documentLSPBridges,
    documentManager.documentTrees,
    validationService,
  );

  registerFormattingProvider(connection, documents, parserService.getDocumentTree.bind(parserService), () =>
    parserService.isParserReady("modelica"),
  );

  registerColorProvider(connection, documents, parserService.getDocumentTree.bind(parserService), () =>
    parserService.isParserReady("modelica"),
  );

  registerDocumentFeaturesProvider(
    connection,
    documents,
    validationService.documentLSPBridges,
    parserService.getDocumentTree.bind(parserService),
    parserService.getLineIndexForDoc.bind(parserService),
    () => parserService.isParserReady("modelica"),
    () => parserService.isParserReady("sysml2"),
    () => parserService.getParser("sysml2"),
    validationService,
  );

  registerWorkspaceFeaturesProvider(
    connection,
    documents,
    documentManager.documentTrees,
    validationService.flushValidation.bind(validationService),
    async (isSysML2) => {
      const idx = isSysML2
        ? workspaceManager.getWorkspaceIndex("sysml2")
        : workspaceManager.getWorkspaceIndex("modelica");
      return await idx?.getIndexAsync();
    },
    () => workspaceManager.getWorkspaceIndex("modelica"),
  );

  registerSignatureHelpProvider(
    connection,
    documents,
    validationService.documentLSPBridges,
    parserService.getDocumentTree.bind(parserService),
    () => parserService.isParserReady("modelica"),
    () => parserService.getParser("modelica"),
    parserService.getLineIndexForDoc.bind(parserService),
  );

  registerCodeLensProvider(context);
  registerInlayHintProvider(context);
}

/**
 * Registers all domain-specific JSON-RPC custom request and notification handlers.
 */
export function registerAllLspEndpoints(context: LspContext): void {
  registerActionRouter(context);
  registerDiagramHandlers(context);
  registerTreeHandlers(context);
  registerSimulationEndpoints(context);
  registerAnalysisEndpoints(context);
  registerRtmEndpoints(context);
  registerInteropEndpoints(context);
  registerClassQueryEndpoints(context);
  registerOwl2Endpoints(context);
  registerMiscEndpoints(context);
  registerReplEndpoints(context);
  registerPolyglotEndpoints(
    context.connection,
    context.documents,
    context.validationService,
    context.documentManager,
    context.workspaceManager,
  );
}
