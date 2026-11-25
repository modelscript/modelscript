// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ActionExecutionContext, LanguageAction } from "@modelscript/dsl";
import type { LspContext } from "../lsp-context.js";
import { globalLanguageRegistry } from "../registry/LanguageRegistry.js";
import { compileStepFromSources } from "./cadStepCompiler.js";

const STOP_TOKENS = new Set(["to", "from", "case", "deck", "model", "network", "flowsheet", "system"]);

function normalizeActionTokens(id: string): string {
  return id
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0 && !STOP_TOKENS.has(t))
    .sort()
    .join("_");
}

function areActionIdsEquivalent(a: string, b: string): boolean {
  if (a === b) return true;
  const na = normalizeActionTokens(a);
  const nb = normalizeActionTokens(b);
  return na.length > 0 && na === nb;
}

function findMatchingAction(actions: LanguageAction[], requestedId: string): LanguageAction | undefined {
  const exact = actions.find((a) => a.id === requestedId);
  if (exact) return exact;
  const equiv = actions.find((a) => areActionIdsEquivalent(a.id, requestedId));
  if (equiv) return equiv;

  const lower = requestedId.toLowerCase();
  if (lower === "simulate" || lower === "solve") {
    return (
      actions.find((a) => a.category === "simulate") ??
      actions.find((a) => /(simulate|solve|run_tran|run_op|run_scan|transient|steady)/i.test(a.id))
    );
  }
  if (lower === "lint" || lower === "verify" || lower === "check") {
    return (
      actions.find((a) => a.category === "verify" && /lint|verify|check/i.test(a.id)) ??
      actions.find((a) => a.category === "verify") ??
      actions.find((a) => /(lint|verify|check)/i.test(a.id))
    );
  }
  if (lower === "flatten" || lower === "to_dae" || lower === "dae") {
    return actions.find((a) => /(to_dae|_dae$|flatten)/i.test(a.id));
  }
  return undefined;
}

interface ListedActionInfo {
  id: string;
  languageId: string;
  command: string;
  title: string;
  description?: string | undefined;
  category?: string | undefined;
  inputs?: LanguageAction["inputs"] | undefined;
  output?: LanguageAction["output"] | undefined;
  ui?: LanguageAction["ui"] | undefined;
}

interface GlobalActionRouterFallback {
  sharedFs?: { read(path: string): string } | undefined;
  sharedContext?: unknown;
}

function findMatchingHandler<T extends (...args: never[]) => unknown>(
  handlers: Record<string, T> | undefined,
  requestedId: string,
): T | undefined {
  if (!handlers) return undefined;
  if (typeof handlers[requestedId] === "function") return handlers[requestedId];
  if (typeof handlers[`modelscript/${requestedId}`] === "function") return handlers[`modelscript/${requestedId}`];
  for (const [key, fn] of Object.entries(handlers)) {
    if (typeof fn === "function" && areActionIdsEquivalent(key, requestedId)) {
      return fn;
    }
  }
  const lower = requestedId.toLowerCase();
  if (lower === "simulate" || lower === "solve") {
    for (const [key, fn] of Object.entries(handlers)) {
      if (typeof fn === "function" && /(simulate|solve|run_tran|run_op|run_scan|transient)/i.test(key)) {
        return fn;
      }
    }
  }
  if (lower === "lint" || lower === "verify" || lower === "check") {
    for (const [key, fn] of Object.entries(handlers)) {
      if (typeof fn === "function" && /(lint|verify|check)/i.test(key)) {
        return fn;
      }
    }
  }
  if (lower === "flatten" || lower === "to_dae" || lower === "dae") {
    for (const [key, fn] of Object.entries(handlers)) {
      if (typeof fn === "function" && /(to_dae|_dae$|flatten)/i.test(key)) {
        return fn;
      }
    }
  }
  return undefined;
}

/**
 * Registers language-agnostic Inversion-of-Control (IoC) action router endpoints.
 * Completely decoupled from specific language implementations.
 */
