// SPDX-License-Identifier: AGPL-3.0-or-later

export {
  IGES_STD_SPECS,
  IgesArchetypeId,
  buildIgesCleanroomSchemas,
  generateIgesBlockSvg,
  type IgesModelCategory,
  type IgesSchemaSpec,
} from "./iges-std-schemas.js";

export {
  ensureBuiltInIgesLibraryRegistered,
  getIgesSchemasFromLibraries,
  lookupIgesEntitySchema,
  registerBuiltInIgesLibrarySync,
} from "./library-package-adapter.js";

export {
  IGES_STD_LIB_DIAGRAMS,
  IGES_STD_LIB_PKG_JSON,
  IGES_STD_LIB_SYMBOLS,
  getIgesStdLibWasmBytes,
} from "./iges-std-lib-data.js";
