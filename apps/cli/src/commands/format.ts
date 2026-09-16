// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";
import { LanguageResolver } from "../util/language-registry.js";

interface FormatArgs {
  files: string[];
  write?: boolean;
  check?: boolean;
  language?: string;
  indentSize?: number;
  preserveFormatting?: boolean;
}

function expandFiles(entries: string[], languageOverride?: string): string[] {
  const result: string[] = [];
  const recognizedExtensions = new Set(LanguageResolver.getAllExtensions().map((e) => e.toLowerCase()));

  for (const entry of entries) {
    const abs = path.resolve(process.cwd(), entry);
    if (!fs.existsSync(abs)) {
      console.warn(`Warning: File or path not found: ${entry}`);
      continue;
    }
    const stat = fs.statSync(abs);
    if (stat.isFile()) {
      result.push(abs);
    } else if (stat.isDirectory()) {
      // Scan directory for recognized extensions
      const crawl = (dir: string) => {
        for (const item of fs.readdirSync(dir)) {
          if (["node_modules", "dist", ".git", "build"].includes(item)) continue;
          const full = path.join(dir, item);
          const st = fs.statSync(full);
          if (st.isDirectory()) {
            crawl(full);
          } else if (st.isFile()) {
            const ext = path.extname(full).toLowerCase();
            if (languageOverride || recognizedExtensions.has(ext)) {
              result.push(full);
            }
          }
        }
      };
      crawl(abs);
    }
  }

  return Array.from(new Set(result));
}

export const Format: CommandModule<any, any> = {
  command: "format <files..>",
  describe: "Format source files using their language DSL formatter or unparser",
  builder: (yargs) => {
    return yargs
      .positional("files", {
        description: "File path(s) or directories to format",
        type: "string",
        array: true,
        demandOption: true,
      })
      .option("write", {
        alias: "w",
        description: "Edit files in place",
        type: "boolean",
        default: false,
      })
      .option("check", {
        alias: "c",
        description: "Check if files are formatted without writing (exits with code 1 if unformatted)",
        type: "boolean",
        default: false,
      })
      .option("language", {
        alias: "l",
        description: "Explicit language override (e.g. modelica, sysml2, scad, step)",
        type: "string",
      })
      .option("indent-size", {
        description: "Number of spaces per indentation level",
        type: "number",
        default: 2,
      })
      .option("preserve-formatting", {
        description: "Preserve original token layout where grammar permits",
        type: "boolean",
        default: false,
      });
  },
  handler: async (args) => {
    const filePaths = expandFiles(args.files, args.language);
    if (filePaths.length === 0) {
      console.error("No matching files found to format.");
      process.exit(1);
    }

    let unformattedCount = 0;
    let formattedCount = 0;
    const isSingleFileStdout = !args.write && !args.check && filePaths.length === 1;

    for (const filePath of filePaths) {
      try {
        const lang = await LanguageResolver.resolve(filePath, args.language);
        const original = fs.readFileSync(filePath, "utf-8");
        const formatted = await lang.format(original, {
          indentSize: args.indentSize,
          preserveFormatting: args.preserveFormatting,
        });

        if (isSingleFileStdout) {
          process.stdout.write(formatted);
          return;
        }

        const isUnchanged = formatted === original;

        if (args.check) {
          if (!isUnchanged) {
            console.error(`[unformatted] ${path.relative(process.cwd(), filePath)} (${lang.manifest.name})`);
            unformattedCount++;
          }
        } else if (args.write) {
          if (!isUnchanged) {
            fs.writeFileSync(filePath, formatted, "utf-8");
            console.log(`Formatted ${path.relative(process.cwd(), filePath)} (${lang.manifest.name})`);
            formattedCount++;
          }
        } else {
          // Multi-file stdout without -w: print file separator & formatted content
          console.log(`\n--- ${path.relative(process.cwd(), filePath)} ---`);
          process.stdout.write(formatted);
        }
      } catch (err: any) {
        console.error(`Error formatting ${path.relative(process.cwd(), filePath)}: ${err.message}`);
        unformattedCount++;
      }
    }

    if (args.check) {
      if (unformattedCount > 0) {
        console.error(`\nFound ${unformattedCount} unformatted file(s). Run 'msc format -w' to format in place.`);
        process.exit(1);
      } else {
        console.log(`All ${filePaths.length} file(s) are properly formatted.`);
      }
    } else if (args.write) {
      console.log(
        `Formatting complete. ${formattedCount} file(s) formatted, ${filePaths.length - formattedCount} file(s) already clean.`,
      );
    }
  },
};
