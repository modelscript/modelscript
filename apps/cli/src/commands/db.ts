// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ArgumentsCamelCase, Argv, CommandModule } from "yargs";
import { getApiUrl, getToken } from "../util/auth.js";

interface DbArgs {
  action?: string | undefined;
  dryRun?: boolean | undefined;
  skipBackup?: boolean | undefined;
  apiUrl?: string | undefined;
}

function useColor(): boolean {
  return Boolean(process.stdout.isTTY && !process.env["NO_COLOR"]);
}

const c = {
  bold: (s: string) => (useColor() ? `\x1b[1m${s}\x1b[0m` : s),
  green: (s: string) => (useColor() ? `\x1b[32m${s}\x1b[0m` : s),
  red: (s: string) => (useColor() ? `\x1b[31m${s}\x1b[0m` : s),
  yellow: (s: string) => (useColor() ? `\x1b[33m${s}\x1b[0m` : s),
  blue: (s: string) => (useColor() ? `\x1b[34m${s}\x1b[0m` : s),
  dim: (s: string) => (useColor() ? `\x1b[2m${s}\x1b[0m` : s),
};

export const Db: CommandModule<Record<string, unknown>, DbArgs> = {
  command: "db <action>",
  describe: "Database schema migration, health verification, and pre-flight snapshot management",
  builder: (yargs: Argv) => {
    return yargs
      .positional("action", {
        type: "string",
        describe: "Action to perform: status | upgrade | verify",
        choices: ["status", "upgrade", "verify"],
      })
      .option("dry-run", {
        type: "boolean",
        describe: "Preview pending migrations without applying changes",
        default: false,
      })
      .option("skip-backup", {
        type: "boolean",
        describe: "Skip automated pre-flight hot snapshot (not recommended for production)",
        default: false,
      })
      .option("api-url", {
        type: "string",
        describe: "ModelScript API server URL",
      }) as unknown as Argv<DbArgs>;
  },
  handler: async (args: ArgumentsCamelCase<DbArgs>) => {
    const action = args.action;
    const apiUrl = args.apiUrl || getApiUrl();
    const token = getToken();

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    if (action === "status") {
      try {
        const res = await fetch(`${apiUrl}/api/v1/admin/db/status`, { headers });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          console.error(c.red(`Failed to fetch database status: ${body.error || res.statusText}`));
          process.exit(1);
        }
        const data = (await res.json()) as {
          currentVersion: string | null;
          applied: { name: string; applied_at: string; execution_ms: number }[];
          pending: { name: string }[];
        };

        console.log(c.bold("\nModelScript Database Status:"));
        console.log(
          `  Current Schema Version: ${data.currentVersion ? c.green(data.currentVersion) : c.yellow("none (uninitialized)")}`,
        );
        console.log(`  Applied Migrations:     ${c.bold(String(data.applied.length))}`);
        console.log(
          `  Pending Migrations:     ${data.pending.length > 0 ? c.yellow(String(data.pending.length)) : c.green("0 (up to date)")}\n`,
        );

        if (data.applied.length > 0) {
          console.log(c.bold("Applied History:"));
          for (const m of data.applied) {
            console.log(`  ${c.green("✔")} ${m.name} ${c.dim(`(${m.applied_at}, ${m.execution_ms}ms)`)}`);
          }
          console.log("");
        }

        if (data.pending.length > 0) {
          console.log(c.bold("Pending Migrations to Apply:"));
          for (const m of data.pending) {
            console.log(`  ${c.yellow("⏳")} ${m.name}`);
          }
          console.log(c.dim("\nRun 'msx db upgrade' to apply pending migrations."));
        }
      } catch (err: any) {
        console.error(c.red(`Could not connect to ModelScript API at ${apiUrl}: ${err.message}`));
        process.exit(1);
      }
    } else if (action === "upgrade") {
      try {
        console.log(c.bold(`Connecting to ${apiUrl} to initiate database upgrade...`));
        const res = await fetch(`${apiUrl}/api/v1/admin/db/upgrade`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            dryRun: Boolean(args.dryRun),
            skipBackup: Boolean(args.skipBackup),
          }),
        });

        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          console.error(c.red(`Database upgrade failed: ${body.error || res.statusText}`));
          process.exit(1);
        }

        const data = (await res.json()) as { appliedCount: number; backupPath: string | null };
        if (args.dryRun) {
          console.log(c.yellow(`[Dry-Run] ${data.appliedCount} migration(s) are pending and would be applied.`));
        } else {
          if (data.backupPath) {
            console.log(c.green(`[Backup] Automated pre-flight snapshot created at: ${data.backupPath}`));
          }
          console.log(c.green(`[Success] Applied ${data.appliedCount} migration(s). Database is fully upgraded.`));
        }
      } catch (err: any) {
        console.error(c.red(`Upgrade request failed: ${err.message}`));
        process.exit(1);
      }
    } else if (action === "verify") {
      try {
        const res = await fetch(`${apiUrl}/api/v1/admin/db/verify`, { headers });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          console.error(c.red(`Integrity check failed: ${body.error || res.statusText}`));
          process.exit(1);
        }

        const data = (await res.json()) as { foreignKeysOk: boolean; integrityOk: boolean };
        console.log(c.bold("\nDatabase Physical & Relational Integrity:"));
        console.log(`  Foreign Key Relations:  ${data.foreignKeysOk ? c.green("VALID") : c.red("INCONSISTENT")}`);
        console.log(`  Physical Table Storage: ${data.integrityOk ? c.green("HEALTHY") : c.red("CORRUPTED")}\n`);
      } catch (err: any) {
        console.error(c.red(`Verify request failed: ${err.message}`));
        process.exit(1);
      }
    }
  },
};
