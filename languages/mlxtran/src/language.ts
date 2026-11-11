// SPDX-License-Identifier: AGPL-3.0-or-later

import { language, type ActionExecutionContext } from "@modelscript/dsl";
import { lowerMlxtranToDae } from "./dae/mlxtran-to-dae.js";
import { mlxtranGrammar } from "./grammar/mlxtran-grammar.js";
import { lintMlxtran } from "./lints/mlxtran-linter.js";
import { parseMlxtran } from "./parser/mlxtran-parser.js";
import { mlxtranToModelica } from "./projections/mlxtran-to-modelica.js";
import { solveMlxtranPk } from "./solvers/mlxtran-solver.js";
import type { MlxtranSimOptions } from "./types.js";

/**
 * ModelScript Monolix MLXTRAN Pharmacometrics (.mlxtran) Language Definition.
 */
export const mlxtranLanguage = language({
  name: "mlxtran",
  fileExtensions: [".mlxtran"],
  maturity: "beta",
  word: mlxtranGrammar.word,
  extras: mlxtranGrammar.extras,
  conflicts: mlxtranGrammar.conflicts,
  rules: mlxtranGrammar.rules,
  lsp: {
    fileExtensions: [".mlxtran"],
    folding: mlxtranGrammar.lsp?.folding,
    outline: mlxtranGrammar.lsp?.outline,
  },
  indexing: {
    canIndex: (uri, text) =>
      uri.toLowerCase().endsWith(".mlxtran") ||
      Boolean(
        text &&
        (text.includes("[LONGITUDINAL]") ||
          text.includes("EQUATION:") ||
          text.includes("input =") ||
          text.includes("ddt_")),
      ),
    indexFile(ctx) {
      try {
        const doc = parseMlxtran(ctx.text);
        ctx.setParsedModel(doc);
        const m = doc.model;

        const rootId = ctx.addSymbol(
          m.name || "MlxtranModel",
          "package",
          null,
          0,
          ctx.text.length,
          {
            inputCount: m.inputs.length,
            equationCount: m.equations.length,
            macroCount: m.macros.length,
            outputCount: m.outputs.length,
            doc,
            rawSource: ctx.text,
          },
          { ruleName: "mlxtran_model" },
        );

        for (const inp of m.inputs) {
          const start = inp.range?.startOffset ?? 0;
          const end = inp.range?.endOffset ?? 50;
          ctx.addSymbol(inp.name, "parameter", rootId, start, end, {
            type: inp.type ?? "real",
            init: inp.init ?? 1.0,
          });
        }

        for (const eq of m.equations) {
          const start = eq.range?.startOffset ?? 0;
          const end = eq.range?.endOffset ?? 50;
          ctx.addSymbol(eq.lhs, eq.isDerivative ? "variable" : "equation", rootId, start, end, {
            rhs: eq.rhs,
            isDerivative: eq.isDerivative,
          });
        }
      } catch {
        // Tolerant indexing
      }
    },
  },
  actions: [
    {
      id: "lint_mlxtran",
      title: "Lint MLXTRAN Model",
      description: "Performs pre-flight pharmacometric static checks against MLXTRAN control streams.",
      category: "query",
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        const doc = parseMlxtran(text);
        return lintMlxtran(doc);
      },
    },
    {
      id: "mlxtran_simulate",
      title: "Simulate MLXTRAN Pharmacokinetics",
      description:
        "Runs deterministic multi-compartment PK integration with non-compartmental AUC, Cmax, and t1/2 metrics.",
      category: "simulate",
      execute: async (
        ctx: ActionExecutionContext,
        params: { documentText?: string | undefined; options?: MlxtranSimOptions | undefined },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const doc = parseMlxtran(text);
        return solveMlxtranPk(doc, params?.options);
      },
    },
    {
      id: "mlxtran_to_dae",
      title: "Lower MLXTRAN to DAEBuilder",
      description: "Compiles MLXTRAN parameters and ODEs directly into ModelScript's zero-GC DAEBuilder arena.",
      category: "transform",
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const doc = parseMlxtran(text);
        const dae = lowerMlxtranToDae(doc);
        return {
          modelName: dae.name,
          variableCount: dae.varCount,
          equationCount: dae.eqCount,
          isSquare: dae.varCount === dae.eqCount,
        };
      },
    },
    {
      id: "mlxtran_to_modelica",
      title: "Project MLXTRAN to Modelica 3.x",
      description: "Generates equivalent equation-oriented Modelica 3.x PK/PD model.",
      category: "export",
      execute: async (
        ctx: ActionExecutionContext,
        params: { documentText?: string | undefined; modelName?: string | undefined },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return "";
        const doc = parseMlxtran(text);
        return mlxtranToModelica(doc, params?.modelName);
      },
    },
  ],
});
