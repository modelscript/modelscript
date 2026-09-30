// SPDX-License-Identifier: AGPL-3.0-or-later

import type { HpcJobSpec } from "./hpc-types.js";
import type { JobStagingManifest } from "./staging/staging-types.js";

/**
 * Generates a reproducible, standard Slurm `#SBATCH` submission script,
 * optionally including storage staging prologue and epilogue scripts.
 */
export function generateSbatchScript(spec: HpcJobSpec, stagingManifest?: JobStagingManifest): string {
  const r = spec.resources;
  const manifest = stagingManifest || spec.stagingManifest;
  const lines: string[] = ["#!/bin/bash"];

  // Core Slurm job directives
  lines.push(`#SBATCH --job-name=${spec.name || spec.jobId}`);
  lines.push("#SBATCH --output=slurm-%j.out");
  lines.push("#SBATCH --error=slurm-%j.err");

  const nodes = r.nodes ?? 1;
  const tasksPerNode = r.tasksPerNode ?? 1;
  const cpusPerTask = r.cpusPerTask ?? 4;

  lines.push(`#SBATCH --nodes=${nodes}`);
  lines.push(`#SBATCH --ntasks-per-node=${tasksPerNode}`);
  lines.push(`#SBATCH --cpus-per-task=${cpusPerTask}`);

  if (r.partition) {
    lines.push(`#SBATCH --partition=${r.partition}`);
  }

  if (r.memoryMb && r.memoryMb > 0) {
    lines.push(`#SBATCH --mem=${r.memoryMb}M`);
  }

  if (r.timeLimitMinutes && r.timeLimitMinutes > 0) {
    const hours = Math.floor(r.timeLimitMinutes / 60);
    const mins = r.timeLimitMinutes % 60;
    lines.push(`#SBATCH --time=${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:00`);
  }

  if (r.gpus && r.gpus > 0) {
    const gpuSpec = r.gpuType ? `gpu:${r.gpuType}:${r.gpus}` : `gpu:${r.gpus}`;
    lines.push(`#SBATCH --gres=${gpuSpec}`);
  }

  if (r.account) {
    lines.push(`#SBATCH --account=${r.account}`);
  }

  if (r.qos) {
    lines.push(`#SBATCH --qos=${r.qos}`);
  }

  lines.push("");
  lines.push("# --- Environment & Threading Setup ---");
  lines.push(`export OMP_NUM_THREADS=${cpusPerTask}`);

  if (spec.env) {
    for (const [key, value] of Object.entries(spec.env)) {
      lines.push(`export ${key}="${value}"`);
    }
  }

  if (spec.modules && spec.modules.length > 0) {
    lines.push("");
    lines.push("# --- Environment Modules ---");
    for (const mod of spec.modules) {
      lines.push(`module load ${mod}`);
    }
  }

  if (manifest?.prologueScript) {
    lines.push("");
    lines.push(manifest.prologueScript);
  }

  const networkIsolation = spec.sandbox?.networkIsolation ?? spec.resources.networkIsolation ?? false;

  if (networkIsolation) {
    lines.push("");
    lines.push("# --- Security & Zero-Egress Network Isolation ---");
    lines.push("# Blocks all outbound network access to prevent cryptomining and data exfiltration");
  }

  lines.push("");
  lines.push("# --- Execution Command ---");

  const fullArgs = spec.args.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ");
  let baseCmd = fullArgs ? `${spec.command} ${fullArgs}` : spec.command;

  // Wrap in Apptainer / Singularity if specified
  if (spec.apptainerImage) {
    const gpuFlag = r.gpus && r.gpus > 0 ? " --nv" : "";
    const netFlag = networkIsolation ? " --net --network none" : "";
    baseCmd = `apptainer exec${gpuFlag}${netFlag} ${spec.apptainerImage} ${baseCmd}`;
  } else if (networkIsolation) {
    // Native network namespace isolation (zero-egress sandbox)
    baseCmd = `unshare -n -r ${baseCmd}`;
  }

  // Wrap in srun for parallel MPI collective execution
  if (tasksPerNode > 1 || nodes > 1) {
    lines.push(`srun ${baseCmd}`);
  } else {
    lines.push(baseCmd);
  }

  if (manifest?.epilogueScript) {
    lines.push("CMD_EXIT=$?");
    lines.push("");
    lines.push(manifest.epilogueScript);
    lines.push("exit $CMD_EXIT");
  }

  return lines.join("\n") + "\n";
}
