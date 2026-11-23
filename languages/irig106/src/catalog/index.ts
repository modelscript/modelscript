// SPDX-License-Identifier: AGPL-3.0-or-later

export {
  IRIG106_STANDARD_SYNC_WORDS,
  Irig106ArchetypeId,
  buildIrig106CleanroomSchemas,
  generateIrig106BlockSvg,
  type Irig106SchemaCategory,
  type Irig106SyncWordSpec,
} from "./irig106-std-schemas.js";
export {
  ensureBuiltInIrig106LibraryRegistered,
  getIrig106SchemasFromLibraries,
  lookupIrig106Schema,
  registerBuiltInIrig106LibrarySync,
} from "./library-package-adapter.js";
