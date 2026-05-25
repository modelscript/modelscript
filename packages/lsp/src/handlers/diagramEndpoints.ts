/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any */
// @ts-nocheck
import { Connection } from "vscode-languageserver";

export function registerDiagramEndpoints(connection: Connection, documentManager: any, workspaceManager: any) {
  connection.onRequest(
    DiagramMethods.getData,
    async (params: { uri: string; className?: string; diagramType?: string }) => {
      return await handleGetDiagramData(params);
    },
  );

  connection.onRequest(
    DiagramMethods.getComponentProperties,
    async (params: { uri: string; componentName: string; className?: string }) => {
      return await getDiagramDispatch().getComponentProperties(params);
    },
  );
}

// @ts-nocheck
