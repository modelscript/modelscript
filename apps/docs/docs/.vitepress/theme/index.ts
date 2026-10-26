// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Theme } from "vitepress";
import DefaultTheme from "vitepress/theme";
import HomeDocker from "./components/HomeDocker.vue";
import HomeLanguages from "./components/HomeLanguages.vue";
import HomePackages from "./components/HomePackages.vue";
import HomeQuickStart from "./components/HomeQuickStart.vue";
import HomeStats from "./components/HomeStats.vue";
import HomeVsCode from "./components/HomeVsCode.vue";
import MermaidBlock from "./components/MermaidBlock.vue";
import ModelScriptViewer from "./components/ModelScriptViewer.vue";
import TurbineHero from "./components/TurbineHero.vue";
import Layout from "./Layout.vue";
import "./style.css";

export default {
  extends: DefaultTheme,
  Layout,
  enhanceApp({ app }) {
    app.component("TurbineHero", TurbineHero);
    app.component("HomeStats", HomeStats);
    app.component("HomeQuickStart", HomeQuickStart);
    app.component("HomeLanguages", HomeLanguages);
    app.component("HomePackages", HomePackages);
    app.component("HomeVsCode", HomeVsCode);
    app.component("HomeDocker", HomeDocker);
    app.component("MermaidBlock", MermaidBlock);
    app.component("ModelScriptViewer", ModelScriptViewer);
  },
} satisfies Theme;
