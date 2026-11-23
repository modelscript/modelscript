// SPDX-License-Identifier: AGPL-3.0-or-later

export {
  ESTEREL_STD_LIB_DIAGRAMS,
  ESTEREL_STD_LIB_PKG_JSON,
  ESTEREL_STD_LIB_SYMBOLS,
  getEsterelStdLibWasmBytes,
} from "./esterel-std-lib-data.js";
export {
  ESTEREL_PATTERN_SPECS,
  EsterelArchetypeId,
  buildEsterelCleanroomSchemas,
  generateEsterelBlockSvg,
  type EsterelPatternCategory,
  type EsterelPatternSpec,
} from "./esterel-std-schemas.js";
export {
  ensureBuiltInEsterelLibraryRegistered,
  getEsterelSchemasFromLibraries,
  lookupEsterelPatternSchema,
  registerBuiltInEsterelLibrarySync,
} from "./library-package-adapter.js";
