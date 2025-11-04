// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CommandModule } from "yargs";

export const Parse: CommandModule = {
  command: "parse <file>",
  describe: "",
  builder: (yargs) => {
    return yargs.positional("file", {
      demandOption: true,
      description: "path to file to parse",
      type: "string",
    });
  },
  handler: (args) => {
    console.log(args);
  },
};
