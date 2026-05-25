/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-unused-vars */

// @ts-nocheck
import { Connection } from "vscode-languageserver";

export function registerCodeLensProvider(connection: Connection) {
  connection.onRequest("textDocument/codeLens", (params): CodeLens[] => {
    return [];
  });
}
