// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CommandModule } from "yargs";
import { clearToken, getToken } from "../util/auth.js";

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export const Logout: CommandModule<{}, {}> = {
  command: "logout",
  describe: "Log out from the ModelScript Registry",
  handler: () => {
    if (!getToken()) {
      console.log("You are not logged in.");
      return;
    }
    clearToken();
    console.log("✅ Logged out successfully.");
  },
};
