// SPDX-License-Identifier: AGPL-3.0-or-later

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { parse as parseYaml } from "yaml";
import { gitSubprocessEnv } from "../../util/git-hardening.js";
import { readSpaceGitFileAtRef } from "../spaces/space-git-vault.js";

export type WorkflowProvider = "github" | "gitlab";

export interface WorkflowStep {
  id?: string | undefined;
  name?: string | undefined;
  run?: string | undefined;
  uses?: string | undefined;
  with?: Record<string, unknown> | undefined;
  env?: Record<string, string> | undefined;
  workingDirectory?: string | undefined;
}

export interface WorkflowJob {
  id: string;
  name: string;
  needs: string[];
  runsOn: string;
  steps: WorkflowStep[];
  env?: Record<string, string> | undefined;
  timeoutMinutes?: number | undefined;
  artifacts?:
    | {
        name?: string | undefined;
        paths?: string[] | undefined;
        reports?: Record<string, string> | undefined;
      }
    | undefined;
}

export interface WorkflowManifest {
  provider: WorkflowProvider;
  name: string;
  filePath: string;
  on: {
    push?: { branches?: string[] | undefined } | undefined;
    pullRequest?: { branches?: string[] | undefined } | undefined;
    eco?: { branches?: string[] | undefined } | undefined;
  };
  jobs: Map<string, WorkflowJob>;
  env?: Record<string, string> | undefined;
}

/**
 * Normalizes a string or string array into a string array.
 */
function normalizeStringArray(val: unknown): string[] {
  if (typeof val === "string") return [val.trim()];
  if (Array.isArray(val))
    return val
      .map(String)
      .map((s) => s.trim())
      .filter(Boolean);
  return [];
}

/**
 * Parses a GitHub Actions workflow YAML document into a unified WorkflowManifest.
 */
export function parseGitHubWorkflow(yamlContent: string, filePath: string): WorkflowManifest | null {
  if (!yamlContent || typeof yamlContent !== "string") return null;

  try {
    const doc = parseYaml(yamlContent) as Record<string, unknown>;
    if (!doc || typeof doc !== "object") return null;

    const name = String(
      doc["name"] ||
        filePath
          .split("/")
          .pop()
          ?.replace(/\.(ya?ml)$/i, "") ||
        "GitHub Workflow",
    );

    // Parse 'on' trigger specifications
    const onSpec: WorkflowManifest["on"] = {};
    const rawOn = doc["on"];
    if (typeof rawOn === "string") {
      if (rawOn === "push") onSpec.push = {};
      if (rawOn === "pull_request") onSpec.pullRequest = {};
    } else if (Array.isArray(rawOn)) {
      if (rawOn.includes("push")) onSpec.push = {};
      if (rawOn.includes("pull_request")) onSpec.pullRequest = {};
    } else if (rawOn && typeof rawOn === "object") {
      const onObj = rawOn as Record<string, unknown>;
      if (onObj["push"]) {
        const pushObj = onObj["push"] as Record<string, unknown> | null;
        onSpec.push = { branches: normalizeStringArray(pushObj?.["branches"]) };
      }
      if (onObj["pull_request"]) {
        const prObj = onObj["pull_request"] as Record<string, unknown> | null;
        onSpec.pullRequest = { branches: normalizeStringArray(prObj?.["branches"]) };
      }
      if (onObj["eco"]) {
        const ecoObj = onObj["eco"] as Record<string, unknown> | null;
        onSpec.eco = { branches: normalizeStringArray(ecoObj?.["branches"]) };
      }
    }

    const globalEnv: Record<string, string> = {};
    if (doc["env"] && typeof doc["env"] === "object") {
      for (const [k, v] of Object.entries(doc["env"] as Record<string, unknown>)) {
        if (v != null) globalEnv[k] = String(v);
      }
    }

    const jobsMap = new Map<string, WorkflowJob>();
    const rawJobs = doc["jobs"];
    if (rawJobs && typeof rawJobs === "object") {
      for (const [jobId, rawJob] of Object.entries(rawJobs as Record<string, unknown>)) {
        if (!rawJob || typeof rawJob !== "object") continue;
        const jObj = rawJob as Record<string, unknown>;

        const jobName = String(jObj["name"] || jobId);
        const needs = normalizeStringArray(jObj["needs"]);
        const runsOnRaw = jObj["runs-on"];
        const runsOn = Array.isArray(runsOnRaw)
          ? String(runsOnRaw[0] || "ubuntu-latest")
          : String(runsOnRaw || "ubuntu-latest");

        const steps: WorkflowStep[] = [];
        const rawSteps = jObj["steps"];
        if (Array.isArray(rawSteps)) {
          for (const s of rawSteps) {
            if (!s || typeof s !== "object") continue;
            const sObj = s as Record<string, unknown>;

            let stepWith: Record<string, unknown> | undefined;
            if (sObj["with"] && typeof sObj["with"] === "object") {
              stepWith = sObj["with"] as Record<string, unknown>;
            }

            let stepEnv: Record<string, string> | undefined;
            if (sObj["env"] && typeof sObj["env"] === "object") {
              stepEnv = {};
              for (const [ek, ev] of Object.entries(sObj["env"] as Record<string, unknown>)) {
                if (ev != null) stepEnv[ek] = String(ev);
              }
            }

            steps.push({
              id: sObj["id"] != null ? String(sObj["id"]) : undefined,
              name: sObj["name"] != null ? String(sObj["name"]) : undefined,
              run: sObj["run"] != null ? String(sObj["run"]) : undefined,
              uses: sObj["uses"] != null ? String(sObj["uses"]) : undefined,
              with: stepWith,
              env: stepEnv,
              workingDirectory: sObj["working-directory"] != null ? String(sObj["working-directory"]) : undefined,
            });
          }
        }

        const jobEnv: Record<string, string> = { ...globalEnv };
        if (jObj["env"] && typeof jObj["env"] === "object") {
          for (const [ek, ev] of Object.entries(jObj["env"] as Record<string, unknown>)) {
            if (ev != null) jobEnv[ek] = String(ev);
          }
        }

        jobsMap.set(jobId, {
          id: jobId,
          name: jobName,
          needs,
          runsOn,
          steps,
          env: jobEnv,
          timeoutMinutes: jObj["timeout-minutes"] ? Number(jObj["timeout-minutes"]) : undefined,
        });
      }
    }

    return {
      provider: "github",
      name,
      filePath,
      on: onSpec,
      jobs: jobsMap,
      env: globalEnv,
    };
  } catch {
    return null;
  }
}

