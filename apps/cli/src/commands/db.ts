// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ArgumentsCamelCase, Argv, CommandModule } from "yargs";
import { getApiUrl, getToken } from "../util/auth.js";

interface DbArgs {
  action?: string | undefined;
  dryRun?: boolean | undefined;
  skipBackup?: boolean | undefined;
  label?: string | undefined;
  file?: string | undefined;
  keep?: number | undefined;
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
  describe: "Database schema migration, health verification, hot WAL backup, and point-in-time restore",
  builder: (yargs: Argv) => {
    return yargs
      .positional("action", {
        type: "string",
        describe:
          "Action to perform: status | upgrade | verify | doctor | support-bundle | backup | backups | restore | prune | export-bundle | import-bundle",
        choices: [
          "status",
          "upgrade",
          "verify",
          "doctor",
          "support-bundle",
          "backup",
          "backups",
          "restore",
          "prune",
          "export-bundle",
          "import-bundle",
        ],
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
      .option("label", {
        type: "string",
        describe: "Optional snapshot label when creating a hot backup (`msx db backup --label pre-release`)",
      })
      .option("file", {
        type: "string",
        describe:
          "Backup snapshot or bundle file path (`msx db restore --file ...` / `msx db import-bundle --file ...`)",
      })
      .option("keep", {
        type: "number",
        describe: "Number of most recent snapshots to keep when pruning (`msx db prune --keep 7`)",
        default: 7,
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
          const body = (await res.json().catch(() => ({}))) as { error?: string | undefined };
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
      } catch (err: unknown) {
        console.error(
          c.red(
            `Could not connect to ModelScript API at ${apiUrl}: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
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
          const body = (await res.json().catch(() => ({}))) as { error?: string | undefined };
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
      } catch (err: unknown) {
        console.error(c.red(`Upgrade request failed: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
      }
    } else if (action === "verify") {
      try {
        const res = await fetch(`${apiUrl}/api/v1/admin/db/verify`, { headers });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string | undefined };
          console.error(c.red(`Integrity check failed: ${body.error || res.statusText}`));
          process.exit(1);
        }

        const data = (await res.json()) as { foreignKeysOk: boolean; integrityOk: boolean };
        console.log(c.bold("\nDatabase Physical & Relational Integrity:"));
        console.log(`  Foreign Key Relations:  ${data.foreignKeysOk ? c.green("VALID") : c.red("INCONSISTENT")}`);
        console.log(`  Physical Table Storage: ${data.integrityOk ? c.green("HEALTHY") : c.red("CORRUPTED")}\n`);
      } catch (err: unknown) {
        console.error(c.red(`Verify request failed: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
      }
    } else if (action === "backup") {
      try {
        console.log(c.bold(`Creating online SQLite WAL snapshot backup via ${apiUrl}...`));
        const res = await fetch(`${apiUrl}/api/v1/admin/backup`, {
          method: "POST",
          headers,
          body: JSON.stringify({ label: args.label }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string | undefined };
          console.error(c.red(`Hot backup failed: ${body.error || res.statusText}`));
          process.exit(1);
        }
        const data = (await res.json()) as {
          backup: { fileName: string; backupPath: string; sizeBytes: number; createdAt: string; sha256?: string };
        };
        console.log(c.green(`✔ Hot backup created: ${data.backup.fileName}`));
        console.log(`  Path:    ${data.backup.backupPath}`);
        console.log(`  Size:    ${(data.backup.sizeBytes / 1024).toFixed(1)} KB`);
        if (data.backup.sha256) {
          console.log(`  SHA-256: ${c.dim(data.backup.sha256)}`);
        }
      } catch (err: unknown) {
        console.error(c.red(`Backup request failed: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
      }
    } else if (action === "backups") {
      try {
        const res = await fetch(`${apiUrl}/api/v1/admin/backups`, { headers });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string | undefined };
          console.error(c.red(`Failed to list backups: ${body.error || res.statusText}`));
          process.exit(1);
        }
        const data = (await res.json()) as {
          backups: { fileName: string; sizeBytes: number; createdAt: string; sha256?: string }[];
        };
        console.log(c.bold(`\nAvailable Hot Backups (${data.backups.length}):`));
        for (const b of data.backups) {
          const kb = (b.sizeBytes / 1024).toFixed(1);
          const hashPreview = b.sha256 ? ` [sha256:${b.sha256.slice(0, 12)}]` : "";
          console.log(`  • ${c.green(b.fileName)} (${kb} KB, ${b.createdAt})${c.dim(hashPreview)}`);
        }
      } catch (err: unknown) {
        console.error(c.red(`Backups list failed: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
      }
    } else if (action === "restore") {
      if (!args.file) {
        console.error(c.red("Missing required --file <backupFileName.db> argument for restore."));
        process.exit(1);
      }
      try {
        console.log(c.yellow(`Restoring live database from snapshot '${args.file}'...`));
        const res = await fetch(`${apiUrl}/api/v1/admin/backups/${encodeURIComponent(args.file)}/restore`, {
          method: "POST",
          headers,
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string | undefined };
          console.error(c.red(`Restore failed: ${body.error || res.statusText}`));
          process.exit(1);
        }
        const data = (await res.json()) as {
          restoredFrom: string;
          preRestoreBackup: string;
          tablesRestored: number;
        };
        console.log(c.green(`✔ Restored ${data.tablesRestored} table(s) from ${data.restoredFrom}.`));
        console.log(c.dim(`  Pre-restore safety snapshot saved as: ${data.preRestoreBackup}`));
      } catch (err: unknown) {
        console.error(c.red(`Restore request failed: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
      }
    } else if (action === "prune") {
      try {
        const res = await fetch(`${apiUrl}/api/v1/admin/backups/prune`, {
          method: "POST",
          headers,
          body: JSON.stringify({ keepCount: args.keep ?? 7 }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string | undefined };
          console.error(c.red(`Prune failed: ${body.error || res.statusText}`));
          process.exit(1);
        }
        const data = (await res.json()) as { deletedCount: number; keepCount: number };
        console.log(c.green(`✔ Pruned ${data.deletedCount} old snapshot(s) (retaining latest ${data.keepCount}).`));
      } catch (err: unknown) {
        console.error(c.red(`Prune request failed: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
      }
    } else if (action === "export-bundle") {
      try {
        const res = await fetch(`${apiUrl}/api/v1/admin/bundle/export`, { headers });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string | undefined };
          console.error(c.red(`Bundle export failed: ${body.error || res.statusText}`));
          process.exit(1);
        }
        const bundle = (await res.json()) as {
          exportedAt: string;
          snapshot: { fileName: string; sizeBytes: number; sha256: string };
          bundleSha256: string;
        };
        if (args.file) {
          const fs = await import("node:fs");
          fs.writeFileSync(args.file, JSON.stringify(bundle, null, 2), "utf8");
          console.log(c.green(`✔ Exported instance migration bundle to ${args.file}`));
        } else {
          console.log(c.green(`✔ Exported instance migration bundle (${bundle.exportedAt})`));
        }
        console.log(
          `  Snapshot:      ${bundle.snapshot.fileName} (${(bundle.snapshot.sizeBytes / 1024).toFixed(1)} KB)`,
        );
        console.log(`  Bundle SHA256: ${c.dim(bundle.bundleSha256)}`);
      } catch (err: unknown) {
        console.error(c.red(`Bundle export request failed: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
      }
    } else if (action === "import-bundle") {
      if (!args.file) {
        console.error(c.red("Missing required --file <bundle.json> argument for import-bundle."));
        process.exit(1);
      }
      try {
        const fs = await import("node:fs");
        const raw = fs.readFileSync(args.file, "utf8");
        const res = await fetch(`${apiUrl}/api/v1/admin/bundle/import`, {
          method: "POST",
          headers,
          body: raw,
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string | undefined };
          console.error(c.red(`Bundle import failed: ${body.error || res.statusText}`));
          process.exit(1);
        }
        const data = (await res.json()) as {
          importedDomains: number;
          importedFlags: number;
          importedQuarantines: number;
        };
        console.log(
          c.green(
            `✔ Imported bundle (${data.importedDomains} federation domains, ${data.importedFlags} flags, ${data.importedQuarantines} quarantines).`,
          ),
        );
      } catch (err: unknown) {
        console.error(c.red(`Bundle import request failed: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
      }
    } else if (action === "doctor" || action === "support-bundle") {
      try {
        const res = await fetch(`${apiUrl}/api/v1/admin/system/support-bundle`, { headers });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string | undefined };
          console.error(c.red(`Diagnostics check failed: ${body.error || res.statusText}`));
          process.exit(1);
        }
        const bundle = (await res.json()) as {
          generatedAt: string;
          edition: string;
          runtime: { nodeVersion: string; platform: string; arch: string; uptimeSeconds: number };
          database: {
            schemaVersion: string | null;
            pendingMigrations: number;
            integrity: { foreignKeysOk: boolean; integrityOk: boolean };
            diagnostics: { dbSizeBytes: number; walSizeBytes: number };
          };
          auditChain: { valid: boolean; totalEntries: number };
          preflight: {
            readyForProduction: boolean;
            checks: {
              id: string;
              label: string;
              status: "pass" | "warn" | "fail";
              detail: string;
              remediation?: string;
            }[];
          };
        };

        if (args.file || action === "support-bundle") {
          const fs = await import("node:fs");
          const outPath = args.file || `modelscript-support-bundle-${Date.now()}.json`;
          fs.writeFileSync(outPath, JSON.stringify(bundle, null, 2), "utf8");
          console.log(c.green(`✔ Exported redacted support diagnostics bundle to ${outPath}`));
        }

        console.log(c.bold(`\nModelScript Hub Doctor Report (${bundle.edition.toUpperCase()} Edition):`));
        console.log(
          `  Production Readiness: ${bundle.preflight.readyForProduction ? c.green("PASS") : c.yellow("WARNINGS / ACTION NEEDED")}`,
        );
        console.log(
          `  Database Schema:      ${bundle.database.schemaVersion || "none"} (${bundle.database.pendingMigrations} pending)`,
        );
        console.log(
          `  Relational Integrity: ${bundle.database.integrity.foreignKeysOk && bundle.database.integrity.integrityOk ? c.green("HEALTHY") : c.red("ISSUES DETECTED")}`,
        );
        console.log(
          `  Audit Hash Chain:     ${bundle.auditChain.valid ? c.green(`VALID (${bundle.auditChain.totalEntries} entries)`) : c.red("TAMPERED / BROKEN")}\n`,
        );
        console.log(c.bold("Preflight Checks:"));
        for (const chk of bundle.preflight.checks) {
          const badge =
            chk.status === "pass" ? c.green("✔ PASS") : chk.status === "warn" ? c.yellow("⚠ WARN") : c.red("✖ FAIL");
          console.log(`  ${badge}  ${c.bold(chk.label)}: ${chk.detail}`);
          if (chk.remediation) {
            console.log(`          ${c.dim(`Remediation: ${chk.remediation}`)}`);
          }
        }
        console.log("");
      } catch (err: unknown) {
        console.error(c.red(`Doctor request failed: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
      }
    }
  },
};
