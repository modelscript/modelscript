// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Web-app LSP transport bridge built on `@modelscript/editor`.
 *
 * Re-exports the host-agnostic `EditorLspTransport` / `createHttpLspTransport`
 * primitives and falls back to the `apps/web` WebWorker (`lsp-worker.ts`) when
 * no custom transport is injected.
 */

import {
  createHttpLspTransport,
  getCustomEditorLspTransport,
  setActiveEditorLspTransport,
  type EditorLspTransport,
} from "@modelscript/editor";
import type { ProtocolConnection } from "vscode-languageserver-protocol/browser";
import { getLsp, startLsp } from "./lsp-worker";

export type AnsatzLspTransport = EditorLspTransport;
export {
  createHttpLspTransport,
  getCustomEditorLspTransport as getCustomLspTransport,
  setActiveEditorLspTransport as setActiveLspTransport,
};

/**
 * Synchronously checks whether a custom transport or the default LSP WebWorker
 * is already active without lazily booting a worker.
 */
export function hasActiveLspTransport(): boolean {
  return Boolean(getCustomEditorLspTransport() || getLsp());
}

/**
 * Returns the currently active `EditorLspTransport`, lazily booting the default
 * WebWorker `ProtocolConnection` when no custom transport has been injected.
 */
export async function getActiveLspTransport(initialLanguageId?: string): Promise<EditorLspTransport> {
  const custom = getCustomEditorLspTransport();
  if (custom) return custom;
  const conn: ProtocolConnection = getLsp() ?? (await startLsp(initialLanguageId));
  return conn as unknown as EditorLspTransport;
}
