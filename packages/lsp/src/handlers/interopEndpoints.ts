/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any, prefer-const */
// @ts-nocheck
import { LspContext } from "../LspContext";

export function registerInteropEndpoints(context: LspContext) {
  context.connection.onRequest(
    "modelscript/exportFmu",
    async (params: { uri: string; fmiVersion: "2.0" | "3.0"; includeWasm?: boolean }) => {
      const ctx = context.workspaceManager.documentContexts.get(params.uri);
      const doc = context.documents.get(params.uri);
      if (!ctx || !doc) throw new Error("Document not found or no context available.");

      // Get the first class defined in the document as the target for FMU generation
      const instances = context.workspaceManager.documentInstances.get(params.uri);
      if (!instances || instances.length === 0) throw new Error("No Modelica classes found in the active document.");

      const targetInstance = instances[0];
      const targetClass = targetInstance.name;
      if (!targetClass) throw new Error("Could not determine model name.");

      const arena = flattenArenaFromInstance(targetInstance, ctx);
      const simulator = new ArenaSimulator(arena);
      simulator.prepare();
      const stateVars = new Set<string>();
      for (const varIdx of simulator.stateVars) {
        stateVars.add(arena.getVarName(varIdx));
      }

      const { archive } = buildFmuArchive(
        arena,
        {
          modelIdentifier: targetClass,
          includeWasm: params.includeWasm,
        },
        stateVars,
      );

      // Base64 encode the Uint8Array
      const chunkSize = 0x8000;
      const chunks: string[] = [];
      for (let i = 0; i < archive.length; i += chunkSize) {
        chunks.push(String.fromCharCode.apply(null, Array.from(archive.subarray(i, i + chunkSize))));
      }
      const base64 = btoa(chunks.join(""));

      return { fmuName: targetClass, base64 };
    },
  );

  context.connection.onRequest(
    "modelscript/registerFmu",
    (params: { name: string; data: string }): { ok: boolean; error?: string } => {
      try {
        const sharedCtx = context.state.sharedContext;
        if (!sharedCtx) return { ok: false, error: "Context not initialized" };
        // Decode base64 to Uint8Array
        const binaryStr = atob(params.data);
        const fmuBytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          fmuBytes[i] = binaryStr.charCodeAt(i);
        }
        const fmuEntity = ModelicaFmuEntity.fromFmu(sharedCtx as any, params.name, fmuBytes);
        fmuEntity.load();
        fmuEntity.instantiate();
        const uri = `__fmu__:${params.name}`;
        context.workspaceManager.workspaceInstances.set(uri, [fmuEntity as any]);
        console.log(`[fmu] Registered FMU entity '${params.name}' via custom request`);
        // Re-validate all .mo documents to pick up the new FMU class
        for (const doc of context.documents.all()) {
          if (doc.uri.endsWith(".mo")) {
            context.validationService.validateTextDocument(doc);
          }
        }
        return { ok: true };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[fmu] Failed to register FMU '${params.name}':`, msg);
        return { ok: false, error: msg };
      }
    },
  );

  context.connection.onRequest(
    "modelscript/importFmu",
    async (params: {
      /** FMU name (without .fmu extension) */
      name: string;
      /** Base64-encoded .fmu archive data */
      data: string;
      /** Optional target URI for the generated .mo wrapper file */
      targetUri?: string;
      /** Optional enclosing Modelica package name */
      packageName?: string;
    }): Promise<{
      ok: boolean;
      /** Generated Modelica source code */
      source?: string;
      /** URI where the wrapper was written (if auto-injected) */
      uri?: string;
      /** Extracted model name */
      modelName?: string;
      /** Number of input variables */
      inputCount?: number;
      /** Number of output variables */
      outputCount?: number;
      error?: string;
    }> => {
      try {
        // Dynamically import cosim for model description parsing and wrapper generation
        const { parseModelDescription, generateFmuWrapperModelica } = await import("@modelscript/cosim");

        // Decode base64 to bytes
        const binaryStr = atob(params.data);
        const fmuBytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          fmuBytes[i] = binaryStr.charCodeAt(i);
        }

        // Extract modelDescription.xml from ZIP
        // Re-use the inline extraction or parse directly from ModelicaFmuEntity
        const sharedCtx = context.state.sharedContext;
        if (!sharedCtx) return { ok: false, error: "Context not initialized" };
        const fmuEntity = ModelicaFmuEntity.fromFmu(sharedCtx as any, params.name, fmuBytes);
        fmuEntity.load();

        // Parse the model description for wrapper generation
        // Extract XML from the FMU archive bytes
        let xmlContent: string | null = null;
        // Simple ZIP extraction for modelDescription.xml
        const td = new TextDecoder();
        const zipStr = td.decode(fmuBytes);
        const xmlStart = zipStr.indexOf("<?xml");
        if (xmlStart >= 0) {
          // Found XML-like content; try full entity path instead
        }
        // Use the fmuEntity's loaded variables to build a description
        const desc = {
          fmiVersion: "2.0",
          modelName: fmuEntity.name || params.name,
          guid: "",
          description: fmuEntity.description || undefined,
          author: undefined,
          generationTool: undefined,
          coSimulationModelIdentifier: undefined,
          modelExchangeModelIdentifier: undefined,
          supportsCoSimulation: true,
          supportsModelExchange: false,
          defaultExperiment: undefined,
          variables: fmuEntity.fmuVariables.map((v) => ({
            name: v.name,
            valueReference: 0,
            description: v.description || undefined,
            causality: v.causality as
              | "input"
              | "output"
              | "parameter"
              | "calculatedParameter"
              | "local"
              | "independent",
            variability: v.variability as "constant" | "fixed" | "tunable" | "discrete" | "continuous",
            type: v.type as "Real" | "Integer" | "Boolean" | "String" | "Enumeration",
            start: v.start,
            unit: undefined,
            displayUnit: undefined,
          })),
          numberOfEventIndicators: undefined,
        };

        const source = generateFmuWrapperModelica(desc, `${params.name}.fmu`, params.packageName);

        const inputs = desc.variables.filter((v) => v.causality === "input");
        const outputs = desc.variables.filter((v) => v.causality === "output");

        // Auto-inject into the workspace via LSP workspace edit
        const targetUri = params.targetUri ?? `memfs:///${params.name}.mo`;
        try {
          await context.connection.workspace.applyEdit({
            documentChanges: [
              {
                kind: "create",
                uri: targetUri,
                options: { overwrite: true },
              } as import("vscode-languageserver-protocol").CreateFile,
              {
                textDocument: { uri: targetUri, version: null },
                edits: [
                  { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: source },
                ],
              },
            ],
          });
          context.connection.console.info(`[fmu-import] Wrote wrapper to ${targetUri}`);
        } catch {
          // Non-fatal: the source is still returned in the response
        }

        // Also register the FMU entity for class resolution
        fmuEntity.instantiate();
        const fmuUri = `__fmu__:${params.name}`;
        context.workspaceManager.workspaceInstances.set(fmuUri, [fmuEntity as any]);
        context.connection.console.info(`[fmu-import] Registered FMU entity '${params.name}'`);

        return {
          ok: true,
          source,
          uri: targetUri,
          modelName: desc.modelName,
          inputCount: inputs.length,
          outputCount: outputs.length,
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[fmu-import] Failed:`, msg);
        return { ok: false, error: msg };
      }
    },
  );
}

// @ts-nocheck
