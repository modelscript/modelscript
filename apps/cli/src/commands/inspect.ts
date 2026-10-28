// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript CLI: Universal Polyglot Inspection Command (`msx inspect`).
 *
 * Inspects and summarizes any of the 44 engineering languages supported by ModelScript,
 * automatically detecting the language by file extension and content header sniffing
 * (or via explicit `--language / --lang / -l` override).
 */

import type { Argv, CommandModule } from "yargs";
import {
  resolveLanguageOption,
  resolveOutputFormat,
  resolveOutputPath,
  withFormatOption,
  withLanguageOption,
  withOutputOption,
} from "../util/cli-options.js";
import { dispatchDomainAction } from "../util/domain-dispatcher.js";

export interface InspectArgs {
  files: string[];
  language?: string | undefined;
  lang?: string | undefined;
  format?: string | undefined;
  json?: boolean | undefined;
  output?: string | undefined;
  out?: string | undefined;
}

export const Inspect: CommandModule<{}, InspectArgs> = {
  command: ["inspect <files..>", "info <files..>", "summary <files..>"],
  describe: "Inspect and summarize engineering models across any of the 44 supported languages",
  builder: ((yargs: Argv) => {
    let y = yargs.positional("files", {
      array: true,
      demandOption: true,
      description: "One or more model, netlist, CAD, or simulation deck files to inspect",
      type: "string",
    });
    y = withLanguageOption(y);
    y = withFormatOption(y, ["terminal", "json", "pretty", "table", "text"], "terminal");
    y = withOutputOption(y, "Write summary report to output file");
    return y as unknown as Argv<InspectArgs>;
  }) as CommandModule<{}, InspectArgs>["builder"],
  handler: async (args) => {
    const language = resolveLanguageOption(args as unknown as Record<string, unknown>);
    const output = resolveOutputPath(args as unknown as Record<string, unknown>);
    const format = resolveOutputFormat(args as unknown as Record<string, unknown>);

    // Group files by resolved language if language is not explicitly forced, or dispatch per file
    for (const file of args.files) {
      await dispatchDomainAction({
        language,
        action: "inspect",
        files: [file],
        output,
        out: output,
        format,
        json: Boolean(args.json),
      });
    }
  },
};
