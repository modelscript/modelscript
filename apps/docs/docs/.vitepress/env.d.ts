// SPDX-License-Identifier: AGPL-3.0-or-later

/// <reference types="vite/client" />
/// <reference types="@webgpu/types" />

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<{}, {}, any>;
  export default component;
}

declare module "monaco-editor/esm/vs/editor/edcore.main" {
  export * from "monaco-editor";
}

declare const __FEATURE_FLAG_HOME_WORKFLOW_PAIRS__: boolean;
declare const __FEATURE_FLAG_HOME_SEMANTIC_COORDINATOR__: boolean;
declare const __FEATURE_FLAG_HOME_AI_AGENT__: boolean;
declare const __FEATURE_FLAG_HOME_POLYGLOT_SANDBOX__: boolean;
