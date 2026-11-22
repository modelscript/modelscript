// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalAlmConnectorRegistry,
  inspectRemoteDrift,
  isRemoteDependency,
  MANIFEST_FILENAME,
  normalizeRemoteDependency,
  PACKAGES_DIR,
  parseModelScriptYaml,
  pullRemotePackage,
  pushRemotePackage,
  resolveRemoteTemplates,
  type AlmArtifact,
  type AlmLink,
  type AlmVerificationRun,
  type ResolvedRemoteSpec,
} from "@modelscript/runtime";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Argv, CommandModule } from "yargs";
import { getHostAuth } from "../util/auth.js";
import { readLockfile, updateLockfilePackage } from "../util/lockfile.js";

function detectGitBranch(cwd: string): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

function getTargetOutputDir(cwd: string, packageName: string, spec: ResolvedRemoteSpec): string {
  if (spec.materialize) {
    return path.resolve(cwd, spec.materialize);
  }
  return path.join(cwd, PACKAGES_DIR, ...packageName.split("/"));
}

function loadRemoteSpecs(cwd: string, filterName?: string): ResolvedRemoteSpec[] {
  const manifestPath = path.join(cwd, MANIFEST_FILENAME);
  if (!existsSync(manifestPath)) {
    throw new Error(`${MANIFEST_FILENAME} not found in ${cwd}. Run 'msx init' first.`);
  }
  const manifest = parseModelScriptYaml(readFileSync(manifestPath, "utf-8"), manifestPath);
  const gitBranch = detectGitBranch(cwd);
  const specs: ResolvedRemoteSpec[] = [];

  for (const [depName, depSpec] of Object.entries(manifest.dependencies ?? {})) {
    if (filterName && depName !== filterName) continue;
    if (!isRemoteDependency(depSpec)) continue;
    const norm = normalizeRemoteDependency(depSpec);
    if (!norm) continue;

    specs.push({
      ...norm,
      packageName: depName,
      workingSet: resolveRemoteTemplates(norm.workingSet, { gitBranch, env: process.env }),
      baseline: resolveRemoteTemplates(norm.baseline, { gitBranch, env: process.env }),
    });
  }

  return specs;
}

interface SyncPullArgs {
  name?: string | undefined;
  conflict: "fail" | "theirs" | "ours";
}

interface SyncStatusArgs {
  name?: string | undefined;
  json?: boolean | undefined;
}

interface SyncPushArgs {
  name?: string | undefined;
  runFile?: string | undefined;
  linksFile?: string | undefined;
  only?: string | undefined;
}

export async function publishVerificationToRemotes(
  cwd: string,
  targetDep: string,
  runs: AlmVerificationRun[],
): Promise<void> {
  const { loadWorkspaceConnectors } = await import("@modelscript/runtime");
  await loadWorkspaceConnectors(cwd);
  const filterName = targetDep === "all" ? undefined : targetDep;
  const specs = loadRemoteSpecs(cwd, filterName);
  if (specs.length === 0) {
    throw new Error(`No matching remote dependencies found in ${MANIFEST_FILENAME} for '${targetDep}'.`);
  }
  for (const spec of specs) {
    const connector = globalAlmConnectorRegistry.get(spec.connector ?? spec.parsed.protocol);
    if (!connector) continue;
    const res = await pushRemotePackage(connector, spec, getHostAuth(spec.parsed.host), {
      verificationRuns: runs,
    });
    console.log(
      `✓ Published ${res.verification?.pushed ?? 0} verification run(s) to ${spec.packageName} [${connector.protocol}]`,
    );
  }
}

