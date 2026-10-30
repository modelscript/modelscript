// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DdpManifest } from "../ddp/types.js";

/**
 * Common types and data contracts for the ModelScript Multi-Projection Lens Engine.
 * Supports projecting a canonical cyber-physical workspace into NPM (package.json),
 * Industrie 4.0 Asset Administration Shell (aas.json / .aasx), Open Know-How (okh.json),
 * and Digital Data Package (ddp-manifest.json / .ddp).
 */

export interface CanonicalSubmodelDescriptor {
  idShort: string;
  semanticId?: string | undefined;
  category?: string | undefined;
  description?: string | undefined;
  path?: string | undefined;
  data?: Record<string, unknown> | undefined;
}

export interface CanonicalBOMItem {
  name: string;
  partNumber?: string | undefined;
  manufacturer?: string | undefined;
  quantity: number;
  packageDependency?: string | undefined; // e.g. "@suppliers/askoll-pump@^1.0.0"
  sourcingUrl?: string | undefined;
  estimatedCost?: number | undefined;
  category?: "electronics" | "mechanics" | "actuator" | "sensor" | "fastener" | "consumable" | "other" | undefined;
}

export interface CanonicalWorkspaceManifest {
  /** Global asset identifier (URI/IRI) */
  globalAssetId: string;
  /** Short identifier / slug */
  idShort: string;
  /** Display title */
  title: string;
  /** Semantic version (semver) */
  version: string;
  /** Package scope (e.g. "@bsh" or "@modelscript") */
  scope?: string | undefined;
  /** Short description */
  description?: string | undefined;
  /** Author name and email */
  author?:
    | {
        name: string;
        email?: string | undefined;
        organization?: string | undefined;
      }
    | undefined;
  /** License (e.g. "CERN-OHL-P-2.0", "Apache-2.0", "Proprietary") */
  license?: string | undefined;
  /** Homepage or repository URL */
  homepage?: string | undefined;
  /** Repository information */
  repository?:
    | {
        type: string;
        url: string;
      }
    | undefined;
  /** Bill of materials */
  bom?: CanonicalBOMItem[] | undefined;
  /** Workflows / scripts */
  scripts?: Record<string, string> | undefined;
  /** Submodels defined or referenced */
  submodels?: CanonicalSubmodelDescriptor[] | undefined;
  /** Variants / configurations */
  variants?:
    | Record<
        string,
        {
          description?: string | undefined;
          parameterSetPath?: string | undefined;
          overrides?: Record<string, unknown> | undefined;
        }
      >
    | undefined;
  /** Assembly or fabrication steps */
  makingInstructions?:
    | {
        step: number;
        title?: string | undefined;
        instruction: string;
        tools?: string[] | undefined;
      }[]
    | undefined;
  /** Engineering requirements models (SysML v2, ReqIF) */
  requirements?:
    | { id: string; path: string; format?: string | undefined; description?: string | undefined }[]
    | undefined;
  /** 3D CAD/MBD geometry models (STEP AP242, JT) */
  geometry?: { id: string; path: string; format?: string | undefined; description?: string | undefined }[] | undefined;
  /** Behavioral and physics simulation models (SSP, FMU, Modelica) */
  behavior?: { id: string; path: string; format?: string | undefined; description?: string | undefined }[] | undefined;
  /** Semantic traceability relationships across domains */
  relations?: { relationType: string; source: string; target: string; description?: string | undefined }[] | undefined;
  /** Data Package profile (e.g., "engineering-package", "engineering-data-package", "tabular-data-package") */
  profile?: string | undefined;
  /** Frictionless / Engineering Data Package resources (datasets, meshes, FMUs, CAS/S3 blobs) */
  resources?: DataPackageResourceDescriptor[] | undefined;
  /** Direct package/data dependencies */
  dependencies?: Record<string, string> | undefined;
}

/** Field schema in a Frictionless Engineering Data Package Table Schema */
export interface DataPackageSchemaField {
  name: string;
  type: "number" | "integer" | "string" | "boolean" | "datetime" | "object" | "array";
  title?: string | undefined;
  description?: string | undefined;
  /** Physical engineering unit (e.g. "rad/s", "N.m", "K", "Pa", "V") */
  unit?: string | undefined;
  min?: number | undefined;
  max?: number | undefined;
  mean?: number | undefined;
  unique?: number | undefined;
  constraints?:
    | {
        required?: boolean | undefined;
        minimum?: number | undefined;
        maximum?: number | undefined;
        enum?: (string | number)[] | undefined;
      }
    | undefined;
}

/** Resource descriptor in an Engineering Data Package (`datapackage.json`) */
export interface DataPackageResourceDescriptor {
  /** Logical identifier (slug) for URI resolution: `msx://@scope/pkg@ver#<name>` */
  name: string;
  /** Relative path within package archive or remote URI */
  path: string;
  /** Optional human-readable title */
  title?: string | undefined;
  /** Optional description */
  description?: string | undefined;
  /** Frictionless resource profile (e.g., "tabular-data-resource", "engineering-cad-resource", "fmu-resource") */
  profile?: string | undefined;
  /** File format ("csv", "tsv", "parquet", "arrow", "hdf5", "mat", "step", "fmu", "json") */
  format?: string | undefined;
  /** IANA media type */
  mediatype?: string | undefined;
  /** Size in bytes */
  bytes?: number | undefined;
  /** Cryptographic content hash (`sha256:<hex>`) */
  hash?: string | undefined;
  /** Storage backing mode: inline inside zip, content-addressed storage, or S3 object store */
  storage?: "inline" | "cas" | "s3" | undefined;
  /** Optional row count for tabular datasets */
  rowCount?: number | undefined;
  /** Table Schema for tabular/time-series engineering datasets */
  schema?:
    | {
        fields: DataPackageSchemaField[];
        primaryKey?: string | string[] | undefined;
      }
    | undefined;
}

