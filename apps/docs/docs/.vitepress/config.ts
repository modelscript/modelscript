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
  title: "ModelScript",
  description: "Polyglot Modeling Environment",
  appearance: "dark",
  themeConfig: {
    logo: "/logo.svg", // Placeholder, we can add later
    nav: [
      { text: "Home", link: "/" },
      { text: "Guide", link: "/guide/introduction" },
    ],
    sidebar: [
      {
        text: "Getting Started",
        items: [
          { text: "Introduction", link: "/guide/introduction" },
          { text: "Installation", link: "/guide/installation" },
          { text: "Getting Started", link: "/guide/getting-started" },
        ],
      },
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/modelscript/modelscript" }],
    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright © 2026-present ModelScript Team",
    },
  },
});
