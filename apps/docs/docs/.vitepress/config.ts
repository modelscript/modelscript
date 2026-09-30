// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vitepress";

let modelicaGrammar: Record<string, unknown> = { name: "modelica", displayName: "modelica", patterns: [] };
const grammarPath = path.resolve(__dirname, "../../../../dist/extension/syntaxes/modelica.tmLanguage.json");
if (fs.existsSync(grammarPath)) {
  try {
    modelicaGrammar = JSON.parse(fs.readFileSync(grammarPath, "utf-8"));
    modelicaGrammar.name = "modelica";
    modelicaGrammar.aliases = ["Modelica", "mo"];
  } catch {
    // fallback
  }
}

export default defineConfig({
  markdown: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    languages: [modelicaGrammar as any],
  },
  vite: {
    build: {
      target: "esnext",
    },
  },
  title: "ModelScript",
  description: "Polyglot Modeling Environment",
  appearance: "dark",
  head: [
    ["link", { rel: "icon", href: "/favicon.ico" }],
    ["link", { rel: "icon", type: "image/png", href: "/ms-logo.png" }],
    ["meta", { name: "theme-color", content: "#0d1117" }],
    ["meta", { property: "og:site_name", content: "ModelScript Documentation" }],
    ["meta", { property: "og:type", content: "website" }],
  ],
  themeConfig: {
    logo: {
      light: "/ms-logo.png",
      dark: "/ms-logo-light.png",
      alt: "ModelScript",
    },
    nav: [
      { text: "Home", link: "/" },
      { text: "Guide", link: "/guide/introduction" },
      { text: "Architecture", link: "/architecture/overview" },
      { text: "Algorithms", link: "/algorithms/overview" },
      { text: "Languages", link: "/languages/overview" },
      { text: "CLI (msc)", link: "/cli/overview" },
      { text: "Reference", link: "/reference/linter-rules" },
      { text: "PDF Manual", link: "/modelscript-reference-manual.pdf", target: "_blank" },
    ],
    sidebar: {
      "/guide/": [
        {
          text: "Getting Started",
          items: [
            { text: "Introduction", link: "/guide/introduction" },
            { text: "Installation", link: "/guide/installation" },
            { text: "Getting Started", link: "/guide/getting-started" },
          ],
        },
      ],
      "/algorithms/": [
        {
          text: "Algorithms Catalog",
          items: [
            { text: "Overview & Index", link: "/algorithms/overview" },
            { text: "Pantelides Index Reduction", link: "/algorithms/pantelides" },
            { text: "Tarjan BLT Partitioning", link: "/algorithms/blt" },
            { text: "Cellier-Elmqvist Tearing", link: "/algorithms/tearing" },
            { text: "Acausal Connector Balancing", link: "/algorithms/connector-balancing" },
            { text: "Automatic Differentiation", link: "/algorithms/autodiff" },
            { text: "Numerical ODE/DAE Solvers", link: "/algorithms/solvers-ode-dae" },
            { text: "Optimization Algorithms", link: "/algorithms/optimization" },
            { text: "Nelson-Oppen & SMT Solvers", link: "/algorithms/theory-coordinator" },
            { text: "CHC & IC3 Verification", link: "/algorithms/verification-chc" },
            { text: "Abstract Interpretation Domains", link: "/algorithms/abstract-interpretation" },
            { text: "Graph Rewriting & E-Graphs", link: "/algorithms/graph-rewriting" },
            { text: "Linear Memory Structures", link: "/algorithms/linear-memory-structures" },
            { text: "Scientific Computing & Surrogates", link: "/algorithms/surrogates-linear-algebra" },
            { text: "SDP, BVP & Geometric CSG", link: "/algorithms/sdp-bvp-cad" },
            { text: "Diagram Layout & Routing", link: "/algorithms/diagram-layout" },
          ],
        },
      ],
      "/architecture/": [
        {
          text: "Compiler Architecture",
          items: [
            { text: "Overview & Pipeline", link: "/architecture/overview" },
            { text: "WASM GLR Parser", link: "/architecture/glr-parser" },
            { text: "Salsa Query Engine", link: "/architecture/salsa-queries" },
            { text: "Linear DAE Arena", link: "/architecture/dae-arena" },
            { text: "Triple Graph Grammars", link: "/architecture/tgg" },
            { text: "Nelson-Oppen Coordinator", link: "/architecture/theory-coordinator" },
            { text: "Simulation Solvers", link: "/architecture/simulation-solvers" },
          ],
        },
      ],
      "/languages/": [
        {
          text: "Polyglot Languages",
          items: [
            { text: "Overview & Matrix", link: "/languages/overview" },
            { text: "Modelica", link: "/languages/modelica" },
            { text: "SysML v2 / KerML", link: "/languages/sysml2" },
            { text: "STEP CAD (ISO 10303)", link: "/languages/step" },
            { text: "OWL2 Ontology", link: "/languages/owl2" },
            { text: "CSV Telemetry", link: "/languages/csv" },
            { text: "CFD (SU2 / OpenFOAM)", link: "/languages/cfd" },
            { text: "FEA Structural Analysis", link: "/languages/fea" },
            { text: "OpenSCAD CSG", link: "/languages/scad" },
            { text: "SSP System Packaging", link: "/languages/ssp" },
          ],
        },
      ],
      "/cli/": [
        {
          text: "CLI Toolchain",
          items: [
            { text: "CLI Overview", link: "/cli/overview" },
            { text: "Command Reference", link: "/cli/commands" },
          ],
        },
      ],
      "/reference/": [
        {
          text: "Reference & Diagnostics",
          items: [
            { text: "Compiler Linter Rules", link: "/reference/linter-rules" },
            { text: "Standards & Export Formats", link: "/reference/export-formats" },
          ],
        },
      ],
    },
    socialLinks: [{ icon: "github", link: "https://github.com/modelscript/modelscript" }],
    footer: {
      message: "Released under the GNU AGPL v3 License.",
      copyright: "Copyright © 2026-present ModelScript Team",
    },
  },
});