export async function syncPullRemoteSpecs(
  cwd: string,
  specs: ResolvedRemoteSpec[],
  conflictStrategy: "fail" | "theirs" | "ours" = "fail",
): Promise<void> {
  const lockfile = readLockfile(cwd);

  for (const spec of specs) {
    const connector = globalAlmConnectorRegistry.get(spec.connector ?? spec.parsed.protocol);
    if (!connector) {
      throw new Error(
        `No connector registered for protocol "${spec.connector ?? spec.parsed.protocol}" (dependency "${spec.packageName}").`,
      );
    }

    const prevEntry = lockfile?.packages[spec.packageName];
    const outDir = getTargetOutputDir(cwd, spec.packageName, spec);
    const cacheMetaPath = path.join(
      cwd,
      ".modelscript",
      "cache",
      `${spec.packageName.replace(/[/@]/g, "_")}.artifacts.json`,
    );

    let previousArtifacts: AlmArtifact[] | undefined;
    if (existsSync(cacheMetaPath)) {
      try {
        previousArtifacts = JSON.parse(readFileSync(cacheMetaPath, "utf-8")) as AlmArtifact[];
      } catch {
        // Ignore corrupt artifact cache
      }
    }

    let existingLocalContent: string | undefined;
    const prevFiles = prevEntry?.domains?.["requirements"]?.files;
    if (prevFiles && prevFiles[0]) {
      const existingPath = path.join(outDir, prevFiles[0]);
      if (existsSync(existingPath)) {
        existingLocalContent = readFileSync(existingPath, "utf-8");
      }
    }

    const result = await pullRemotePackage(connector, spec, getHostAuth(spec.parsed.host), prevEntry?.remote, {
      conflictStrategy,
      existingLocalContent,
      previousArtifacts,
    });

    mkdirSync(outDir, { recursive: true });
    const writtenFiles: string[] = [];
    for (const file of result.snapshot.files) {
      writeFileSync(path.join(outDir, file.filename), file.content, "utf-8");
      writtenFiles.push(file.filename);
    }

    // Persist artifact cache for future incremental delta merges
    mkdirSync(path.dirname(cacheMetaPath), { recursive: true });
    writeFileSync(cacheMetaPath, JSON.stringify(result.artifacts, null, 2), "utf-8");

    updateLockfilePackage(cwd, spec.packageName, {
      version: result.snapshotVersion,
      resolved: spec.source,
      integrity: result.snapshot.integrity,
      isDirect: true,
      domains: {
        requirements: {
          files: writtenFiles,
          hash: result.snapshot.integrity,
        },
      },
      remote: result.remoteState,
    });

    const relOut = path.relative(cwd, outDir) || ".";
    console.log(
      `✓ Synced ${spec.packageName} [${connector.protocol}] → ${relOut}/ (${result.artifacts.length} items, +${result.addedIds.length} ~${result.updatedIds.length} -${result.deletedIds.length})`,
    );
  }
}

const SyncPullCommand: CommandModule<{}, SyncPullArgs> = {
  command: "pull [name]",
  describe: "Pull latest deltas from remote ALM dependencies into local projections & modelscript.lock",
  builder: (yargs) => {
    return yargs
      .positional("name", {
        description: "Optional single remote dependency name to pull (defaults to all)",
        type: "string",
      })
      .option("conflict", {
        description: "3-way conflict resolution strategy",
        choices: ["fail", "theirs", "ours"] as const,
        default: "fail" as const,
      }) as unknown as Argv<SyncPullArgs>;
  },
  handler: async (args) => {
    const cwd = process.cwd();
    const specs = loadRemoteSpecs(cwd, args.name);
    if (specs.length === 0) {
      console.log(`No matching remote dependencies found in ${MANIFEST_FILENAME}.`);
      return;
    }
    await syncPullRemoteSpecs(cwd, specs, args.conflict);
  },
};

const SyncStatusCommand: CommandModule<{}, SyncStatusArgs> = {
  command: "status [name]",
  describe: "Inspect local vs. remote ALM drift without modifying files",
  builder: (yargs) => {
    return yargs
      .positional("name", {
        description: "Optional single remote dependency name",
        type: "string",
      })
      .option("json", {
        description: "Output drift report as JSON",
        type: "boolean",
        default: false,
      }) as unknown as Argv<SyncStatusArgs>;
  },
  handler: async (args) => {
    const cwd = process.cwd();
    const specs = loadRemoteSpecs(cwd, args.name);
    const lockfile = readLockfile(cwd);
    const reports = [];

    for (const spec of specs) {
      const connector = globalAlmConnectorRegistry.get(spec.connector ?? spec.parsed.protocol);
      if (!connector) continue;
      const prevEntry = lockfile?.packages[spec.packageName];
      const outDir = getTargetOutputDir(cwd, spec.packageName, spec);
      let existingLocalContent: string | undefined;
      const prevFiles = prevEntry?.domains?.["requirements"]?.files;
      if (prevFiles && prevFiles[0]) {
        const existingPath = path.join(outDir, prevFiles[0]);
        if (existsSync(existingPath)) {
          existingLocalContent = readFileSync(existingPath, "utf-8");
        }
      }

      const drift = await inspectRemoteDrift(
        connector,
        spec,
        getHostAuth(spec.parsed.host),
        prevEntry?.remote,
        existingLocalContent,
      );
      reports.push(drift);
    }

    if (args.json) {
      console.log(JSON.stringify(reports, null, 2));
      return;
    }

    for (const r of reports) {
      if (r.inSync) {
        console.log(`✓ ${r.packageName} [${r.connector}]: up to date`);
      } else {
        console.log(
          `⚠ ${r.packageName} [${r.connector}]: remote(+${r.remoteAdded.length} ~${r.remoteUpdated.length} -${r.remoteDeleted.length}), local(~${r.localModified.length}), conflicts(${r.conflicts.length})`,
        );
      }
    }
  },
};

