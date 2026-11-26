// SPDX-License-Identifier: AGPL-3.0-or-later

import "@modelscript/design-tokens/components.css";
import "@modelscript/design-tokens/tokens.css";
import type { Theme } from "vitepress";
import DefaultTheme from "vitepress/theme";
import AnsatzArtifact from "./components/AnsatzArtifact.vue";
import BlogIndex from "./components/BlogIndex.vue";
import Layout from "./Layout.vue";
import "./style.css";

export default {
  extends: DefaultTheme,
  Layout,
  enhanceApp({ app }) {
    app.component("BlogIndex", BlogIndex);
    app.component("AnsatzArtifact", AnsatzArtifact);
  },
} satisfies Theme;
