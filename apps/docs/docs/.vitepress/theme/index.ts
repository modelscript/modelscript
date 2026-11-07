// SPDX-License-Identifier: AGPL-3.0-or-later

import "@modelscript/design-tokens/components.css";
import "@modelscript/design-tokens/tokens.css";
import type { Theme } from "vitepress";
import DefaultTheme from "vitepress/theme";
import { defineAsyncComponent } from "vue";
import AnsatzNavPill from "./components/AnsatzNavPill.vue";
import DocsMegaMenu from "./components/DocsMegaMenu.vue";
import IndustriesMegaMenu from "./components/IndustriesMegaMenu.vue";
import MsIcon from "./components/MsIcon.vue";
import PlatformMegaMenu from "./components/PlatformMegaMenu.vue";
import Layout from "./Layout.vue";
import "./style.css";

export default {
  extends: DefaultTheme,
  Layout,
  enhanceApp({ app, router }) {
    // Eagerly register lightweight global navbar / icon primitives
    app.component("MsIcon", MsIcon);
    app.component("IndustriesMegaMenu", IndustriesMegaMenu);
    app.component("PlatformMegaMenu", PlatformMegaMenu);
    app.component("DocsMegaMenu", DocsMegaMenu);
    app.component("AnsatzNavPill", AnsatzNavPill);

    // Lazy-load page-specific and below-the-fold components so initial JS bundle stays lean
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
    app.component(
      "LanguageExample",
      defineAsyncComponent(() => import("./components/LanguageExample.vue")),
    );
    app.component(
      "HomeStats",
      defineAsyncComponent(() => import("./components/HomeStats.vue")),
    );
    app.component(
      "HomeFormatStrip",
      defineAsyncComponent(() => import("./components/HomeFormatStrip.vue")),
    );
    app.component(
      "HomeIndustries",
      defineAsyncComponent(() => import("./components/HomeIndustries.vue")),
    );
    app.component(
      "HomeWorkflowPairs",
      defineAsyncComponent(() => import("./components/HomeWorkflowPairs.vue")),
    );
    app.component(
      "HomeSemanticCoordinator",
      defineAsyncComponent(() => import("./components/HomeSemanticCoordinator.vue")),
    );
    app.component(
      "HomeThread",
      defineAsyncComponent(() => import("./components/HomeThread.vue")),
    );
    app.component(
      "HomeAiAgent",
      defineAsyncComponent(() => import("./components/HomeAiAgent.vue")),
    );
    app.component(
      "HomeCapabilities",
      defineAsyncComponent(() => import("./components/HomeCapabilities.vue")),
    );
    app.component(
      "HomeSurfaces",
      defineAsyncComponent(() => import("./components/HomeSurfaces.vue")),
    );
    app.component(
      "HomeVsCode",
      defineAsyncComponent(() => import("./components/HomeVsCode.vue")),
    );
    app.component(
      "HomeCta",
      defineAsyncComponent(() => import("./components/HomeCta.vue")),
    );
    app.component(
      "IndustriesIndex",
      defineAsyncComponent(() => import("./components/IndustriesIndex.vue")),
    );
    app.component(
      "IndustryPage",
      defineAsyncComponent(() => import("./components/IndustryPage.vue")),
    );
    app.component(
      "PricingPlans",
      defineAsyncComponent(() => import("./components/PricingPlans.vue")),
    );
    app.component(
      "LanguageExplorer",
      defineAsyncComponent(() => import("./components/LanguageExplorer.vue")),
    );
    app.component(
      "MermaidBlock",
      defineAsyncComponent(() => import("./components/MermaidBlock.vue")),
    );
    app.component(
      "ModelScriptViewer",
      defineAsyncComponent(() => import("./components/ModelScriptViewer.vue")),
    );

    if (typeof window !== "undefined") {
      let lastReportedPath = "";
      const sendPageView = (rawPath: string) => {
        const cleanPath = (rawPath || window.location.pathname || "/").split(/[?#]/)[0] || "/";
        if (cleanPath === lastReportedPath) return;
        lastReportedPath = cleanPath;

        const payload = JSON.stringify({
          path: cleanPath,
          surface: "docs",
        });

        try {
          if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
            const blob = new Blob([payload], { type: "application/json" });
            navigator.sendBeacon("/api/v1/analytics/pageview", blob);
          } else {
            fetch("/api/v1/analytics/pageview", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: payload,
              keepalive: true,
            }).catch(() => {});
          }
        } catch {
          // Ignore analytics beacon errors in offline or static preview environments
        }
      };

      const prevAfterRouteChanged = router.onAfterRouteChanged;
      router.onAfterRouteChanged = (to) => {
        if (prevAfterRouteChanged) {
          prevAfterRouteChanged(to);
        }
        sendPageView(to);
      };

      // Initial hydration page view
      sendPageView(window.location.pathname);
    }
  },
} satisfies Theme;
