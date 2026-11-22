// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  globalAlmConnectorRegistry,
  isRemoteDependency,
  MANIFEST_FILENAME,
  normalizeRemoteDependency,
  parseModelScriptYaml,
  parseProtocolUri,
  removeManifestDependency,
  upsertManifestDependency,
  type DependencySpec,
  type MaterializeFormat,
  type PushCapability,
  type RemoteDependencySpec,
} from "@modelscript/runtime";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Argv, CommandModule } from "yargs";
import { getHostAuth } from "../util/auth.js";

interface RemoteAddArgs {
  name: string;
  source: string;
  materialize?: string | undefined;
  push?: string[] | undefined;
  query?: string | undefined;
  baseline?: string | undefined;
  workingSet?: string | undefined;
  revision?: string | undefined;
  format?: MaterializeFormat | undefined;
  skipCheck?: boolean | undefined;
}

interface RemoteRemoveArgs {
  name: string;
}

const RemoteAddCommand: CommandModule<{}, RemoteAddArgs> = {
  command: "add <name> <source>",
  describe: "Add a protocol/API-based ALM remote dependency to modelscript.yaml",
  builder: (yargs) => {
    return yargs
      .positional("name", {
        description: "Package name for the remote (e.g. '@reqs/battery-safety', '@issues/jira-ev')",
        type: "string",
        demandOption: true,
      })
      .positional("source", {
        description:
          "Protocol URI (e.g. 'oslc+https://...', 'jama+https://...', 'codebeamer+https://...', 'polarion+https://...', 'jira+https://...')",
        type: "string",
        demandOption: true,
      })
      .option("materialize", {
        alias: "m",
        description: "Optional Git-tracked relative directory to materialize projections into",
        type: "string",
      })
      .option("push", {
        description: "Authorized outbound push capabilities (verification, links, defects-on-fail, artifacts)",
        type: "array",
        string: true,
      })
      .option("query", {
        alias: "q",
        description: "Remote query filter (e.g. JQL for Jira or OSLC where clause)",
        type: "string",
      })
      .option("baseline", {
        alias: "b",
        description: "Remote baseline or configuration URI/ID",
        type: "string",
      })
      .option("working-set", {
        description: "Remote working-set or branch template (e.g. 'branch:${git.branch}')",
        type: "string",
      })
      .option("revision", {
        description: "Remote SVN/item revision pin (e.g. Polarion revision)",
        type: "string",
      })
      .option("format", {
        description: "Materialized projection format",
        choices: ["sysml2", "modelscript", "reqif"] as const,
      })
      .option("skip-check", {
        description: "Skip live server discovery probe when adding the remote",
        type: "boolean",
        default: false,
      }) as unknown as Argv<RemoteAddArgs>;
  },
  handler: async (args) => {
    const cwd = process.cwd();
    const manifestPath = path.join(cwd, MANIFEST_FILENAME);
    if (!existsSync(manifestPath)) {
      console.error(`Error: ${MANIFEST_FILENAME} not found in ${cwd}. Run 'msx init' first.`);
      process.exit(1);
    }

    const parsedUri = parseProtocolUri(args.source);
    if (!parsedUri) {
      console.error(
        `Error: Invalid remote URI "${args.source}". Expected '<protocol>+https://...' (e.g. oslc+https://, jama+https://, codebeamer+https://, polarion+https://, jira+https://).`,
      );
      process.exit(1);
    }

    const connector = globalAlmConnectorRegistry.get(parsedUri.protocol);
    if (!connector) {
      console.warn(
        `Warning: No built-in connector registered for protocol "${parsedUri.protocol}". Known protocols: ${globalAlmConnectorRegistry.listProtocols().join(", ")}.`,
      );
    }

    const hasStructuredOptions = Boolean(
      args.materialize ||
      (args.push && args.push.length > 0) ||
      args.query ||
      args.baseline ||
      args.workingSet ||
      args.revision ||
      args.format,
    );

    let depSpec: DependencySpec;
    if (hasStructuredOptions) {
      const obj: RemoteDependencySpec = { source: args.source };
      if (args.query) obj.query = args.query;
      if (args.baseline) obj.baseline = args.baseline;
      if (args.workingSet) obj.workingSet = args.workingSet;
      if (args.revision) obj.revision = args.revision;
      if (args.format) obj.format = args.format;
      if (args.materialize) obj.materialize = args.materialize;
      if (args.push && args.push.length > 0) obj.push = args.push as PushCapability[];
      depSpec = obj;
    } else {
      depSpec = args.source;
    }

    if (!args.skipCheck && connector) {
      const normalized = normalizeRemoteDependency(depSpec)!;
      try {
        const caps = await connector.discover({ ...normalized, packageName: args.name }, getHostAuth(parsedUri.host));
        console.log(
          `✓ Discovered ${caps.serverName ?? caps.protocol}${caps.serverVersion ? ` (${caps.serverVersion})` : ""}`,
        );
      } catch (err) {
        console.warn(
          `Warning: Live discovery probe failed (${err instanceof Error ? err.message : String(err)}). Adding remote anyway.`,
        );
      }
    }

    const rawYaml = readFileSync(manifestPath, "utf-8");
    const updatedYaml = upsertManifestDependency(rawYaml, args.name, depSpec);
    writeFileSync(manifestPath, updatedYaml, "utf-8");
    console.log(`✓ Added remote "${args.name}" (${parsedUri.protocol}) to ${MANIFEST_FILENAME}`);
  },
};

