// SPDX-License-Identifier: AGPL-3.0-or-later

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";
import { getApiUrl, requireToken } from "../util/auth.js";
import { parsePackageMo } from "../util/package-mo.js";

interface UnpublishArgs {
  name: string | undefined;
  version: string | undefined;
  path: string | undefined;
}

export const Unpublish: CommandModule<{}, UnpublishArgs> = {
  command: "unpublish [path]",
  describe: "Remove a published library version from the Ansatz Package Registry",
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
        const pkgJsonPath = path.join(targetPath, "package.json");
        const msJsonPath = path.join(targetPath, "modelscript.json");
        const kparMetaPath = path.join(targetPath, ".meta.json");
        const packageMoPath = path.join(targetPath, "package.mo");

        if (existsSync(pkgJsonPath)) {
          const parsed = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
          name = parsed.name ?? null;
          version = parsed.version || "0.0.0";
        } else if (existsSync(msJsonPath)) {
          const parsed = JSON.parse(readFileSync(msJsonPath, "utf-8"));
          name = parsed.scope ? `${parsed.scope}/${parsed.idShort}` : (parsed.idShort ?? parsed.name ?? null);
          version = parsed.version || "0.0.0";
        } else if (existsSync(kparMetaPath)) {
          const parsed = JSON.parse(readFileSync(kparMetaPath, "utf-8"));
          name = parsed.name ?? null;
          version = parsed.version || "0.0.0";
        } else if (existsSync(packageMoPath)) {
          const content = readFileSync(packageMoPath, "utf-8");
          const parsed = parsePackageMo(content);
          if (!parsed.name) {
            console.error(`Error: Could not determine package name from ${packageMoPath}`);
            process.exit(1);
          }
          name = parsed.name;
          version = parsed.version || "0.0.0";
        } else {
          console.error(
            `Error: Directory must contain a 'package.json', 'modelscript.json', '.meta.json', or 'package.mo' file: ${targetPath}`,
          );
          process.exit(1);
        }
      } else if (stat.isFile() && targetPath.endsWith(".mo")) {
        const content = readFileSync(targetPath, "utf-8");
        const parsed = parsePackageMo(content);

        if (!parsed.name) {
          console.error(`Error: Could not determine package name from file: ${targetPath}`);
          process.exit(1);
        }

        name = parsed.name;
        version = parsed.version || "0.0.0";
      } else if (stat.isFile() && targetPath.endsWith(".json")) {
        const parsed = JSON.parse(readFileSync(targetPath, "utf-8"));
        name = parsed.name ?? parsed.idShort ?? null;
        version = parsed.version || "0.0.0";
      } else {
        console.error(`Error: Path must be a package directory or manifest/model file`);
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
      const API_URL = getApiUrl();
      const endpoint = `${API_URL}/api/v1/libraries/${name}/${version}`;

      const res = await fetch(endpoint, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        let errMessage = res.statusText;
        try {
          const json = (await res.json()) as { error?: string | undefined };
          if (json.error) errMessage = json.error;
        } catch {
          // ignore parsing error if it's not JSON
        }
        console.error(`Unpublish failed (${res.status}): ${errMessage}`);
        process.exit(1);
      }

      const data = (await res.json()) as { message?: string | undefined };
      console.log(`✅ ${data.message || "Unpublished successfully."}`);
    } catch (e) {
      console.error(`Error connecting to registry: ${(e as Error).message}`);
      process.exit(1);
    }
  },
};
