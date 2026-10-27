// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";
import { defineConfig, type DefaultTheme } from "vitepress";
import { INDUSTRIES } from "./theme/data/industries";
import { LANGUAGES, PLATFORM_GROUPS, type LanguageGroupId } from "./theme/data/languages";

const SITE_DESCRIPTION = `Free, open-source toolchain that imports ${LANGUAGES.length} simulation and CAE formats, links them to requirements, and lets you simulate, verify, and export — in the browser, CLI, or VS Code.`;

/** Maps a language's primary group to the industry slug whose name labels the sidebar group. */
const GROUP_TO_INDUSTRY: Partial<Record<LanguageGroupId, string>> = {
  aerospace: "aerospace",
  automotive: "automotive",
  rail: "rail",
  marine: "marine",
  power: "power-systems",
  "oil-gas": "oil-gas",
  nuclear: "nuclear",
  buildings: "buildings",
  electronics: "electronics",
  robotics: "robotics",
  process: "process",
  "life-sciences": "life-sciences",
};

function languagesSidebar(): DefaultTheme.SidebarItem[] {
  const itemsFor = (group: LanguageGroupId): DefaultTheme.SidebarItem[] =>
    LANGUAGES.filter((l) => l.group === group).map((l) => ({ text: l.sidebar, link: `/languages/${l.slug}` }));

  const platform = PLATFORM_GROUPS.map((g) => ({ text: g.label, collapsed: false, items: itemsFor(g.id) }));
  const industries = INDUSTRIES.flatMap((ind) => {
    const group = (Object.keys(GROUP_TO_INDUSTRY) as LanguageGroupId[]).find((k) => GROUP_TO_INDUSTRY[k] === ind.slug);
    if (!group) return [];
    const items = itemsFor(group);
    return items.length ? [{ text: ind.name, collapsed: true, items }] : [];
  });

  return [
    { text: "Polyglot Languages", items: [{ text: "Overview & Matrix", link: "/languages/overview" }] },
    ...platform,
    ...industries,
  ];
}

let modelicaGrammar: Record<string, unknown> | null = null;
const grammarPath = path.resolve(__dirname, "../../../../dist/extension/syntaxes/modelica.tmLanguage.json");
if (fs.existsSync(grammarPath)) {
  try {
    modelicaGrammar = JSON.parse(fs.readFileSync(grammarPath, "utf-8"));
    if (modelicaGrammar) {
      modelicaGrammar["name"] = "modelica";
      modelicaGrammar["scopeName"] = modelicaGrammar["scopeName"] || "source.modelica";
      modelicaGrammar["aliases"] = ["Modelica", "mo"];
    }
  } catch {
    modelicaGrammar = null;
  }
}

export default defineConfig({
  markdown: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    languages: modelicaGrammar ? [modelicaGrammar as any] : [],
    languageAlias: {
      abaqus: "ini",
      owl: "lisp",
      rocets: "c",
      scad: "c",
      sysml: "rust",
    },
    config(md) {
      const defaultCodeInline = md.renderer.rules.code_inline;
      md.renderer.rules.code_inline = (tokens, idx, options, env, self) => {
        const token = tokens[idx]!;
        if (token.content.includes("{{") || token.content.includes("}}")) {
          token.attrSet("v-pre", "");
        }
        return defaultCodeInline
          ? defaultCodeInline(tokens, idx, options, env, self)
          : self.renderToken(tokens, idx, options);
      };
      const defaultFence = md.renderer.rules.fence;
      md.renderer.rules.fence = (tokens, idx, options, env, self) => {
        const token = tokens[idx]!;
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
    resolve: {
      dedupe: ["three"],
    },
    optimizeDeps: {
      include: [
        "three",
        "three/examples/jsm/environments/RoomEnvironment.js",
        "three/examples/jsm/utils/BufferGeometryUtils.js",
      ],
      esbuildOptions: {
        target: "esnext",
      },
    },
  },
  title: "ModelScript",
  description: SITE_DESCRIPTION,
  appearance: "dark",
  sitemap: { hostname: "https://modelscript.org" },
  transformPageData(pageData) {
    const params = pageData.params as { title?: string; description?: string } | undefined;
    if (params?.title) {
      pageData.title = params.title;
      pageData.frontmatter["title"] = params.title;
    }
    if (params?.description) {
      pageData.description = params.description;
      pageData.frontmatter["description"] = params.description;
    }
  },
  transformHead({ pageData, title, description }) {
    const route = pageData.relativePath.replace(/(^|\/)index\.md$/, "$1").replace(/\.md$/, ".html");
    const url = `https://modelscript.org/${route}`;
    const desc = description || SITE_DESCRIPTION;
    return [
      ["link", { rel: "canonical", href: url }],
      ["meta", { property: "og:url", content: url }],
      ["meta", { property: "og:title", content: title }],
      ["meta", { property: "og:description", content: desc }],
      ["meta", { name: "twitter:title", content: title }],
      ["meta", { name: "twitter:description", content: desc }],
    ];
  },
  head: [
    ["link", { rel: "icon", href: "/favicon.ico" }],
    ["link", { rel: "icon", type: "image/png", href: "/ms-logo.png" }],
    ["link", { rel: "preconnect", href: "https://fonts.googleapis.com" }],
    ["link", { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "" }],
    [
      "link",
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap",
      },
    ],
    ["meta", { name: "theme-color", content: "#0a0f1c" }],
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
    ["meta", { property: "og:image", content: "https://modelscript.org/ms-logo.png" }],
    ["meta", { name: "twitter:card", content: "summary_large_image" }],
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
      { component: "IndustriesMegaMenu" },
      {
        text: "Docs",
        activeMatch: "^/(guide|architecture|algorithms|cli|reference)/",
        items: [
          {
            text: "Learn",
            items: [
              { text: "Introduction", link: "/guide/introduction" },
              { text: "Installation", link: "/guide/installation" },
              { text: "Getting Started", link: "/guide/getting-started" },
            ],
          },
          {
            text: "Deep Dive",
            items: [
              { text: "Compiler Architecture", link: "/architecture/overview" },
              { text: "Algorithms Catalog", link: "/algorithms/overview" },
            ],
          },
          {
            text: "Reference",
            items: [
              { text: "CLI Commands", link: "/cli/commands" },
              { text: "Linter Rules", link: "/reference/linter-rules" },
              { text: "Standards & Export Formats", link: "/reference/export-formats" },
              { text: "MCP Server & IDE", link: "/reference/mcp-and-ide" },
            ],
          },
        ],
      },
      { text: "Languages", link: "/languages/overview", activeMatch: "^/languages/" },
      {
        text: "Ecosystem",
        items: [
          { text: "Playground", link: "https://modelscript.org/playground" },
          { text: "Web IDE", link: "https://ide.modelscript.org" },
          { text: "Native Desktop App", link: "https://github.com/modelscript/modelscript/releases" },
          {
            text: "VS Code Extension",
            link: "https://marketplace.visualstudio.com/items?itemName=modelscript.modelscript",
          },
          { text: "PDF Reference Manual", link: "/modelscript-reference-manual.pdf", target: "_blank" },
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
            { text: "Embedding Artifacts", link: "/guide/embedding" },
            { text: "Administration", link: "/guide/administration" },
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
            { text: "SIL & Real-Time HIL", link: "/architecture/hil-wasm-runtime" },
          ],
        },
      ],
      "/languages/": languagesSidebar(),
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
            { text: "MCP Server & IDE Workbench", link: "/reference/mcp-and-ide" },
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
