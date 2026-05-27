/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { LspContext } from "../LspContext";
import { DiagramMethods } from "../diagramProtocol";

export function registerDiagramEndpoints(context: LspContext) {
  context.connection.onRequest(
    DiagramMethods.getData,
    async (params: { uri: string; className?: string; diagramType?: string }) => {
      return await context.diagramService.handleGetDiagramData(params);
    },
  );

  context.connection.onRequest(
    DiagramMethods.getComponentProperties,
    async (params: { uri: string; componentName: string; className?: string }) => {
      return await context.diagramService.getDiagramDispatch().getComponentProperties(params);
    },
  );
}

// @ts-nocheck
