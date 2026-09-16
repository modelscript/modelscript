// SPDX-License-Identifier: AGPL-3.0-or-later

import path from "node:path";
import type { CommandModule } from "yargs";
import {
  getRegistryDir,
  listAllLanguages,
  registerLanguageFromDirectory,
  unregisterLanguage,
} from "../util/language-registry.js";

interface LanguageArgs {
  action: "list" | "register" | "unregister";
  target?: string;
}

export const Language: CommandModule<any, any> = {
  command: "language <action> [target]",
  aliases: ["lang"],
  describe: "Manage registered language DSLs (list, register, unregister)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        description: "Action to perform: 'list', 'register', or 'unregister'",
        choices: ["list", "register", "unregister"],
        demandOption: true,
        type: "string",
      })
      .positional("target", {
        description: "Target directory (for register) or language ID (for unregister)",
        type: "string",
      });
  },
  handler: async (args) => {
    const { action, target } = args;

    if (action === "list") {
      const { builtIn, userRegistered } = listAllLanguages();
      console.log("\n=== ModelScript Language Registry ===");
      console.log(`Registry Directory: ${getRegistryDir()}\n`);

      console.log("Built-in Languages:");
      for (const b of builtIn) {
        console.log(`  • ${b.name.padEnd(16)} [${b.id}]  extensions: ${b.extensions.join(", ")}`);
      }

      console.log("\nUser-Registered Languages:");
      if (userRegistered.length === 0) {
        console.log("  (None registered yet. Use 'msc language register <path>' or 'msc build --register')");
      } else {
        for (const u of userRegistered) {
          console.log(
            `  • ${u.name.padEnd(16)} [${u.id}]  extensions: ${u.extensions.join(", ")}  (wasm: ${u.wasmPath || "none"})`,
          );
        }
      }
      console.log("");
      return;
    }

    if (action === "register") {
      const targetDir = path.resolve(process.cwd(), target || ".");
      console.log(`Registering language from: ${targetDir}...`);
      try {
        const manifest = await registerLanguageFromDirectory(targetDir);
        console.log(
          `✔ Successfully registered language '${manifest.name}' [${manifest.id}] for extensions: ${manifest.extensions.join(", ")}`,
        );
        console.log(`  Installed at: ${path.join(getRegistryDir(), manifest.id)}`);
      } catch (err: any) {
        console.error(`Failed to register language: ${err.message}`);
        process.exit(1);
      }
      return;
    }

    if (action === "unregister") {
      if (!target) {
        console.error("Error: Please specify the language ID to unregister (e.g. 'msc language unregister mylang').");
        process.exit(1);
      }
      const success = unregisterLanguage(target);
      if (success) {
        console.log(`✔ Successfully unregistered language '${target}'.`);
      } else {
        console.warn(`Language '${target}' not found in user registry.`);
      }
      return;
    }
  },
};
