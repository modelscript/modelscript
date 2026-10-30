// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";
import { defineConfig, type DefaultTheme } from "vitepress";
import { INDUSTRIES } from "./theme/data/industries";
import { LANGUAGES, PLATFORM_GROUPS, type LanguageGroupId } from "./theme/data/languages";

const SITE_DESCRIPTION = `Open-core computable digital thread that imports ${LANGUAGES.length} simulation and CAE formats, links them to requirements, and lets you simulate, verify, and export — in the browser, CLI, VS Code, or air-gapped enterprise appliances.`;

/** Feature flag: Pricing page and nav are visible in dev mode or when SHOW_PRICING=true */
const isPricingVisible =
  process.env["NODE_ENV"] !== "production" ||
  process.env["SHOW_PRICING"] === "true" ||
  process.env["VITE_SHOW_PRICING"] === "true";

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
    math: true,

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
  lastUpdated: true,
  appearance: "dark",
  cleanUrls: true,
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
    const rawPath = pageData.relativePath
      .replace(/(^|\/)index\.md$/, "$1")
      .replace(/\.md$/, "")
      .replace(/\/+$/, "");
    const cleanRoute = rawPath ? rawPath.replace(/^\/+/, "") : "";
    const url = cleanRoute ? `https://modelscript.org/${cleanRoute}` : "https://modelscript.org/";
    const desc = description || SITE_DESCRIPTION;
    const tags: ([string, Record<string, string>] | [string, Record<string, string>, string])[] = [
      ["link", { rel: "canonical", href: url }],
      ["meta", { property: "og:url", content: url }],
      ["meta", { property: "og:title", content: title }],
      ["meta", { property: "og:description", content: desc }],
      ["meta", { name: "twitter:title", content: title }],
      ["meta", { name: "twitter:description", content: desc }],
    ];

    if (cleanRoute) {
      const parts = cleanRoute.split("/");
      const section = parts[0];
      const sectionLabels: Record<string, { name: string; link: string }> = {
        guide: { name: "Guide", link: "https://modelscript.org/guide/introduction" },
        architecture: { name: "Architecture", link: "https://modelscript.org/architecture/overview" },
        algorithms: { name: "Algorithms", link: "https://modelscript.org/algorithms/overview" },
        cli: { name: "CLI Reference", link: "https://modelscript.org/cli/overview" },
        languages: { name: "Languages", link: "https://modelscript.org/languages/overview" },
        industries: { name: "Industries", link: "https://modelscript.org/industries" },
        reference: { name: "Reference", link: "https://modelscript.org/reference/linter-rules" },
        pricing: { name: "Pricing", link: "https://modelscript.org/pricing" },
      };

      const items: { "@type": string; position: number; name: string; item: string }[] = [
        {
          "@type": "ListItem",
          position: 1,
          name: "Home",
          item: "https://modelscript.org/",
        },
      ];

      if (section && sectionLabels[section]) {
        items.push({
          "@type": "ListItem",
          position: 2,
          name: sectionLabels[section].name,
          item: sectionLabels[section].link,
        });
        if (parts.length > 1 && url !== sectionLabels[section].link) {
          items.push({
            "@type": "ListItem",
            position: 3,
            name: title || parts[parts.length - 1]!,
            item: url,
          });
        }
      } else {
        items.push({
          "@type": "ListItem",
          position: 2,
          name: title || cleanRoute,
          item: url,
        });
      }

      tags.push([
        "script",
        { type: "application/ld+json" },
        JSON.stringify({
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: items,
        }),
      ]);
    }

    return tags;
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
          "Open-core computable digital thread for polyglot engineering and simulation — compiler, simulator, optimizer, language server, multi-domain theory coordinator, and enterprise appliance.",
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
    editLink: {
      pattern: "https://github.com/modelscript/modelscript/edit/main/apps/docs/docs/:path",
      text: "Edit this page on GitHub",
    },
    lastUpdated: {
      text: "Last updated",
      formatOptions: { dateStyle: "medium" },
    },
    outline: { level: [2, 3], label: "On this page" },
    nav: [
      { component: "IndustriesMegaMenu" },
      { component: "PlatformMegaMenu" },
      { component: "LanguagesMegaMenu" },
      { component: "DocsMegaMenu" },
      ...(isPricingVisible ? [{ text: "Pricing", link: "/pricing" }] : []),
      { text: "Ansatz", link: "https://ansatz.social", target: "_blank" },
    ],
    sidebar: (() => {
      const docsSidebar: DefaultTheme.SidebarItem[] = [
        {
          text: "Getting Started",
          items: [
            { text: "Introduction", link: "/guide/introduction" },
            { text: "Installation", link: "/guide/installation" },
            { text: "Getting Started", link: "/guide/getting-started" },
          ],
        },
        {
          text: "Guides & Operations",
          items: [
            { text: "AI Agents & MCP Workflows", link: "/guide/ai-agents" },
            { text: "CI/CD & GitHub Actions", link: "/guide/ci-cd" },
            { text: "Embedding Artifacts", link: "/guide/embedding" },
            { text: "Enterprise Administration", link: "/guide/administration" },
          ],
        },
        {
          text: "Toolchain Reference",
          items: [
            { text: "CLI Overview", link: "/cli/overview" },
            { text: "CLI Command Reference", link: "/cli/commands" },
            { text: "Compiler Linter Rules", link: "/reference/linter-rules" },
            { text: "Standards & Export Formats", link: "/reference/export-formats" },
            { text: "MCP Server & IDE Workbench", link: "/reference/mcp-and-ide" },
          ],
        },
        {
          text: "Ansatz Platform",
          items: [
            { text: "Overview & Architecture", link: "/ansatz/overview" },
            { text: "ActivityPub Federation", link: "/ansatz/federation" },
            { text: "Package Registry", link: "/ansatz/package-registry" },
            { text: "Cloud HPC Simulation", link: "/ansatz/cloud-hpc" },
            { text: "Self-Hosting Guide", link: "/ansatz/self-hosting" },
          ],
        },
      ];

      const ansatzSidebar: DefaultTheme.SidebarItem[] = [
        {
          text: "Ansatz Platform",
          items: [
            { text: "Overview & Architecture", link: "/ansatz/overview" },
            { text: "ActivityPub Federation", link: "/ansatz/federation" },
            { text: "Package Registry", link: "/ansatz/package-registry" },
            { text: "Cloud HPC Simulation", link: "/ansatz/cloud-hpc" },
            { text: "Self-Hosting Guide", link: "/ansatz/self-hosting" },
          ],
        },
        {
          text: "Guides & Operations",
          items: [
            { text: "Enterprise Administration", link: "/guide/administration" },
            { text: "Embedding Artifacts", link: "/guide/embedding" },
            { text: "CI/CD & GitHub Actions", link: "/guide/ci-cd" },
          ],
        },
      ];

      const engineSidebar: DefaultTheme.SidebarItem[] = [
        {
          text: "Compiler Architecture",
          items: [
            { text: "Overview & Pipeline", link: "/architecture/overview" },
            { text: "Monorepo & Taxonomy", link: "/architecture/monorepo" },
            { text: "WASM GLR Parser", link: "/architecture/glr-parser" },
            { text: "Salsa Query Engine", link: "/architecture/salsa-queries" },
            { text: "Linear DAE Arena", link: "/architecture/dae-arena" },
            { text: "Triple Graph Grammars", link: "/architecture/tgg" },
            { text: "Nelson-Oppen Coordinator", link: "/architecture/theory-coordinator" },
            { text: "Simulation Solvers", link: "/architecture/simulation-solvers" },
            { text: "SIL & Real-Time HIL", link: "/architecture/hil-wasm-runtime" },
          ],
        },
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
      ];

      return {
        "/guide/": docsSidebar,
        "/ansatz/": ansatzSidebar,
        "/cli/": docsSidebar,
        "/reference/": docsSidebar,
        "/architecture/": engineSidebar,
        "/algorithms/": engineSidebar,
        "/languages/": languagesSidebar(),
      };
    })(),
    socialLinks: [
      { icon: "github", link: "https://github.com/modelscript/modelscript" },
      { icon: "npm", link: "https://www.npmjs.com/org/modelscript" },
    ],
    footer: {
      message:
        "Open-Core under the GNU AGPL v3 License; Enterprise Edition (ee/) under the ModelScript Enterprise License.",
      copyright: "Copyright © 2026-present Mohamad Omar Nachawati and ModelScript Contributors.",
    },
  },
});
