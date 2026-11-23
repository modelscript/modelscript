// SPDX-License-Identifier: AGPL-3.0-or-later

export {
  ensureBuiltInVhdlLibraryRegistered,
  getVhdlSchemasFromLibraries,
  lookupVhdlModelSchema,
  registerBuiltInVhdlLibrarySync,
} from "./library-package-adapter.js";
export {
  VHDL_STD_LIB_DIAGRAMS,
  VHDL_STD_LIB_PKG_JSON,
  VHDL_STD_LIB_SYMBOLS,
  getVhdlStdLibWasmBytes,
} from "./vhdl-std-lib-data.js";
export {
  VHDL_STD_SPECS,
  VhdlArchetypeId,
  buildVhdlCleanroomSchemas,
  generateVhdlBlockSvg,
  type VhdlStdCategory,
  type VhdlStdSpec,
} from "./vhdl-std-schemas.js";
