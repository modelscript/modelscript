// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CommandModule } from "yargs";

export const Render: CommandModule = {
  command: "render <class> [libraries...]",
  describe: "",
  builder: (yargs) => {
    return yargs
      .positional("class", {
        demandOption: true,
        description: "qualified name of class to render",
        type: "string",
      })
      .positional("libraries", {
        array: true,
        demandOption: false,
        description: "library paths",
        type: "string",
      });
  },
  handler: (args) => {
    console.log(args);
  },
};
