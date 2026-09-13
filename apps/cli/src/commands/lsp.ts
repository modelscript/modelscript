// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CommandModule } from "yargs";

interface LspArgs {
  stdio: boolean;
  port?: number;
}

export const Lsp: CommandModule<any, any> = {
  command: "lsp",
  describe: "Start the ModelScript polyglot Language Server (over stdio for editor integration)",
  builder: (yargs) => {
    return yargs
      .option("stdio", {
        description: "Run language server over standard I/O (default for VS Code, Neovim, Emacs)",
        type: "boolean",
        default: true,
      })
      .option("port", {
        description: "Run language server over a TCP port",
        type: "number",
      });
  },
  handler: async (args) => {
    const { startNodeServer } = await import("@modelscript/lsp");
    startNodeServer();
  },
};
