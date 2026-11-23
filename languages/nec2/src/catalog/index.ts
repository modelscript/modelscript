// SPDX-License-Identifier: AGPL-3.0-or-later

export {
  ensureBuiltInNec2LibraryRegistered,
  getNec2SchemasFromLibraries,
  lookupNec2ModelSchema,
  registerBuiltInNec2LibrarySync,
} from "./library-package-adapter.js";
export {
  NEC2_STD_LIB_DIAGRAMS,
  NEC2_STD_LIB_PKG_JSON,
  NEC2_STD_LIB_SYMBOLS,
  getNec2StdLibWasmBytes,
} from "./nec2-std-lib-data.js";
export {
  NEC2_STD_SPECS,
  Nec2ArchetypeId,
  buildNec2CleanroomSchemas,
  generateNec2ArchetypeDeck,
  generateNec2BlockSvg,
  type Nec2AntennaCategory,
  type Nec2AntennaSpec,
} from "./nec2-std-schemas.js";
