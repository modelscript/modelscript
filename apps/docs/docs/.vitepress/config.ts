// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";
import { defineConfig, type DefaultTheme } from "vitepress";
import { INDUSTRIES } from "./theme/data/industries";
import { LANGUAGES, PLATFORM_GROUPS, type LanguageGroupId } from "./theme/data/languages";

const SITE_DESCRIPTION = `Open-core computable digital thread that imports ${LANGUAGES.length} simulation and CAE formats, links them to requirements, and lets you simulate, verify, and export — in the browser, CLI, VS Code, or air-gapped enterprise appliances.`;

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

const examplesJsonPath = path.resolve(__dirname, "./theme/data/language-examples.generated.json");
const examplesBySlug: Record<string, unknown> = fs.existsSync(examplesJsonPath)
  ? Object.fromEntries(
      (JSON.parse(fs.readFileSync(examplesJsonPath, "utf-8")) as { slug: string }[]).map((e) => [e.slug, e]),
    )
  : {};

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
      target: ["es2020", "safari15"],
    },
    esbuild: {
      target: ["es2020", "safari15"],
    },
    plugins: [
      {
        name: "browser-node-builtins-shim",
        enforce: "pre",
        resolveId(source, _importer, options) {
          if (options?.ssr) return null;
          const nodeBuiltins = new Set([
            "path",
            "node:path",
            "url",
            "node:url",
            "fs",
            "node:fs",
            "node:fs/promises",
            "child_process",
            "node:child_process",
            "os",
            "node:os",
            "crypto",
            "node:crypto",
            "http",
            "node:http",
            "module",
            "node:module",
            "worker_threads",
            "node:worker_threads",
            "tty",
            "node:tty",
          ]);
          if (nodeBuiltins.has(source)) {
            return path.resolve(__dirname, "./theme/util/node-shims.ts");
          }
          return null;
        },
      },
    ],
    resolve: {
      dedupe: ["three"],
      alias: {
        "@modelscript/dsl/xml": path.resolve(__dirname, "./theme/util/xml-browser.ts"),
      },
    },
    optimizeDeps: {
      include: [
        "three",
        "three/examples/jsm/environments/RoomEnvironment.js",
        "three/examples/jsm/utils/BufferGeometryUtils.js",
      ],
      esbuildOptions: {
        target: ["es2020", "safari15"],
      },
    },
  },
  title: "ModelScript",
  description: SITE_DESCRIPTION,
  lastUpdated: true,
  appearance: true,
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
    const langMatch = /^languages\/([a-z0-9-]+)\.md$/.exec(pageData.relativePath);
    if (langMatch?.[1] && langMatch[1] !== "overview" && examplesBySlug[langMatch[1]]) {
      pageData.frontmatter["_example"] = examplesBySlug[langMatch[1]];
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
    const slug = cleanRoute ? cleanRoute.replace(/\//g, "-") : "index";
    const publicDir = path.resolve(__dirname, "../public");
    const ogRelPath = fs.existsSync(path.join(publicDir, `og/${slug}.png`))
      ? `og/${slug}.png`
      : fs.existsSync(path.join(publicDir, `og/${slug}.svg`))
        ? `og/${slug}.svg`
        : "og/index.svg";
    const ogImageUrl = `https://modelscript.org/${ogRelPath}`;
    const tags: ([string, Record<string, string>] | [string, Record<string, string>, string])[] = [
      ["link", { rel: "canonical", href: url }],
      ["meta", { property: "og:url", content: url }],
      ["meta", { property: "og:title", content: title }],
      ["meta", { property: "og:description", content: desc }],
      ["meta", { property: "og:image", content: ogImageUrl }],
      ["meta", { name: "twitter:title", content: title }],
      ["meta", { name: "twitter:description", content: desc }],
      ["meta", { name: "twitter:image", content: ogImageUrl }],
    ];

    if (cleanRoute) {
      const parts = cleanRoute.split("/");
      const section = parts[0];
      const sectionLabels: Record<string, { name: string; link: string }> = {
        guide: { name: "Guide", link: "https://modelscript.org/guide/introduction" },
        ansatz: { name: "Ansatz Platform", link: "https://modelscript.org/ansatz/overview" },
        architecture: { name: "Architecture", link: "https://modelscript.org/architecture/overview" },
        algorithms: { name: "Algorithms", link: "https://modelscript.org/algorithms/overview" },
        cli: { name: "CLI Reference", link: "https://modelscript.org/cli/overview" },
        languages: { name: "Languages", link: "https://modelscript.org/languages/overview" },
        industries: { name: "Industries", link: "https://modelscript.org/industries" },
        reference: { name: "Reference", link: "https://modelscript.org/reference/linter-rules" },
        pricing: { name: "Pricing", link: "https://modelscript.org/pricing" },
        trademark: { name: "Trademark Policy", link: "https://modelscript.org/trademark" },
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
    ["link", { rel: "dns-prefetch", href: "https://fonts.googleapis.com" }],
    ["link", { rel: "dns-prefetch", href: "https://fonts.gstatic.com" }],
    [
      "link",
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&family=JetBrains+Mono:wght@400;500;600&display=swap",
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
    ["meta", { property: "og:image", content: "https://modelscript.org/og/index.svg" }],
    ["meta", { name: "twitter:card", content: "summary_large_image" }],
    ["meta", { name: "twitter:image", content: "https://modelscript.org/og/index.svg" }],
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
      { component: "DocsMegaMenu" },
      { text: "Pricing", link: "/pricing" },
      { component: "AnsatzNavPill" },
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
            { text: "Pricing & Licensing", link: "/pricing" },
            { text: "Trademark Policy", link: "/trademark" },
          ],
        },
        {
          text: "Toolchain Reference",
          items: [
            { text: "CLI Overview", link: "/cli/overview" },
            { text: "CLI Command Reference", link: "/cli/commands" },
            { text: "Polyglot Languages Matrix", link: "/languages/overview" },
            { text: "Compiler Linter Rules", link: "/reference/linter-rules" },
            { text: "Radiology & Surgical CAS", link: "/reference/radiology-and-surgery" },
            { text: "Standards & Export Formats", link: "/reference/export-formats" },
            { text: "MCP Server & IDE Workbench", link: "/reference/mcp-and-ide" },
          ],
        },
        {
          text: "Ansatz Platform",
          items: [
            { text: "Overview & Architecture", link: "/ansatz/overview" },
            { text: "Workflow Replacement Guide", link: "/ansatz/workflow-replacement" },
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
            { text: "Workflow Replacement Guide", link: "/ansatz/workflow-replacement" },
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
            { text: "Pricing & Licensing", link: "/pricing" },
            { text: "Embedding Artifacts", link: "/guide/embedding" },
            { text: "CI/CD & GitHub Actions", link: "/guide/ci-cd" },
            { text: "Trademark Policy", link: "/trademark" },
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
        "/pricing": docsSidebar,
        "/trademark": docsSidebar,
        "/architecture/": engineSidebar,
        "/algorithms/": engineSidebar,
        "/languages/": languagesSidebar(),
      };
    })(),
    socialLinks: [
      { icon: "github", link: "https://github.com/modelscript/modelscript", ariaLabel: "GitHub repository" },
      { icon: "npm", link: "https://www.npmjs.com/org/modelscript", ariaLabel: "npm packages" },
      {
        icon: {
          svg: '<svg role="img" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><title>Visual Studio Code</title><path d="M23.15 2.587L18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .326 8.74L3.899 12 .326 15.26a1 1 0 0 0 .001 1.479L1.65 17.94a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352zm-5.146 14.861L10.826 12l7.178-5.448v10.896z"/></svg>',
        },
        link: "https://marketplace.visualstudio.com/items?itemName=modelscript.modelscript",
        ariaLabel: "VS Code Extension on Marketplace",
      },
    ],
    footer: {
      message:
        'Open-Core under the GNU AGPL v3 License; Enterprise Edition (ee/) under the ModelScript Enterprise License. • <a href="/pricing">Pricing</a> • <a href="/trademark">Trademark Policy</a>',
      copyright: "Copyright © 2025-2026 Mohamad Omar Nachawati and ModelScript Contributors.",
    },
  },
});
