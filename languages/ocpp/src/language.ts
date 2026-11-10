// SPDX-License-Identifier: AGPL-3.0-or-later

import { language, type ActionExecutionContext } from "@modelscript/dsl";
import { lowerOcppToDae } from "./dae/ocpp-to-dae.js";
import { lintOcpp } from "./lints/rules.js";
import { parseOcpp } from "./parser/ocpp-parser.js";
import { scheduleSmartCharging } from "./solver/charging-scheduler.js";

export const ocppLanguage = language({
  name: "ocpp",
  fileExtensions: [".ocpp", ".ocpp.json", ".cpo"],
  maturity: "experimental",
  lsp: {
    fileExtensions: [".ocpp", ".ocpp.json", ".cpo"],
  },
  rules: {
    Root: () => "ocpp",
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
      description: "Compiles EV charger active/reactive power and battery energy dynamics into ModelScript linear memory.",
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
