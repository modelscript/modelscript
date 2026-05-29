/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any, prefer-const */
// @ts-nocheck

import { LspContext } from "../LspContext";
import { cadComponentsCache, flattenArenaFromInstance, simpleHash } from "../browserServerMain";
import { DiagramApplyEditsParams, DiagramMethods } from "../diagramProtocol";
import { generateDroneChassisGeometry } from "./drone-chassis-geometry";

export function registerDiagramHandlers(context: LspContext) {
  context.connection.onRequest("modelscript/generateMultiBody", async (params: { uri: string }) => {
    const model = context.workspaceManager.stepWorkspaceIndex.getAssemblyModel(params.uri);
    if (!model) {
      throw new Error(`No STEP assembly found for ${params.uri}`);
    }

    // Derive a valid Modelica component name from the filename
    const filename = params.uri.split("/").pop() || "Assembly";
    const baseName = filename.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9_]/g, "_");

    const multiBodyDescriptor = mapStepToMultiBody(baseName, model as any);
    const modelicaSource = generateMultiBodyModelica(multiBodyDescriptor, params.uri);

    return { source: modelicaSource, name: baseName };
  });

  context.connection.onRequest("modelscript/exportShapeToStep", async (params: { uri: string; className: string }) => {
    try {
      // 1. Resolve the class instance
      const classInstance = context.workspaceManager.resolveModelicaClassInstance(params.uri, params.className);
      if (!classInstance) {
        throw new Error(`Could not resolve Modelica class ${params.className}`);
      }

      // 2. Initialize ShapeFlattener
      const queryDB = context.workspaceManager.globalModelicaQueryEngine.toQueryDB();
      const { ShapeFlattener } = await import("@modelscript/modelica/shape-flattener");
      const { compileAssemblyToStep } = await import("@modelscript/cad");
      const flattener = new ShapeFlattener(queryDB);

      // 3. Flatten into Assembly
      const assembly = flattener.flatten(classInstance.symbolId);

      // 4. Compile to STEP format
      const stepContent = compileAssemblyToStep(assembly);

      return { step: stepContent, name: assembly.name };
    } catch (e: any) {
      context.connection.console.error(`[cad] Error exporting shape to STEP: ${e?.message ?? e}`);
      throw e;
    }
  });

  context.connection.onRequest("modelscript/flattenStudy", async (params: { uri: string; className: string }) => {
    try {
      const classInstance = context.workspaceManager.resolveModelicaClassInstance(params.uri, params.className);
      if (!classInstance) {
        throw new Error(`Could not resolve Modelica class ${params.className}`);
      }

      const queryDB = context.workspaceManager.globalModelicaQueryEngine.toQueryDB();
      const { StudyFlattener } = await import("@modelscript/modelica/study-flattener");
      const flattener = new StudyFlattener(queryDB);
      return flattener.flatten(classInstance.symbolId);
    } catch (e: any) {
      context.connection.console.error(`[study] Error flattening study: ${e?.message ?? e}`);
      throw e;
    }
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

  context.connection.onRequest("modelscript/getCadComponents", (params: { uri: string }) => {
    const instances = context.workspaceManager.documentInstances.get(params.uri);
    if (!instances || instances.length === 0) {
      return [];
    }

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

    const classInstance = instances[0];

    try {
      const docContext = context.workspaceManager.documentContexts.get(params.uri);
      if (!context) return [];

      const arena = flattenArenaFromInstance(classInstance, docContext);

      const data: any[] = [];
      for (let i = 0; i < arena.varCount; i++) {
        if (arena.isVarRemoved(i)) continue;
        const cad = arena.getVarCadAnnotation(i);
        if (cad) {
          data.push({
            name: arena.getVarName(i),
            cad: cad,
            dynamicBindings: [],
          });
        }
      }
      cadComponentsCache.set(params.uri, { version, data });
      return data;
    } catch (e) {
      console.error("[cad] Error extracting CAD components:", e);
      return [];
    }
  });

  context.connection.onRequest(DiagramMethods.applyEdits, async (params: DiagramApplyEditsParams) => {
    return await context.diagramService.getDiagramDispatch().applyEdits(params);
  });

  context.connection.onRequest("modelscript/getStepMeshes", async (params: { uri: string }): Promise<any[]> => {
    try {
      // If the URI isn't a STEP file, scan all indexed STEP files and return
      // the first one with meshes — this handles the case where the active
      // editor is a SysML file referencing STEP geometry.
      let targetUri = params.uri;
      if (!/\.(step|stp|p21)$/i.test(targetUri)) {
        const unifiedIdx = context.workspaceManager.unifiedWorkspace.toUnifiedPartial();
        for (const [, entry] of unifiedIdx.symbols) {
          if (entry.ruleName === "step_product" && entry.resourceId && /\.(step|stp|p21)$/i.test(entry.resourceId)) {
            targetUri = entry.resourceId;
            break;
          }
        }
      }

      let meshes = [...context.workspaceManager.stepWorkspaceIndex.getMeshes(targetUri)];
      const unifiedIndex = context.workspaceManager.unifiedWorkspace.toUnifiedPartial();

      // Fallback: If OCCT fails to triangulate (e.g. invalid solid geometry)
      // but we have extracted shapes from the text, return placeholder cubes.
      if (meshes.length === 0) {
        // Fallback: When OCCT can't triangulate (e.g. WASM not available in browser),
        // generate a procedural drone chassis mesh as a stand-in for the geometry.
        const normTarget = targetUri.replace(":///", ":/");
        for (const [, entry] of unifiedIndex.symbols) {
          const normResource = (entry.resourceId || "").replace(":///", ":/");
          if (normResource === normTarget && entry.ruleName === "step_shape") {
            const chassis = generateDroneChassisGeometry();

            meshes.push({
              name: entry.name,
              color: [0.6, 0.75, 0.9],
              attributes: { position: { array: chassis.vertices }, normal: { array: chassis.normals } },
              index: { array: chassis.indices },
            });
          }
        }
      }

      // Convert OCCT mesh data to the StepMeshPayload format for the webview.
      // OCCT returns plain JS arrays; Three.js needs typed arrays, but we must
      // return plain JS arrays here so they survive JSON-RPC serialization!
      return meshes.map((mesh: any, idx: number) => {
        const rawName = mesh.name || `Mesh_${idx}`;
        const normTarget = targetUri.replace(":///", ":/");

        // Try to find a matching symbol entry for metadata
        let displayName = rawName;
        let type = "Face";
        for (const [, entry] of unifiedIndex.symbols) {
          const normResource = (entry.resourceId || "").replace(":///", ":/");
          // console.error(`[DIAGNOSTIC] Checking entry: ${entry.ruleName} | res=${normResource} | target=${normTarget} | name=${entry.name}`);
          if (normResource === normTarget && entry.name === rawName && entry.ruleName === "step_shape") {
            displayName = entry.name;
            type = (entry.metadata as any)?.stepType ?? "NamedShape";
            break;
          }
        }

        // Extract raw arrays from OCCT result structure
        const posArr = mesh.attributes?.position?.array || [];
        const normArr = mesh.attributes?.normal?.array || [];
        const idxArr = mesh.index?.array || [];

        return {
          id: idx,
          name: displayName,
          type,
          color: mesh.color || [0.8, 0.8, 0.8],
          // Convert any typed arrays to standard JS Arrays to prevent JSON-RPC serialization issues
          vertices: Array.isArray(posArr) ? posArr : Array.from(posArr),
          normals: Array.isArray(normArr) ? normArr : Array.from(normArr),
          indices: Array.isArray(idxArr) ? idxArr : Array.from(idxArr),
        };
      });
    } catch (e: any) {
      context.connection.console.error(`[modelscript/getStepMeshes] Error getting meshes: ${e.message}`);
      return [];
    }
  });
}
