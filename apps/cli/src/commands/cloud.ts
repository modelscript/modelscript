// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";
import type { ArgumentsCamelCase, Argv, CommandModule } from "yargs";
import { getApiUrl, getToken } from "../util/auth.js";

interface CloudArgs {
  action?: string | undefined;
  target?: string | undefined;
  profile?: string | undefined;
  domain?: string | undefined;
  follow?: boolean | undefined;
  output?: string | undefined;
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
};

interface CloudStreamEvent {
  type?: string | undefined;
  logs?: string[] | undefined;
  status?: string | undefined;
  data?: { status?: string | undefined; error?: string | undefined } | string | undefined;
}

interface CloudComputeProfile {
  id: string;
  name: string;
  cpus: number;
  memoryMb: number;
  gpus?: number | undefined;
  gpuType?: string | undefined;
  costCreditsPerHour: number;
}

interface CloudWalletBalance {
  userId?: string | undefined;
  balance?: number | undefined;
  totalSpent?: number | undefined;
  totalJobs?: number | undefined;
}

interface CloudJobSummary {
  jobId: string;
  name: string;
  domain?: string | undefined;
  profile?: string | undefined;
  status: string;
  costCredits?: number | undefined;
  elapsedSeconds?: number | undefined;
  usage?: { costCredits?: number | undefined } | undefined;
  hasResult?: boolean | undefined;
  error?: string | undefined;
}

