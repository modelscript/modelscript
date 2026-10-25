// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CommandModule } from "yargs";
import { getApiUrl, getAuthHeaders, getToken } from "../util/auth.js";

interface TokenCreateArgs {
  name: string;
  scope?: string | string[] | undefined;
  pattern?: string | undefined;
  expires?: number | undefined;
  registry?: string | undefined;
  json?: boolean | undefined;
}

interface TokenListArgs {
  registry?: string | undefined;
  json?: boolean | undefined;
}

interface TokenRevokeArgs {
  id: number;
  registry?: string | undefined;
  json?: boolean | undefined;
}

export const Token: CommandModule = {
  command: "token <action>",
  describe: "Manage granular personal access tokens (PATs) for CI/CD and automation",
  builder: (yargs) => {
    return yargs
      .command(
        "create <name>",
        "Create a new granular personal access token",
        (y) =>
          y
            .positional("name", {
              describe: "Name/description of the token (e.g. 'ci-github-actions')",
              type: "string",
              demandOption: true,
            })
            .option("scope", {
              alias: "s",
              describe: "Token permissions (packages:read, packages:publish, packages:yank, packages:manage, *)",
              type: "array",
              default: ["packages:publish"],
            })
            .option("pattern", {
              alias: "p",
              describe: "Package pattern constraint (e.g. '@myorg/*', 'Modelica*', '*')",
              type: "string",
              default: "*",
            })
            .option("expires", {
              alias: "e",
              describe: "Expiration period in days (e.g. 30, 90). Default: never expires",
              type: "number",
            })
            .option("registry", {
              alias: "r",
              describe: "Registry API URL",
              type: "string",
            })
            .option("json", {
              describe: "Output result as JSON",
              type: "boolean",
              default: false,
            }),
        async (args: any) => {
          await handleCreateToken(args);
        },
      )
      .command(
        "list",
        "List all active personal access tokens for the authenticated user",
        (y) =>
          y
            .option("registry", {
              alias: "r",
              describe: "Registry API URL",
              type: "string",
            })
            .option("json", {
              describe: "Output result as JSON",
              type: "boolean",
              default: false,
            }),
        async (args: any) => {
          await handleListTokens(args);
        },
      )
      .command(
        "revoke <id>",
        "Revoke an active personal access token by ID",
        (y) =>
          y
            .positional("id", {
              describe: "ID of the token to revoke",
              type: "number",
              demandOption: true,
            })
            .option("registry", {
              alias: "r",
              describe: "Registry API URL",
              type: "string",
            })
            .option("json", {
              describe: "Output result as JSON",
              type: "boolean",
              default: false,
            }),
        async (args: any) => {
          await handleRevokeToken(args);
        },
      )
      .demandCommand(1, "Please specify a token action: create, list, or revoke");
  },
  handler: () => {},
};

async function handleCreateToken(args: TokenCreateArgs): Promise<void> {
  const token = getToken();
  if (!token) {
    console.error("Not logged in. Run 'msx login' first.");
    process.exit(1);
  }

  const apiUrl = (args.registry || getApiUrl()).replace(/\/+$/, "");
  const scopes = Array.isArray(args.scope) ? args.scope : [args.scope || "packages:publish"];

  try {
    const res = await fetch(`${apiUrl}/api/v1/auth/tokens`, {
      method: "POST",
      headers: {
        ...getAuthHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: args.name,
        scopes,
        packagePattern: args.pattern || "*",
        expiresInDays: args.expires,
      }),
    });

    const data = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) {
      console.error(`Failed to create token: ${data.error || res.statusText}`);
      process.exit(1);
    }

    if (args.json) {
      console.log(JSON.stringify(data, null, 2));
    } else {
      console.log("\n Token created successfully!\n");
      console.log(`  Name:            ${data.name}`);
      console.log(`  ID:              ${data.id}`);
      console.log(`  Prefix:          ${data.prefix}`);
      console.log(`  Scopes:          ${data.scopes.join(", ")}`);
      console.log(`  Package Pattern: ${data.packagePattern}`);
      console.log(`  Expires:         ${data.expiresAt || "Never"}`);
      console.log(`\n  Plaintext Secret:\n  \x1b[32m${data.token}\x1b[0m\n`);
      console.log("  ⚠️  Save this token now; you will NOT be able to view it again.\n");
    }
  } catch (err: any) {
    console.error(`Network error: ${err.message}`);
    process.exit(1);
  }
}

async function handleListTokens(args: TokenListArgs): Promise<void> {
  const token = getToken();
  if (!token) {
    console.error("Not logged in. Run 'msx login' first.");
    process.exit(1);
  }

  const apiUrl = (args.registry || getApiUrl()).replace(/\/+$/, "");

  try {
    const res = await fetch(`${apiUrl}/api/v1/auth/tokens`, {
      headers: {
        ...getAuthHeaders(),
      },
    });

    const data = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) {
      console.error(`Failed to list tokens: ${data.error || res.statusText}`);
      process.exit(1);
    }

    const tokens: any[] = data.tokens || [];
    if (args.json) {
      console.log(JSON.stringify(tokens, null, 2));
      return;
    }

    if (tokens.length === 0) {
      console.log("No personal access tokens found.");
      return;
    }

    console.log(`\nActive API Tokens (${tokens.length}):\n`);
    console.log(
      "ID".padEnd(6) +
        "Name".padEnd(24) +
        "Prefix".padEnd(16) +
        "Scopes".padEnd(24) +
        "Pattern".padEnd(14) +
        "Expires".padEnd(14),
    );
    console.log("-".repeat(98));

    for (const t of tokens) {
      const id = String(t.id).padEnd(6);
      const name = (t.name.length > 22 ? t.name.slice(0, 20) + ".." : t.name).padEnd(24);
      const prefix = (t.token_prefix || "").padEnd(16);
      const scopes = (Array.isArray(t.scopes) ? t.scopes.join(",") : "").slice(0, 22).padEnd(24);
      const pattern = (t.package_pattern || "*").slice(0, 12).padEnd(14);
      const expires = (t.expires_at ? t.expires_at.slice(0, 10) : "Never").padEnd(14);
      console.log(`${id}${name}${prefix}${scopes}${pattern}${expires}`);
    }
    console.log("");
  } catch (err: any) {
    console.error(`Network error: ${err.message}`);
    process.exit(1);
  }
}

async function handleRevokeToken(args: TokenRevokeArgs): Promise<void> {
  const token = getToken();
  if (!token) {
    console.error("Not logged in. Run 'msx login' first.");
    process.exit(1);
  }

  const apiUrl = (args.registry || getApiUrl()).replace(/\/+$/, "");

  try {
    const res = await fetch(`${apiUrl}/api/v1/auth/tokens/${args.id}`, {
      method: "DELETE",
      headers: {
        ...getAuthHeaders(),
      },
    });

    const data = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) {
      console.error(`Failed to revoke token: ${data.error || res.statusText}`);
      process.exit(1);
    }

    if (args.json) {
      console.log(JSON.stringify(data, null, 2));
    } else {
      console.log(`✓ Token ID ${args.id} successfully revoked.`);
    }
  } catch (err: any) {
    console.error(`Network error: ${err.message}`);
    process.exit(1);
  }
}