const RemoteListCommand: CommandModule = {
  command: "list",
  aliases: ["ls"],
  describe: "List protocol/API remote dependencies declared in modelscript.yaml",
  handler: () => {
    const cwd = process.cwd();
    const manifestPath = path.join(cwd, MANIFEST_FILENAME);
    if (!existsSync(manifestPath)) {
      console.error(`Error: ${MANIFEST_FILENAME} not found in ${cwd}.`);
      process.exit(1);
    }

    const manifest = parseModelScriptYaml(readFileSync(manifestPath, "utf-8"), manifestPath);
    const entries = Object.entries(manifest.dependencies ?? {}).filter(([, spec]) => isRemoteDependency(spec));

    if (entries.length === 0) {
      console.log(`No remote ALM dependencies declared in ${MANIFEST_FILENAME}.`);
      return;
    }

    for (const [name, spec] of entries) {
      const norm = normalizeRemoteDependency(spec)!;
      const target = norm.materialize ? `materialize=${norm.materialize}` : `cached=.modelscript/packages/${name}`;
      const push = norm.push && norm.push.length > 0 ? ` push=[${norm.push.join(",")}]` : " read-only";
      console.log(`  ${name}  [${norm.connector}]  ${norm.source}  (${target}${push})`);
    }
  },
};

const RemoteRemoveCommand: CommandModule<{}, RemoteRemoveArgs> = {
  command: "remove <name>",
  aliases: ["rm"],
  describe: "Remove a remote dependency from modelscript.yaml",
  builder: (yargs) => {
    return yargs.positional("name", {
      description: "Package name of the remote dependency to remove",
      type: "string",
      demandOption: true,
    }) as unknown as Argv<RemoteRemoveArgs>;
  },
  handler: (args) => {
    const cwd = process.cwd();
    const manifestPath = path.join(cwd, MANIFEST_FILENAME);
    if (!existsSync(manifestPath)) {
      console.error(`Error: ${MANIFEST_FILENAME} not found in ${cwd}.`);
      process.exit(1);
    }

    const rawYaml = readFileSync(manifestPath, "utf-8");
    const { content, removed } = removeManifestDependency(rawYaml, args.name);
    if (!removed) {
      console.error(`Error: Dependency "${args.name}" not found in ${MANIFEST_FILENAME}.`);
      process.exit(1);
    }
    writeFileSync(manifestPath, content, "utf-8");
    console.log(`✓ Removed "${args.name}" from ${MANIFEST_FILENAME}`);
  },
};

export const Remote: CommandModule = {
  command: "remote <subcommand>",
  describe: "Manage protocol/API-based ALM remotes (DOORS Next, Jama, Codebeamer, Polarion, Jira) in modelscript.yaml",
  builder: (yargs) => {
    return yargs
      .command(RemoteAddCommand)
      .command(RemoteListCommand)
      .command(RemoteRemoveCommand)
      .demandCommand(1, "Please specify a remote subcommand: add, list, or remove");
  },
  handler: () => {},
};
