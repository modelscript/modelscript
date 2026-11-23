// SPDX-License-Identifier: AGPL-3.0-or-later

import { globalLibraryRegistry } from "@modelscript/runtime";
import {
  ARINC429_STD_LIB_DIAGRAMS,
  ARINC429_STD_LIB_PKG_JSON,
  ARINC429_STD_LIB_SYMBOLS,
  getArinc429StdLibWasmBytes,
} from "./arinc429-std-lib-data.js";

/**
 * Registers the built-in `@modelscript/arinc429-std-lib` bundle into `globalLibraryRegistry` with zero I/O.
 */
export function registerBuiltInArinc429LibrarySync(): void {
  if (globalLibraryRegistry.getPackagesForLanguage("arinc429").length > 0) return;
  globalLibraryRegistry.registerLibraryBundle(ARINC429_STD_LIB_PKG_JSON, {
    symbols: ARINC429_STD_LIB_SYMBOLS,
    diagrams: ARINC429_STD_LIB_DIAGRAMS,
    wasmBytes: getArinc429StdLibWasmBytes(),
  });
}

/**
 * Ensures the built-in `@modelscript/arinc429-std-lib` package is registered in `globalLibraryRegistry`.
 */
export function ensureBuiltInArinc429LibraryRegistered(): void {
  registerBuiltInArinc429LibrarySync();
}
