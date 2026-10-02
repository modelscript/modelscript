// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";
import type { ArgumentsCamelCase, Argv, CommandModule } from "yargs";
import { getApiUrl, getToken } from "../util/auth.js";

interface ArchiveArgs {
  action?: string | undefined;
  users?: string[] | undefined;
  all?: boolean | undefined;
  format?: string | undefined;
  concurrency?: number | undefined;
  output?: string | undefined;
  outputDir?: string | undefined;
  apiUrl?: string | undefined;
  wait?: boolean | undefined;
}

function useColor(): boolean {
  return Boolean(process.stdout.isTTY && !process.env["NO_COLOR"]);
}

const c = {
  bold: (s: string) => (useColor() ? `\x1b[1m${s}\x1b[0m` : s),
  dim: (s: string) => (useColor() ? `\x1b[2m${s}\x1b[0m` : s),
  green: (s: string) => (useColor() ? `\x1b[32m${s}\x1b[0m` : s),
  red: (s: string) => (useColor() ? `\x1b[31m${s}\x1b[0m` : s),
  yellow: (s: string) => (useColor() ? `\x1b[33m${s}\x1b[0m` : s),
  blue: (s: string) => (useColor() ? `\x1b[34m${s}\x1b[0m` : s),
  cyan: (s: string) => (useColor() ? `\x1b[36m${s}\x1b[0m` : s),
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const Archive: CommandModule<Record<string, unknown>, ArchiveArgs> = {
  command: "archive [action] [users..]",
  describe: "GDPR Art. 20 / CCPA data archive export with async worker queue and concurrency limits",
  builder: (yargs: Argv) => {
    return yargs
      .positional("action", {
        type: "string",
        describe: "Action to perform: request | status | download",
        default: "request",
      })
      .positional("users", {
        type: "string",
        array: true,
        describe: "Target usernames or IDs for batch processing",
      })
      .option("format", {
        type: "string",
        describe: "Archive payload format: zip (default) or json",
        choices: ["zip", "json"],
        default: "zip",
      })
      .option("concurrency", {
        type: "number",
        alias: "c",
        describe: "Maximum concurrent worker jobs (default: 2 or ARCHIVE_CONCURRENCY env)",
      })
      .option("output", {
        type: "string",
        alias: "o",
        describe: "Destination path or file for single-user archive",
      })
      .option("output-dir", {
        type: "string",
        describe: "Destination directory for batch archives (default: ./data/archives)",
      })
      .option("wait", {
        type: "boolean",
        describe: "Wait and stream download after queueing completes",
        default: true,
      })
      .option("api-url", {
        type: "string",
        describe: "ModelScript Hub API endpoint URL",
      }) as unknown as Argv<ArchiveArgs>;
  },
  handler: async (args: ArgumentsCamelCase<ArchiveArgs>) => {
    const action = args.action || "request";
    const apiUrl = (args.apiUrl || getApiUrl()).replace(/\/+$/, "");
    const token = getToken();

    if (!token) {
      console.error(c.red("Authentication required: Please log in using 'msx login' or set MODELSCRIPT_API_TOKEN."));
      process.exit(1);
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    const format = (args.format || "zip").toLowerCase() === "json" ? "json" : "zip";

    if (action === "status") {
      try {
        const res = await fetch(`${apiUrl}/api/v1/users/me/export/status`, { headers });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          console.error(c.red(`Failed to query archive status: ${body.error || res.statusText}`));
          process.exit(1);
        }
        const data = (await res.json()) as { job: any; concurrency?: number };
        if (!data.job) {
          console.log(c.yellow("No active or recent archive job found for current user."));
          return;
        }

        console.log(c.bold("\nModelScript Archive Job Status:"));
        console.log(`  Job ID:          ${data.job.id}`);
        console.log(`  Status:          ${c.bold(data.job.status.toUpperCase())}`);
        console.log(`  Format:          ${data.job.format.toUpperCase()}`);
        console.log(`  Concurrency:     ${data.concurrency ?? 2} worker slots`);
        if (data.job.queuePosition) {
          console.log(`  Queue Position:  #${data.job.queuePosition}`);
        }
        if (data.job.createdAt) {
          console.log(`  Enqueued At:     ${data.job.createdAt}`);
        }
        if (data.job.fileSizeBytes) {
          console.log(`  Archive Size:    ${formatBytes(data.job.fileSizeBytes)}`);
        }
        if (data.job.error) {
          console.log(`  Error:           ${c.red(data.job.error)}`);
        }
        console.log("");
      } catch (err: any) {
        console.error(c.red(`Error connecting to ${apiUrl}: ${err.message}`));
        process.exit(1);
      }
      return;
    }

    // Default action: "request" / "export"
    console.log("");
    console.log(c.bold("┌────────────────────────────────────────────────────────────────────────┐"));
    console.log(c.bold("│            ModelScript GDPR / CCPA Data Archive Exporter               │"));
    console.log(c.bold("└────────────────────────────────────────────────────────────────────────┘"));
    console.log(`  ${c.dim("Regulation:")}   GDPR Art. 20 / CCPA § 1798.100 Data Portability`);
    console.log(`  ${c.dim("Endpoint:")}     ${apiUrl}/api/v1/users/me/export`);
    console.log(
      `  ${c.dim("Format:")}       ${c.cyan(format.toUpperCase())} ${format === "zip" ? "(with offline HTML viewer)" : "(raw JSON)"}`,
    );

    try {
      const enqueueRes = await fetch(`${apiUrl}/api/v1/users/me/export`, {
        method: "POST",
        headers,
        body: JSON.stringify({ format }),
      });

      if (!enqueueRes.ok && enqueueRes.status !== 202) {
        const body = (await enqueueRes.json().catch(() => ({}))) as { error?: string };
        console.error(c.red(`\nFailed to enqueue archive request: ${body.error || enqueueRes.statusText}`));
        process.exit(1);
      }

      const enqueueData = (await enqueueRes.json()) as {
        job: { id: string; status: string; queuePosition?: number; concurrency?: number };
        concurrency?: number;
      };

      const jobId = enqueueData.job.id;
      const concurrency = enqueueData.concurrency ?? enqueueData.job.concurrency ?? 2;

      console.log(`  ${c.dim("Job ID:")}       ${jobId}`);
      console.log(`  ${c.dim("Worker Pool:")}   ${c.green(`${concurrency} concurrent slots`)}`);
      if (enqueueData.job.queuePosition) {
        console.log(`  ${c.dim("Initial Pos:")}   #${enqueueData.job.queuePosition} in worker queue`);
      }
      console.log(c.dim("──────────────────────────────────────────────────────────────────────────\n"));

      if (!args.wait) {
        console.log(c.green(`✔ Archive job enqueued successfully (Status: ${enqueueData.job.status}).`));
        console.log(c.dim("Run 'msx archive status' to monitor progress or check web settings.\n"));
        return;
      }

      // Polling loop
      const spinnerChars = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
      let spinIdx = 0;
      let finalJob: any = null;

      while (true) {
        const pollRes = await fetch(`${apiUrl}/api/v1/users/me/export/status?jobId=${encodeURIComponent(jobId)}`, {
          headers,
        });

        if (pollRes.ok) {
          const pollData = (await pollRes.json()) as { job: any };
          finalJob = pollData.job;

          if (finalJob) {
            const spin = spinnerChars[spinIdx++ % spinnerChars.length] ?? "•";
            if (finalJob.status === "queued") {
              const pos = finalJob.queuePosition ? `#${finalJob.queuePosition}` : "pending";
              if (process.stdout.isTTY) {
                process.stdout.write(
                  `\r  ${c.yellow(spin)} ${c.bold("Queued")} (Position ${pos} in worker queue • Concurrency: ${concurrency})...`,
                );
              }
            } else if (finalJob.status === "processing") {
              if (process.stdout.isTTY) {
                process.stdout.write(`\r  ${c.cyan(spin)} ${c.bold("Processing")} in background worker pool...`);
              }
            } else if (finalJob.status === "completed" || finalJob.status === "failed") {
              break;
            }
          }
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      if (process.stdout.isTTY) {
        process.stdout.write("\r\x1b[K");
      }

      if (!finalJob || finalJob.status === "failed") {
        console.error(c.red(`\n✖ Archive compilation failed: ${finalJob?.error || "Unknown server error"}\n`));
        process.exit(1);
      }

      console.log(
        `  ${c.green("✔")} Archive compilation complete! ${c.dim(`(${formatBytes(finalJob.fileSizeBytes || 0)})`)}`,
      );

      // Download the staged archive
      const downloadUrl = `${apiUrl}/api/v1/users/me/export/download?jobId=${encodeURIComponent(jobId)}`;
      console.log(`  ${c.dim("Downloading:")}  ${downloadUrl}`);

      const downloadRes = await fetch(downloadUrl, { headers });
      if (!downloadRes.ok) {
        console.error(c.red(`Failed to download archive: ${downloadRes.statusText}`));
        process.exit(1);
      }

      const buffer = Buffer.from(await downloadRes.arrayBuffer());
      const targetPath =
        args.output ||
        path.resolve(
          process.cwd(),
          args.outputDir || "./data/archives",
          `modelscript-archive-${finalJob.id}.${format}`,
        );

      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, buffer);

      console.log(
        `  ${c.green("✔")} Stored archive to: ${c.bold(targetPath)} ${c.dim(`(${formatBytes(buffer.length)})`)}\n`,
      );

      if (format === "zip") {
        console.log(`${c.bold("To view your archive:")}`);
        console.log(`  1. Extract ${path.basename(targetPath)}`);
        console.log(`  2. Double-click "index.html" to open the interactive offline viewer.\n`);
      }
    } catch (err: any) {
      console.error(c.red(`\nArchive export error: ${err.message}\n`));
      process.exit(1);
    }
  },
};
