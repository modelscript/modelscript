// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";
import { getApiUrl, getToken } from "../util/auth.js";
import type { SimulateArgs } from "./simulate.js";

export interface CloudSimulationResult {
  jobId: string;
  resultPath?: string;
  costCredits?: number;
  runtimeSeconds?: number;
  csvContent?: string;
}

export interface SimulateCloudOptions {
  exitOnError?: boolean;
}

/**
 * Dispatches a Modelica simulation to the remote ModelScript HPC API.
 */
export async function simulateCloud(
  args: SimulateArgs,
  options: SimulateCloudOptions = { exitOnError: true },
): Promise<CloudSimulationResult> {
  const apiUrl = (args.apiUrl ?? args["api-url"] ?? getApiUrl()).replace(/\/+$/, "");
  const token = getToken();

  if (!token) {
    const msg =
      "Error: Authentication required for cloud bursting. Please log in using 'msc login' or set MODELSCRIPT_API_TOKEN.";
    if (options.exitOnError) {
      console.error(msg);
      process.exit(1);
    }
    throw new Error(msg);
  }

  // Collect Modelica source from paths
  let modelSource = "";
  for (const p of args.paths) {
    if (fs.existsSync(p)) {
      const stat = fs.statSync(p);
      if (stat.isFile()) {
        const content = fs.readFileSync(p, "utf-8");
        modelSource += (modelSource ? "\n" : "") + content;
      } else if (stat.isDirectory()) {
        const walk = (dir: string) => {
          for (const item of fs.readdirSync(dir)) {
            const full = path.join(dir, item);
            if (fs.statSync(full).isDirectory()) {
              walk(full);
            } else if (full.endsWith(".mo")) {
              modelSource += "\n" + fs.readFileSync(full, "utf-8");
            }
          }
        };
        walk(p);
      }
    }
  }

  if (!modelSource.trim()) {
    const msg = `Error: Could not read any Modelica source files from: ${args.paths.join(", ")}`;
    if (options.exitOnError) {
      console.error(msg);
      process.exit(1);
    }
    throw new Error(msg);
  }

  const profile = args.profile || "standard";
  const stopTime = args.stopTime ?? args["stop-time"] ?? 10;
  const startTime = args.startTime ?? args["start-time"] ?? 0;
  const interval = args.interval;
  const numberOfIntervals = interval ? Math.max(1, Math.round((stopTime - startTime) / interval)) : undefined;

  const payload: Record<string, unknown> = {
    modelName: args.name,
    modelSource,
    profile,
  };
  if (numberOfIntervals !== undefined) {
    payload.numberOfIntervals = numberOfIntervals;
  }

  console.log(`[Cloud Burst] Dispatching simulation to ModelScript HPC (${apiUrl})...`);
  console.log(`  Model: ${args.name}`);
  console.log(`  Compute Profile: ${profile}`);

  let res: Response;
  try {
    res = await fetch(`${apiUrl}/api/v1/simulate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (err: any) {
    const msg = `Error: Could not connect to ModelScript API at ${apiUrl}: ${err.message}`;
    if (options.exitOnError) {
      console.error(msg);
      process.exit(1);
    }
    throw new Error(msg, { cause: err });
  }

  if (res.status === 401) {
    const msg = "Error: Unauthorized (401). Your session token is invalid or expired. Please run 'msc login'.";
    if (options.exitOnError) {
      console.error(msg);
      process.exit(1);
    }
    throw new Error(msg);
  }

  if (res.status === 402) {
    const errData = (await res.json().catch(() => ({}))) as any;
    const msg = `Payment Required (402) - Insufficient Compute Credits: ${errData.message || "Balance too low"}. Required: ${errData.required ?? "?"}, Balance: ${errData.balance ?? "?"}`;
    if (options.exitOnError) {
      console.error("\x1b[31mError: Payment Required (402) - Insufficient Compute Credits\x1b[0m");
      if (errData.message) console.error(`  ${errData.message}`);
      if (errData.balance !== undefined && errData.required !== undefined) {
        console.error(
          `  Current Balance: ${errData.balance} credits | Required: ${errData.required} credits (Profile: '${errData.profile || profile}')`,
        );
      }
      console.error(`  Top up your compute credits at: ${apiUrl}/settings or contact your administrator.`);
      process.exit(1);
    }
    throw new Error(msg);
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    const msg = `Error: Cloud simulation request failed (${res.status} ${res.statusText}): ${errText}`;
    if (options.exitOnError) {
      console.error(msg);
      process.exit(1);
    }
    throw new Error(msg);
  }

  const data = (await res.json()) as { jobId: string };
  const jobId = data.jobId;

  if (args.async) {
    console.log(`\n\x1b[32m✔ Cloud simulation submitted successfully.\x1b[0m`);
    console.log(`  Job ID: ${jobId}`);
    console.log(`  Status check: GET ${apiUrl}/api/v1/simulate/${jobId}`);
    return { jobId };
  }

  console.log(`  Job ID: ${jobId}`);
  console.log(`[Cloud Burst] Waiting for execution...`);

  const pollInterval = args.pollInterval ?? args["poll-interval"] ?? 1500;
  const startWait = Date.now();

  while (true) {
    await new Promise((r) => setTimeout(r, pollInterval));
    let statusRes: Response;
    try {
      statusRes = await fetch(`${apiUrl}/api/v1/simulate/${jobId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      continue;
    }

    if (!statusRes.ok) {
      continue;
    }

    const statusData = (await statusRes.json()) as any;
    const elapsedSec = ((Date.now() - startWait) / 1000).toFixed(1);
    const normalizedStatus = String(statusData.status || "").toLowerCase();

    if (normalizedStatus === "running" || normalizedStatus === "processing") {
      process.stdout.write(`\r[Cloud Burst] Running on HPC cluster (${elapsedSec}s)... `);
    } else if (normalizedStatus === "queued" || normalizedStatus === "pending") {
      process.stdout.write(`\r[Cloud Burst] Queued in scheduler (${elapsedSec}s)... `);
    } else if (normalizedStatus === "success" || normalizedStatus === "completed") {
      console.log(`\n\x1b[32m✔ Simulation completed successfully in ${elapsedSec}s!\x1b[0m`);
      if (statusData.usage) {
        console.log(`  Compute Credits Billed: ${statusData.usage.costCredits ?? "0.00"}`);
        console.log(`  Native HPC Exit Code: ${statusData.usage.exitCode ?? 0}`);
      }

      // Download result
      const resultRes = await fetch(`${apiUrl}/api/v1/simulate/${jobId}/result`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!resultRes.ok) {
        const msg = `Error: Could not retrieve simulation results (${resultRes.status} ${resultRes.statusText})`;
        if (options.exitOnError) {
          console.error(msg);
          process.exit(1);
        }
        throw new Error(msg);
      }

      const csvData = await resultRes.text();
      const outDir = path.resolve(args.outputDir ?? args["output-dir"] ?? "./results");
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }

      const fileNamePrefix = args.name.replace(/\./g, "_");
      const outFilePath = path.join(outDir, `${fileNamePrefix}_res.csv`);
      fs.writeFileSync(outFilePath, csvData, "utf-8");

      console.log(`  Result file saved to: ${outFilePath} (${csvData.length} bytes)`);

      const lines = csvData.trim().split("\n");
      const firstLine = lines[0];
      if (firstLine && lines.length > 1) {
        console.log(`  Variables recorded: ${firstLine.split(",").length}`);
        console.log(`  Time steps recorded: ${lines.length - 1}`);
      }

      return {
        jobId,
        resultPath: outFilePath,
        costCredits: statusData.usage?.costCredits,
        runtimeSeconds: parseFloat(elapsedSec),
        csvContent: csvData,
      };
    } else if (normalizedStatus === "failed") {
      console.log(`\n\x1b[31m✖ Simulation failed on remote cluster (${elapsedSec}s).\x1b[0m`);
      const msg = `Simulation failed on remote cluster: ${statusData.error || "Unknown error"}`;
      if (statusData.error) {
        console.error(`  Details: ${statusData.error}`);
      }
      if (options.exitOnError) {
        process.exit(1);
      }
      throw new Error(msg);
    }
  }
}
