// SPDX-License-Identifier: AGPL-3.0-or-later

export {
  OBJ_STANDARD_SPECS,
  ObjArchetypeId,
  buildObjCleanroomSchemas,
  generateObjBlockSvg,
  generateStandardEngineeringMtl,
  type ObjSchemaCategory,
  type ObjSchemaSpec,
} from "./obj-std-schemas.js";

export {
  ensureBuiltInObjLibraryRegistered,
  getObjSchemasFromLibraries,
  lookupObjSchema,
  registerBuiltInObjLibrarySync,
} from "./library-package-adapter.js";
