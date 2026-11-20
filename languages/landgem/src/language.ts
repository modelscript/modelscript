// SPDX-License-Identifier: AGPL-3.0-or-later

import { iniSectionRules, language, type ActionExecutionContext } from "@modelscript/dsl";
import { lowerLandgemToDae } from "./dae/index.js";
import { lintLandgem } from "./lints/index.js";
import { parseLandgem } from "./parser/index.js";
import { solveBiogas } from "./solver/index.js";
import { landgemPolyglotConfig } from "./tgg/index.js";

export const landgemLanguage = language({
  polyglot: landgemPolyglotConfig,
  name: "landgem",
  fileExtensions: [".landgem", ".lfg", ".biogas"],
  maturity: "experimental",
  lsp: {
    fileExtensions: [".landgem", ".lfg", ".biogas"],
  },
  indexing: {
    indexFile(ctx) {
      try {
        const model = parseLandgem(ctx.text);
        ctx.setParsedModel(model);

        const rootName = model.sites[0]?.name ?? model.digesters[0]?.name ?? "Biogas_Model";
        const rootId = ctx.addSymbol(rootName, "package", null, 0, ctx.text.length, undefined, {
          ruleName: "landgem_symbol",
        });

        for (const site of model.sites) {
          const sId = ctx.addSymbol(
            site.name,
            "class",
            rootId,
            0,
            50,
            {
              openYear: site.openYear,
              closeYear: site.closeYear,
              k: site.params.k,
              l0: site.params.l0,
            },
            { ruleName: "landgem_symbol" },
          );
          for (const c of site.cohorts) {
            ctx.addSymbol(
              `Cohort_${c.year}`,
              "variable",
              sId,
              0,
              30,
              { year: c.year, massMg: c.massMg },
              { ruleName: "landgem_symbol" },
            );
          }
        }

        for (const d of model.digesters) {
          ctx.addSymbol(
            d.name,
            "class",
            rootId,
            0,
            50,
            {
              volumeM3: d.volumeM3,
              temperatureC: d.temperatureC,
              hrtDays: d.hrtDays,
              ph: d.ph,
            },
            { ruleName: "landgem_symbol" },
          );
        }
      } catch {
        // Ignore malformed input during background indexing
      }
    },
  },
  ui: {
    toolbarButtons: [
      {
        id: "landgemSolveEmissions",
        label: "Solve Methane & Biogas Generation",
        shortLabel: "Solve Methane",
        tooltip: "Solve Methane & Biogas Generation",
        icon: "graph",
        views: ["code", "inspector"],
        targets: ["morsel"],
        placement: "primary",
        order: 10,
        actionId: "landgem_solve_emissions",
      },
      {
        id: "landgemToDae",
        label: "Lower LandGEM to DAEBuilder",
        shortLabel: "Lower LandGEM",
        tooltip: "Lower LandGEM to DAEBuilder",
        icon: "stack",
        views: ["code", "inspector"],
        targets: ["morsel"],
        placement: "overflow",
        order: 20,
        actionId: "landgem_to_dae",
      },
      {
        id: "landgemLint",
        label: "Lint LandGEM / Biogas Deck",
        shortLabel: "Lint LandGEM",
        tooltip: "Lint LandGEM / Biogas Deck",
        icon: "shield-check",
        views: ["*"],
        targets: ["morsel"],
        placement: "overflow",
        order: 30,
        actionId: "landgem_lint",
      },
    ],
  },
  actions: [
    {
      id: "landgem_lint",
      title: "Lint LandGEM / Biogas Deck",
      description: "Validates kinetic rate constants, waste acceptance years, and digester pH.",
      category: "query",
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        return lintLandgem(parseLandgem(text));
      },
    },
    {
      id: "landgem_solve_emissions",
      title: "Solve Methane & Biogas Generation",
      description: "Computes first-order decay methane generation curves and digester CHP outputs.",
      category: "simulate",
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        return solveBiogas(parseLandgem(text));
      },
    },
    {
      id: "landgem_to_dae",
      title: "Lower LandGEM to DAEBuilder",
      description: "Lowers methane generation and digester state equations to DAE arena.",
      category: "transform",
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const model = parseLandgem(text);
        const dae = lowerLandgemToDae(model);
        return {
          variables: dae.variables().length,
          equations: dae.equations().length,
        };
      },
    },
  ],
  extras: ($) => [/[ \t\r\n]+/, $["IniComment"]!],
  rules: iniSectionRules,
});

export default landgemLanguage;
