// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript SEL Relay Language Definition.
 */

import { cardDeckRules, language } from "@modelscript/dsl";
import { evaluateRelayProtection } from "./analysis/selogic-evaluator.js";
import { registerBuiltInSelLibrarySync } from "./catalog/library-package-adapter.js";
import { lowerSELToDae } from "./dae/sel-to-dae.js";
import { selIndexing } from "./indexing.js";
import { lintSELSettings } from "./lints/index.js";
import { parseSELSettings } from "./parser/sel-parser.js";
import { writeSELAscii, writeSELJson } from "./parser/sel-writer.js";
import { selPolyglotConfig } from "./tgg/index.js";

export const selLanguage = language({
  polyglot: selPolyglotConfig,
  name: "sel",
  fileExtensions: [".rcf", ".rdb", ".sel", ".txt"],
  maturity: "beta",
  indexing: selIndexing,
  lsp: {
    fileExtensions: [".rcf", ".rdb", ".sel", ".txt"],
  },

  ui: {
    toolbarButtons: [
      {
        id: "evaluateSelProtection",
        label: "Evaluate SEL Protection & SELogic",
        shortLabel: "Evaluate SEL",
        tooltip: "Evaluate SEL Protection & SELogic",
        icon: "play",
        views: ["code", "inspector"],
        targets: ["morsel"],
        placement: "primary",
        order: 10,
        actionId: "evaluate_sel_protection",
      },
      {
        id: "lowerSelDae",
        label: "Lower SEL Relay to DAE Arena",
        shortLabel: "Lower SEL",
        tooltip: "Lower SEL Relay to DAE Arena",
        icon: "stack",
        views: ["code", "inspector"],
        targets: ["morsel"],
        placement: "overflow",
        order: 20,
        actionId: "lower_sel_dae",
      },
      {
        id: "exportSelAscii",
        label: "Export SEL ASCII Settings (.rcf)",
        shortLabel: "Export SEL",
        tooltip: "Export SEL ASCII Settings (.rcf)",
        icon: "download",
        views: ["code", "inspector"],
        targets: ["morsel"],
        placement: "primary",
        order: 30,
        actionId: "export_sel_ascii",
      },
      {
        id: "exportSelJson",
        label: "Export SEL Settings JSON (.rdb)",
        shortLabel: "Export SEL",
        tooltip: "Export SEL Settings JSON (.rdb)",
        icon: "download",
        views: ["code", "inspector"],
        targets: ["morsel"],
        placement: "overflow",
        order: 40,
        actionId: "export_sel_json",
      },
      {
        id: "lintSelSettings",
        label: "Lint SEL Relay Settings",
        shortLabel: "Lint SEL",
        tooltip: "Lint SEL Relay Settings",
        icon: "shield-check",
        views: ["*"],
        targets: ["morsel"],
        placement: "overflow",
        order: 50,
        actionId: "lint_sel_settings",
      },
    ],
  },
  actions: [
    {
      id: "evaluate_sel_protection",
      title: "Evaluate SEL Protection & SELogic",
      description: "Evaluates phase/ground overcurrent, distance reach, and resolves SELogic control equations.",
      category: "simulate",
      ui: {
        editorTitle: {
          icon: "$(shield)",
          group: "navigation@0",
        },
        languageModelTool: {
          name: "sel_evaluate_protection",
          displayName: "Evaluate SEL Relay Protection",
          modelDescription:
            "Evaluates SEL protective relay element trip decisions and SELogic equations for simulated faults.",
        },
      },
      execute: async (
        ctx,
        params?: {
          documentText?: string | undefined;
          phaseCurrentA?: number | undefined;
          groundCurrentA?: number | undefined;
          faultImpedanceOhms?: number | undefined;
          phaseVoltageV?: number | undefined;
          frequencyHz?: number | undefined;
          digitalInputs?: Record<string, boolean> | undefined;
        },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const settings = parseSELSettings(text);
        return evaluateRelayProtection(settings, {
          phaseCurrentA: params?.phaseCurrentA ?? 20.0,
          groundCurrentA: params?.groundCurrentA ?? 0.0,
          faultImpedanceOhms: params?.faultImpedanceOhms,
          phaseVoltageV: params?.phaseVoltageV ?? 120.0,
          frequencyHz: params?.frequencyHz ?? 60.0,
          digitalInputs: params?.digitalInputs,
        });
      },
    },
    {
      id: "lower_sel_dae",
      title: "Lower SEL Relay to DAE Arena",
      description: "Compiles relay settings, pickup thresholds, and contacts directly into zero-GC DAEBuilder arena.",
      category: "transform",
      execute: async (ctx, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return { variableCount: 0, equationCount: 0 };
        const settings = parseSELSettings(text);
        const dae = lowerSELToDae(settings);
        return {
          variableCount: dae.varCount,
          equationCount: dae.eqCount,
        };
      },
    },
    {
      id: "lint_sel_settings",
      title: "Lint SEL Relay Settings",
      description: "Validates relay identification, pickup coordination, and SELogic equation consistency.",
      category: "verify",
      execute: async (ctx, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        const settings = parseSELSettings(text);
        return lintSELSettings(settings);
      },
    },
    {
      id: "export_sel_ascii",
      title: "Export SEL ASCII Settings (.rcf)",
      description: "Serializes relay settings into standard SEL ASCII command dump format.",
      category: "transform",
      execute: async (ctx, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const settings = parseSELSettings(text);
        return writeSELAscii(settings);
      },
    },
    {
      id: "export_sel_json",
      title: "Export SEL Settings JSON (.rdb)",
      description: "Serializes relay settings into structured JSON database format.",
      category: "transform",
      execute: async (ctx, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const settings = parseSELSettings(text);
        return writeSELJson(settings);
      },
    },
  ],
  extras: () => [/[ \t\r\n]+/],
  rules: cardDeckRules,
});

export default selLanguage;

// Auto-register cleanroom standard library in globalLibraryRegistry (zero-I/O).
registerBuiltInSelLibrarySync();