const SyncPushCommand: CommandModule<{}, SyncPushArgs> = {
  command: "push [name]",
  describe: "Push authorized verification runs or trace links back to remote ALM systems",
  builder: (yargs) => {
    return yargs
      .positional("name", {
        description: "Optional single remote dependency name",
        type: "string",
      })
      .option("run-file", {
        description: "Path to JSON file containing AlmVerificationRun[] to publish",
        type: "string",
      })
      .option("links-file", {
        description: "Path to JSON file containing AlmLink[] to publish",
        type: "string",
      })
      .option("only", {
        description: "Comma-separated capabilities to push (verification,links,artifacts)",
        type: "string",
      }) as unknown as Argv<SyncPushArgs>;
  },
  handler: async (args) => {
    const cwd = process.cwd();
    const { loadWorkspaceConnectors, extractDirtyArtifactEdits } = await import("@modelscript/runtime");
    await loadWorkspaceConnectors(cwd);

    const specs = loadRemoteSpecs(cwd, args.name);
    if (specs.length === 0) {
      console.log(`No matching remote dependencies found in ${MANIFEST_FILENAME}.`);
      return;
    }

    const onlySet = args.only
      ? new Set(
          args.only
            .split(",")
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean),
        )
      : null;
    const allowKind = (k: string) => !onlySet || onlySet.has(k);

    const verificationRuns: AlmVerificationRun[] | undefined =
      allowKind("verification") && args.runFile
        ? (JSON.parse(readFileSync(path.resolve(cwd, args.runFile), "utf-8")) as AlmVerificationRun[])
        : undefined;
    const links: AlmLink[] | undefined =
      allowKind("links") && args.linksFile
        ? (JSON.parse(readFileSync(path.resolve(cwd, args.linksFile), "utf-8")) as AlmLink[])
        : undefined;

    const lockfile = readLockfile(cwd);

    for (const spec of specs) {
      const connector = globalAlmConnectorRegistry.get(spec.connector ?? spec.parsed.protocol);
      if (!connector) continue;

      let edits;
      if (allowKind("artifacts") && (spec.push ?? []).includes("artifacts")) {
        const prevEntry = lockfile?.packages[spec.packageName];
        const outDir = getTargetOutputDir(cwd, spec.packageName, spec);
        const prevFiles = prevEntry?.domains?.["requirements"]?.files;
        if (prevFiles && prevFiles[0]) {
          const filePath = path.join(outDir, prevFiles[0]);
          if (existsSync(filePath)) {
            edits = await extractDirtyArtifactEdits(readFileSync(filePath, "utf-8"), prevEntry?.remote);
          }
        }
      }

      const res = await pushRemotePackage(connector, spec, getHostAuth(spec.parsed.host), {
        links,
        verificationRuns,
        edits,
      });

      const verPushed = res.verification?.pushed ?? 0;
      const linksPushed = res.links?.pushed ?? 0;
      const editsPushed = res.artifacts?.pushed ?? 0;
      console.log(
        `✓ Pushed to ${spec.packageName} [${connector.protocol}]: ${verPushed} verification run(s), ${linksPushed} link(s), ${editsPushed} artifact edit(s)`,
      );
    }
  },
};

export const Sync: CommandModule = {
  command: "sync <subcommand>",
  describe: "Synchronize protocol/API ALM dependencies (pull, status, push)",
  builder: (yargs) => {
    return yargs
      .command(SyncPullCommand)
      .command(SyncStatusCommand)
      .command(SyncPushCommand)
      .demandCommand(1, "Please specify a sync subcommand: pull, status, or push");
  },
  handler: () => {},
};
