// SPDX-License-Identifier: AGPL-3.0-or-later

export {
  HDF4_MODEL_SPECS,
  Hdf4ArchetypeId,
  buildHdf4CleanroomSchemas,
  generateHdf4BlockSvg,
  type Hdf4ModelCategory,
  type Hdf4ModelSpec,
} from "./hdf4-std-schemas.js";
export {
  ensureBuiltInHdf4LibraryRegistered,
  getHdf4SchemasFromLibraries,
  lookupHdf4ModelSchema,
  registerBuiltInHdf4LibrarySync,
} from "./library-package-adapter.js";
