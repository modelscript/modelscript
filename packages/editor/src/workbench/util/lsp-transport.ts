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
} from "../../transport.js";
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
  return getLsp() ?? (await startLsp(initialLanguageId));
}
