// SPDX-License-Identifier: AGPL-3.0-or-later

import "@modelscript/design-tokens/components.css";
import "@modelscript/design-tokens/tokens.css";
import type { Theme } from "vitepress";
import DefaultTheme from "vitepress/theme";
import { defineAsyncComponent } from "vue";
import DocsMegaMenu from "./components/DocsMegaMenu.vue";
import HomeAiAgent from "./components/HomeAiAgent.vue";
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
import LanguagesMegaMenu from "./components/LanguagesMegaMenu.vue";
import MermaidBlock from "./components/MermaidBlock.vue";
import ModelScriptViewer from "./components/ModelScriptViewer.vue";
import MsIcon from "./components/MsIcon.vue";
import PlatformMegaMenu from "./components/PlatformMegaMenu.vue";
import Layout from "./Layout.vue";
import "./style.css";

export default {
  extends: DefaultTheme,
  Layout,
  enhanceApp({ app }) {
    // Lazy: pulls in the generated CLI / lint-rule metadata only on pages that use it.
    app.component(
      "CliCommand",
      defineAsyncComponent(() => import("./components/CliCommand.vue")),
    );
    app.component(
      "LintRules",
      defineAsyncComponent(() => import("./components/LintRules.vue")),
    );
    app.component(
      "CapabilityMatrix",
      defineAsyncComponent(() => import("./components/CapabilityMatrix.vue")),
    );
    app.component("HomeAiAgent", HomeAiAgent);
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
    app.component("PlatformMegaMenu", PlatformMegaMenu);
    app.component("LanguagesMegaMenu", LanguagesMegaMenu);
    app.component("DocsMegaMenu", DocsMegaMenu);
    app.component("IndustriesIndex", IndustriesIndex);
    app.component("IndustryPage", IndustryPage);
    app.component("MsIcon", MsIcon);
    app.component("LanguageExplorer", LanguageExplorer);
    app.component("MermaidBlock", MermaidBlock);
    app.component("ModelScriptViewer", ModelScriptViewer);
  },
} satisfies Theme;
