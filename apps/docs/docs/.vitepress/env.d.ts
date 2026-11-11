// SPDX-License-Identifier: AGPL-3.0-or-later

/// <reference types="vite/client" />
/// <reference types="@webgpu/types" />

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<{}, {}, any>;
  export default component;
}
