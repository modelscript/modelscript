// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript ASPEN OneLiner / CAPE Language Definition.
 */

import { cardDeckRules, language } from "@modelscript/dsl";
import { calculateBusFaultCurrents, calculateOvercurrentTripTime } from "./analysis/fault-solver.js";
import { lowerOneLinerToDae } from "./dae/oneliner-to-dae.js";
import { indexOneLinerFile } from "./indexing.js";
import { lintOneLinerCase } from "./lints/index.js";
import { parseOneLiner } from "./parser/oneliner-parser.js";
import { writeOneLinerDxt } from "./parser/oneliner-writer.js";
import { onelinerPolyglotConfig } from "./tgg/index.js";

export const onelinerLanguage = language({
  polyglot: onelinerPolyglotConfig,
  name: "oneliner",
  fileExtensions: [".olx", ".dxt"],
  maturity: "beta",
  indexing: {
    indexFile: indexOneLinerFile,
  },
  lsp: {
    fileExtensions: [".olx", ".dxt"],
  },

  ui: {
    toolbarButtons: [
      {
        id: "calculateOnelinerFault",
        label: "Calculate Short-Circuit Fault Currents",
        shortLabel: "Calculate",
        tooltip: "Calculate Short-Circuit Fault Currents",
        icon: "zap",
        views: ["code", "inspector"],
        targets: ["morsel"],
        placement: "primary",
        order: 10,
        actionId: "calculate_oneliner_fault",
      },
      {
        id: "evaluateOnelinerRelayTrip",
        label: "Evaluate Time-Overcurrent Relay Trip Time",
        shortLabel: "Evaluate",
        tooltip: "Evaluate Time-Overcurrent Relay Trip Time",
        icon: "zap",
        views: ["code", "inspector"],
        targets: ["morsel"],
        placement: "primary",
        order: 20,
        actionId: "evaluate_oneliner_relay_trip",
      },
      {
        id: "lowerOnelinerDae",
        label: "Lower OneLiner Model to DAE Arena",
        shortLabel: "Lower OneLiner",
        tooltip: "Lower OneLiner Model to DAE Arena",
        icon: "stack",
        views: ["code", "inspector"],
        targets: ["morsel"],
        placement: "overflow",
        order: 30,
        actionId: "lower_oneliner_dae",
      },
      {
        id: "exportOnelinerDxt",
        label: "Export OneLiner DXT Format",
        shortLabel: "Export OneLiner",
        tooltip: "Export OneLiner DXT Format",
        icon: "download",
        views: ["code", "inspector"],
        targets: ["morsel"],
        placement: "overflow",
        order: 40,
        actionId: "export_oneliner_dxt",
      },
      {
        id: "lintOnelinerCase",
        label: "Lint OneLiner Network & Protection Settings",
        shortLabel: "Lint OneLiner",
        tooltip: "Lint OneLiner Network & Protection Settings",
        icon: "shield-check",
        views: ["*"],
        targets: ["morsel"],
        placement: "overflow",
        order: 50,
        actionId: "lint_oneliner_case",
      },
    ],
  },
  actions: [
    {
      id: "calculate_oneliner_fault",
      title: "Calculate Short-Circuit Fault Currents",
      description: "Computes 3-phase and single line-to-ground (SLG) fault currents and sequence Thevenin impedances.",
      category: "simulate",
      ui: {
        editorTitle: {
          icon: "$(zap)",
          group: "navigation@0",
        },
        languageModelTool: {
          name: "oneliner_calculate_fault",
          displayName: "Calculate Sequence Network Fault Currents",
          modelDescription:
            "Solves symmetrical component sequence networks for 3-phase and SLG fault currents at a designated bus.",
        },
      },
      execute: async (
        ctx,
        params?: {
          busId?: string | undefined;
          documentText?: string | undefined;
          zFaultOhms?: number | undefined;
        },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const c = parseOneLiner(text);
        if (c.busses.length === 0) return null;
        const targetBus = params?.busId ?? c.busses[0]!.id;
        return calculateBusFaultCurrents(c, targetBus, { zFaultOhms: params?.zFaultOhms });
      },
    },
    {
      id: "evaluate_oneliner_relay_trip",
      title: "Evaluate Time-Overcurrent Relay Trip Time",
      description: "Calculates ANSI 51/50 trip times using IEEE C37.112 / IEC 60255 curve characteristics.",
      category: "simulate",
      execute: async (
        ctx,
        params?: {
          relayId?: string | undefined;
          faultCurrentA?: number | undefined;
          documentText?: string | undefined;
        },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const c = parseOneLiner(text);
        if (c.overcurrentRelays.length === 0) return null;
        const targetRelay = c.overcurrentRelays.find((r) => r.id === params?.relayId) ?? c.overcurrentRelays[0]!;
        const iFault = params?.faultCurrentA ?? targetRelay.pickupA * 5.0;
        return calculateOvercurrentTripTime(targetRelay, iFault);
      },
    },
    {
      id: "lower_oneliner_dae",
      title: "Lower OneLiner Model to DAE Arena",
      description:
        "Compiles sequence networks and relay pickup thresholds into zero-GC linear memory DAEBuilder arena.",
      category: "transform",
      execute: async (ctx, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return { variableCount: 0, equationCount: 0 };
        const c = parseOneLiner(text);
        const dae = lowerOneLinerToDae(c);
        return {
          variableCount: dae.varCount,
          equationCount: dae.eqCount,
        };
      },
    },
    {
      id: "lint_oneliner_case",
      title: "Lint OneLiner Network & Protection Settings",
      description: "Validates terminal bus connectivity, positive sequence reactances, and relay settings.",
      category: "verify",
      execute: async (ctx, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        const c = parseOneLiner(text);
        return lintOneLinerCase(c);
      },
    },
    {
      id: "export_oneliner_dxt",
      title: "Export OneLiner DXT Format",
      description: "Serializes OneLiner network and protection model into standard DXT text format.",
      category: "transform",
      execute: async (ctx, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const c = parseOneLiner(text);
        return writeOneLinerDxt(c);
      },
    },
  ],
  extras: () => [/[ \t\r\n]+/],
  rules: cardDeckRules,
});

export default onelinerLanguage;
