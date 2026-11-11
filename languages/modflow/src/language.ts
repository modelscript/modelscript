// SPDX-License-Identifier: AGPL-3.0-or-later

import { language, type ActionExecutionContext } from "@modelscript/dsl";
import { lowerModflowToDae } from "./dae/index.js";
import { lintModflow } from "./lints/index.js";
import { parseModflow } from "./parser/index.js";
import { solveAquiferBalance } from "./solver/index.js";

export const modflowLanguage = language({
  name: "modflow",
  fileExtensions: [".dis", ".dis6", ".npf", ".npf6", ".wel", ".wel6", ".riv", ".riv6", ".chd", ".chd6", ".nam"],
  maturity: "experimental",
  lsp: {
    fileExtensions: [".dis", ".dis6", ".npf", ".npf6", ".wel", ".wel6", ".riv", ".riv6", ".chd", ".chd6", ".nam"],
  },
  indexing: {
    indexFile(ctx) {
      try {
        const model = parseModflow(ctx.text);
        ctx.setParsedModel(model);

        const rootName = model.name || "MODFLOW_Aquifer";
        const rootId = ctx.addSymbol(rootName, "package", null, 0, ctx.text.length, undefined, {
          ruleName: "modflow_symbol",
        });

        ctx.addSymbol(
          `DIS_${model.dis.nlay}x${model.dis.nrow}x${model.dis.ncol}`,
          "class",
          rootId,
          0,
          50,
          { nlay: model.dis.nlay, nrow: model.dis.nrow, ncol: model.dis.ncol },
          { ruleName: "modflow_symbol" },
        );

        ctx.addSymbol(
          `NPF_K${model.npf.k}`,
          "property",
          rootId,
          0,
          50,
          { k: model.npf.k, k33: model.npf.k33, ss: model.npf.ss, sy: model.npf.sy },
          { ruleName: "modflow_symbol" },
        );

        for (let i = 0; i < model.wells.length; i++) {
          const w = model.wells[i]!;
          const name = w.name ?? `WELL_${w.cell.layer}_${w.cell.row}_${w.cell.col}`;
          ctx.addSymbol(
            name,
            "variable",
            rootId,
            0,
            50,
            {
              layer: w.cell.layer,
              row: w.cell.row,
              col: w.cell.col,
              q: w.q,
            },
            { ruleName: "modflow_symbol" },
          );
        }

        for (let i = 0; i < model.rivers.length; i++) {
          const r = model.rivers[i]!;
          const name = `RIV_${r.cell.layer}_${r.cell.row}_${r.cell.col}`;
          ctx.addSymbol(
            name,
            "variable",
            rootId,
            0,
            50,
            {
              layer: r.cell.layer,
              row: r.cell.row,
              col: r.cell.col,
              stage: r.stage,
              cond: r.cond,
            },
            { ruleName: "modflow_symbol" },
          );
        }

        for (let i = 0; i < model.chds.length; i++) {
          const chd = model.chds[i]!;
          const name = `CHD_${chd.cell.layer}_${chd.cell.row}_${chd.cell.col}`;
          ctx.addSymbol(
            name,
            "variable",
            rootId,
            0,
            50,
            {
              layer: chd.cell.layer,
              row: chd.cell.row,
              col: chd.cell.col,
              head: chd.head,
            },
            { ruleName: "modflow_symbol" },
          );
        }
      } catch {
        // Ignore malformed input during background indexing
      }
    },
  },
  actions: [
    {
      id: "modflow_lint",
      title: "Lint MODFLOW Model",
      description: "Validates grid cell bounds, conductivity values, and boundary elevations.",
      category: "query",
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        return lintModflow(parseModflow(text));
      },
    },
    {
      id: "modflow_solve_balance",
      title: "Solve Aquifer Balance",
      description: "Computes cell conductances, boundary water fluxes, and mass balances.",
      category: "simulate",
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        return solveAquiferBalance(parseModflow(text));
      },
    },
    {
      id: "modflow_to_dae",
      title: "Lower MODFLOW to DAEBuilder",
      description: "Lowers aquifer grid cells and Darcy continuity equations to DAE arena.",
      category: "transform",
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const model = parseModflow(text);
        const dae = lowerModflowToDae(model);
        return {
          name: model.name,
          variables: dae.variables().length,
          equations: dae.equations().length,
        };
      },
    },
  ],
});
