// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Argv, CommandModule } from "yargs";
import { clearHostAuth, clearToken, getApiUrl, getAuthHeaders, getToken } from "../util/auth.js";

interface LogoutArgs {
  registry?: string | undefined;
  host?: string | undefined;
  all?: boolean | undefined;
}

export const Logout: CommandModule<{}, LogoutArgs> = {
  command: "logout",
  describe: "Log out from the Ansatz Package Registry or an external ALM host",
  builder: (yargs) => {
    return yargs
      .option("host", {
        alias: "H",
        description: "External ALM host to remove stored credentials for",
        type: "string",
      })
      .option("registry", {
        alias: "r",
        description: "Registry API URL to log out from",
        type: "string",
      })
      .option("all", {
        description: "Clear all saved registry preferences and credentials",
        type: "boolean",
        default: false,
      }) as unknown as Argv<LogoutArgs>;
  },
  handler: async (args) => {
    if (args.host) {
      const normalizedHost = args.host
        .replace(/^https?:\/\//i, "")
        .replace(/\/.*$/, "")
        .trim();
      const removed = clearHostAuth(normalizedHost);
      console.log(
        removed
          ? `✅ Cleared credentials for ALM host '${normalizedHost}'.`
          : `No stored credentials for '${normalizedHost}'.`,
      );
      return;
    }

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
