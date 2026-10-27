// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/lps — Language Definition for PipelineStudio (TGNET & TLNET).
 *
 * Provides language registration, LSP quick-actions (linter, steady hydraulics,
 * transient Euler simulation, line pack analysis, and SysML v2 projection).
 */

import { language } from "@modelscript/dsl";
import { lintLpsModel } from "./lints/index.js";
import { parseLps } from "./parser/index.js";
import { lpsToSysml2 } from "./projections/lps-to-sysml2.js";
import { LinePackEngine } from "./solver/line-pack/line-pack-engine.js";
import { SteadyNetworkSolver } from "./solver/steady/steady-network-solver.js";
import { GasEulerDaeSolver } from "./solver/transient/gas-euler-dae.js";
import { PipelineVerifier } from "./verification/pipeline-verifier.js";

interface LpsActionContext {
  documentText?: string | undefined;
}

export const lpsLanguage = language({
  name: "lps",
  fileExtensions: [".lps", ".tgx", ".tlx", ".tgn", ".tln", ".psg", ".psl"],
  maturity: "beta",
  lsp: {
    fileExtensions: [".lps", ".tgx", ".tlx", ".tgn", ".tln", ".psg", ".psl"],
    icons: {
      light: "./assets/lps/icon-light.png",
      dark: "./assets/lps/icon-dark.png",
    },
  },

  actions: [
    {
      id: "lint_lps_network",
      title: "Lint PipelineStudio Network",
      description:
        "Checks MAOP integrity, compressor operating limits, delivery reachability, and hydrogen blending rules.",
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
          name: "lps_lint",
          displayName: "Lint PipelineStudio Network",
          modelDescription:
            "Lints a PipelineStudio .lps/.tgx model for MAOP violations, compressor surge, and delivery pressure deficits.",
        },
      },
      execute: async (ctx: LpsActionContext | undefined, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        const model = parseLps(text);
        return lintLpsModel(model);
      },
    },
    {
      id: "solve_lps_steady",
      title: "Solve Steady-State Hydraulics",
      description: "Computes nodal pressures, branch flows, friction losses, and line pack.",
      category: "simulate",
      ui: {
        editorTitle: {
          icon: "$(play)",
          group: "navigation@1",
        },
        explorerContextMenu: {
          group: "modelscript_run@1",
        },
        languageModelTool: {
          name: "lps_solve_steady",
          displayName: "Solve Steady Hydraulics",
          modelDescription: "Solves steady-state pressures, mass flows, velocities, and line pack.",
        },
      },
      execute: async (ctx: LpsActionContext | undefined, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const model = parseLps(text);
        const steady = SteadyNetworkSolver.solve(model);
        const analysis = LinePackEngine.analyze(model, steady);
        const verification = PipelineVerifier.verifySteady(model, steady);
        return { steady, analysis, verification };
      },
    },
    {
      id: "simulate_lps_transient",
      title: "Simulate Transient Dynamics (WASM)",
      description: "Simulates 1D transient gas Euler dynamics and line pack pressure waves.",
      category: "simulate",
      ui: {
        editorTitle: {
          icon: "$(graph)",
          group: "navigation@2",
        },
        explorerContextMenu: {
          group: "modelscript_run@2",
        },
        languageModelTool: {
          name: "lps_simulate_transient",
          displayName: "Simulate Transient Dynamics",
          modelDescription: "Simulates transient gas dynamics across the pipeline network over time.",
        },
      },
      execute: async (
        ctx: LpsActionContext | undefined,
        params: { documentText?: string | undefined; duration?: number | undefined },
      ) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const model = parseLps(text);
        return GasEulerDaeSolver.simulate(model, { durationSeconds: params?.duration });
      },
    },
    {
      id: "project_lps_sysml2",
      title: "Project to SysML v2 Architecture",
      description: "Generates formal SysML v2 parts, ports, safety requirements, and operational state machines.",
      category: "query",
      ui: {
        editorTitle: {
          icon: "$(references)",
          group: "navigation@3",
        },
        explorerContextMenu: {
          group: "modelscript_run@3",
        },
        languageModelTool: {
          name: "lps_to_sysml2",
          displayName: "Project to SysML v2",
          modelDescription: "Translates PipelineStudio models into formal SysML v2 textual architecture.",
        },
      },
      execute: async (ctx: LpsActionContext | undefined, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return "";
        const model = parseLps(text);
        return lpsToSysml2(model);
      },
    },
  ],
});
