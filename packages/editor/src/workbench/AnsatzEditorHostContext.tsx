// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Re-exports `@modelscript/editor`'s host-agnostic `EditorHostProvider` and
 * `useEditorHost` under backwards-compatible `Ansatz*` aliases.
 */

export {
  EditorHostProvider as AnsatzHostProvider,
  EditorHostProvider,
  useEditorHost as useAnsatzHost,
  useEditorHost,
  type EditorHostAdapter as AnsatzHostAdapter,
  type EditorHostAdapter,
} from "@modelscript/editor";