async function streamJobEvents(apiUrl: string, jobId: string, headers: Record<string, string>): Promise<void> {
  const res = await fetch(`${apiUrl}/api/v1/cloud/jobs/${jobId}/events`, {
    headers: { ...headers, Accept: "text/event-stream" },
  });
  if (!res.ok || !res.body) {
    throw new Error(`Failed to attach to event stream (${res.status} ${res.statusText})`);
  }

  console.log(`\n${c.bold(`--- Streaming Live Events for ${jobId} ---`)}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() || "";

    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith("data:")) continue;
      try {
        const evt = JSON.parse(line.slice(5).trim()) as CloudStreamEvent;
        if (evt.type === "init" && Array.isArray(evt.logs)) {
          for (const l of evt.logs) console.log(l);
          if (evt.status === "completed" || evt.status === "failed" || evt.status === "cancelled") {
            return;
          }
        } else if (evt.type === "log") {
          console.log(String(evt.data));
        } else if (evt.type === "status") {
          const dataObj = typeof evt.data === "object" && evt.data !== null ? evt.data : undefined;
          const st = dataObj?.status;
          if (st === "completed") {
            console.log(c.green(`✔ Job ${jobId} completed.`));
            return;
          } else if (st === "failed" || st === "cancelled") {
            console.error(c.red(`✖ Job ${jobId} ${st}: ${dataObj?.error || ""}`));
            return;
          }
        }
      } catch {
        // ignore malformed chunk
      }
    }
  }
}

export const Cloud: CommandModule<Record<string, unknown>, CloudArgs> = {
  command: "cloud <action> [target]",
  describe: "Manage cloud HPC jobs, compute profiles, credit wallet, and live telemetry",
  builder: (yargs: Argv) => {
    return yargs
      .positional("action", {
        type: "string",
        describe: "Action to perform: profiles | balance | jobs | status | logs | cancel | download | dispatch",
        choices: ["profiles", "balance", "wallet", "jobs", "list", "status", "logs", "cancel", "download", "dispatch"],
      })
      .positional("target", {
        type: "string",
        describe: "Target Job ID or file path to dispatch",
      })
      .option("profile", {
        type: "string",
        alias: "p",
        describe: "Compute profile ID (standard, high-memory, gpu-a100, hpc-mpi-64)",
      })
      .option("domain", {
        type: "string",
        alias: "d",
        describe: "Simulation domain (modelica, cfd, fea, monte-carlo)",
      })
      .option("follow", {
        type: "boolean",
        alias: "f",
        describe: "Follow log stream in real time",
      })
      .option("output", {
        type: "string",
        alias: "o",
        describe: "Output path for downloaded artifacts",
      })
      .option("api-url", {
        type: "string",
        describe: "ModelScript API server URL",
      });
  },
  handler: async (args: ArgumentsCamelCase<CloudArgs>) => {
    const action = args.action?.toLowerCase();
    const apiUrl = (args.apiUrl ?? getApiUrl()).replace(/\/+$/, "");
    const token = getToken();

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    switch (action) {
      case "profiles": {
        try {
          const res = await fetch(`${apiUrl}/api/v1/cloud/profiles`, { headers });
          if (!res.ok) {
            console.error(`Error: Failed to fetch profiles (${res.status} ${res.statusText})`);
            process.exit(1);
          }
          const data = (await res.json()) as { profiles: CloudComputeProfile[] };
          console.log(`\n${c.bold(`ModelScript Cloud Compute Profiles (${apiUrl})`)}\n`);
          console.log(
            `${"PROFILE ID".padEnd(16)} ${"NAME".padEnd(28)} ${"VCPUS".padEnd(8)} ${"RAM".padEnd(10)} ${"GPUS".padEnd(10)} ${"COST (CR/HR)"}`,
          );
          console.log("-".repeat(84));
          for (const p of data.profiles) {
            const gpus = p.gpus ? `${p.gpus}x ${p.gpuType || "GPU"}` : "None";
            const ramGb = `${(p.memoryMb / 1024).toFixed(0)} GB`;
            console.log(
              `${p.id.padEnd(16)} ${p.name.padEnd(28)} ${String(p.cpus).padEnd(8)} ${ramGb.padEnd(10)} ${gpus.padEnd(10)} ${p.costCreditsPerHour.toFixed(1)} cr/hr`,
            );
          }
          console.log("");
        } catch (err: unknown) {
          console.error(`Failed to connect to ${apiUrl}: ${err instanceof Error ? err.message : String(err)}`);
          process.exit(1);
        }
        break;
      }

      case "balance":
      case "wallet": {
        try {
          const res = await fetch(`${apiUrl}/api/v1/cloud/balance`, { headers });
          if (!res.ok) {
            if (res.status === 401) {
              console.error("Error: Authentication required. Please run 'msx login' or set MODELSCRIPT_API_TOKEN.");
            } else {
              console.error(`Error: Failed to fetch balance (${res.status} ${res.statusText})`);
            }
            process.exit(1);
          }
          const data = (await res.json()) as CloudWalletBalance;
          console.log(`\n${c.bold("ModelScript Cloud Credit Wallet")}`);
          console.log(`  User ID:        ${data.userId ?? "Default"}`);
          console.log(`  Current Balance: ${c.green(`${Number(data.balance ?? 0).toFixed(2)} Credits`)}`);
          if (data.totalSpent !== undefined) {
            console.log(`  Lifetime Spent:  ${Number(data.totalSpent).toFixed(2)} Credits`);
          }
          if (data.totalJobs !== undefined) {
            console.log(`  Jobs Dispatched: ${data.totalJobs}`);
          }
          console.log("");
        } catch (err: unknown) {
          console.error(`Failed to connect to ${apiUrl}: ${err instanceof Error ? err.message : String(err)}`);
          process.exit(1);
        }
        break;
      }

      case "jobs":
      case "list": {
        try {
          const res = await fetch(`${apiUrl}/api/v1/cloud/jobs`, { headers });
          if (!res.ok) {
            console.error(`Error: Failed to list jobs (${res.status} ${res.statusText})`);
            process.exit(1);
          }
          const data = (await res.json()) as { jobs: CloudJobSummary[] };
          console.log(`\n${c.bold(`ModelScript Cloud Jobs (${apiUrl})`)}\n`);
          if (data.jobs.length === 0) {
            console.log("  No active or historical jobs found.\n");
            return;
          }
          console.log(
            `${"JOB ID".padEnd(28)} ${"DOMAIN".padEnd(12)} ${"PROFILE".padEnd(14)} ${"STATUS".padEnd(12)} ${"COST".padEnd(10)} NAME`,
          );
          console.log("-".repeat(90));
          for (const j of data.jobs) {
            let statusStr = j.status;
            if (j.status === "completed") statusStr = c.green(j.status);
            else if (j.status === "running") statusStr = c.blue(j.status);
            else if (j.status === "failed") statusStr = c.red(j.status);
            else if (j.status === "queued") statusStr = c.yellow(j.status);

            const cost = j.costCredits !== undefined ? `${Number(j.costCredits).toFixed(2)} cr` : "-";
            const paddedStatus = useColor()
              ? statusStr + " ".repeat(Math.max(0, 12 - j.status.length))
              : statusStr.padEnd(12);
            console.log(
              `${j.jobId.padEnd(28)} ${(j.domain || "sim").padEnd(12)} ${(j.profile || "standard").padEnd(14)} ${paddedStatus} ${cost.padEnd(10)} ${j.name}`,
            );
          }
          console.log("");
        } catch (err: unknown) {
          console.error(`Failed to connect to ${apiUrl}: ${err instanceof Error ? err.message : String(err)}`);
          process.exit(1);
        }
        break;
      }

      case "status": {
        const jobId = args.target;
        if (!jobId) {
          console.error("Error: Job ID required. Usage: msx cloud status <jobId>");
          process.exit(1);
        }
        try {
          const res = await fetch(`${apiUrl}/api/v1/cloud/jobs/${jobId}`, { headers });
          if (!res.ok) {
            console.error(`Error: Failed to fetch status for job '${jobId}' (${res.status} ${res.statusText})`);
            process.exit(1);
          }
          const data = (await res.json()) as CloudJobSummary;
          console.log(`\n${c.bold(`Job Status: ${data.jobId}`)}`);
          console.log(`  Name:           ${data.name}`);
          console.log(`  Domain:         ${data.domain}`);
          console.log(`  Profile:        ${data.profile}`);
          console.log(`  Status:         ${data.status}`);
          console.log(`  Elapsed:        ${data.elapsedSeconds}s`);
          if (data.usage?.costCredits !== undefined) {
            console.log(`  Credits Billed: ${data.usage.costCredits.toFixed(2)}`);
          }
          if (data.hasResult) {
            console.log(`  Result Ready:   Yes (Download: 'msx cloud download ${jobId}')`);
          }
          if (data.error) {
            console.log(`  ${c.red(`Error:          ${data.error}`)}`);
          }
          console.log("");
        } catch (err: unknown) {
          console.error(`Failed to connect to ${apiUrl}: ${err instanceof Error ? err.message : String(err)}`);
          process.exit(1);
        }
        break;
      }

      case "logs": {
        const jobId = args.target;
        if (!jobId) {
          console.error("Error: Job ID required. Usage: msx cloud logs <jobId>");
          process.exit(1);
        }
        try {
          if (args.follow) {
            await streamJobEvents(apiUrl, jobId, headers);
            break;
          }
          const res = await fetch(`${apiUrl}/api/v1/cloud/jobs/${jobId}/logs`, { headers });
          if (!res.ok) {
            console.error(`Error: Failed to fetch logs (${res.status} ${res.statusText})`);
            process.exit(1);
          }
          const data = (await res.json()) as { logs: string[] };
          console.log(`\n${c.bold(`--- Logs for ${jobId} ---`)}`);
          for (const l of data.logs) {
            console.log(l);
          }
          console.log("");
        } catch (err: unknown) {
          console.error(`Failed to connect to ${apiUrl}: ${err instanceof Error ? err.message : String(err)}`);
          process.exit(1);
        }
        break;
      }

      case "cancel": {
        const jobId = args.target;
        if (!jobId) {
          console.error("Error: Job ID required. Usage: msx cloud cancel <jobId>");
          process.exit(1);
        }
        try {
          const res = await fetch(`${apiUrl}/api/v1/cloud/jobs/${jobId}/cancel`, {
            method: "POST",
            headers,
          });
          if (!res.ok) {
            console.error(`Error: Failed to cancel job (${res.status} ${res.statusText})`);
            process.exit(1);
          }
          console.log(c.green(`✔ Job ${jobId} cancelled successfully.`));
        } catch (err: unknown) {
          console.error(`Failed to connect to ${apiUrl}: ${err instanceof Error ? err.message : String(err)}`);
          process.exit(1);
        }
        break;
      }

      case "download": {
        const jobId = args.target;
        if (!jobId) {
          console.error("Error: Job ID required. Usage: msx cloud download <jobId>");
          process.exit(1);
        }
        try {
          const res = await fetch(`${apiUrl}/api/v1/cloud/jobs/${jobId}/result`, { headers });
          if (!res.ok) {
            console.error(`Error: Result not available (${res.status} ${res.statusText})`);
            process.exit(1);
          }
          const disposition = res.headers.get("content-disposition") || "";
          let fileName = `result_${path.basename(jobId)}.dat`;
          const match = disposition.match(/filename="?([^";]+)"?/);
          if (match && match[1]) {
            fileName = path.basename(match[1]) || fileName;
          }

          const outPath = args.output ? path.resolve(args.output) : path.join(process.cwd(), fileName);
          const buf = Buffer.from(await res.arrayBuffer());
          fs.writeFileSync(outPath, buf);
          console.log(c.green(`✔ Result downloaded: ${outPath} (${buf.length} bytes)`));
        } catch (err: unknown) {
          console.error(`Download failed: ${err instanceof Error ? err.message : String(err)}`);
          process.exit(1);
        }
        break;
      }

      case "dispatch": {
        const filePath = args.target;
        if (!filePath || !fs.existsSync(filePath)) {
          console.error(
            "Error: Valid file required. Usage: msx cloud dispatch <file.mo|file.cfg|file.inp> [--profile=standard]",
          );
          process.exit(1);
        }
        const ext = path.extname(filePath).toLowerCase();
        let domain = args.domain || "modelica";
        if (ext === ".cfg") domain = "cfd";
        else if (ext === ".inp") domain = "fea";

        const content = fs.readFileSync(filePath, "utf-8");
        const fileName = path.basename(filePath);
        const modelName = fileName.replace(/\.[^.]+$/, "");

        const profile = args.profile || "standard";
        console.log(`[Cloud] Dispatching ${domain.toUpperCase()} model '${modelName}' using profile '${profile}'...`);

        try {
          const payload: {
            domain: string;
            name: string;
            profile: string;
            deck?: { content: string; format: string } | undefined;
            sourceContent?: string | undefined;
          } = {
            domain,
            name: modelName,
            profile,
          };
          if (domain === "cfd" || domain === "fea") {
            payload.deck = { content, format: ext.replace(".", "") };
          } else {
            payload.sourceContent = content;
          }

          const res = await fetch(`${apiUrl}/api/v1/cloud/dispatch`, {
            method: "POST",
            headers,
            body: JSON.stringify(payload),
          });

          if (res.status === 402) {
            const errData = (await res.json().catch(() => ({}))) as { message?: string | undefined };
            console.error(c.red(`Payment Required (402) - Insufficient Compute Credits`));
            if (errData.message) console.error(`  ${errData.message}`);
            process.exit(1);
          }

          if (!res.ok) {
            console.error(`Dispatch failed (${res.status} ${res.statusText}): ${await res.text()}`);
            process.exit(1);
          }

          const data = (await res.json()) as { jobId: string };
          console.log(c.green(`✔ Job dispatched successfully!`));
          console.log(`  Job ID: ${data.jobId}`);
          if (args.follow) {
            await streamJobEvents(apiUrl, data.jobId, headers);
          } else {
            console.log(`  Check status: msx cloud status ${data.jobId}`);
            console.log(`  View logs:    msx cloud logs ${data.jobId}`);
          }
        } catch (err: unknown) {
          console.error(`Dispatch failed: ${err instanceof Error ? err.message : String(err)}`);
          process.exit(1);
        }
        break;
      }

      default: {
        console.log("Usage: msx cloud <action> [options]");
        console.log("Actions:");
        console.log("  profiles               List cloud compute hardware tiers & costs");
        console.log("  balance                View account credits and wallet status");
        console.log("  jobs                   List active and historical cloud jobs");
        console.log("  status <jobId>         Inspect status of a specific job");
        console.log("  logs <jobId>           View execution logs");
        console.log("  cancel <jobId>         Cancel a running job");
        console.log("  download <jobId>       Download job output artifacts");
        console.log("  dispatch <file>        One-command cloud dispatch");
        break;
      }
    }
  },
};
