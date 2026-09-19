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
  requirements?: { id: string; path: string; format?: string; description?: string }[] | undefined;
  /** 3D CAD/MBD geometry models (STEP AP242, JT) */
  geometry?: { id: string; path: string; format?: string; description?: string }[] | undefined;
  /** Behavioral and physics simulation models (SSP, FMU, Modelica) */
  behavior?: { id: string; path: string; format?: string; description?: string }[] | undefined;
  /** Semantic traceability relationships across domains */
  relations?: { relationType: string; source: string; target: string; description?: string }[] | undefined;
}

/** NPM-compatible package.json projection */
export interface PackageJsonProjection {
  name: string;
  version: string;
  description?: string | undefined;
  main?: string | undefined;
  author?: string | { name: string; email?: string } | undefined;
  license?: string | undefined;
  homepage?: string | undefined;
  repository?: { type: string; url: string } | undefined;
  dependencies?: Record<string, string> | undefined;
  devDependencies?: Record<string, string> | undefined;
  scripts?: Record<string, string> | undefined;
  modelscript?:
    | {
        globalAssetId: string;
        variants?: string[] | undefined;
        submodels?: string[] | undefined;
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
