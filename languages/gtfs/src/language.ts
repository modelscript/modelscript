// SPDX-License-Identifier: AGPL-3.0-or-later

import { language, type ActionExecutionContext } from "@modelscript/dsl";
import { lowerGtfsToDae } from "./dae/index.js";
import { lintGtfs } from "./lints/index.js";
import { parseGtfs } from "./parser/index.js";
import { solveTractionProfiles, solveDepotCharging } from "./solver/index.js";

export const gtfsLanguage = language({
  name: "gtfs",
  fileExtensions: [".gtfs", ".gtfs.txt", ".gtfs-rt"],
  maturity: "experimental",
  lsp: {
    fileExtensions: [".gtfs", ".gtfs.txt", ".gtfs-rt"],
  },
  actions: [
    {
      id: "gtfs_lint",
      title: "Lint GTFS Transit Feed",
      description: "Validates route/stop references, chronology, and bus battery depletion limits.",
      category: "query",
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        return lintGtfs(parseGtfs(text));
      },
    },
    {
      id: "gtfs_solve_traction",
      title: "Solve e-Bus Traction & Depot Charging",
      description: "Computes kinematic vehicle traction, battery SOC curves, and aggregated depot charging load.",
      category: "simulate",
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const feed = parseGtfs(text);
        const profiles = solveTractionProfiles(feed);
        const depot = solveDepotCharging(feed);
        return {
          trips: profiles,
          depot,
        };
      },
    },
    {
      id: "gtfs_to_dae",
      title: "Lower GTFS to DAEBuilder",
      description: "Lowers transit vehicle state variables and depot power equations to DAE arena.",
      category: "transform",
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const feed = parseGtfs(text);
        const dae = lowerGtfsToDae(feed);
        return {
          variables: dae.variables().length,
          equations: dae.equations().length,
        };
      },
    },
  ],
});
