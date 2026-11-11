// SPDX-License-Identifier: AGPL-3.0-or-later

import { language, type ActionExecutionContext } from "@modelscript/dsl";
import { lowerNmtranToDae } from "./dae/nmtran-to-dae.js";
import { nmtranGrammar } from "./grammar/nmtran-grammar.js";
import { lintNmtran } from "./lints/index.js";
import { parseNmtran } from "./parser/nmtran-parser.js";
import { nmtranToModelica } from "./projections/nmtran-to-modelica.js";
import { solveNmtranPkPd, type PkPdSolverOptions } from "./solvers/pkpd-solver.js";

/**
 * ModelScript NONMEM / NMTRAN Pharmacometrics (.ctl, .mod) Language Definition.
 */
export const nmtranLanguage = language({
  name: "nmtran",
  fileExtensions: [".ctl", ".mod"],
  maturity: "beta",
  word: nmtranGrammar.word,
  extras: nmtranGrammar.extras,
  conflicts: nmtranGrammar.conflicts,
  rules: nmtranGrammar.rules,
  lsp: {
    fileExtensions: [".ctl", ".mod"],
    folding: nmtranGrammar.lsp?.folding,
    outline: nmtranGrammar.lsp?.outline,
    icons: {
      light: "./assets/nmtran/icon-light.png",
      dark: "./assets/nmtran/icon-dark.png",
    },
  },
  indexing: {
    canIndex: (uri, text) =>
      uri.toLowerCase().endsWith(".ctl") ||
      Boolean(
        text &&
        (text.includes("$PROBLEM") ||
          text.includes("$PROB") ||
          text.includes("$THETA") ||
          text.includes("$PK") ||
          text.includes("$PRED") ||
          text.includes("$DES")),
      ),
    indexFile(ctx) {
      try {
        const doc = parseNmtran(ctx.text, ctx.uri);
        ctx.setParsedModel(doc);
        const cs = doc.controlStream;

        const rootId = ctx.addSymbol(
          cs.problem || "NmtranControlStream",
          "package",
          null,
          0,
          ctx.text.length,
          {
            advan: cs.subroutines.advan,
            trans: cs.subroutines.trans,
            thetaCount: cs.thetas.length,
            omegaCount: cs.omegas.length,
            compartmentCount: cs.compartments.length,
            doc,
            rawSource: ctx.text,
          },
          { ruleName: "nmtran_model" },
        );

        for (const c of cs.compartments) {
          const start = c.range?.startOffset ?? 0;
          const end = c.range?.endOffset ?? 50;
          ctx.addSymbol(
            c.name,
            "struct",
            rootId,
            start,
            end,
            {
              index: c.index,
              defDose: c.defDose,
              defObs: c.defObs,
            },
            { ruleName: "nmtran_symbol" },
          );
        }

        for (const st of cs.pkStatements) {
          const start = st.range?.startOffset ?? 0;
          const end = st.range?.endOffset ?? 50;
          ctx.addSymbol(
            st.lhs,
            "variable",
            rootId,
            start,
            end,
            {
              rhs: st.rhs,
              thetaRefs: st.thetaRefs,
              etaRefs: st.etaRefs,
            },
            { ruleName: "nmtran_symbol" },
          );
        }

        for (const th of cs.thetas) {
          const start = th.range?.startOffset ?? 0;
          const end = th.range?.endOffset ?? 50;
          ctx.addSymbol(
            `THETA(${th.index})`,
            "constant",
            rootId,
            start,
            end,
            {
              index: th.index,
              name: th.name,
              lower: th.lower,
              init: th.init,
              upper: th.upper,
              fixed: th.fixed,
            },
            { ruleName: "nmtran_symbol" },
          );
          if (th.name) {
            ctx.addSymbol(
              th.name,
              "constant",
              rootId,
              start,
              end,
              {
                thetaIndex: th.index,
                init: th.init,
              },
              { ruleName: "nmtran_symbol" },
            );
          }
        }

        for (const om of cs.omegas) {
          const start = om.range?.startOffset ?? 0;
          const end = om.range?.endOffset ?? 50;
          ctx.addSymbol(
            `ETA(${om.index})`,
            "constant",
            rootId,
            start,
            end,
            {
              index: om.index,
              variance: om.variance,
              fixed: om.fixed,
            },
            { ruleName: "nmtran_symbol" },
          );
        }

        for (const eq of cs.desEquations) {
          const start = eq.range?.startOffset ?? 0;
          const end = eq.range?.endOffset ?? 50;
          ctx.addSymbol(
            eq.lhs,
            "function",
            rootId,
            start,
            end,
            {
              rhs: eq.rhs,
              compartmentIndex: eq.compartmentIndex,
              isDerivative: eq.isDerivative,
            },
            { ruleName: "nmtran_symbol" },
          );
        }
      } catch {
        // Return partial symbol map if parsing failed
      }
    },
  },

  writeback: {
    operators: ["="],
  },

  actions: [
    {
      id: "lint_nmtran",
      title: "Lint NMTRAN Control Stream",
      description: "Validates $PROBLEM, $THETA bounds, $OMEGA variances, $DES compartments, and $PK TRANS parameters.",
      category: "query",
      ui: {
        editorTitle: {
          icon: "$(check)",
          group: "navigation@0",
        },
        explorerContextMenu: {
          group: "modelscript_run@0",
        },
        languageModelTool: {
          name: "nmtran_lint",
          displayName: "Lint NMTRAN Control Stream",
          modelDescription:
            "Lints NONMEM / NMTRAN control stream for bounds violations, missing $DES/$ERROR blocks, and undefined THETA/ETA references.",
        },
      },
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        const parsed = parseNmtran(text);
        return lintNmtran(parsed);
      },
    },
    {
      id: "nmtran_simulate",
      title: "Simulate PK/PD Control Stream",
      description:
        "Simulates compartmental and custom $DES PK/PD trajectories across bolus, infusion, and multi-dose regimens.",
      category: "simulate",
      execute: async (
        ctx: ActionExecutionContext,
        params: { documentText?: string | undefined; options?: PkPdSolverOptions | undefined },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const doc = parseNmtran(text);
        return solveNmtranPkPd(doc, params?.options);
      },
    },
    {
      id: "nmtran_to_dae",
      title: "Lower NMTRAN to DAE",
      description: "Compiles $THETA parameters, $PK equations, and compartment ODEs into DAEBuilder.",
      category: "transform",
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const parsed = parseNmtran(text);
        const dae = lowerNmtranToDae(parsed);
        return {
          modelName: parsed.controlStream.problem || "NmtranPkPdModel",
          variableCount: dae.variables().length,
          equationCount: dae.equations().length,
        };
      },
    },
    {
      id: "nmtran_to_modelica",
      title: "Project NMTRAN to Modelica",
      description: "Synthesizes standalone Modelica 3.x pharmacokinetic and pharmacodynamic compartment equations.",
      category: "export",
      execute: async (
        ctx: ActionExecutionContext,
        params: { documentText?: string | undefined; modelName?: string | undefined },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return "";
        const parsed = parseNmtran(text);
        return nmtranToModelica(parsed, params?.modelName);
      },
    },
  ],
});
