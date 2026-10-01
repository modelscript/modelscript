// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any, prefer-const */
// @ts-nocheck
import { buildFmuArchive, parseFmuModelDescription } from "@modelscript/exchange/fmu";
import { readZipTextEntry } from "@modelscript/runtime/wasm_container.js";
import { ArenaSimulator } from "@modelscript/simulate";
import { LspContext } from "../lsp-context.js";
import { flattenTargetClass } from "./simulationEndpoints.js";

export function registerInteropEndpoints(context: LspContext) {
  context.connection.onRequest(
    "modelscript/exportFmu",
    async (params: { uri: string; fmiVersion: "2.0" | "3.0"; includeWasm?: boolean }) => {
      let doc = context.documents.get(params.uri);
      if (!doc) {
        for (const d of context.documents.all()) {
          if (d.uri === params.uri || decodeURIComponent(d.uri) === decodeURIComponent(params.uri)) {
            doc = d;
            break;
          }
        }
      }

      // Await any inflight validation
      const pending =
        context.state.activeValidationPromises?.get(params.uri) ??
        (doc ? context.state.activeValidationPromises?.get(doc.uri) : undefined);
      if (pending) {
        await pending;
      }

      let instances =
        context.workspaceManager.documentInstances.get(params.uri) ??
        context.workspaceManager.workspaceInstances.get(params.uri) ??
        (doc ? context.workspaceManager.documentInstances.get(doc.uri) : undefined) ??
        (doc ? context.workspaceManager.workspaceInstances.get(doc.uri) : undefined);

      if ((!instances || instances.length === 0) && doc) {
        await context.validationService.validateTextDocument(doc);
        const postPending =
          context.state.activeValidationPromises?.get(doc.uri) ??
          context.state.activeValidationPromises?.get(params.uri);
        if (postPending) await postPending;
        instances =
          context.workspaceManager.documentInstances.get(params.uri) ??
          context.workspaceManager.workspaceInstances.get(params.uri) ??
          context.workspaceManager.documentInstances.get(doc.uri) ??
          context.workspaceManager.workspaceInstances.get(doc.uri);
      }

      if (!instances || instances.length === 0) {
        const resolved =
          context.workspaceManager.resolveModelicaClassInstance(params.uri) ??
          (doc ? context.workspaceManager.resolveModelicaClassInstance(doc.uri) : null);
        if (resolved) {
          instances = [resolved];
        }
      }

      let arena: any = null;
      let targetClass = "";

      if (instances && instances.length > 0) {
        const targetInstance = instances[0];
        targetClass = targetInstance.name || targetInstance.compositeName || "";
        const ctx =
          context.workspaceManager.documentContexts.get(params.uri) ??
          (doc ? context.workspaceManager.documentContexts.get(doc.uri) : undefined) ??
          context.state.sharedContext ??
          (context.parserService as any)?.sharedContext;
        const flattenFn = (globalThis as any).flattenArenaFromInstance ?? flattenArenaFromInstance;
        if (typeof flattenFn === "function") {
          try {
            arena = flattenFn(targetInstance, ctx);
          } catch {
            arena = null;
          }
        }
      }

      if (!arena) {
        try {
          const flatRes = flattenTargetClass(context, params.uri);
          if ("error" in flatRes) {
            if (!instances || instances.length === 0) {
              throw new Error("No Modelica classes found in the active document.");
            }
            throw new Error(flatRes.error);
          }
          arena = flatRes.arena;
          targetClass = flatRes.target.className;
        } catch (e: any) {
          if (!instances || instances.length === 0) {
            throw new Error("No Modelica classes found in the active document.", { cause: e });
          }
          throw e;
        }
      }

      if (!targetClass) throw new Error("Could not determine model name.");

      const simulator = new ArenaSimulator(arena);
      simulator.prepare();
      const stateVars = new Set<string>();
      for (const varIdx of simulator.stateVars) {
        stateVars.add(arena.getVarName(varIdx));
      }

      const fmiVer = params.fmiVersion === "3.0" ? "3" : "2";
      const { archive } = buildFmuArchive(
        arena,
        {
          modelIdentifier: targetClass,
          fmiVersion: fmiVer,
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
        const xml = readZipTextEntry(fmuBytes, "modelDescription.xml");
        if (!xml) return { ok: false, error: "modelDescription.xml not found in FMU" };
        const parsed = parseFmuModelDescription(xml);
        console.log(`[fmu] Registered FMU '${params.name}' (modelName: ${parsed.modelName}) via custom request`);
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
        // Dynamically import exchange for model description parsing, terminals, and wrapper generation
        const { parseModelDescription, parseTerminalsAndIcons, generateFmuWrapperModelica } =
          await import("@modelscript/exchange");

        // Decode base64 to bytes
        const binaryStr = atob(params.data);
        const fmuBytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          fmuBytes[i] = binaryStr.charCodeAt(i);
        }

        // Extract modelDescription.xml from ZIP using container toolkit
        const xmlContent = readZipTextEntry(fmuBytes, "modelDescription.xml");
        if (!xmlContent) return { ok: false, error: "modelDescription.xml not found in FMU" };
        const desc = parseModelDescription(xmlContent);
        if (!desc.modelName || desc.modelName === "Unknown") {
          desc.modelName = params.name;
        }

        // Extract FMI-LS-TI terminalsAndIcons.xml if present
        const terminalsXml =
          readZipTextEntry(fmuBytes, "terminalsAndIcons/terminalsAndIcons.xml") ??
          readZipTextEntry(fmuBytes, "terminalsAndIcons.xml") ??
          readZipTextEntry(fmuBytes, "fmi3TerminalsAndIcons.xml");
        const terminals = terminalsXml ? parseTerminalsAndIcons(terminalsXml) : desc.terminals;

        const source = generateFmuWrapperModelica(desc, `${params.name}.fmu`, params.packageName, terminals);

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
