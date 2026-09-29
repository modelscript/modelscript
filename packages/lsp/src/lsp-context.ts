// SPDX-License-Identifier: AGPL-3.0-or-later

import { Connection, TextDocuments } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { DiagramService } from "./services/diagram-service.js";
import { DocumentManager } from "./services/document-manager.js";
import { ParserService } from "./services/parser-service.js";
import { ValidationService } from "./services/validation-service.js";
import { WorkspaceManager } from "./services/workspace-manager.js";

export interface LspContext {
  connection: Connection;
  documents: TextDocuments<TextDocument>;
  workspaceManager: WorkspaceManager;
  documentManager: DocumentManager;
  validationService: ValidationService;
  parserService: ParserService;
  diagramService?: DiagramService;

  state: {
    activeValidationPromises: Map<string, Promise<void>>;
    sharedContext: any | null;
    fqnCache: Map<string, unknown>;
    fqnCacheIndex: Map<string, unknown>;
    documentRevisions: Map<string, number>;
    documentLSPBridges: Map<string, unknown>;
    lastSemanticDiagnostics: Map<string, unknown[]>;
    dependenciesReady: boolean;
  };
}