/**
 * Parses a GitLab CI (.gitlab-ci.yml) document into a unified WorkflowManifest.
 */
export function parseGitLabWorkflow(yamlContent: string, filePath: string = ".gitlab-ci.yml"): WorkflowManifest | null {
  if (!yamlContent || typeof yamlContent !== "string") return null;

  try {
    const doc = parseYaml(yamlContent) as Record<string, unknown>;
    if (!doc || typeof doc !== "object") return null;

    const name = "GitLab CI Pipeline";
    const stages = normalizeStringArray(doc["stages"] || ["build", "test", "deploy"]);

    const globalEnv: Record<string, string> = {};
    if (doc["variables"] && typeof doc["variables"] === "object") {
      for (const [k, v] of Object.entries(doc["variables"] as Record<string, unknown>)) {
        if (v != null) globalEnv[k] = String(v);
      }
    }

    const defaultBeforeScript = normalizeStringArray(doc["before_script"]);
    const RESERVED_GITLAB_KEYS = new Set([
      "image",
      "services",
      "before_script",
      "after_script",
      "variables",
      "stages",
      "include",
      "default",
      "workflow",
      "cache",
    ]);

    const stageJobMap = new Map<string, string[]>();
    for (const st of stages) {
      stageJobMap.set(st, []);
    }

    const rawJobEntries: [string, Record<string, unknown>][] = [];
    for (const [key, val] of Object.entries(doc)) {
      if (key.startsWith(".") || RESERVED_GITLAB_KEYS.has(key)) continue;
      if (val && typeof val === "object" && (val as Record<string, unknown>)["script"]) {
        rawJobEntries.push([key, val as Record<string, unknown>]);
        const stage = String((val as Record<string, unknown>)["stage"] || "test");
        const list = stageJobMap.get(stage) || [];
        list.push(key);
        stageJobMap.set(stage, list);
      }
    }

    const jobsMap = new Map<string, WorkflowJob>();
    for (const [jobId, jObj] of rawJobEntries) {
      const stage = String(jObj["stage"] || "test");
      let needs: string[] = [];

      if (jObj["needs"]) {
        if (Array.isArray(jObj["needs"])) {
          needs = jObj["needs"]
            .map((n) => (typeof n === "string" ? n : String((n as Record<string, unknown>)["job"] || "")))
            .filter(Boolean);
        }
      } else {
        // Standard GitLab stage sequencing: depend on all jobs in the preceding stage
        const stageIdx = stages.indexOf(stage);
        if (stageIdx > 0) {
          const prevStage = stages[stageIdx - 1]!;
          needs = stageJobMap.get(prevStage) || [];
        }
      }

      const jobBeforeScript = jObj["before_script"] ? normalizeStringArray(jObj["before_script"]) : defaultBeforeScript;
      const scriptLines = normalizeStringArray(jObj["script"]);

      const steps: WorkflowStep[] = [];
      steps.push({ uses: "actions/checkout@v4", name: "Checkout Repository" });

      for (const line of jobBeforeScript) {
        steps.push({ name: `before: ${line.slice(0, 40)}`, run: line });
      }
      for (const line of scriptLines) {
        steps.push({ name: line.slice(0, 40), run: line });
      }

      let artifactsInfo: WorkflowJob["artifacts"];
      if (jObj["artifacts"] && typeof jObj["artifacts"] === "object") {
        const artObj = jObj["artifacts"] as Record<string, unknown>;
        const paths = normalizeStringArray(artObj["paths"]);
        artifactsInfo = { paths };
        if (paths.length > 0) {
          steps.push({
            name: "Upload Artifacts",
            uses: "actions/upload-artifact@v4",
            with: { path: paths.join(",") },
          });
        }
      }

      const tags = normalizeStringArray(jObj["tags"]);
      const runsOn = tags[0] || "gitlab-runner";

      const jobEnv = { ...globalEnv };
      if (jObj["variables"] && typeof jObj["variables"] === "object") {
        for (const [ek, ev] of Object.entries(jObj["variables"] as Record<string, unknown>)) {
          if (ev != null) jobEnv[ek] = String(ev);
        }
      }

      jobsMap.set(jobId, {
        id: jobId,
        name: String(jObj["name"] || jobId),
        needs,
        runsOn,
        steps,
        env: jobEnv,
        artifacts: artifactsInfo,
      });
    }

    return {
      provider: "gitlab",
      name,
      filePath,
      on: {
        push: { branches: ["*"] },
        pullRequest: { branches: ["*"] },
      },
      jobs: jobsMap,
      env: globalEnv,
    };
  } catch {
    return null;
  }
}

