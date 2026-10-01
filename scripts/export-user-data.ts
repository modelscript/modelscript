// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript GDPR / CCPA Data Archive Batch Exporter
 * Generates self-contained ZIP archives with interactive offline HTML viewers
 * or raw JSON export bundles with async worker queueing and concurrency limits.
 *
 * Usage:
 *   npx tsx scripts/export-user-data.ts [usernames_or_ids...] [options]
 *   npx tsx scripts/export-user-data.ts --all --concurrency 3 --output-dir ./data/archives
 */

import fs from "node:fs";
import path from "node:path";
import { LibraryDatabase } from "../apps/api/src/database.js";
import { gatherUserDataBundle, generateUserArchiveZip } from "../apps/api/src/services/user-archive.js";

interface CliOptions {
  userQueries: string[];
  exportAll: boolean;
  concurrency: number;
  outputDir: string;
  explicitOutputFile?: string;
  format: "zip" | "json";
  dbDir?: string;
  quiet: boolean;
}

interface BatchJob {
  index: number;
  user: {
    id: number;
    username: string;
    email: string;
    account_type?: string;
  };
  format: "zip" | "json";
  outputPath: string;
  status: "queued" | "processing" | "completed" | "failed";
  workerId?: number;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
  fileSizeBytes?: number;
  error?: string;
}

const isTTY = Boolean(process.stdout.isTTY && !process.env["NO_COLOR"]);

const c = {
  bold: (s: string) => (isTTY ? `\x1b[1m${s}\x1b[0m` : s),
  dim: (s: string) => (isTTY ? `\x1b[2m${s}\x1b[0m` : s),
  green: (s: string) => (isTTY ? `\x1b[32m${s}\x1b[0m` : s),
  red: (s: string) => (isTTY ? `\x1b[31m${s}\x1b[0m` : s),
  yellow: (s: string) => (isTTY ? `\x1b[33m${s}\x1b[0m` : s),
  blue: (s: string) => (isTTY ? `\x1b[34m${s}\x1b[0m` : s),
  magenta: (s: string) => (isTTY ? `\x1b[35m${s}\x1b[0m` : s),
  cyan: (s: string) => (isTTY ? `\x1b[36m${s}\x1b[0m` : s),
};

function printHelp(): void {
  console.log(`
${c.bold("ModelScript GDPR/CCPA Data Archive Batch Exporter")}
Generates self-contained ZIP archives (with offline HTML viewer) or raw JSON bundles.

${c.bold("USAGE:")}
  npx tsx scripts/export-user-data.ts [usernames_or_ids...] [options]

${c.bold("TARGETS:")}
  <usernames_or_ids...>     One or more usernames or numeric user IDs to export
  --all                     Export all active users found in the database
  --users, -u <list>        Comma-separated list of usernames or numeric IDs

${c.bold("CONCURRENCY & QUEUE:")}
  --concurrency, -c <N>     Maximum concurrent worker tasks (default: 2 or ARCHIVE_CONCURRENCY env)
  
${c.bold("OUTPUT & FORMAT:")}
  --output-dir, -o <path>   Directory to save generated archives (default: ./data/archives)
  --output <path>           Exact path for single-user archive (e.g. ./alice-archive.zip)
  --format, -f <zip|json>   Archive format: zip (default) or json
  --json                    Shorthand for --format json

${c.bold("STORAGE & LOGGING:")}
  --sqlite, -s <path>       Path or directory of SQLite database (default: ./data)
  --dir, -d <path>          Alias for --sqlite
  --quiet, -q               Minimal output, suppresses progress bars
  --help, -h                Show this help message

${c.bold("EXAMPLES:")}
  # Export a single user
  npx tsx scripts/export-user-data.ts alice --output ./alice.zip

  # Batch export multiple users with 4 workers
  npx tsx scripts/export-user-data.ts alice bob charlie --concurrency 4

  # Batch export ALL users with concurrency limit of 3 to a custom directory
  npx tsx scripts/export-user-data.ts --all -c 3 --output-dir ./backup/gdpr-exports
`);
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    userQueries: [],
    exportAll: false,
    concurrency: Number(process.env["ARCHIVE_CONCURRENCY"] || process.env["ARCHIVE_MAX_CONCURRENCY"]) || 2,
    outputDir: path.resolve(process.cwd(), "data/archives"),
    format: "zip",
    quiet: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (arg === "--all") {
      options.exportAll = true;
    } else if ((arg === "--concurrency" || arg === "-c") && args[i + 1]) {
      const parsed = parseInt(args[++i]!, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        options.concurrency = parsed;
      }
    } else if ((arg === "--output-dir" || arg === "-o" || arg === "--out") && args[i + 1]) {
      const val = args[++i]!;
      if (val.endsWith(".zip") || val.endsWith(".json")) {
        options.explicitOutputFile = path.resolve(process.cwd(), val);
        options.outputDir = path.dirname(options.explicitOutputFile);
      } else {
        options.outputDir = path.resolve(process.cwd(), val);
      }
    } else if (arg === "--output" && args[i + 1]) {
      const val = args[++i]!;
      options.explicitOutputFile = path.resolve(process.cwd(), val);
      options.outputDir = path.dirname(options.explicitOutputFile);
    } else if ((arg === "--users" || arg === "-u") && args[i + 1]) {
      const rawList = args[++i]!;
      options.userQueries.push(
        ...rawList
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      );
    } else if ((arg === "--format" || arg === "-f") && args[i + 1]) {
      const fmt = args[++i]!.toLowerCase();
      options.format = fmt === "json" ? "json" : "zip";
    } else if (arg === "--json") {
      options.format = "json";
    } else if ((arg === "--sqlite" || arg === "-s" || arg === "--dir" || arg === "-d") && args[i + 1]) {
      options.dbDir = path.resolve(process.cwd(), args[++i]!);
    } else if (arg === "--quiet" || arg === "-q") {
      options.quiet = true;
    } else if (!arg.startsWith("-")) {
      options.userQueries.push(arg);
    }
  }

  return options;
}

