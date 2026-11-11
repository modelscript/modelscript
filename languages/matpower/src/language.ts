// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript MATPOWER Language Definition.
 */

import { language } from "@modelscript/dsl";
import { formatPowerFlowReport, solvePowerFlow } from "@modelscript/psse";
import { lowerMatpowerToDae } from "./dae/matpower-to-dae.js";
import { lintMatpowerCase } from "./lints/index.js";
import { parseMatpowerCase } from "./parser/matpower-parser.js";
import { matpowerToPsseRaw } from "./projections/matpower-to-psse.js";

export const matpowerLanguage = language({
  name: "matpower",
  fileExtensions: [".m", ".matpower"],
  maturity: "beta",
  lsp: {
    fileExtensions: [".m", ".matpower"],
  },
  indexing: {
    canIndex: (uri, text) =>
      uri.toLowerCase().endsWith(".matpower") ||
      Boolean(text && (text.includes("mpc.bus") || text.includes("mpc.gen") || text.includes("mpc.baseMVA"))),
    indexFile(ctx) {
      if (ctx.text.includes("mpc.bus") || ctx.text.includes("mpc.gen") || ctx.text.includes("mpc.baseMVA")) {
        const caseData = parseMatpowerCase(ctx.text);
        ctx.setParsedModel(caseData);

        const rootName = caseData.caseName || "MatpowerCase";
        const rootId = ctx.addSymbol(rootName, "Package", null, 0, ctx.text.length, {
          version: caseData.version,
          baseMVA: caseData.baseMVA,
        });
        for (const b of caseData.bus) {
          const busName = b.name || `Bus_${b.bus_i}`;
          ctx.addSymbol(
            busName,
            "Component",
            rootId,
            0,
            0,
            { bus_i: b.bus_i, type: b.type, baseKv: b.baseKv, vm: b.vm, va: b.va },
            { aliases: [String(b.bus_i), `Bus_${b.bus_i}`] },
          );
        }
        for (let i = 0; i < caseData.gen.length; i++) {
          const g = caseData.gen[i]!;
          ctx.addSymbol(`Gen_${i + 1}_Bus_${g.bus}`, "Component", rootId, 0, 0, {
            bus: g.bus,
            pg: g.pg,
            qg: g.qg,
          });
        }
        for (let i = 0; i < caseData.branch.length; i++) {
          const br = caseData.branch[i]!;
          ctx.addSymbol(`Branch_${br.fbus}_${br.tbus}_${i + 1}`, "Variable", rootId, 0, 0, {
            fbus: br.fbus,
            tbus: br.tbus,
            r: br.r,
            x: br.x,
          });
        }
      }
    },
  },

  actions: [
    {
      id: "solve_matpower_powerflow",
      title: "Solve AC Power Flow (MATPOWER)",
      description: "Solves steady-state AC Newton-Raphson power flow for a MATPOWER .m case file.",
      category: "simulate",
      ui: {
        editorTitle: {
          icon: "$(pulse)",
          group: "navigation@0",
        },
        languageModelTool: {
          name: "matpower_solve_powerflow",
          displayName: "Solve MATPOWER AC Power Flow",
          modelDescription: "Solves AC Newton-Raphson power flow for a MATPOWER .m power grid case.",
        },
      },
      execute: async (ctx, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const mpc = parseMatpowerCase(text);
        const psseCase = matpowerToPsseRaw(mpc);
        const sol = solvePowerFlow(psseCase);
        return {
          ...sol,
          reportText: formatPowerFlowReport(sol, `MATPOWER Case: ${mpc.caseName}`),
        };
      },
    },
    {
      id: "lint_matpower_case",
      title: "Lint MATPOWER Case",
      description: "Checks MATPOWER .m case files for topological, electrical, and data integrity violations.",
      category: "verify",
      execute: async (ctx, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        const mpc = parseMatpowerCase(text);
        return lintMatpowerCase(mpc);
      },
    },
    {
      id: "lower_matpower_dae",
      title: "Lower MATPOWER Case to DAE Arena",
      description: "Compiles MATPOWER nodal AC power flow equations directly into linear memory DAEBuilder arena.",
      category: "transform",
      execute: async (ctx, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return { variableCount: 0, equationCount: 0 };
        const mpc = parseMatpowerCase(text);
        const arena = lowerMatpowerToDae(mpc);
        return {
          variableCount: arena.getVarCount(),
          equationCount: arena.getEqCount(),
        };
      },
    },
  ],
});

export default matpowerLanguage;
