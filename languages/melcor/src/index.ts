// SPDX-License-Identifier: AGPL-3.0-or-later

import { registerBuiltInMelcorLibrarySync } from "./catalog/library-package-adapter.js";

export * from "./catalog/index.js";
export * from "./dae/index.js";
export * from "./errors.js";
export * from "./indexing.js";
export * from "./language.js";
export * from "./lints/index.js";
export * from "./lsp.js";
export * from "./parser/index.js";
export * from "./projections/index.js";
export * from "./solver/index.js";
export * from "./types.js";

// Auto-register cleanroom standard library in globalLibraryRegistry (zero-I/O).
registerBuiltInMelcorLibrarySync();
