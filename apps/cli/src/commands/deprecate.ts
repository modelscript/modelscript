// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Argv, CommandModule } from "yargs";
import { getApiUrl, getToken } from "../util/auth.js";

export interface DeprecateArgs {
  package: string;
  reason?: string | undefined;
  undo?: boolean | undefined;
  json?: boolean | undefined;
}

export const Deprecate: CommandModule<{}, DeprecateArgs> = {
  command: "deprecate <package> [reason]",
  aliases: ["undeprecate"],
  describe: "Deprecate or un-deprecate a package release in the registry",
  builder: ((yargs: Argv) => {
    return yargs
      .positional("package", {
        description: "Package identifier and version (e.g. Modelica@4.0.0 or @scope/pkg@1.0.0)",
        type: "string",
      })
      .positional("reason", {
        description: "Deprecation explanation message and recommended migration",
        type: "string",
      })
      .option("undo", {
        description: "Clear/undo deprecation status for this release",
        type: "boolean",
        default: false,
      })
      .option("json", {
        description: "Output result summary as JSON",
        type: "boolean",
        default: false,
      });
  }) as CommandModule<{}, DeprecateArgs>["builder"],
  handler: async (args) => {
    const raw = args.package.trim();
    let name = raw;
    let version: string | undefined;

    if (raw.startsWith("@")) {
      const lastAt = raw.lastIndexOf("@");
      if (lastAt > 0) {
        name = raw.slice(0, lastAt);
        version = raw.slice(lastAt + 1);
      }
    } else if (raw.includes("@")) {
      const parts = raw.split("@");
      name = parts[0]!;
      version = parts[1];
    }

    if (!version) {
      console.error(`Error: Exact version must be specified (e.g. ${name}@1.0.0).`);
      process.exit(1);
    }

    const token = getToken();
    if (!token) {
      console.error("Error: Authentication required. Run 'msx login' or set MODELSCRIPT_TOKEN.");
      process.exit(1);
    }

    const API_URL = getApiUrl();
    const isUndo = Boolean(args.undo || process.argv.includes("undeprecate"));
    const packagePath = name.startsWith("@")
      ? name.split("/").map(encodeURIComponent).join("/")
      : encodeURIComponent(name);

    const url = `${API_URL}/api/v1/libraries/${packagePath}/${encodeURIComponent(version)}/deprecate`;
    const method = isUndo ? "DELETE" : "POST";
    const body = isUndo
      ? undefined
      : JSON.stringify({ reason: args.reason || "This release has been deprecated by the author." });

    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body } : {}),
    });

    if (!res.ok) {
      let errMsg = res.statusText;
      try {
        const data = (await res.json()) as { error?: string };
        if (data.error) errMsg = data.error;
      } catch {}
      console.error(`\n❌ Failed to ${isUndo ? "undeprecate" : "deprecate"} ${name}@${version}: ${errMsg}\n`);
      process.exit(1);
    }

    if (args.json) {
      console.log(
        JSON.stringify({ status: "success", package: name, version, isDeprecated: !isUndo, reason: args.reason }),
      );
    } else {
      if (isUndo) {
        console.log(`\n✅ Cleared deprecation status for ${name}@${version}.\n`);
      } else {
        console.log(
          `\n⚠️  Deprecated ${name}@${version}: ${args.reason || "This release has been deprecated by the author."}\n`,
        );
      }
    }
  },
};
