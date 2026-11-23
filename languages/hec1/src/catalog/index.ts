// SPDX-License-Identifier: AGPL-3.0-or-later

export {
  HEC1_MODEL_SPECS,
  Hec1ArchetypeId,
  TR55_CURVE_NUMBER_TABLE,
  buildHec1CleanroomSchemas,
  generateHec1BlockSvg,
  lookupTr55CurveNumber,
  type Hec1ModelCategory,
  type Hec1ModelSpec,
  type HydrologicSoilGroup,
  type Tr55LandCoverEntry,
} from "./hec1-std-schemas.js";
export {
  ensureBuiltInHec1LibraryRegistered,
  getHec1SchemasFromLibraries,
  getHec1StdLibWasmRuntime,
  lookupHec1ModelSchema,
  registerBuiltInHec1LibrarySync,
  type Hec1StdLibWasmExports,
} from "./library-package-adapter.js";
