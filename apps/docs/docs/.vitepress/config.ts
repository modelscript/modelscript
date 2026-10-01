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
    config(md) {
      const defaultFence = md.renderer.rules.fence;
      md.renderer.rules.fence = (tokens, idx, options, env, self) => {
        const token = tokens[idx];
        const info = token.info.trim();
        if (info === "mermaid") {
          const encoded = encodeURIComponent(token.content);
          return `<MermaidBlock code="${encoded}" />`;
        }
        return defaultFence ? defaultFence(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options);
      };
    },
  },
  vite: {
    build: {
      target: "esnext",
    },
    esbuild: {
      target: "esnext",
    },
    optimizeDeps: {
      esbuildOptions: {
        target: "esnext",
      },
    },
  },
  title: "ModelScript",
  description: "Open-source computable digital thread unifying Modelica, SysML2, 3D CAD, and continuum physics.",
  appearance: "dark",
  head: [
    ["link", { rel: "icon", href: "/favicon.ico" }],
    ["link", { rel: "icon", type: "image/png", href: "/ms-logo.png" }],
    ["link", { rel: "canonical", href: "https://modelscript.org" }],
    ["meta", { name: "theme-color", content: "#0d1117" }],
    [
      "meta",
      {
        name: "keywords",
        content:
          "Modelica, simulation, modeling, open-source, compiler, DAE, ODE, GLR, WebAssembly, AssemblyScript, VS Code, ModelScript, systems engineering, differential equations, digital thread, computable digital thread, Modelica Standard Library, MSL, SysML, CAD, STEP",
      },
    ],
    ["meta", { name: "author", content: "Mohamad Omar Nachawati" }],
    ["meta", { property: "og:site_name", content: "ModelScript" }],
    ["meta", { property: "og:type", content: "website" }],
    [
      "meta",
      { property: "og:title", content: "ModelScript — The Computable Digital Thread for Engineering & Simulation" },
    ],
    [
      "meta",
      {
        property: "og:description",
        content:
          "Parse, lint, flatten, simulate, optimize, and formally verify across Modelica, SysML v2, CAD, and continuum physics — uniting multi-domain engineering in an active computable digital thread. Free and open-source under AGPL-3.0.",
      },
    ],
    ["meta", { property: "og:url", content: "https://modelscript.org" }],
    ["meta", { property: "og:image", content: "https://modelscript.org/ms-logo.png" }],
    ["meta", { name: "twitter:card", content: "summary_large_image" }],
    [
      "meta",
      { name: "twitter:title", content: "ModelScript — The Computable Digital Thread for Engineering & Simulation" },
    ],
    [
      "meta",
      {
        name: "twitter:description",
        content:
          "Parse, lint, flatten, simulate, optimize, and formally verify across Modelica, SysML v2, CAD, and continuum physics — uniting multi-domain engineering in an active computable digital thread.",
      },
    ],
    ["meta", { name: "twitter:image", content: "https://modelscript.org/ms-logo.png" }],
    ["meta", { name: "robots", content: "index, follow" }],
    [
      "script",
      { type: "application/ld+json" },
      JSON.stringify({
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        name: "ModelScript",
        applicationCategory: "DeveloperApplication",
        operatingSystem: "Any",
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD",
        },
        description:
          "Free, open-source computable digital thread for polyglot engineering and simulation — compiler, simulator, optimizer, language server, and multi-domain theory coordinator.",
        url: "https://modelscript.org",
        license: "https://www.gnu.org/licenses/agpl-3.0.html",
        author: {
          "@type": "Person",
          name: "Mohamad Omar Nachawati",
        },
      }),
    ],
  ],
  themeConfig: {
    logo: {
      light: "/ms-logo.png",
      dark: "/ms-logo-light.png",
      alt: "ModelScript",
    },
    search: {
      provider: "local",
    },
    nav: [
      { text: "Guide", link: "/guide/introduction" },
      { text: "Architecture", link: "/architecture/overview" },
      { text: "Algorithms", link: "/algorithms/overview" },
      { text: "Languages", link: "/languages/overview" },
      { text: "CLI", link: "/cli/overview" },
      { text: "Reference", link: "/reference/linter-rules" },
      {
        text: "Ecosystem",
        items: [
          { text: "Morsel (Playground)", link: "https://morsel.modelscript.org" },
          { text: "Web IDE", link: "https://ide.modelscript.org" },
          {
            text: "VS Code Extension",
            link: "https://marketplace.visualstudio.com/items?itemName=modelscript.vscode",
          },
          { text: "PDF Manual (110p)", link: "/modelscript-reference-manual.pdf", target: "_blank" },
        ],
      },
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
    socialLinks: [
      { icon: "github", link: "https://github.com/modelscript/modelscript" },
      { icon: "npm", link: "https://www.npmjs.com/org/modelscript" },
    ],
    footer: {
      message: "Released under the GNU AGPL v3 License.",
      copyright: "Copyright © 2026-present Mohamad Omar Nachawati and ModelScript Contributors.",
    },
  },
});
