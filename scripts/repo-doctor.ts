// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Unified Repository Hygiene & Structural Doctor (`npm run lint:repo`).
 *
 * Executes all repository-level checks in a single Node/tsx process, sharing
 * git tracked-file discovery and workspace manifest caches across checks:
 *   1. Lockfile staging & synchronization (`lint-lockfile`)
 *   2. Nx project dependency graph acyclicity (`check-nx-cycles`)
 *   3. SPDX license header presence & positioning (`normalize-headers`)
 *   4. Cross-OS filename conventions (`lint-filenames`)
 *   5. Workspace package manifests, READMEs, Dockerfile layer copies & version sync (`lint-package-manifests`)
 *   6. Per-workspace type-safety ratchet ceilings (`lint-type-safety-ratchet`)
 */

import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { checkNxCycles, checkNxCyclesAsync } from "./check-nx-cycles.js";
import { getTrackedFiles, getWorkspacePackages } from "./lib/workspaces.js";
import { run as runFilenameChecks } from "./lint-filenames.js";
import { checkLockfile, checkLockfileAsync } from "./lint-lockfile.js";
import {
  checkAllManifests,
  syncDockerfileManifests,
  syncMaturityMetadata,
  syncSharedDevDependencies,
} from "./lint-package-manifests.js";
import { checkTypeSafetyRatchet } from "./lint-type-safety-ratchet.js";
import { run as runHeaderChecks } from "./normalize-headers.js";
import { syncVersions } from "./sync-versions.js";

const __filename = fileURLToPath(import.meta.url);

export interface DoctorCheckResult {
  name: string;
  passed: boolean;
  durationMs: number;
  summary: string;
  errors: string[];
}

export interface RepoDoctorOptions {
  skipLockfile?: boolean;
  skipCycles?: boolean;
  fix?: boolean;
}

function runInProcessChecks(packagePaths: string[], trackedFiles: string[]): DoctorCheckResult[] {
  const results: DoctorCheckResult[] = [];

  // 3. SPDX license headers
  {
    const start = performance.now();
    const headerStats = runHeaderChecks("", false, true);
    results.push({
      name: "headers",
      passed: headerStats.violations.length === 0,
      durationMs: Math.round(performance.now() - start),
      summary:
        headerStats.violations.length === 0
          ? `${headerStats.scanned} source files have valid SPDX headers`
          : `${headerStats.violations.length} SPDX header violation(s)`,
      errors: headerStats.violations,
    });
  }

  // 4. Filename conventions
  {
    const start = performance.now();
    const filenameResult = runFilenameChecks(trackedFiles);
    results.push({
      name: "filenames",
      passed: filenameResult.violations.length === 0,
      durationMs: Math.round(performance.now() - start),
      summary:
        filenameResult.violations.length === 0
          ? `${filenameResult.checked} tracked filenames conform to naming standards`
          : `${filenameResult.violations.length} filename violation(s)`,
      errors: filenameResult.violations.map((v) => `[${v.rule}] ${v.file}: ${v.message}`),
    });
  }

  // 5. Package manifests, READMEs, Dockerfile layer copies & version sync
  {
    const start = performance.now();
    const manifestResult = checkAllManifests(packagePaths);
    results.push({
      name: "manifests",
      passed: manifestResult.violations.length === 0,
      durationMs: Math.round(performance.now() - start),
      summary:
        manifestResult.violations.length === 0
          ? `${manifestResult.packageCount} manifests, READMEs, Dockerfile copies & version pins (${manifestResult.version}) verified`
          : `${manifestResult.violations.length} manifest/README violation(s)`,
      errors: manifestResult.violations.map((v) => `${v.file}: [${v.rule}] ${v.message}`),
    });
  }

  // 6. Type-safety ratchet
  {
    const start = performance.now();
    const ratchetResult = checkTypeSafetyRatchet();
    results.push({
      name: "types-ratchet",
      passed: ratchetResult.regressions.length === 0,
      durationMs: Math.round(performance.now() - start),
      summary:
        ratchetResult.regressions.length === 0
          ? `${ratchetResult.totalWorkspaces} workspaces within ratchet ceiling (${ratchetResult.zeroAnyCount} at 0 explicit 'any')`
          : `${ratchetResult.regressions.length} type-safety ratchet regression(s)`,
      errors: ratchetResult.regressions,
    });
  }

  return results;
}

