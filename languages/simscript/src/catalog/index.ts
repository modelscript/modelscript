// SPDX-License-Identifier: AGPL-3.0-or-later

export {
  ensureBuiltInSimscriptLibraryRegistered,
  getSimscriptSchemasFromLibraries,
  lookupSimscriptModelSchema,
  registerBuiltInSimscriptLibrarySync,
} from "./library-package-adapter.js";
export {
  SIMSCRIPT_STD_LIB_DIAGRAMS,
  SIMSCRIPT_STD_LIB_PKG_JSON,
  SIMSCRIPT_STD_LIB_SYMBOLS,
  getSimscriptStdLibWasmBytes,
} from "./simscript-std-lib-data.js";
export {
  SIMSCRIPT_STD_SPECS,
  SimscriptArchetypeId,
  buildSimscriptCleanroomSchemas,
  generateSimscriptBlockSvg,
  type SimscriptModelCategory,
  type SimscriptModelSpec,
} from "./simscript-std-schemas.js";
