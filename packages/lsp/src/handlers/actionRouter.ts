// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ActionExecutionContext, LanguageAction } from "@modelscript/dsl";
import type { LspContext } from "../LspContext.js";
import { globalLanguageRegistry } from "../registry/LanguageRegistry.js";

/**
 * Registers language-agnostic Inversion-of-Control (IoC) action router endpoints.
 * Completely decoupled from specific language implementations.
 */
export function registerActionRouter(context: LspContext): void {
  // 1. List actions endpoint
  context.connection.onRequest(
    "modelscript/listActions",
    async (params?: { languageId?: string; uri?: string }): Promise<any[]> => {
      const plugins = params?.languageId
        ? [globalLanguageRegistry.getPluginById(params.languageId)].filter(Boolean)
        : params?.uri
          ? [globalLanguageRegistry.getPluginForUri(params.uri)].filter(Boolean)
          : globalLanguageRegistry.getAllPlugins();

      const results: any[] = [];
      const seenPluginDefs = new Set<any>();
      for (const plugin of plugins) {
        if (!plugin) continue;
        if (plugin.languageDef) {
          if (seenPluginDefs.has(plugin.languageDef)) continue;
          seenPluginDefs.add(plugin.languageDef);
        }
        const actions: LanguageAction[] = plugin.languageDef?.actions || [];
        for (const action of actions) {
          results.push({
            id: action.id,
            languageId: plugin.id,
            command: `modelscript.${plugin.id}.${action.id}`,
            title: action.title,
            description: action.description,
            category: action.category,
            inputs: action.inputs,
            output: action.output,
            ui: action.ui,
          });
        }
      }
      return results;
    },
  );

  // 2. Execute action endpoint
  context.connection.onRequest(
    "modelscript/executeAction",
    async (params: {
      actionId: string;
      languageId?: string;
      uri?: string;
      inputs?: Record<string, any>;
    }): Promise<any> => {
      console.log(
        `[LSP-WORKER][executeAction] START: actionId=${params.actionId}, uri=${params.uri}, lang=${params.languageId}`,
      );
      let plugin = params.languageId ? globalLanguageRegistry.getPluginById(params.languageId) : undefined;
      if (!plugin && params.uri) {
        plugin = globalLanguageRegistry.getPluginForUri(params.uri);
      }
      if (!plugin) {
        // Fallback: search all plugins for one providing this action ID
        for (const p of globalLanguageRegistry.getAllPlugins()) {
          const actions: LanguageAction[] = p.languageDef?.actions || [];
          if (actions.some((a) => a.id === params.actionId)) {
            plugin = p;
            break;
          }
        }
      }

      if (!plugin) {
        throw new Error(
          `[lsp] No language plugin resolved for action '${params.actionId}' (lang: ${params.languageId}, uri: ${params.uri})`,
        );
      }

      const actions: LanguageAction[] = plugin.languageDef?.actions || [];
      const action = actions.find((a) => a.id === params.actionId);
      if (!action) {
        throw new Error(`[lsp] Action '${params.actionId}' not found on language '${plugin.id}'`);
      }

      let executeFn = action.execute;
      if (typeof executeFn !== "function" && plugin.actionHandlers) {
        executeFn = plugin.actionHandlers[params.actionId];
      }
      if (typeof executeFn !== "function" && plugin.languageDef?.actionHandlers) {
        executeFn = plugin.languageDef.actionHandlers[params.actionId];
      }
      if (typeof executeFn !== "function" && plugin.handlers) {
        executeFn = plugin.handlers[params.actionId] ?? plugin.handlers[`modelscript/${params.actionId}`];
      }
      if (typeof executeFn !== "function" && plugin.languageDef?.lsp?.handlers) {
        executeFn =
          plugin.languageDef.lsp.handlers[params.actionId] ??
          plugin.languageDef.lsp.handlers[`modelscript/${params.actionId}`];
      }

      if (typeof executeFn !== "function") {
        throw new Error(
          `[lsp] Action '${params.actionId}' does not have an execute handler on language '${plugin.id}'`,
        );
      }

      let docText = params.inputs?.documentText;
      if (!docText) {
        let doc = params.uri ? context.documents.get(params.uri) : undefined;
        if (!doc && params.uri && typeof context.documents?.all === "function") {
          const normUri = params.uri.replace(/^([a-z0-9+-]+):\/{1,3}/i, "$1:///");
          for (const d of context.documents.all()) {
            const dNorm = d.uri.replace(/^([a-z0-9+-]+):\/{1,3}/i, "$1:///");
            if (
              d.uri === params.uri ||
              dNorm === normUri ||
              decodeURIComponent(d.uri) === decodeURIComponent(params.uri) ||
              decodeURIComponent(dNorm) === decodeURIComponent(normUri)
            ) {
              doc = d;
              break;
            }
          }
        }
        docText = doc?.getText();
        if (!docText && params.uri) {
          const normUri = params.uri.replace(/^([a-z0-9+-]+):\/{1,3}/i, "$1:///");
          const cached =
            context.documentManager?.documentTrees?.get(params.uri) ??
            context.documentManager?.documentTrees?.get(normUri) ??
            (context.workspaceManager as any)?.documentManager?.documentTrees?.get(params.uri);
          if (cached?.text) {
            docText = cached.text;
          } else if ((globalThis as any).sharedFs) {
            const fsPath = params.uri.replace(/^[a-z0-9+-]+:\/\/?/, "/");
            try {
              docText = (globalThis as any).sharedFs.read(fsPath);
            } catch {
              /* ignore */
            }
          }
        }
      }

      if (!docText && typeof context.documents?.all === "function") {
        for (const d of context.documents.all()) {
          const text = d.getText();
          if (
            params.inputs?.name &&
            (text.includes(`model ${params.inputs.name}`) ||
              text.includes(`class ${params.inputs.name}`) ||
              text.includes(`block ${params.inputs.name}`) ||
              text.includes(params.inputs.name))
          ) {
            docText = text;
            if (!params.uri) params.uri = d.uri;
            break;
          }
        }
      }

      const executionContext: ActionExecutionContext = {
        uri: params.uri,
        languageId: plugin.id,
        documentText: docText,
        queryEngine:
          plugin.queryEngine ??
          (context.workspaceManager as any)?.getQueryEngine?.(plugin.id) ??
          (context.workspaceManager as any)?.globalModelicaQueryEngine,
        workspaceManager: context.workspaceManager,
        parserService: context.parserService,
        validationService: context.validationService,
        documentManager: context.documentManager,
        documents: context.documents,
        state: context.state,
        sharedContext:
          context.state?.sharedContext ?? context.parserService?.sharedContext ?? (globalThis as any).sharedContext,
        connection: context.connection,
        notifyProgress: (msg: string, increment?: number) => {
          context.connection.sendNotification("modelscript/status", {
            state: "progress",
            message: msg,
            increment,
          });
        },
      };

      try {
        return await executeFn(executionContext, params.inputs || {});
      } catch (err: any) {
        context.connection.console.error(
          `[lsp] Error executing action '${params.actionId}' for '${params.uri ?? plugin.id}': ${err?.message ?? err}`,
        );
        throw err;
      }
    },
  );
}
