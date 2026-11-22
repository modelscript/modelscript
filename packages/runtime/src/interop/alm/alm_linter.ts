// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ALM Workspace Linter.
 *
 * Validates synced ALM requirements & change requests against ModelScript workspace
 * models and Git branch policies:
 * - ALM001: Referenced external ALM ID does not exist in synced package
 * - ALM002: Model references a Deprecated / Rejected / Obsolete requirement
 * - ALM003: Unpinned mutable ALM remote on protected branch (main/master)
 * - ALM004: Safety-critical / High-priority requirement missing verification link
 */

import { isRemoteDependency, normalizeRemoteDependency, type ModelScriptManifest } from "../../workspace/manifest.js";
import type { AlmArtifact, AlmLink } from "./alm_ir.js";

export interface AlmLintDiagnostic {
  code: "ALM001" | "ALM002" | "ALM003" | "ALM004";
  severity: "error" | "warning" | "info";
  packageName: string;
  externalId?: string | undefined;
  message: string;
}

const DEPRECATED_STATUSES = new Set(["deprecated", "rejected", "obsolete", "cancelled", "canceled", "deleted"]);
const CRITICAL_PRIORITIES = new Set(["critical", "blocker", "high", "asil-d", "asil-c", "dal-a", "dal-b", "safety"]);

export interface AlmLintInput {
  manifest: ModelScriptManifest;
  /** Current Git branch name (used for ALM003 protected-branch baseline check). */
  gitBranch?: string | undefined;
  /** Synced artifacts keyed by remote package name. */
  artifactsByPackage: Record<string, AlmArtifact[]>;
  /** Known outbound/inbound traceability links across the workspace. */
  links?: AlmLink[] | undefined;
  /** External IDs referenced in workspace models (e.g., `@satisfies(doors: "REQ-042")`). */
  referencedIdsByPackage?: Record<string, string[]> | undefined;
}

export function lintAlmWorkspace(input: AlmLintInput): AlmLintDiagnostic[] {
  const diagnostics: AlmLintDiagnostic[] = [];
  const links = input.links ?? [];
  const verifiedTargetIds = new Set(links.filter((l) => l.relation === "verifies").map((l) => l.targetId));

  const isProtectedBranch = input.gitBranch === "main" || input.gitBranch === "master";

  for (const [pkgName, depSpec] of Object.entries(input.manifest.dependencies ?? {})) {
    if (!isRemoteDependency(depSpec)) continue;
    const norm = normalizeRemoteDependency(depSpec);
    if (!norm) continue;

    // ALM003: Unpinned mutable stream on protected branch
    if (isProtectedBranch && !norm.baseline && !norm.revision && norm.connector !== "jira") {
      diagnostics.push({
        code: "ALM003",
        severity: "warning",
        packageName: pkgName,
        message: `Remote dependency '${pkgName}' (${norm.connector}) has no 'baseline' or 'revision' pin on protected branch '${input.gitBranch}'.`,
      });
    }

    const artifacts = input.artifactsByPackage[pkgName] ?? [];
    const byId = new Map(artifacts.map((a) => [a.externalId, a]));

    // ALM001 & ALM002: Validate model references against synced artifacts
    for (const refId of input.referencedIdsByPackage?.[pkgName] ?? []) {
      const target = byId.get(refId);
      if (!target) {
        diagnostics.push({
          code: "ALM001",
          severity: "error",
          packageName: pkgName,
          externalId: refId,
          message: `External ALM item '${refId}' referenced in workspace was not found in synced package '${pkgName}'.`,
        });
        continue;
      }

      if (DEPRECATED_STATUSES.has(target.status.toLowerCase())) {
        diagnostics.push({
          code: "ALM002",
          severity: "warning",
          packageName: pkgName,
          externalId: refId,
          message: `Workspace references '${refId}' in '${pkgName}', which has status '${target.status}'.`,
        });
      }
    }

    // ALM004: Safety-critical / high-priority requirements missing a verification link
    for (const item of artifacts) {
      if (item.kind !== "requirement") continue;
      if (DEPRECATED_STATUSES.has(item.status.toLowerCase())) continue;
      const prio = (item.priority ?? "").toLowerCase();
      if (prio && CRITICAL_PRIORITIES.has(prio) && !verifiedTargetIds.has(item.externalId)) {
        diagnostics.push({
          code: "ALM004",
          severity: "warning",
          packageName: pkgName,
          externalId: item.externalId,
          message: `High-priority requirement '${item.externalId}' ('${item.title}') in '${pkgName}' has no 'verifies' link.`,
        });
      }
    }
  }

  return diagnostics;
}
