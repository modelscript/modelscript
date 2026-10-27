// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Theme } from "vitepress";
import DefaultTheme from "vitepress/theme";
import HomeCapabilities from "./components/HomeCapabilities.vue";
import HomeCta from "./components/HomeCta.vue";
import HomeDocker from "./components/HomeDocker.vue";
import HomeFormatStrip from "./components/HomeFormatStrip.vue";
import HomeIndustries from "./components/HomeIndustries.vue";
import HomeLanguages from "./components/HomeLanguages.vue";
import HomePackages from "./components/HomePackages.vue";
import HomeQuickStart from "./components/HomeQuickStart.vue";
import HomeStats from "./components/HomeStats.vue";
import HomeSurfaces from "./components/HomeSurfaces.vue";
import HomeThread from "./components/HomeThread.vue";
import HomeVsCode from "./components/HomeVsCode.vue";
import IndustriesIndex from "./components/IndustriesIndex.vue";
import IndustriesMegaMenu from "./components/IndustriesMegaMenu.vue";
import IndustryPage from "./components/IndustryPage.vue";
import LanguageExplorer from "./components/LanguageExplorer.vue";
import MermaidBlock from "./components/MermaidBlock.vue";
import ModelScriptViewer from "./components/ModelScriptViewer.vue";
import MsIcon from "./components/MsIcon.vue";
import Layout from "./Layout.vue";
import "./style.css";

export default {
  extends: DefaultTheme,
  Layout,
  enhanceApp({ app }) {
    app.component("HomeStats", HomeStats);
    app.component("HomeFormatStrip", HomeFormatStrip);
    app.component("HomeIndustries", HomeIndustries);
    app.component("HomeThread", HomeThread);
    app.component("HomeSurfaces", HomeSurfaces);
    app.component("HomeCapabilities", HomeCapabilities);
    app.component("HomeCta", HomeCta);
    app.component("HomeQuickStart", HomeQuickStart);
    app.component("HomeLanguages", HomeLanguages);
    app.component("HomePackages", HomePackages);
    app.component("HomeVsCode", HomeVsCode);
    app.component("HomeDocker", HomeDocker);
    app.component("IndustriesMegaMenu", IndustriesMegaMenu);
    app.component("IndustriesIndex", IndustriesIndex);
    app.component("IndustryPage", IndustryPage);
    app.component("MsIcon", MsIcon);
    app.component("LanguageExplorer", LanguageExplorer);
    app.component("MermaidBlock", MermaidBlock);
    app.component("ModelScriptViewer", ModelScriptViewer);
  },
} satisfies Theme;
