import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitepress";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modelicaGrammar = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../../../../extensions/vscode/syntaxes/modelica.tmLanguage.json"), "utf-8"),
);
modelicaGrammar.name = "modelica";
modelicaGrammar.aliases = ["Modelica", "mo"];

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
