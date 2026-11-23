// SPDX-License-Identifier: AGPL-3.0-or-later

export {
  ensureBuiltInSlamLibraryRegistered,
  getSlamSchemasFromLibraries,
  lookupSlamModelSchema,
  registerBuiltInSlamLibrarySync,
} from "./library-package-adapter.js";
export {
  SLAM_BLOCK_SPECS,
  SlamArchetypeId,
  buildSlamCleanroomSchemas,
  generateSlamBlockSvg,
  type SlamBlockCategory,
  type SlamBlockSpec,
} from "./slam-std-schemas.js";
