// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  MANIFEST_FILENAME,
  stringifyModelScriptYaml,
  WORKSPACE_DIR,
  type ModelScriptManifest,
} from "@modelscript/runtime";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import type { Argv, CommandModule } from "yargs";
import { parsePackageMo } from "../util/package-mo.js";

interface InitArgs {
  path?: string | undefined;
  yes?: boolean | undefined;
}

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export const Init: CommandModule<{}, InitArgs> = {
  command: "init [path]",
  describe: "Initialize a modelscript.yaml manifest for a ModelScript project",
  builder: (yargs) => {
    return yargs
      .positional("path", {
        description: "Path to the project directory (defaults to cwd)",
        type: "string",
      })
      .option("yes", {
        alias: "y",
        description: "Accept all defaults without prompts",
        type: "boolean",
        default: false,
      }) as unknown as Argv<InitArgs>;
  },
  handler: async (args) => {
    const projectDir = path.resolve(args.path || ".");
    const manifestPath = path.join(projectDir, MANIFEST_FILENAME);

    if (existsSync(manifestPath)) {
      console.error(`Error: ${MANIFEST_FILENAME} already exists at ${manifestPath}`);
      process.exit(1);
    }

    // Try to auto-detect from package.mo
    const packageMoPath = path.join(projectDir, "package.mo");
    let detectedName: string | null = null;
    let detectedVersion: string | null = null;
    let detectedDescription: string | null = null;

    if (existsSync(packageMoPath)) {
      const content = readFileSync(packageMoPath, "utf-8");
      const parsed = parsePackageMo(content);
      detectedName = parsed.name;
      detectedVersion = parsed.version;
      detectedDescription = parsed.description ?? null;
      console.log(`📦 Detected Modelica package: ${detectedName}@${detectedVersion ?? "0.0.0"}`);
    }

    let name: string;
    let version: string;
    let description: string;
    let license: string;
    let modelicaVersion: string;

    if (args.yes) {
      name = detectedName ? `@modelscript/${detectedName.toLowerCase()}` : path.basename(projectDir);
      version = detectedVersion || "0.1.0";
      description = detectedDescription || "";
      license = "MIT";
      modelicaVersion = "3.7";
    } else {
      const defaultName = detectedName ? `@modelscript/${detectedName.toLowerCase()}` : path.basename(projectDir);

      name = (await prompt(`Package name (${defaultName}): `)) || defaultName;
      version = (await prompt(`Version (${detectedVersion || "0.1.0"}): `)) || detectedVersion || "0.1.0";
      description = (await prompt(`Description (${detectedDescription || ""}): `)) || detectedDescription || "";
      license = (await prompt("License (MIT): ")) || "MIT";
      modelicaVersion = (await prompt("Modelica version (3.7): ")) || "3.7";
    }

    const manifest: ModelScriptManifest = {
      name,
      version,
      description: description || undefined,
      license,
      languages: ["modelica", "sysml2"],
      main: existsSync(packageMoPath) ? "package.mo" : undefined,
      modelicaVersion,
      dependencies: {},
    };

    writeFileSync(manifestPath, stringifyModelScriptYaml(manifest), "utf-8");

    // Ensure .modelscript/ is gitignored
    const gitignorePath = path.join(projectDir, ".gitignore");
    const ignoreLine = `${WORKSPACE_DIR}/`;
    if (existsSync(gitignorePath)) {
      const existing = readFileSync(gitignorePath, "utf-8");
      if (!existing.split(/\r?\n/).some((line) => line.trim() === ignoreLine)) {
        appendFileSync(gitignorePath, `${existing.endsWith("\n") ? "" : "\n"}${ignoreLine}\n`, "utf-8");
      }
    } else {
      writeFileSync(gitignorePath, `${ignoreLine}\n`, "utf-8");
    }

    console.log(`\n✅ Created ${manifestPath}`);
    console.log("\nNext steps:");
    console.log(`  msx install @modelscript/msl`);
    console.log(`  msx remote add @reqs/safety oslc+https://elm.corp.com/rm/modules/MOD-42`);
    console.log(`  msx sync pull`);
  },
};