export function registerActionRouter(context: LspContext): void {
  // 1. List actions endpoint
  context.connection.onRequest(
    "modelscript/listActions",
    async (params?: { languageId?: string | undefined; uri?: string | undefined }): Promise<ListedActionInfo[]> => {
      const plugins = params?.languageId
        ? [globalLanguageRegistry.getPluginById(params.languageId)].filter(Boolean)
        : params?.uri
          ? [globalLanguageRegistry.getPluginForUri(params.uri)].filter(Boolean)
          : globalLanguageRegistry.getAllPlugins();

      const results: ListedActionInfo[] = [];
      const seenPluginDefs = new Set<unknown>();
      for (const plugin of plugins) {
        if (!plugin) continue;
        if (plugin.languageDef) {
          if (seenPluginDefs.has(plugin.languageDef)) continue;
          seenPluginDefs.add(plugin.languageDef);
        }
        const actions: LanguageAction[] = plugin.languageDef?.actions || [];
        const listedActionIds: string[] = [];
        for (const action of actions) {
          listedActionIds.push(action.id);
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
        if (plugin.actionHandlers) {
          for (const actionId of Object.keys(plugin.actionHandlers)) {
            if (listedActionIds.some((existing) => areActionIdsEquivalent(existing, actionId))) continue;
            listedActionIds.push(actionId);
            results.push({
              id: actionId,
              languageId: plugin.id,
              command: `modelscript.${plugin.id}.${actionId}`,
              title: actionId.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()),
              description: `Execute ${actionId} on ${plugin.name || plugin.id}`,
              category: "Verification",
            });
          }
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
      languageId?: string | undefined;
      uri?: string | undefined;
      inputs?: Record<string, unknown> | undefined;
    }): Promise<unknown> => {
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
          if (
            actions.some((a) => areActionIdsEquivalent(a.id, params.actionId)) ||
            findMatchingHandler(p.actionHandlers, params.actionId) !== undefined
          ) {
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
      const action = findMatchingAction(actions, params.actionId);
      const effectiveActionId = action?.id ?? params.actionId;

      type ActionExecFn = (ctx: ActionExecutionContext, inputs: Record<string, unknown>) => unknown;
      let executeFn: ActionExecFn | undefined = action?.execute as ActionExecFn | undefined;
      if (typeof executeFn !== "function") {
        executeFn =
          findMatchingHandler(plugin.actionHandlers, effectiveActionId) ??
          findMatchingHandler(plugin.actionHandlers, params.actionId);
      }
      if (typeof executeFn !== "function") {
        executeFn =
          findMatchingHandler(plugin.languageDef?.actionHandlers, effectiveActionId) ??
          findMatchingHandler(plugin.languageDef?.actionHandlers, params.actionId);
      }
      if (typeof executeFn !== "function") {
        executeFn =
          findMatchingHandler(plugin.handlers, effectiveActionId) ??
          findMatchingHandler(plugin.handlers, params.actionId);
      }
      if (typeof executeFn !== "function") {
        executeFn =
          findMatchingHandler(plugin.languageDef?.lsp?.handlers, effectiveActionId) ??
          findMatchingHandler(plugin.languageDef?.lsp?.handlers, params.actionId);
      }

      if (typeof executeFn !== "function") {
        if (!action) {
          throw new Error(`[lsp] Action '${params.actionId}' not found on language '${plugin.id}'`);
        }
        throw new Error(
          `[lsp] Action '${params.actionId}' does not have an execute handler on language '${plugin.id}'`,
        );
      }

      const globalFallback = globalThis as unknown as GlobalActionRouterFallback;
      let docText = typeof params.inputs?.["documentText"] === "string" ? params.inputs["documentText"] : undefined;
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
          const wmDocMgr = (
            context.workspaceManager as unknown as {
              documentManager?: { documentTrees?: Map<string, { text?: string }> };
            }
          )?.documentManager;
          const cached =
            context.documentManager?.documentTrees?.get(params.uri) ??
            context.documentManager?.documentTrees?.get(normUri) ??
            wmDocMgr?.documentTrees?.get(params.uri);
          if (cached?.text) {
            docText = cached.text;
          } else if (globalFallback.sharedFs) {
            const fsPath = params.uri.replace(/^[a-z0-9+-]+:\/\/?/, "/");
            try {
              docText = globalFallback.sharedFs.read(fsPath);
            } catch {
              /* ignore */
            }
          }
        }
      }

      const inputName = typeof params.inputs?.["name"] === "string" ? params.inputs["name"] : undefined;
      if (!docText && inputName && typeof context.documents?.all === "function") {
        for (const d of context.documents.all()) {
          const text = d.getText();
          if (
            text.includes(`model ${inputName}`) ||
            text.includes(`class ${inputName}`) ||
            text.includes(`block ${inputName}`) ||
            text.includes(inputName)
          ) {
            docText = text;
            if (!params.uri) params.uri = d.uri;
            break;
          }
        }
      }

      const collectedProjectFiles: Record<string, string> = {};
      if (typeof context.documents?.all === "function") {
        const activeDirPrefix = params.uri ? params.uri.slice(0, params.uri.lastIndexOf("/") + 1) : "";
        for (const d of context.documents.all()) {
          if (!activeDirPrefix || d.uri.startsWith(activeDirPrefix)) {
            const relName = activeDirPrefix
              ? d.uri.slice(activeDirPrefix.length)
              : d.uri.replace(/^[a-z0-9+-]+:\/\/\/?/i, "");
            if (relName) {
              collectedProjectFiles[relName] = d.getText();
            }
          }
        }
      }
      const inputProjectFiles = params.inputs?.["projectFiles"] ?? params.inputs?.["virtualFiles"];
      if (inputProjectFiles && typeof inputProjectFiles === "object" && !Array.isArray(inputProjectFiles)) {
        for (const [k, v] of Object.entries(inputProjectFiles as Record<string, unknown>)) {
          if (typeof v === "string") {
            collectedProjectFiles[k] = v;
          }
        }
      }

      const executionContext: ActionExecutionContext = {
        uri: params.uri,
        languageId: plugin.id,
        documentText: docText,
        projectFiles: collectedProjectFiles,
        queryEngine:
          plugin.queryEngine ??
          context.workspaceManager?.getQueryEngine?.(plugin.id) ??
          context.workspaceManager?.globalModelicaQueryEngine,
        workspaceManager: context.workspaceManager,
        parserService: context.parserService,
        validationService: context.validationService,
        documentManager: context.documentManager,
        documents: context.documents,
        state: context.state,
        sharedContext:
          context.state?.sharedContext ?? context.parserService?.sharedContext ?? globalFallback.sharedContext,
        connection: context.connection,
        notifyProgress: (msg: string, increment?: number) => {
          context.connection.sendNotification("modelscript/status", {
            state: "progress",
            message: msg,
            increment,
          });
        },
      };

      if (plugin.id === "scad") {
        (executionContext as unknown as Record<string, unknown>)["compileStepFromSources"] = compileStepFromSources;
      }

      try {
        const rawRes = await executeFn(executionContext, params.inputs || {});
        const toJsonSafe = (v: unknown): unknown => {
          if (v === null || v === undefined || typeof v !== "object") return v;
          if (v instanceof Map) {
            const obj: Record<string, unknown> = {};
            for (const [k, val] of v.entries()) obj[String(k)] = toJsonSafe(val);
            return obj;
          }
          if (ArrayBuffer.isView(v)) {
            return Array.from(v as unknown as ArrayLike<number>);
          }
          if (Array.isArray(v)) return v.map(toJsonSafe);
          const rec = v as Record<string, unknown>;
          const out: Record<string, unknown> = {};
          for (const [k, val] of Object.entries(rec)) {
            out[k] =
              val instanceof Map ||
              ArrayBuffer.isView(val) ||
              Array.isArray(val) ||
              (val && typeof val === "object" && val.constructor === Object)
                ? toJsonSafe(val)
                : val;
          }
          return out;
        };
        return toJsonSafe(rawRes);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        context.connection.console.error(
          `[lsp] Error executing action '${params.actionId}' for '${params.uri ?? plugin.id}': ${msg}`,
        );
        throw err;
      }
    },
  );
}
