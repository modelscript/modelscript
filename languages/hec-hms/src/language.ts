// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript USACE HEC-HMS Language Definition.
 */

import { language } from "@modelscript/dsl";
import { lowerHmsToDae } from "./dae/hec-hms-to-dae.js";
import { simulateSubbasinRunoff } from "./hydrology/scs-cn.js";
import { lintHmsBasin } from "./lints/index.js";
import { parseHmsBasin } from "./parser/hms-parser.js";
import { hmsHydrographToHecRasU01 } from "./projections/hms-to-hecras.js";
import type { HmsHydrographPoint } from "./types.js";

export const hecHmsLanguage = language({
  name: "hec-hms",
  fileExtensions: [".basin", ".hms", ".met", ".control"],
  maturity: "beta",
  lsp: {
    fileExtensions: [".basin", ".hms", ".met", ".control"],
  },
  indexing: {
    indexFile(ctx) {
      if (ctx.text.includes("Basin:") || ctx.text.includes("Subbasin:") || ctx.text.includes("Reach:")) {
        const basin = parseHmsBasin(ctx.text);
        ctx.setParsedModel(basin);

        const rootId = ctx.addSymbol(basin.name || "Basin", "Package", null, 0, ctx.text.length, {
          unitSystem: basin.unitSystem,
        });
        for (const [name, sb] of basin.subbasins) {
          ctx.addSymbol(name, "Component", rootId, 0, 0, {
            elementKind: "subbasin",
            area: sb.area,
            downstream: sb.downstream,
          });
        }
        for (const [name, reach] of basin.reaches) {
          ctx.addSymbol(name, "Component", rootId, 0, 0, {
            elementKind: "reach",
            downstream: reach.downstream,
          });
        }
        for (const [name, junc] of basin.junctions) {
          ctx.addSymbol(name, "Component", rootId, 0, 0, {
            elementKind: "junction",
            downstream: junc.downstream,
          });
        }
        for (const [name, res] of basin.reservoirs) {
          ctx.addSymbol(name, "Component", rootId, 0, 0, {
            elementKind: "reservoir",
            downstream: res.downstream,
          });
        }
        for (const [name] of basin.sinks) {
          ctx.addSymbol(name, "Component", rootId, 0, 0, {
            elementKind: "sink",
          });
        }
      }
    },
  },

  actions: [
    {
      id: "simulate_hms_runoff",
      title: "Simulate Watershed Rainfall-Runoff (HEC-HMS)",
      description: "Computes subbasin SCS Curve Number runoff and Unit Hydrograph convolution.",
      category: "simulate",
      ui: {
        editorTitle: {
          icon: "$(pulse)",
          group: "navigation@0",
        },
        languageModelTool: {
          name: "hms_simulate_runoff",
          displayName: "Simulate HEC-HMS Watershed Runoff",
          modelDescription: "Runs SCS Curve Number hydrology simulation for a HEC-HMS .basin model.",
        },
      },
      execute: async (ctx, params?: { documentText?: string | undefined; precipitationMm?: number }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const basin = parseHmsBasin(text);
        const pTotal = params?.precipitationMm ?? 75.0; // Default 75 mm rain

        const subbasinHydrographs = new Map<string, HmsHydrographPoint[]>();
        let peakFlow = 0.0;
        let timeToPeak = 0.0;

        for (const [name, sb] of basin.subbasins) {
          const hg = simulateSubbasinRunoff(sb, {
            precipitationTotal: pTotal,
            durationHours: 24.0,
            timeStepHours: 0.25,
            unitSystem: basin.unitSystem,
          });
          subbasinHydrographs.set(name, hg);
          for (const pt of hg) {
            if (pt.flow > peakFlow) {
              peakFlow = pt.flow;
              timeToPeak = pt.timeHours;
            }
          }
        }

        return {
          basinName: basin.name,
          subbasinCount: basin.subbasins.size,
          peakDischarge: peakFlow,
          timeToPeakHours: timeToPeak,
        };
      },
    },
    {
      id: "export_hms_to_hecras",
      title: "Export Hydrograph to HEC-RAS (.u01)",
      description: "Exports computed watershed runoff hydrograph as a HEC-RAS unsteady boundary flow deck.",
      category: "transform",
      execute: async (ctx, params?: { documentText?: string | undefined; precipitationMm?: number }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return "";
        const basin = parseHmsBasin(text);
        const pTotal = params?.precipitationMm ?? 75.0;

        let compositeHg: HmsHydrographPoint[] = [];
        for (const sb of basin.subbasins.values()) {
          const hg = simulateSubbasinRunoff(sb, {
            precipitationTotal: pTotal,
            durationHours: 24.0,
            timeStepHours: 0.25,
            unitSystem: basin.unitSystem,
          });
          if (compositeHg.length === 0) {
            compositeHg = hg.map((p) => ({ ...p }));
          } else {
            for (let i = 0; i < compositeHg.length && i < hg.length; i++) {
              compositeHg[i]!.flow += hg[i]!.flow;
            }
          }
        }

        return hmsHydrographToHecRasU01(compositeHg, {
          riverName: "MainRiver",
          reachName: "Reach1",
          station: 1000,
          flowTitle: `HMS Inflow from ${basin.name}`,
        });
      },
    },
    {
      id: "lint_hms_basin",
      title: "Lint HEC-HMS Basin Deck",
      description: "Validates HEC-HMS .basin model for topological, hydrologic, and numerical consistency.",
      category: "verify",
      execute: async (ctx, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        const basin = parseHmsBasin(text);
        return lintHmsBasin(basin);
      },
    },
    {
      id: "lower_hms_dae",
      title: "Lower HEC-HMS to DAE Arena",
      description:
        "Compiles watershed reservoir and reach storage continuity directly into linear memory DAEBuilder arena.",
      category: "transform",
      execute: async (ctx, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return { variableCount: 0, equationCount: 0 };
        const basin = parseHmsBasin(text);
        const arena = lowerHmsToDae(basin);
        return {
          variableCount: arena.getVarCount(),
          equationCount: arena.getEqCount(),
        };
      },
    },
  ],
});

export default hecHmsLanguage;
