// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Argv, CommandModule } from "yargs";

export interface LspArgs {
  stdio: boolean;
  port?: number | undefined;
}

export const Lsp: CommandModule<{}, LspArgs> = {
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
      }) as unknown as Argv<LspArgs>;
  },
  handler: async (_args) => {
    const { startNodeServer } = await import("@modelscript/lsp");
    startNodeServer();
  },
};
