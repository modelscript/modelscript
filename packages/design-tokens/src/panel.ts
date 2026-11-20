// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Lightweight, zero-runtime subpath entry for decentralized language UI panels.
 * Importing from `@modelscript/react/panel` avoids bundling `@modelscript/runtime`,
 * `@modelscript/exchange`, or `@modelscript/embed` into individual language webviews.
 */

export * from "./components/LanguagePanelPrimitives.js";
export * from "./components/PanelBltView.js";
export * from "./panel-contract.js";