/**
 * Scans a bare Git vault at a given ref (branch, tag, or SHA) to discover and parse
 * any existing GitHub Actions (.github/workflows/*.yml) or GitLab CI (.gitlab-ci.yml) files.
 */
export function discoverWorkflowsInRepo(opts: { repoPath: string; ref: string }): WorkflowManifest[] {
  const manifests: WorkflowManifest[] = [];
  if (!opts.repoPath || !fs.existsSync(opts.repoPath)) return manifests;

  const env = gitSubprocessEnv();
  let allFiles: string[] = [];
  try {
    const lsOut = execFileSync("git", ["-C", opts.repoPath, "ls-tree", "-r", "--name-only", opts.ref], {
      env,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    allFiles = lsOut ? lsOut.split("\n").filter(Boolean) : [];
  } catch {
    return manifests;
  }

  // 1. Check for GitHub Actions workflows in .github/workflows/
  const ghFiles = allFiles.filter((f) => /^\.github\/workflows\/[^/]+\.(ya?ml)$/i.test(f));
  for (const ghFile of ghFiles) {
    const content = readSpaceGitFileAtRef({ repoPath: opts.repoPath, ref: opts.ref, filePath: ghFile });
    if (content) {
      const parsed = parseGitHubWorkflow(content, ghFile);
      if (parsed && parsed.jobs.size > 0) {
        manifests.push(parsed);
      }
    }
  }

  // 2. Check for GitLab CI in .gitlab-ci.yml
  const gitlabFile = allFiles.find((f) => f === ".gitlab-ci.yml");
  if (gitlabFile) {
    const content = readSpaceGitFileAtRef({ repoPath: opts.repoPath, ref: opts.ref, filePath: gitlabFile });
    if (content) {
      const parsed = parseGitLabWorkflow(content, gitlabFile);
      if (parsed && parsed.jobs.size > 0) {
        manifests.push(parsed);
      }
    }
  }

  return manifests;
}
