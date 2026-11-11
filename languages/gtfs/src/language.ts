// SPDX-License-Identifier: AGPL-3.0-or-later

import { language, type ActionExecutionContext } from "@modelscript/dsl";
import { lowerGtfsToDae } from "./dae/index.js";
import { lintGtfs } from "./lints/index.js";
import { parseGtfs } from "./parser/index.js";
import { solveDepotCharging, solveTractionProfiles } from "./solver/index.js";

export const gtfsLanguage = language({
  name: "gtfs",
  fileExtensions: [".gtfs", ".gtfs.txt", ".gtfs-rt"],
  maturity: "experimental",
  lsp: {
    fileExtensions: [".gtfs", ".gtfs.txt", ".gtfs-rt"],
  },
  indexing: {
    canIndex: (uri, text) =>
      uri.toLowerCase().endsWith(".gtfs") ||
      uri.toLowerCase().endsWith(".gtfs.txt") ||
      uri.toLowerCase().endsWith(".gtfs-rt") ||
      Boolean(text && (text.includes("# STOPS") || text.includes("# ROUTES") || text.includes("stop_id,"))),
    indexFile(ctx) {
      try {
        const feed = parseGtfs(ctx.text);
        ctx.setParsedModel(feed);

        const rootName = feed.routes[0]?.route_short_name
          ? `Transit_Route_${feed.routes[0].route_short_name}`
          : "GTFS_Feed";
        const rootId = ctx.addSymbol(rootName, "package", null, 0, ctx.text.length, undefined, {
          ruleName: "gtfs_symbol",
        });

        for (const r of feed.routes) {
          ctx.addSymbol(
            r.route_short_name || r.route_id,
            "class",
            rootId,
            0,
            50,
            {
              route_id: r.route_id,
              long_name: r.route_long_name,
              type: r.route_type,
            },
            { ruleName: "gtfs_symbol" },
          );
        }

        for (const s of feed.stops) {
          ctx.addSymbol(
            s.stop_name || s.stop_id,
            "variable",
            rootId,
            0,
            50,
            {
              stop_id: s.stop_id,
              lat: s.stop_lat,
              lon: s.stop_lon,
            },
            { ruleName: "gtfs_symbol" },
          );
        }

        for (const t of feed.trips) {
          ctx.addSymbol(
            t.trip_id,
            "function",
            rootId,
            0,
            50,
            {
              route_id: t.route_id,
              service_id: t.service_id,
            },
            { ruleName: "gtfs_symbol" },
          );
        }
      } catch {
        // Ignore malformed feed during background indexing
      }
    },
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
