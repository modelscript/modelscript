// SPDX-License-Identifier: AGPL-3.0-or-later

import { CodeLens, Range } from "vscode-languageserver";
import { type LspContext, resolveFeatureFlags } from "../lsp-context.js";
import { globalLanguageRegistry } from "../registry/LanguageRegistry.js";
import { CadMetricsService } from "../services/cad-metrics-service.js";

const defaultCadMetricsService = new CadMetricsService();

function isIdentContCode(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95 || (code >= 48 && code <= 57);
}

function splitLinesPreserve(text: string): string[] {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.endsWith("\r")) {
      lines[i] = line.slice(0, -1);
    }
  }
  return lines;
}

function humanizeActionId(actionId: string): string {
  const spaced = actionId.split("_").join(" ");
  let out = "";
  let prevWasWord = false;
  for (let i = 0; i < spaced.length; i++) {
    const ch = spaced[i]!;
    const isWord = isIdentContCode(ch.charCodeAt(0));
    out += !prevWasWord && isWord ? ch.toUpperCase() : ch;
    prevWasWord = isWord;
  }
  return out;
}

function computeHeaderRange(text: string): Range {
  let targetLine = 0;
  if (text) {
    const lines = splitLinesPreserve(text);
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i]!.trim();
      if (
        t &&
        !t.startsWith("//") &&
        !t.startsWith("#") &&
        !t.startsWith(";") &&
        !t.startsWith("!") &&
        !t.startsWith("/*") &&
        !t.startsWith("<?xml")
      ) {
        targetLine = i;
        break;
      }
    }
  }
  return Range.create(targetLine, 0, targetLine, 0);
}

export function registerCodeLensProvider(context: LspContext) {
  context.connection.onRequest("textDocument/codeLens", (params): CodeLens[] => {
    const uri = params.textDocument.uri;
    const lenses: CodeLens[] = [];

    const settings = context.settings;
    const features = resolveFeatureFlags(settings);
    const codeLensCfg = settings?.codeLens;
    if (codeLensCfg?.enabled === false) {
      return lenses;
    }

    const showSimulate = (codeLensCfg?.simulate ?? true) && features.codeLensSimulate;
    const showDiagram = codeLensCfg?.diagram ?? false;

    const rawVerif = codeLensCfg?.verification;
    const verificationMode: "all" | "problemsOnly" | "off" =
      rawVerif === "all" || rawVerif === true
        ? "all"
        : rawVerif === "off" || rawVerif === false
          ? "off"
          : "problemsOnly";
    const showVerification =
      verificationMode !== "off" && (features.formalVerification || rawVerif === true || rawVerif === "all");
    const showPolyglotLinks = (codeLensCfg?.polyglotLinks ?? features.digitalThread) && features.digitalThread;
    const showCadMetrics = codeLensCfg?.cadMetrics ?? false;
    const showFileConversions = (codeLensCfg?.fileConversions ?? false) && features.caeWorkbench;

    const currentDoc = context.documents.get(uri);
    const currentText = currentDoc?.getText() ?? "";
    const detectedPlugin = globalLanguageRegistry.getPluginForUri(uri, currentText);
    const headerRange = computeHeaderRange(currentText);

    // 1. Plugin-provided CodeLens (covers Modelica, SysML v2, SCAD, FEA, CFD, STEP, OLGA, PSCAD, PSS/E, OWL2, CSV, ModelScript, etc.)
    let extraPluginLenses: CodeLens[] = [];
    if (detectedPlugin?.customHandlers?.codeLens) {
      const pluginResult = detectedPlugin.customHandlers.codeLens(currentDoc ?? { uri, getText: () => currentText }, {
        uri,
        text: currentText,
        headerRange,
        flags: {
          showVerification,
          showPolyglotLinks,
          showCadMetrics,
          showDiagram,
          showSimulate,
          showFileConversions,
          verificationMode,
          rawVerif,
          formalVerification: features.formalVerification,
          scaffolding: features.scaffolding,
          demos: features.demos,
        },
        workspaceManager: context.workspaceManager,
        documentManager: (context as any).documentManager,
        validationService: context.validationService,
        cadMetricsService: context.cadMetricsService ?? defaultCadMetricsService,
        connection: context.connection,
      });
      if (Array.isArray(pluginResult)) {
        return pluginResult;
      }
      if (pluginResult && typeof (pluginResult as any).then === "function") {
        return pluginResult as any;
      }
      if (pluginResult && typeof pluginResult === "object" && Array.isArray((pluginResult as any).lenses)) {
        if ((pluginResult as any).appendUniversal) {
          extraPluginLenses = (pluginResult as any).lenses;
        } else {
          return (pluginResult as any).lenses;
        }
      }
    }

    // 2. Universal Language Plugin CodeLens Provider (covers all remaining registered languages)
    if (detectedPlugin) {
      if (showDiagram) {
        lenses.push({
          range: headerRange,
          command: {
            title: `⊞ Open Interactive ${detectedPlugin.name} Diagram`,
            command: "modelscript.openDiagram",
            arguments: [uri],
          },
        });
      }

      const actions: Array<{ id: string; title: string; category?: string }> =
        (detectedPlugin.languageDef as any)?.actions ?? [];
      if (actions.length > 0) {
        let emittedSim = false;
        for (const action of actions) {
          const cat = action.category ?? "query";
          if (cat === "simulate") {
            if (!showSimulate || (emittedSim && !showVerification && !showFileConversions)) continue;
            emittedSim = true;
          }
          if ((cat === "verify" || cat === "query") && !showVerification) continue;
          if ((cat === "transform" || cat === "export") && !showFileConversions) continue;
          const prefix = cat === "simulate" ? "▶ " : cat === "verify" || cat === "query" ? "✓ " : "⇄ ";
          lenses.push({
            range: headerRange,
            command: {
              title: `${prefix}${action.title}`,
              command: `modelscript.${detectedPlugin.id}.${action.id}`,
              arguments: [uri],
            },
          });
        }
      } else if (detectedPlugin.actionHandlers) {
        let emittedSim = false;
        for (const actionId of Object.keys(detectedPlugin.actionHandlers)) {
          const isSim = actionId.includes("simulate") || actionId.includes("solve") || actionId.includes("run");
          const isExport = actionId.includes("export") || actionId.includes("project") || actionId.includes("_to_");
          if (isSim) {
            if (!showSimulate || (emittedSim && !showVerification && !showFileConversions)) continue;
            emittedSim = true;
          } else if (isExport) {
            if (!showFileConversions) continue;
          } else {
            if (!showVerification) continue;
          }
          const prefix = isSim ? "▶ " : isExport ? "⇄ " : "✓ ";
          const humanTitle = humanizeActionId(actionId);
          lenses.push({
            range: headerRange,
            command: {
              title: `${prefix}${humanTitle}`,
              command: `modelscript.${detectedPlugin.id}.${actionId}`,
              arguments: [uri],
            },
          });
        }
      }

      if (extraPluginLenses.length > 0) {
        lenses.push(...extraPluginLenses);
      }
    }

    return lenses;
  });
}