function renderProgressBar(current: number, total: number, width = 24): string {
  const ratio = total > 0 ? Math.min(1, current / total) : 0;
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  const bar = "█".repeat(filled) + "░".repeat(empty);
  const pct = (ratio * 100).toFixed(1).padStart(5);
  return `[${c.cyan(bar)}] ${pct}%`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    printHelp();
    process.exit(1);
  }

  const options = parseArgs(args);

  if (!options.exportAll && options.userQueries.length === 0) {
    console.error(c.red("\nError: No target users specified. Provide usernames/IDs or use --all."));
    printHelp();
    process.exit(1);
  }

  const database = new LibraryDatabase(options.dbDir);
  const targetUsers: { id: number; username: string; email: string; account_type?: string }[] = [];

  if (options.exportAll) {
    const all = database.getAllUsers();
    targetUsers.push(...all);
    if (targetUsers.length === 0) {
      console.log(c.yellow("No active users found in database to export."));
      process.exit(0);
    }
  } else {
    const notFound: string[] = [];
    for (const query of options.userQueries) {
      let user: any = null;
      const numericId = Number(query);
      if (!Number.isNaN(numericId) && numericId > 0) {
        user = database.getUserById(numericId);
      }
      if (!user) {
        user = database.getUserByUsername(query);
      }
      if (user) {
        if (!targetUsers.some((u) => u.id === user.id)) {
          targetUsers.push(user);
        }
      } else {
        notFound.push(query);
      }
    }

    if (notFound.length > 0) {
      console.warn(c.yellow(`\nWarning: Could not find user(s): ${notFound.join(", ")}`));
    }

    if (targetUsers.length === 0) {
      console.error(c.red("Error: None of the specified users could be resolved in the database."));
      process.exit(1);
    }
  }

  // Ensure output directory exists
  fs.mkdirSync(options.outputDir, { recursive: true });

  // Prepare batch jobs
  const jobs: BatchJob[] = targetUsers.map((user, idx) => {
    let targetPath: string;
    if (options.explicitOutputFile && targetUsers.length === 1) {
      targetPath = options.explicitOutputFile;
    } else {
      const ext = options.format === "json" ? "json" : "zip";
      targetPath = path.join(options.outputDir, `modelscript-archive-${user.username}.${ext}`);
    }

    return {
      index: idx + 1,
      user,
      format: options.format,
      outputPath: targetPath,
      status: "queued",
    };
  });

  // Print Header Banner
  console.log("");
  console.log(c.bold("┌────────────────────────────────────────────────────────────────────────┐"));
  console.log(c.bold("│          ModelScript GDPR / CCPA Data Archive Batch Processor          │"));
  console.log(c.bold("└────────────────────────────────────────────────────────────────────────┘"));
  console.log(`  ${c.dim("Regulation:")}        GDPR Art. 20 / CCPA § 1798.100 Data Portability`);
  console.log(`  ${c.dim("Target Users:")}      ${c.bold(String(jobs.length))} user(s) queued for export`);
  console.log(
    `  ${c.dim("Concurrency:")}       ${c.green(String(options.concurrency))} parallel worker slots (${c.dim(`limit: ${options.concurrency}`)})`,
  );
  console.log(
    `  ${c.dim("Format:")}            ${c.cyan(options.format.toUpperCase())} ${options.format === "zip" ? "(with offline HTML viewer)" : "(raw JSON)"}`,
  );
  console.log(`  ${c.dim("Output Directory:")}  ${options.outputDir}`);
  console.log(c.dim("──────────────────────────────────────────────────────────────────────────"));
  console.log("");

  const startTime = Date.now();
  let completedCount = 0;
  let failedCount = 0;
  let totalBytes = 0;
  let nextJobIdx = 0;

  // Active worker status for dynamic CLI display
  const activeWorkerMap = new Map<number, { user: string; startedAt: number }>();

  function updateStatusLine(): void {
    if (options.quiet || !process.stdout.isTTY) return;
    const progress = renderProgressBar(completedCount + failedCount, jobs.length);
    const active = activeWorkerMap.size;
    const remaining = jobs.length - (completedCount + failedCount);
    process.stdout.write(
      `\r  ${progress} ${c.bold(`${completedCount + failedCount}/${jobs.length}`)} | ${c.blue(`Active: ${active}`)} | ${c.yellow(`Queued: ${remaining}`)} | ${c.green(`Done: ${completedCount}`)}${failedCount > 0 ? ` | ${c.red(`Fail: ${failedCount}`)}` : ""}`,
    );
  }

  async function worker(workerId: number): Promise<void> {
    while (nextJobIdx < jobs.length) {
      const job = jobs[nextJobIdx++];
      if (!job) break;

      job.status = "processing";
      job.workerId = workerId;
      job.startedAt = Date.now();
      activeWorkerMap.set(workerId, { user: job.user.username, startedAt: job.startedAt });
      updateStatusLine();

      try {
        if (job.format === "zip") {
          const zipBuffer = generateUserArchiveZip(database, job.user.id);
          if (!zipBuffer) {
            throw new Error("Failed to generate archive: user record or data missing.");
          }
          fs.writeFileSync(job.outputPath, zipBuffer);
          job.fileSizeBytes = zipBuffer.length;
        } else {
          const bundle = gatherUserDataBundle(database, job.user.id);
          if (!bundle) {
            throw new Error("Failed to gather user data: user record missing.");
          }
          const jsonStr = JSON.stringify(bundle, null, 2);
          fs.writeFileSync(job.outputPath, jsonStr, "utf-8");
          job.fileSizeBytes = Buffer.byteLength(jsonStr, "utf-8");
        }

        job.completedAt = Date.now();
        job.durationMs = job.completedAt - job.startedAt;
        job.status = "completed";
        completedCount++;
        totalBytes += job.fileSizeBytes || 0;

        activeWorkerMap.delete(workerId);

        // Print completion log line
        if (process.stdout.isTTY) {
          process.stdout.write("\r\x1b[K"); // clear current line
        }
        const sizeStr = formatBytes(job.fileSizeBytes || 0);
        console.log(
          `  ${c.green("✔")} [${job.index}/${jobs.length}] @${c.bold(job.user.username.padEnd(14))} -> ${path.basename(job.outputPath)} ${c.dim(`(${sizeStr}, ${job.durationMs}ms)`)}`,
        );
        updateStatusLine();
      } catch (err: any) {
        job.completedAt = Date.now();
        job.durationMs = job.completedAt - (job.startedAt || Date.now());
        job.status = "failed";
        job.error = err.message || "Unknown export error";
        failedCount++;

        activeWorkerMap.delete(workerId);

        if (process.stdout.isTTY) {
          process.stdout.write("\r\x1b[K");
        }
        console.log(
          `  ${c.red("✖")} [${job.index}/${jobs.length}] @${c.bold(job.user.username.padEnd(14))} -> ${c.red(`FAILED: ${job.error}`)} ${c.dim(`(${job.durationMs}ms)`)}`,
        );
        updateStatusLine();
      }
    }
  }

  // Spawn concurrency-limited workers
  const workerCount = Math.min(options.concurrency, jobs.length);
  const workers: Promise<void>[] = [];
  for (let i = 0; i < workerCount; i++) {
    workers.push(worker(i + 1));
  }

  await Promise.all(workers);

  if (process.stdout.isTTY) {
    process.stdout.write("\r\x1b[K");
  }

  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);
  const throughput = jobs.length > 0 ? (jobs.length / Math.max(0.1, Number(totalDuration))).toFixed(1) : "0";

  // Print Summary Table
  console.log("");
  console.log(c.bold("┌────────────────────────────────────────────────────────────────────────┐"));
  console.log(c.bold("│                        Batch Export Summary                            │"));
  console.log(c.bold("└────────────────────────────────────────────────────────────────────────┘"));
  console.log(`  ${c.dim("Total Jobs:")}         ${jobs.length}`);
  console.log(`  ${c.dim("Successful:")}         ${c.green(String(completedCount))}`);
  if (failedCount > 0) {
    console.log(`  ${c.dim("Failed:")}             ${c.red(String(failedCount))}`);
  }
  console.log(`  ${c.dim("Total Data Size:")}    ${formatBytes(totalBytes)}`);
  console.log(`  ${c.dim("Total Elapsed:")}      ${totalDuration}s (${c.cyan(`${throughput} archives/sec`)})`);
  console.log(`  ${c.dim("Concurrency Limit:")}  ${options.concurrency} workers`);
  console.log(`  ${c.dim("Staging Location:")}   ${options.outputDir}`);
  console.log(c.dim("──────────────────────────────────────────────────────────────────────────"));

  if (jobs.length === 1 && completedCount === 1) {
    const singleJob = jobs[0]!;
    console.log(`\n${c.bold("To inspect this single archive:")}`);
    console.log(`  1. Extract ${path.basename(singleJob.outputPath)}`);
    console.log(`  2. Double-click "index.html" to open the interactive viewer offline.\n`);
  } else {
    console.log(`\n${c.green("Batch process completed successfully.")}\n`);
  }

  if (failedCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(c.red("\nFatal error during batch export:"), err);
  process.exit(1);
});
