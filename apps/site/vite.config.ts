// SPDX-License-Identifier: AGPL-3.0-or-later

import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [reactRouter(), tsconfigPaths()],
  server: {
    port: 3001,
    strictPort: true,
  },
  ssr: {
    noExternal: ["@primer/react"],
  },
});
