// SPDX-License-Identifier: AGPL-3.0-or-later

export {
  DATCOM_AIRCRAFT_TEMPLATES,
  DATCOM_STD_SPECS,
  DatcomArchetypeId,
  buildDatcomCleanroomSchemas,
  generateDatcomBlockSvg,
  type DatcomModelCategory,
  type DatcomModelSpec,
} from "./datcom-std-schemas.js";
export {
  ensureBuiltInDatcomLibraryRegistered,
  getDatcomSchemasFromLibraries,
  lookupDatcomModelSchema,
  registerBuiltInDatcomLibrarySync,
} from "./library-package-adapter.js";
