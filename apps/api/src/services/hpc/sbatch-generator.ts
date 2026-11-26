// SPDX-License-Identifier: AGPL-3.0-or-later

import type { HpcJobSpec } from "./hpc-types.js";
import type { JobStagingManifest } from "./staging/staging-types.js";

/**
 * Sanitizes a value used in a `#SBATCH` directive or module name,
 * stripping newlines and restricting to safe token characters.
 */
export function sanitizeSlurmToken(value: string | undefined, fallback = "default"): string {
  if (!value) return fallback;
  const firstLine = value.split(/[\r\n]/)[0] ?? "";
  const cleaned = firstLine.replace(/[^a-zA-Z0-9._:/@-]/g, "_");
  return cleaned.length > 0 ? cleaned : fallback;
}

/**
 * Validates that an environment variable name is a valid POSIX identifier.
 */
export function isValidEnvKey(key: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key);
}

/**
 * Dangerous environment variables that can hijack dynamic linkers, shells, or runtimes.
 */
const BLOCKED_USER_ENV_KEYS = new Set([
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "LD_AUDIT",
  "LD_DEBUG",
  "LD_PROFILE",
  "DYLD_INSERT_LIBRARIES",
  "DYLD_LIBRARY_PATH",
  "DYLD_FRAMEWORK_PATH",
  "BASH_ENV",
  "ENV",
  "PROMPT_COMMAND",
  "SHELLOPTS",
  "BASHOPTS",
  "PS4",
  "PATH",
  "HOME",
  "SHELL",
  "IFS",
  "CDPATH",
  "GLOBIGNORE",
  "TMPDIR",
  "PYTHONPATH",
  "PYTHONSTARTUP",
  "PYTHONHOME",
  "NODE_OPTIONS",
  "NODE_EXTRA_CA_CERTS",
  "PERL5OPT",
  "PERL5LIB",
  "RUBYOPT",
  "RUBYLIB",
  "JAVA_TOOL_OPTIONS",
  "_JAVA_OPTIONS",
  "CLASSPATH",
  "GOPATH",
  "GIT_SSH_COMMAND",
  "GIT_EXEC_PATH",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "JWT_SECRET",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "AWS_SECRET_ACCESS_KEY",
  "S3_SECRET_KEY",
  "TURNSTILE_SECRET_KEY",
  "GITLAB_TOKEN",
  "GITHUB_TOKEN",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "SLURM_JWT_TOKEN",
  "OIDC_CLIENT_SECRET",
  "SMTP_PASSWORD",
  "AUDIT_HMAC_SECRET",
  "TOTP_ENCRYPTION_KEY",
  "CLOUDFLARE_TUNNEL_TOKEN",
]);

const SENSITIVE_ENV_KEY_PATTERN = /_(SECRET|TOKEN|PASSWORD|PRIVATE_KEY|API_KEY|ENCRYPTION_KEY)$/i;

/**
 * Sanitizes user-supplied environment variables across all HPC drivers,
 * blocking linker/shell/runtime hijack variables, BASH_FUNC_*, and invalid keys.
 */
export function sanitizeUserEnv(env?: Record<string, string> | undefined): Record<string, string> {
  const safe: Record<string, string> = {};
  if (!env || typeof env !== "object") return safe;

  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== "string") continue;
    if (!isValidEnvKey(key)) continue;
    const upper = key.toUpperCase();
    if (upper.startsWith("BASH_FUNC_")) continue;
    if (BLOCKED_USER_ENV_KEYS.has(upper)) continue;
    if (SENSITIVE_ENV_KEY_PATTERN.test(upper)) continue;
    // Strip NUL bytes from values
    safe[key] = value.replace(/\0/g, "");
  }

  return safe;
}

/**
 * Escapes a string for safe inclusion inside bash double quotes (`"..."`),
 * neutralizing `$`, `` ` ``, `"`, `\`, NUL bytes, and newlines.
 */
