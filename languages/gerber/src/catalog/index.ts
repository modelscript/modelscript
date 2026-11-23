// SPDX-License-Identifier: AGPL-3.0-or-later

export {
  GERBER_STD_LIB_DIAGRAMS,
  GERBER_STD_LIB_PKG_JSON,
  GERBER_STD_LIB_SYMBOLS,
  getGerberStdLibWasmBytes,
} from "./gerber-std-lib-data.js";
export {
  GERBER_MODEL_SPECS,
  GerberArchetypeId,
  buildGerberCleanroomSchemas,
  generateGerberBlockSvg,
  type GerberModelCategory,
  type GerberModelSpec,
} from "./gerber-std-schemas.js";
export {
  ensureBuiltInGerberLibraryRegistered,
  getGerberSchemasFromLibraries,
  lookupGerberModelSchema,
  registerBuiltInGerberLibrarySync,
} from "./library-package-adapter.js";
