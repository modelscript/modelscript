// SPDX-License-Identifier: AGPL-3.0-or-later

import { language, type ActionExecutionContext } from "@modelscript/dsl";
import { lowerNmodlToDae } from "./dae/nmodl-to-dae.js";
import { nmodlGrammar } from "./grammar/nmodl-grammar.js";
import { lintNmodl } from "./lints/nmodl-linter.js";
import { parseNmodl } from "./parser/nmodl-parser.js";
import { nmodlToModelica } from "./projections/nmodl-to-modelica.js";
import { solveNmodlActionPotential } from "./solvers/nmodl-solver.js";
import type { NmodlSimOptions } from "./types.js";

/**
 * ModelScript NEURON NMODL (.mod) Language Definition.
 */
export const nmodlLanguage = language({
  name: "nmodl",
  fileExtensions: [".mod"],
  maturity: "beta",
  word: nmodlGrammar.word,
  extras: nmodlGrammar.extras,
  conflicts: nmodlGrammar.conflicts,
  rules: nmodlGrammar.rules,
  lsp: {
    fileExtensions: [".mod"],
    folding: nmodlGrammar.lsp?.folding,
    outline: nmodlGrammar.lsp?.outline,
  },
  indexing: {
    canIndex: (uri, text) =>
      uri.toLowerCase().endsWith(".mod") ||
      Boolean(
        text &&
        (text.includes("NEURON") || text.includes("BREAKPOINT") || text.includes("SUFFIX") || text.includes("USEION")),
      ),
    indexFile(ctx) {
      try {
        const doc = parseNmodl(ctx.text);
        ctx.setParsedModel(doc);
        const m = doc.model;

        const rootId = ctx.addSymbol(
          m.suffix || "NmodlMechanism",
          "package",
          null,
          0,
          ctx.text.length,
          {
            title: m.title,
            parameterCount: m.parameters.length,
            stateCount: m.states.length,
            ionCount: m.ions.length,
            doc,
            rawSource: ctx.text,
          },
          { ruleName: "nmodl_channel" },
        );

        for (const p of m.parameters) {
          const start = p.range?.startOffset ?? 0;
          const end = p.range?.endOffset ?? 50;
          ctx.addSymbol(p.name, "parameter", rootId, start, end, {
            val: p.val,
            units: p.units,
          });
        }

        for (const s of m.states) {
          const start = s.range?.startOffset ?? 0;
          const end = s.range?.endOffset ?? 50;
          ctx.addSymbol(s.name, "variable", rootId, start, end, {
            isState: true,
          });
        }

        for (const ion of m.ions) {
          const start = ion.range?.startOffset ?? 0;
          const end = ion.range?.endOffset ?? 50;
          ctx.addSymbol(`USEION_${ion.ion}`, "interface", rootId, start, end, {
            reads: ion.read,
            writes: ion.write,
          });
        }
      } catch {
        // Tolerant indexing
      }
    },
  },
  actions: [
    {
      id: "lint_nmodl",
      title: "Lint NMODL Mechanism",
      description: "Performs pre-flight biophysical static checks against NMODL channel descriptions.",
      category: "query",
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        const doc = parseNmodl(text);
        return lintNmodl(doc);
      },
    },
    {
      id: "nmodl_simulate",
      title: "Simulate Action Potential Dynamics",
      description:
        "Runs deterministic current-clamp action potential integration with spike counting and threshold metrics.",
      category: "simulate",
      execute: async (
        ctx: ActionExecutionContext,
        params: { documentText?: string | undefined; options?: NmodlSimOptions | undefined },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const doc = parseNmodl(text);
        return solveNmodlActionPotential(doc, params?.options);
      },
    },
    {
      id: "nmodl_to_dae",
      title: "Lower NMODL to DAEBuilder",
      description:
        "Compiles NMODL parameters, gating ODEs, and ionic currents directly into ModelScript's zero-GC DAEBuilder arena.",
      category: "transform",
      execute: async (ctx: ActionExecutionContext, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const doc = parseNmodl(text);
        const dae = lowerNmodlToDae(doc);
        return {
          modelName: dae.name,
          variableCount: dae.varCount,
          equationCount: dae.eqCount,
          isSquare: dae.varCount === dae.eqCount,
        };
      },
    },
    {
      id: "nmodl_to_modelica",
      title: "Project NMODL to Modelica 3.x",
      description: "Generates equivalent equation-oriented Modelica 3.x biophysical channel component.",
      category: "export",
      execute: async (
        ctx: ActionExecutionContext,
        params: { documentText?: string | undefined; modelName?: string | undefined },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return "";
        const doc = parseNmodl(text);
        return nmodlToModelica(doc, params?.modelName);
      },
    },
  ],
});
