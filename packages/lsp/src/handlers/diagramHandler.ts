/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any, prefer-const */
// @ts-nocheck

import { buildComponentProperties } from "@modelscript/modelica/diagram";
import { LspContext } from "../LspContext.js";
import { DiagramApplyEditsParams, DiagramMethods } from "../diagramProtocol.js";
import { dispatchLanguageRequest } from "./languageProtocolRouter.js";

function simpleHash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

export const cadComponentsCache = new Map<string, { version: string; data: any }>();
export { simpleHash };

export function registerDiagramHandlers(context: LspContext) {
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

  context.connection.onRequest("modelscript/generateMultiBody", async (params: { uri: string }) => {
    return await dispatchLanguageRequest(context, "modelscript/generateMultiBody", params.uri, params);
  });

  context.connection.onRequest("modelscript/exportShapeToStep", async (params: { uri: string; className: string }) => {
    return await dispatchLanguageRequest(context, "modelscript/exportShapeToStep", params.uri, params);
  });

  context.connection.onRequest("modelscript/flattenStudy", async (params: { uri: string; className: string }) => {
    return await dispatchLanguageRequest(context, "modelscript/flattenStudy", params.uri, params);
  });

  context.connection.onRequest(
    "modelscript/getDiagramData",
    async (params: { uri: string; className?: string; diagramType?: string }) =>
      await context.diagramService.handleGetDiagramData(params),
  );

  context.connection.onRequest(
    "modelscript/getComponentProperties",
    (params: { uri: string; componentName: string; className?: string }) => {
      const classInstance = context.workspaceManager.resolveModelicaClassInstance(params.uri, params.className);
      if (!classInstance) return null;

      try {
        return buildComponentProperties(classInstance, params.componentName);
      } catch (e: any) {
        context.connection.console.error(`[diagram] Error building component properties: ${e?.message ?? e}
  ${e?.stack ?? ""}`);
        return null;
      }
    },
  );

  context.connection.onRequest("modelscript/getCadComponents", async (params: { uri: string }) => {
    // Check cache using the same content-hash strategy as the diagram cache
    const effectiveUri = params.uri.startsWith("modelscript-lib://global")
      ? "file://" + params.uri.substring("modelscript-lib://global".length)
      : params.uri;
    const indexedText = context.validationService.lastIndexedText.get(effectiveUri);
    const version = indexedText != null ? `idx:${indexedText.length}:${simpleHash(indexedText)}` : "unknown";
    const cached = cadComponentsCache.get(params.uri);
    if (cached && cached.version === version) {
      return cached.data;
    }

    try {
      const data = await dispatchLanguageRequest(context, "modelscript/getCadComponents", params.uri, params, []);
      cadComponentsCache.set(params.uri, { version, data });
      return data;
    } catch (e: any) {
      context.connection.console.error(`[cad] Error extracting CAD components: ${e?.message ?? e}`);
      return [];
    }
  });

  context.connection.onRequest(DiagramMethods.applyEdits, async (params: DiagramApplyEditsParams) => {
    return await context.diagramService.getDiagramDispatch().applyEdits(params);
  });

  context.connection.onRequest("modelscript/getStepMeshes", async (params: { uri: string }): Promise<any[]> => {
    return await dispatchLanguageRequest(context, "modelscript/getStepMeshes", params.uri, params, []);
  });
}
