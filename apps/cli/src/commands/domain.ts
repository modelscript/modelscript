// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript CLI: Unified Domain Command Router (`msx domain <lang> <action> [files..]`).
 *
 * Provides a clean hierarchical namespace for invoking any domain-specific tool or
 * lifecycle verb (`inspect`, `lint`, `to-dae`, `to-modelica`, `to-sysml2`, `to-ssp`,
 * `to-fmu`, `simulate`, `diagram`, or specialty commands like `easy5 bode`, `olga flash`,
 * `touchstone passivity`, `urdf rnea`) with normalized flags.
 */

import type { Argv, CommandModule } from "yargs";
import { resolveOutputFormat, resolveOutputPath, withFormatOption, withOutputOption } from "../util/cli-options.js";
import { dispatchDomainAction } from "../util/domain-dispatcher.js";

export interface DomainCommandArgs {
  lang: string;
  action: string;
  files?: string[] | undefined;
  output?: string | undefined;
  out?: string | undefined;
  format?: string | undefined;
  json?: boolean | undefined;
  [key: string]: unknown;
}

export const Domain: CommandModule<{}, DomainCommandArgs> = {
  command: ["domain <lang> <action> [files..]", "tool <lang> <action> [files..]"],
  describe: "Invoke domain-specific engineering actions and solvers for any registered language",
  builder: ((yargs: Argv) => {
    let y = yargs
      .positional("lang", {
        demandOption: true,
        description: "Target engineering language ID (e.g. spice, cfd, fea, urdf, olga, easy5, sysml2)",
        type: "string",
      })
      .positional("action", {
        demandOption: true,
        description:
          "Lifecycle or specialty action (inspect, lint, to-dae, to-modelica, to-sysml2, to-ssp, to-fmu, simulate, diagram, ...)",
        type: "string",
      })
      .positional("files", {
        array: true,
        demandOption: false,
        description: "Input model/deck file(s)",
        type: "string",
      });
    y = withFormatOption(y, ["terminal", "json", "pretty", "table", "text", "csv", "svg"], "terminal");
    y = withOutputOption(y, "Output file path");
    return y as unknown as Argv<DomainCommandArgs>;
  }) as CommandModule<{}, DomainCommandArgs>["builder"],
  handler: async (args) => {
    const files = args.files ?? [];
    const output = resolveOutputPath(args as unknown as Record<string, unknown>);
    const format = resolveOutputFormat(args as unknown as Record<string, unknown>);
    await dispatchDomainAction({
      language: args.lang,
      action: args.action,
      files,
      output,
      out: output,
      format,
      json: Boolean(args.json),
      extraArgs: args,
    });
  },
};
