// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/lsp
 * Multi-language Language Server Protocol server, language services,
 * and multi-file workspace indexing for ModelScript.
 */

export * from "./diagramApi.js";
export * from "./diagramData.js";
export * from "./diagramEdits.js";
export * from "./diagramProtocol.js";
export * from "./handlers/index.js";
export * from "./lsp-bridge.js";
export * from "./LspContext.js";
export { startNodeServer } from "./nodeServerMain.js";
export * from "./providers/index.js";
export * from "./registry/index.js";
export * from "./requirements.js";
export * from "./services/index.js";
export * from "./utils/hook-extractor.js";
export {
  LineIndex,
  type Edit,
  type Parser,
  type Range,
  type SyntaxNode,
  type TokenData,
  type Tree,
  type Point as TreePoint,
} from "./utils/index.js";
export * from "./vfs/index.js";
export * from "./workers/worker-pool.js";
