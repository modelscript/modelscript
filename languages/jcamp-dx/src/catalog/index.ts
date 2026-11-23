// SPDX-License-Identifier: AGPL-3.0-or-later

export {
  IR_FUNCTIONAL_GROUP_BANDS,
  JcampDxArchetypeId,
  buildJcampDxCleanroomSchemas,
  generateJcampDxBlockSvg,
  matchIrFunctionalGroup,
  type IrFunctionalGroupBand,
  type JcampDxModelCategory,
} from "./jcamp-dx-std-schemas.js";
export {
  ensureBuiltInJcampDxLibraryRegistered,
  getJcampDxSchemasFromLibraries,
  lookupJcampDxModelSchema,
  registerBuiltInJcampDxLibrarySync,
} from "./library-package-adapter.js";
