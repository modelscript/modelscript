// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Re-exports `@modelscript/editor`'s host-agnostic `EditorHostProvider` and
 * `useEditorHost` under backwards-compatible `Morsel*` aliases.
 */

export {
  EditorHostProvider,
  EditorHostProvider as MorselHostProvider,
  useEditorHost,
  useEditorHost as useMorselHost,
  type EditorHostAdapter,
  type EditorHostAdapter as MorselHostAdapter,
} from "@modelscript/editor";
