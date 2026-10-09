// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CommandModule } from "yargs";
import { clearToken, getApiUrl, getAuthHeaders, getToken } from "../util/auth.js";

interface LogoutArgs {
  registry?: string;
  all?: boolean;
}

export const Logout: CommandModule<{}, LogoutArgs> = {
  command: "logout",
  describe: "Log out from the ModelScript Registry",
  builder: (yargs) => {
    return yargs
      .option("registry", {
        alias: "r",
        description: "Registry API URL to log out from",
        type: "string",
      })
      .option("all", {
        description: "Clear all saved registry preferences and credentials",
        type: "boolean",
        default: false,
      }) as any;
  },
  handler: async (args) => {
    const token = getToken();
    if (!token) {
      console.log("You are not logged in.");
      return;
    }

    const apiUrl = (args.registry || getApiUrl()).replace(/\/+$/, "");

    // Optionally notify server to invalidate session cookie/token if reachable
    try {
      await fetch(`${apiUrl}/api/v1/auth/logout`, {
        method: "POST",
        headers: {
          ...getAuthHeaders(),
          "Content-Type": "application/json",
        },
      }).catch(() => {});
    } catch {
      // Ignore network errors on logout
    }

    clearToken();
    console.log("✅ Logged out successfully.");
  },
};
