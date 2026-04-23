// SPDX-License-Identifier: AGPL-3.0-or-later

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import type { CommandModule } from "yargs";
import { parsePackageMo } from "../util/package-mo.js";

interface InitArgs {
  path?: string;
  yes?: boolean;
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

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export const Init: CommandModule<{}, InitArgs> = {
  command: "init [path]",
  describe: "Initialize a ModelScript package.json for a Modelica/SysML project",
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any;
  },
  handler: async (args) => {
    const projectDir = path.resolve(args.path || ".");
    const packageJsonPath = path.join(projectDir, "package.json");

    if (existsSync(packageJsonPath)) {
      console.error(`Error: package.json already exists at ${packageJsonPath}`);
      console.error("Use 'npm init' to modify it or delete it first.");
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
      // Use defaults
      name = detectedName ? `@modelscript/${detectedName.toLowerCase()}` : path.basename(projectDir);
      version = detectedVersion || "0.0.0";
      description = detectedDescription || "";
      license = "MIT";
      modelicaVersion = "3.7";
    } else {
      // Interactive prompts
      const defaultName = detectedName ? `@modelscript/${detectedName.toLowerCase()}` : path.basename(projectDir);

      name = (await prompt(`Package name (${defaultName}): `)) || defaultName;
      version = (await prompt(`Version (${detectedVersion || "0.0.0"}): `)) || detectedVersion || "0.0.0";
      description = (await prompt(`Description (${detectedDescription || ""}): `)) || detectedDescription || "";
      license = (await prompt("License (MIT): ")) || "MIT";
      modelicaVersion = (await prompt("Modelica version (3.7): ")) || "3.7";
    }

    // Build the package.json
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const packageJson: Record<string, any> = {
      name,
      version,
      description,
      license,
      modelscript: {
        languages: ["modelica"],
        main: existsSync(packageMoPath) ? "package.mo" : undefined,
        modelicaVersion,
        artifacts: [],
      },
      dependencies: {},
    };

    // Remove undefined values
    if (!packageJson.modelscript.main) {
      delete packageJson.modelscript.main;
    }

    writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + "\n");
    console.log(`\n✅ Created ${packageJsonPath}`);
    console.log("\nNext steps:");
    console.log(`  npm install @modelscript/msl --registry=https://api.modelscript.org`);
    console.log(`  npm publish --registry=https://api.modelscript.org`);
  },
};
