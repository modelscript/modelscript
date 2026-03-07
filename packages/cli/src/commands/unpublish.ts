// SPDX-License-Identifier: AGPL-3.0-or-later

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";
import { requireToken } from "../util/auth.js";
import { parsePackageMo } from "../util/package-mo.js";

interface UnpublishArgs {
  name: string | undefined;
  version: string | undefined;
  path: string | undefined;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export const Unpublish: CommandModule<{}, UnpublishArgs> = {
  command: "unpublish [path]",
  describe: "Remove a published library version from the ModelScript Registry",
  builder: (yargs) => {
    return yargs
      .version(false)
      .positional("path", {
        description:
          "Path to a library directory (containing package.mo) or a single .mo file to infer name and version from",
        type: "string",
      })
      .option("name", {
        alias: "n",
        description: "Library name (used with --version instead of a path)",
        type: "string",
      })
      .option("version", {
        alias: "v",
        description: "Library version (used with --name instead of a path)",
        type: "string",
      })
      .check((argv) => {
        if (argv.path) return true;
        if (argv.name && argv.version) return true;
        throw new Error("Either a path argument, or --name and --version must be provided");
      });
  },
  handler: async (args) => {
    let name: string | null = args.name ?? null;
    let version: string | null = args.version ?? null;

    // If path is provided, extract name and version from the file/directory
    if (args.path) {
      const targetPath = path.resolve(args.path);

      if (!existsSync(targetPath)) {
        console.error(`Error: Path does not exist: ${targetPath}`);
        process.exit(1);
      }

      const stat = statSync(targetPath);

      if (stat.isDirectory()) {
        const packageMoPath = path.join(targetPath, "package.mo");
        if (!existsSync(packageMoPath)) {
          console.error(`Error: Directory must contain a 'package.mo' file: ${packageMoPath}`);
          process.exit(1);
        }

        const content = readFileSync(packageMoPath, "utf-8");
        const parsed = parsePackageMo(content);

        if (!parsed.name) {
          console.error(`Error: Could not determine package name from ${packageMoPath}`);
          process.exit(1);
        }

        name = parsed.name;
        version = parsed.version || "0.0.0";
      } else if (stat.isFile() && targetPath.endsWith(".mo")) {
        const content = readFileSync(targetPath, "utf-8");
        const parsed = parsePackageMo(content);

        if (!parsed.name) {
          console.error(`Error: Could not determine package name from file: ${targetPath}`);
          process.exit(1);
        }

        name = parsed.name;
        version = parsed.version || "0.0.0";
      } else {
        console.error(`Error: Path must be a directory or a single .mo file`);
        process.exit(1);
      }
    }

    if (!name || !version) {
      console.error("Error: Could not determine library name and version");
      process.exit(1);
    }

    console.log(`Unpublishing ${name}@${version}...`);

    const token = requireToken();

    try {
      const API_URL = process.env.MODELSCRIPT_API_URL || "http://localhost:3000";
      const endpoint = `${API_URL}/api/v1/libraries/${name}/${version}`;

      const res = await fetch(endpoint, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        let errMessage = res.statusText;
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const json = (await res.json()) as any;
          if (json.error) errMessage = json.error;
        } catch {
          // ignore parsing error if it's not JSON
        }
        console.error(`Unpublish failed (${res.status}): ${errMessage}`);
        process.exit(1);
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (await res.json()) as any;
      console.log(`✅ ${data.message || "Unpublished successfully."}`);
    } catch (e) {
      console.error(`Error connecting to registry: ${(e as Error).message}`);
      process.exit(1);
    }
  },
};
