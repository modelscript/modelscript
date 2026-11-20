// SPDX-License-Identifier: AGPL-3.0-or-later

import { language, type ActionExecutionContext } from "@modelscript/dsl";
import { lowerOcppToDae } from "./dae/ocpp-to-dae.js";
import { indexOcppFile } from "./indexing.js";
import { lintOcpp } from "./lints/rules.js";
import { parseOcpp } from "./parser/ocpp-parser.js";
import { scheduleSmartCharging } from "./solver/charging-scheduler.js";
import { ocppPolyglotConfig } from "./tgg/index.js";

export const ocppLanguage = language({
  polyglot: ocppPolyglotConfig,
  name: "ocpp",
  fileExtensions: [".ocpp", ".ocpp.json", ".cpo", ".json"],
  maturity: "experimental",
  indexing: {
    indexFile: indexOcppFile,
    canIndex: (uri, text) => {
      const lower = uri.toLowerCase();
      if (lower.endsWith(".ocpp") || lower.endsWith(".ocpp.json") || lower.endsWith(".cpo")) return true;
      return Boolean(
        text &&
        (text.includes("chargingStationId") ||
          text.includes("chargingProfile") ||
          text.includes("gridLimitKW") ||
          text.includes("evse ")),
      );
    },
  },
  lsp: {
    fileExtensions: [".ocpp", ".ocpp.json", ".cpo"],
  },
  rules: {
    Root: () => "ocpp",
  },

  ui: {
    toolbarButtons: [
      {
        id: "ocppSchedule",
        label: "Schedule Smart Charging Loads",
        shortLabel: "Schedule Smart",
        tooltip: "Schedule Smart Charging Loads",
        icon: "sliders",
        views: ["code", "inspector"],
        targets: ["morsel"],
        placement: "primary",
        order: 10,
        actionId: "ocpp_schedule",
      },
      {
        id: "ocppToDae",
        label: "Lower OCPP to DAE Arena",
        shortLabel: "Lower OCPP",
        tooltip: "Lower OCPP to DAE Arena",
        icon: "stack",
        views: ["code", "inspector"],
        targets: ["morsel"],
        placement: "overflow",
        order: 20,
        actionId: "ocpp_to_dae",
      },
      {
        id: "ocppLint",
        label: "Lint OCPP EV Charging Network",
        shortLabel: "Lint OCPP",
        tooltip: "Lint OCPP EV Charging Network",
        icon: "shield-check",
        views: ["*"],
        targets: ["morsel"],
        placement: "overflow",
        order: 30,
        actionId: "ocpp_lint",
      },
    ],
  },
  actions: [
    {
      id: "ocpp_lint",
      title: "Lint OCPP EV Charging Network",
      description: "Checks transformer grid limits, connector ratings, SoC ranges, and deadline feasibility.",
      category: "verify",
      execute: async (context: ActionExecutionContext) => {
        const text = context.documentText || "";
        const net = parseOcpp(text);
        return lintOcpp(net);
      },
    },
    {
      id: "ocpp_schedule",
      title: "Schedule Smart Charging Loads",
      description: "Optimizes power allocation among active EV sessions within upstream grid constraints.",
      category: "simulate",
      execute: async (context: ActionExecutionContext) => {
        const text = context.documentText || "";
        const net = parseOcpp(text);
        return scheduleSmartCharging(net);
      },
    },
    {
      id: "ocpp_to_dae",
      title: "Lower OCPP to DAE Arena",
      description:
        "Compiles EV charger active/reactive power and battery energy dynamics into ModelScript linear memory.",
      category: "transform",
      execute: async (context: ActionExecutionContext) => {
        const text = context.documentText || "";
        const net = parseOcpp(text);
        const arena = lowerOcppToDae(net);
        return {
          variableCount: arena.getVarCount(),
          equationCount: arena.getEqCount(),
        };
      },
    },
  ],
});