/** Frictionless / W3C Engineering Data Package (`datapackage.json`) projection */
export interface DataPackageJsonProjection {
  $schema: string;
  profile: string;
  name: string;
  id?: string | undefined;
  title?: string | undefined;
  version: string;
  description?: string | undefined;
  homepage?: string | undefined;
  created?: string | undefined;
  contributors?:
    | { title: string; email?: string | undefined; organization?: string | undefined; role?: string | undefined }[]
    | undefined;
  licenses?: { name: string; title?: string | undefined; path?: string | undefined }[] | undefined;
  dependencies?: Record<string, string> | undefined;
  resources: DataPackageResourceDescriptor[];
  modelscript?:
    | {
        globalAssetId: string;
        languages?: string[] | undefined;
        nativeFormat?: string | undefined;
      }
    | undefined;
}

/** Locked package or data-package entry inside `datapackage.lock.json` */
export interface DataPackageLockEntry {
  version: string;
  resolved?: string | undefined;
  integrity: string;
  profile?: string | undefined;
  dependencies?: Record<string, string> | undefined;
  resources?:
    | Record<
        string,
        {
          path: string;
          hash: string;
          bytes?: number | undefined;
          format?: string | undefined;
          storage?: "inline" | "cas" | "s3" | undefined;
        }
      >
    | undefined;
}

/** Deterministic, content-addressed lockfile (`datapackage.lock.json` / `modelscript.lock.json`) */
export interface DataPackageLockJson {
  $schema: string;
  lockfileVersion: 1;
  name: string;
  version: string;
  generatedAt: string;
  rootIntegrity: string;
  lockfileIntegrity: string;
  compiler: {
    engine: string;
    version: string;
  };
  experiment?:
    | {
        solver?: string | undefined;
        startTime?: number | undefined;
        stopTime?: number | undefined;
        interval?: number | undefined;
        numberOfIntervals?: number | undefined;
        tolerance?: number | undefined;
      }
    | undefined;
  packages: Record<string, DataPackageLockEntry>;
}

/** NPM-compatible package.json projection */
export interface PackageJsonProjection {
  name: string;
  version: string;
  profile?: string | undefined;
  description?: string | undefined;
  main?: string | undefined;
  author?: string | { name: string; email?: string | undefined } | undefined;
  license?: string | undefined;
  homepage?: string | undefined;
  repository?: { type: string; url: string } | undefined;
  dependencies?: Record<string, string> | undefined;
  devDependencies?: Record<string, string> | undefined;
  scripts?: Record<string, string> | undefined;
  resources?: DataPackageResourceDescriptor[] | undefined;
  modelscript?:
    | {
        globalAssetId: string;
        profile?: string | undefined;
        variants?: string[] | undefined;
        submodels?: string[] | undefined;
        languages?: string[] | undefined;
        nativeFormat?: string | undefined;
        resourcesCount?: number | undefined;
      }
    | undefined;
  [key: string]: unknown;
}

/** AAS (Asset Administration Shell - IEC 63278) JSON projection */
export interface AasJsonProjection {
  assetAdministrationShells: {
    id: string;
    idShort: string;
    assetInformation: {
      assetKind: "Type" | "Instance";
      globalAssetId: string;
      assetType?: string | undefined;
      defaultThumbnail?: { path: string; contentType: string } | undefined;
    };
    submodels?:
      | {
          type: "ModelReference";
          keys: { type: "Submodel"; value: string }[];
        }[]
      | undefined;
  }[];
  submodels: {
    id: string;
    idShort: string;
    semanticId?:
      | {
          type: "ExternalReference";
          keys: { type: "GlobalReference"; value: string }[];
        }
      | undefined;
    submodelElements?: unknown[] | undefined;
  }[];
  conceptDescriptions?: unknown[] | undefined;
}

/** Open Know-How (OKH - DIN SPEC 3105) projection */
export interface OkhJsonProjection {
  title: string;
  name: string;
  version: string;
  description?: string | undefined;
  license?: string | undefined;
  "standard-version": string;
  bom?: string | CanonicalBOMItem[] | undefined;
  schematics?: string | undefined;
  "manufacturing-files"?:
    | {
        type: string;
        path: string;
        description?: string | undefined;
      }[]
    | undefined;
  "making-instructions"?:
    | {
        step: number;
        instruction: string;
      }[]
    | undefined;
  "tool-list"?: string[] | undefined;
  software?:
    | {
        platform: string;
        "entry-point": string;
        manifest?: string | undefined;
      }[]
    | undefined;
  [key: string]: unknown;
}

/** Digital Data Package (DDP - prostep ivip PSI 21 / OMG CASCaRA) projection */
export type DdpProjection = DdpManifest;
