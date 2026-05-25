/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-unused-vars */

// @ts-nocheck
import { Connection } from "vscode-languageserver";

export function registerInlayHintProvider(connection: Connection) {
  connection.onRequest("textDocument/inlayHint", (params): InlayHint[] => {
    return [];
  });
}
