// SPDX-License-Identifier: AGPL-3.0-or-later

export {
  GAUSSIAN_MODEL_SPECS,
  GaussianArchetypeId,
  buildGaussianCleanroomSchemas,
  generateGaussianBlockSvg,
  type GaussianModelCategory,
  type GaussianModelSpec,
} from "./gaussian-std-schemas.js";
export {
  ensureBuiltInGaussianLibraryRegistered,
  getGaussianSchemasFromLibraries,
  lookupGaussianModelSchema,
  registerBuiltInGaussianLibrarySync,
} from "./library-package-adapter.js";