export function runRepoDoctor(options: RepoDoctorOptions = {}): {
  passed: boolean;
  totalDurationMs: number;
  results: DoctorCheckResult[];
} {
  const t0 = performance.now();
  const results: DoctorCheckResult[] = [];
  const packagePaths = getWorkspacePackages();
  const trackedFiles = getTrackedFiles();

  if (options.fix) {
    syncMaturityMetadata(packagePaths);
    syncSharedDevDependencies(packagePaths);
    syncDockerfileManifests(packagePaths);
    syncVersions({ checkOnly: false });
    runHeaderChecks("", false, false);
  }

  // 1. Lockfile check
  if (!options.skipLockfile) {
    const start = performance.now();
    const lockErrors = checkLockfile();
    results.push({
      name: "lockfile",
      passed: lockErrors.length === 0,
      durationMs: Math.round(performance.now() - start),
      summary:
        lockErrors.length === 0
          ? "package-lock.json is in sync with workspace manifests"
          : `${lockErrors.length} lockfile issue(s)`,
      errors: lockErrors,
    });
  }

  // 2. Nx project graph cycles & architectural boundaries
  if (!options.skipCycles) {
    const start = performance.now();
    try {
      const {
        nodeCount,
        cycles,
        boundaryViolations = [],
      } = checkNxCycles() as {
        nodeCount: number;
        cycles: string[][];
        boundaryViolations?: string[];
      };
      const allErrors = [...cycles.map((c: string[]) => `Cycle: ${c.join(" -> ")}`), ...boundaryViolations];
      results.push({
        name: "cycles",
        passed: allErrors.length === 0,
        durationMs: Math.round(performance.now() - start),
        summary:
          allErrors.length === 0
            ? `${nodeCount} workspace nodes verified acyclic and bounded (0 cycles, 0 boundary violations)`
            : `${cycles.length} cycle(s), ${boundaryViolations.length} boundary violation(s)`,
        errors: allErrors,
      });
    } catch (err) {
      results.push({
        name: "cycles",
        passed: false,
        durationMs: Math.round(performance.now() - start),
        summary: "Failed to inspect Nx project graph",
        errors: [err instanceof Error ? err.message : String(err)],
      });
    }
  }

  results.push(...runInProcessChecks(packagePaths, trackedFiles));

  const totalDurationMs = Math.round(performance.now() - t0);
  const passed = results.every((r) => r.passed);
  return { passed, totalDurationMs, results };
}

export async function runRepoDoctorAsync(options: RepoDoctorOptions = {}): Promise<{
  passed: boolean;
  totalDurationMs: number;
  results: DoctorCheckResult[];
}> {
  const t0 = performance.now();
  const packagePaths = getWorkspacePackages();
  const trackedFiles = getTrackedFiles();

  if (options.fix) {
    syncMaturityMetadata(packagePaths);
    syncSharedDevDependencies(packagePaths);
    syncDockerfileManifests(packagePaths);
    syncVersions({ checkOnly: false });
    runHeaderChecks("", false, false);
  }

  const lockfilePromise: Promise<DoctorCheckResult | null> = options.skipLockfile
    ? Promise.resolve(null)
    : (async () => {
        const start = performance.now();
        const lockErrors = await checkLockfileAsync();
        return {
          name: "lockfile",
          passed: lockErrors.length === 0,
          durationMs: Math.round(performance.now() - start),
          summary:
            lockErrors.length === 0
              ? "package-lock.json is in sync with workspace manifests"
              : `${lockErrors.length} lockfile issue(s)`,
          errors: lockErrors,
        };
      })();

  const cyclesPromise: Promise<DoctorCheckResult | null> = options.skipCycles
    ? Promise.resolve(null)
    : (async () => {
        const start = performance.now();
        try {
          const { nodeCount, cycles } = await checkNxCyclesAsync();
          return {
            name: "cycles",
            passed: cycles.length === 0,
            durationMs: Math.round(performance.now() - start),
            summary:
              cycles.length === 0
                ? `${nodeCount} workspace nodes verified acyclic (0 cycles)`
                : `${cycles.length} cycle(s) detected`,
            errors: cycles.map((c) => `Cycle: ${c.join(" -> ")}`),
          };
        } catch (err) {
          return {
            name: "cycles",
            passed: false,
            durationMs: Math.round(performance.now() - start),
            summary: "Failed to inspect Nx project graph",
            errors: [err instanceof Error ? err.message : String(err)],
          };
        }
      })();

  // Run the 4 fast in-process checks while child processes (npm ci --dry-run and nx graph) execute concurrently
  const inProcessResults = runInProcessChecks(packagePaths, trackedFiles);
  const [lockfileResult, cyclesResult] = await Promise.all([lockfilePromise, cyclesPromise]);

  const results: DoctorCheckResult[] = [];
  if (lockfileResult) results.push(lockfileResult);
  if (cyclesResult) results.push(cyclesResult);
  results.push(...inProcessResults);

  const totalDurationMs = Math.round(performance.now() - t0);
  const passed = results.every((r) => r.passed);
  return { passed, totalDurationMs, results };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const args = process.argv.slice(2);
  const skipLockfile = args.includes("--skip-lockfile");
  const skipCycles = args.includes("--skip-cycles");
  const fix = args.includes("--fix") || args.includes("--sync");

  const { passed, totalDurationMs, results } = await runRepoDoctorAsync({ skipLockfile, skipCycles, fix });

  for (const res of results) {
    const icon = res.passed ? "✓" : "✗";
    console.log(`${icon} [${res.name.padEnd(13)}] ${res.summary} (${res.durationMs}ms)`);
    if (!res.passed) {
      for (const err of res.errors) {
        console.error(`    - ${err}`);
      }
    }
  }

  if (!passed) {
    console.error(`\n❌ Repo doctor found hygiene violations (${totalDurationMs}ms).`);
    process.exit(1);
  }

  console.log(`\n✓ All ${results.length} repository hygiene checks passed in ${totalDurationMs}ms.`);
}
