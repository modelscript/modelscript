// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Theme } from "vitepress";
import DefaultTheme from "vitepress/theme";
import HomeDocker from "./components/HomeDocker.vue";
import HomePackages from "./components/HomePackages.vue";
import HomeQuickStart from "./components/HomeQuickStart.vue";
import HomeVsCode from "./components/HomeVsCode.vue";
import MermaidBlock from "./components/MermaidBlock.vue";
import TurbineHero from "./components/TurbineHero.vue";
import Layout from "./Layout.vue";
import "./style.css";

export default {
  extends: DefaultTheme,
  Layout,
  enhanceApp({ app }) {
    app.component("TurbineHero", TurbineHero);
    app.component("HomeQuickStart", HomeQuickStart);
    app.component("HomePackages", HomePackages);
    app.component("HomeVsCode", HomeVsCode);
    app.component("HomeDocker", HomeDocker);
    app.component("MermaidBlock", MermaidBlock);
  },
} satisfies Theme;
