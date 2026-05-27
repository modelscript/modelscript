import { Context } from "@modelscript/compiler";
import { Connection, TextDocuments } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { DiagramService } from "./services/DiagramService";
import { DocumentManager } from "./services/DocumentManager";
import { ParserService } from "./services/ParserService";
import { ValidationService } from "./services/ValidationService";
import { WorkspaceManager } from "./services/WorkspaceManager";

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
    sharedContext: Context | null;
    fqnCache: Map<string, unknown>;
    fqnCacheIndex: Map<string, unknown>;
    documentRevisions: Map<string, number>;
    documentLSPBridges: Map<string, unknown>;
    lastSemanticDiagnostics: Map<string, unknown[]>;
    dependenciesReady: boolean;
  };
}