export function escapeBashDoubleQuoted(value: string): string {
  return value
    .replace(/\0/g, "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, "\\$")
    .replace(/`/g, "\\`");
}

/**
 * Safely quotes a shell argument using POSIX single-quote escaping (`'` -> `'\''`),
 * stripping NUL bytes and normalizing newlines.
 */
export function quoteShellArg(arg: string): string {
  const clean = arg.replace(/\0/g, "").replace(/[\r\n]+/g, " ");
  if (clean.length === 0) return "''";
  if (/^[a-zA-Z0-9._:/@=-]+$/.test(clean)) {
    return clean;
  }
  return `'${clean.replace(/'/g, "'\\''")}'`;
}

/**
 * Generates a reproducible, standard Slurm `#SBATCH` submission script,
 * optionally including storage staging prologue and epilogue scripts.
 */
export function generateSbatchScript(spec: HpcJobSpec, stagingManifest?: JobStagingManifest): string {
  const r = spec.resources;
  const manifest = stagingManifest || spec.stagingManifest;
  const lines: string[] = ["#!/bin/bash"];

  // Core Slurm job directives
  const safeJobName = sanitizeSlurmToken(spec.name || spec.jobId, "modelscript-job");
  lines.push(`#SBATCH --job-name=${safeJobName}`);
  lines.push("#SBATCH --output=slurm-%j.out");
  lines.push("#SBATCH --error=slurm-%j.err");

  const nodes = Math.max(1, Math.floor(r.nodes ?? 1));
  const tasksPerNode = Math.max(1, Math.floor(r.tasksPerNode ?? 1));
  const cpusPerTask = Math.max(1, Math.floor(r.cpusPerTask ?? 4));

  lines.push(`#SBATCH --nodes=${nodes}`);
  lines.push(`#SBATCH --ntasks-per-node=${tasksPerNode}`);
  lines.push(`#SBATCH --cpus-per-task=${cpusPerTask}`);

  if (r.partition) {
    lines.push(`#SBATCH --partition=${sanitizeSlurmToken(r.partition, "compute")}`);
  }

  if (r.memoryMb && r.memoryMb > 0) {
    lines.push(`#SBATCH --mem=${Math.floor(r.memoryMb)}M`);
  }

  if (r.timeLimitMinutes && r.timeLimitMinutes > 0) {
    const hours = Math.floor(r.timeLimitMinutes / 60);
    const mins = Math.floor(r.timeLimitMinutes % 60);
    lines.push(`#SBATCH --time=${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:00`);
  }

  if (r.gpus && r.gpus > 0) {
    const gpuCount = Math.floor(r.gpus);
    const safeGpuType = r.gpuType ? sanitizeSlurmToken(r.gpuType, "gpu") : undefined;
    const gpuSpec = safeGpuType ? `gpu:${safeGpuType}:${gpuCount}` : `gpu:${gpuCount}`;
    lines.push(`#SBATCH --gres=${gpuSpec}`);
  }

  if (r.account) {
    lines.push(`#SBATCH --account=${sanitizeSlurmToken(r.account, "default")}`);
  }

  if (r.qos) {
    lines.push(`#SBATCH --qos=${sanitizeSlurmToken(r.qos, "normal")}`);
  }

  lines.push("");
  lines.push("# --- Environment & Threading Setup ---");
  lines.push(`export OMP_NUM_THREADS=${cpusPerTask}`);
  if (r.partition === "emt-rt") {
    lines.push(`export MODELSCRIPT_EMT_PARTITIONS=${nodes * tasksPerNode}`);
    lines.push('export MODELSCRIPT_EMT_RINGBUF_SHM="1"');
  }

  const safeEnv = sanitizeUserEnv(spec.env);
  for (const [key, value] of Object.entries(safeEnv)) {
    lines.push(`export ${key}="${escapeBashDoubleQuoted(value)}"`);
  }

  if (spec.modules && spec.modules.length > 0) {
    lines.push("");
    lines.push("# --- Environment Modules ---");
    for (const mod of spec.modules) {
      const safeMod = sanitizeSlurmToken(mod, "");
      if (safeMod) {
        lines.push(`module load ${safeMod}`);
      }
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

  const safeCommand = quoteShellArg(spec.command);
  const fullArgs = spec.args.map((a) => quoteShellArg(String(a))).join(" ");
  let baseCmd = fullArgs ? `${safeCommand} ${fullArgs}` : safeCommand;

  // Wrap in Apptainer / Singularity if specified
  if (spec.apptainerImage) {
    const gpuFlag = r.gpus && r.gpus > 0 ? " --nv" : "";
    const netFlag = networkIsolation ? " --net --network none" : "";
    const safeImage = quoteShellArg(spec.apptainerImage);
    baseCmd = `apptainer exec${gpuFlag}${netFlag} ${safeImage} ${baseCmd}`;
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
