// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CommandModule } from "yargs";
import { getApiUrl, getAuthHeaders, getToken } from "../util/auth.js";

interface WhoAmIArgs {
  registry?: string;
  json?: boolean;
}

export const WhoAmI: CommandModule<{}, WhoAmIArgs> = {
  command: "whoami",
  describe: "Display information about the currently authenticated user",
  builder: (yargs) => {
    return yargs
      .option("registry", {
        alias: "r",
        description: "Registry API URL to query against",
        type: "string",
      })
      .option("json", {
        description: "Output in JSON format",
        type: "boolean",
        default: false,
      }) as any;
  },
  handler: async (args) => {
    const token = getToken();
    if (!token) {
      if (args.json) {
        console.log(JSON.stringify({ authenticated: false, error: "Not logged in" }, null, 2));
      } else {
        console.error("Not logged in. Run 'msx login' to authenticate.");
      }
      process.exit(1);
    }

    const apiUrl = (args.registry || getApiUrl()).replace(/\/+$/, "");

    try {
      const res = await fetch(`${apiUrl}/api/v1/auth/me`, {
        headers: {
          ...getAuthHeaders(),
          Accept: "application/json",
        },
      });

      if (!res.ok) {
        if (res.status === 401) {
          if (args.json) {
            console.log(JSON.stringify({ authenticated: false, error: "Session expired or invalid token" }, null, 2));
          } else {
            console.error("❌ Session expired or invalid token. Run 'msx login' to re-authenticate.");
          }
          process.exit(1);
        }
        const data = (await res.json().catch(() => ({}))) as any;
        console.error(`Failed to fetch user profile: ${data.error || res.statusText}`);
        process.exit(1);
      }

      const data = (await res.json()) as any;
      const user = data.user;

      if (args.json) {
        console.log(
          JSON.stringify(
            {
              authenticated: true,
              registry: apiUrl,
              user,
            },
            null,
            2,
          ),
        );
        return;
      }

      console.log(`👤 Username:    ${user.username}`);
      if (user.display_name) {
        console.log(`📛 Name:        ${user.display_name}`);
      }
      console.log(`📧 Email:       ${user.email}`);
      console.log(`🏷️  Role:        ${user.role || "user"}`);
      console.log(`🔐 2FA:         ${user.totp_enabled ? "Enabled" : "Disabled"}`);
      console.log(`🌐 Registry:    ${apiUrl}`);
    } catch (e) {
      console.error(`Error connecting to registry at ${apiUrl}: ${(e as Error).message}`);
      process.exit(1);
    }
  },
};
