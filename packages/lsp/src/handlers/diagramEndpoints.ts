/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any */
// @ts-nocheck
import { Connection } from "vscode-languageserver";
import { DiagramMethods } from "../diagramProtocol";
import { DiagramService } from "../services/DiagramService";

export function registerDiagramEndpoints(
  connection: Connection,
  documentManager: any,
  workspaceManager: any,
  diagramService: DiagramService,
) {
  connection.onRequest(
    DiagramMethods.getData,
    async (params: { uri: string; className?: string; diagramType?: string }) => {
      return await diagramService.handleGetDiagramData(params);
    },
  );

  connection.onRequest(
    DiagramMethods.getComponentProperties,
    async (params: { uri: string; componentName: string; className?: string }) => {
      return await diagramService.getDiagramDispatch().getComponentProperties(params);
    },
  );
}

// @ts-nocheck
