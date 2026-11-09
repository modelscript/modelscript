// SPDX-License-Identifier: AGPL-3.0-or-later

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { gitSubprocessEnv } from "../../util/git-hardening.js";
import { readSpaceGitFileAtRef } from "./space-git-vault.js";

export interface EcoDownstreamDependency {
  model: string;
  dependencyType: string;
  path: string;
}

export interface EcoAllocatedRequirement {
  reqId: string;
  title: string;
  standard: string;
  status: "satisfied" | "violated";
}

export interface EcoBlastRadiusResult {
  directModels: string[];
  downstreamDependencies: EcoDownstreamDependency[];
  allocatedRequirements: EcoAllocatedRequirement[];
  riskScore: "low" | "medium" | "high" | "safety_critical";
}

export function computeEcoBlastRadius(opts: {
  repoPath?: string | null | undefined;
  baseRef: string;
  targetRef: string;
  impactedModels: string[];
  severity: "minor" | "standard" | "major" | "safety_critical";
  defaultDownstreamDependencies?: EcoDownstreamDependency[] | undefined;
  defaultAllocatedRequirements?: EcoAllocatedRequirement[] | undefined;
}): EcoBlastRadiusResult {
  const directModels = opts.impactedModels.length > 0 ? opts.impactedModels : ["models/SystemBaseline.mo"];
  const downstreamDependencies: EcoDownstreamDependency[] = [];
  const allocatedRequirements: EcoAllocatedRequirement[] = [];

  if (opts.repoPath && fs.existsSync(opts.repoPath)) {
    const env = gitSubprocessEnv();
    try {
      // 1. List all tree files at the targetRef
      const lsTreeOut = execFileSync("git", ["-C", opts.repoPath, "ls-tree", "-r", "--name-only", opts.targetRef], {
        env,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();

      const allFiles = lsTreeOut ? lsTreeOut.split("\n").filter(Boolean) : [];
      const modelFiles = allFiles.filter((f) => f.endsWith(".mo") || f.endsWith(".sysml"));

      for (const direct of directModels) {
        const baseName = direct.split(/[/.]/).pop() || direct;
        const extendsRegex = new RegExp(`(?:extends|inherit)\\s+([A-Za-z0-9_.]*${baseName})`, "i");
        const connectRegex = new RegExp(`connect\\s*\\([^)]*${baseName}[^)]*\\)`, "i");
        const componentRegex = new RegExp(`(?:^|\\s)${baseName}\\s+([A-Za-z0-9_]+)`, "m");

        for (const mf of modelFiles) {
          if (mf === direct || mf.endsWith(direct)) continue;
          const code = readSpaceGitFileAtRef({ repoPath: opts.repoPath, ref: opts.targetRef, filePath: mf });
          if (!code) continue;

          if (extendsRegex.test(code)) {
            const mName = mf.split(/[/.]/).slice(-2, -1)[0] || mf;
            downstreamDependencies.push({
              model: mName,
              dependencyType: "extends",
              path: mf,
            });
          } else if (connectRegex.test(code)) {
            const mName = mf.split(/[/.]/).slice(-2, -1)[0] || mf;
            downstreamDependencies.push({
              model: mName,
              dependencyType: "connect()",
              path: mf,
            });
          } else if (componentRegex.test(code)) {
            const mName = mf.split(/[/.]/).slice(-2, -1)[0] || mf;
            downstreamDependencies.push({
              model: mName,
              dependencyType: "component",
              path: mf,
            });
          }
        }
      }

      // 2. Scan living docs & markdown for requirements allocated to these models
      const docFiles = allFiles.filter((f) => f.endsWith(".md") || f.endsWith(".reqif"));
      const reqRegex = /(REQ-[A-Z]+-[0-9]+)[:\s]+([^.\n\r]+)/g;
      for (const df of docFiles) {
        const text = readSpaceGitFileAtRef({ repoPath: opts.repoPath, ref: opts.targetRef, filePath: df });
        if (!text) continue;
        let rMatch: RegExpExecArray | null;
        while ((rMatch = reqRegex.exec(text)) !== null) {
          const reqId = rMatch[1]?.trim() || "";
          const title = rMatch[2]?.trim() || "System Requirement";
          let standard = "ISO 26262 ASIL-D";
          if (reqId.includes("THM") || reqId.includes("AERO")) standard = "AS9100 Rev D";
          else if (reqId.includes("SEC") || reqId.includes("CYB")) standard = "ISO/SAE 21434";
          else if (reqId.includes("MED") || reqId.includes("BIO")) standard = "FDA 21 CFR Part 11";

          if (reqId && !allocatedRequirements.some((r) => r.reqId === reqId)) {
            allocatedRequirements.push({
              reqId,
              title,
              standard,
              status: "satisfied",
            });
          }
        }
      }
    } catch {}
  }

  // Fallbacks if repository is empty or has no cross-references yet
  if (downstreamDependencies.length === 0 && opts.defaultDownstreamDependencies) {
    downstreamDependencies.push(...opts.defaultDownstreamDependencies);
  }
  if (allocatedRequirements.length === 0 && opts.defaultAllocatedRequirements) {
    allocatedRequirements.push(...opts.defaultAllocatedRequirements);
  }

  let riskScore: "low" | "medium" | "high" | "safety_critical" = "medium";
  if (opts.severity === "safety_critical" || allocatedRequirements.some((r) => r.standard.includes("ASIL-D"))) {
    riskScore = "safety_critical";
  } else if (opts.severity === "major" || downstreamDependencies.length >= 3) {
    riskScore = "high";
  } else if (downstreamDependencies.length === 0) {
    riskScore = "low";
  }

  return {
    directModels,
    downstreamDependencies,
    allocatedRequirements,
    riskScore,
  };
}
