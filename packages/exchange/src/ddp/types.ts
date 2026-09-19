// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Digital Data Package (DDP) Type Definitions.
 *
 * Conforming to:
 * - prostep ivip Recommendation PSI 21 (Digital Data Package)
 * - OMG CASCaRA / CASCaDE (Collaborative Artifact Specification, Context and Resource Access)
 *
 * Supports packaging, cross-linking, and validating multi-domain engineering artifacts:
 * - Requirements / MBSE: SysML v2, ReqIF
 * - 3D CAD / MBD: STEP AP242, JT, 3D PDF
 * - Behavior / Simulation: SSP 1.0/2.0, FMI 2.0/3.0, Modelica
 * - Traceability relations: satisfies, verifies, implements, describes, refines, derives, parameterizes
 */

/**
 * Standard semantic relation types linking artifacts across domain boundaries.
 */
export type DdpRelationType =
  | "satisfies" // e.g. CAD part or simulation component satisfies a SysML/ReqIF requirement
  | "verifies" // e.g. Modelica simulation / FMU verifies a requirement or constraint
  | "implements" // e.g. STEP geometry implements a logical architecture block
  | "describes" // e.g. 3D PDF or drawing describes a physical STEP assembly
  | "refines" // e.g. Detailed subsystem refines top-level architecture
  | "derives" // e.g. Derived requirement or specification
  | "parameterizes"; // e.g. SSV / parameter binding parameterizes simulation model

/**
 * A directional semantic traceability link between two engineering artifacts or elements.
 */
export interface DdpRelation {
  /** Unique link identifier */
  id?: string | undefined;
  /** Semantic predicate describing the relationship */
  relationType: DdpRelationType | string;
  /** Source artifact path or URI (e.g. "behavior/actuator.fmu" or "urn:req:REQ-001") */
  source: string;
  /** Target artifact path or URI (e.g. "requirements/system.sysml#REQ-001" or "geometry/chassis.stp") */
  target: string;
  /** Optional human-readable rationale or description */
  description?: string | undefined;
  /** Optional confidence or verification status */
  status?: "unverified" | "passed" | "failed" | "pending" | undefined;
  /** Additional user-defined metadata */
  properties?: Record<string, unknown> | undefined;
}

/**
 * Metadata descriptor for an individual artifact contained within or referenced by a DDP.
 */
export interface DdpArtifactDescriptor {
  /** Unique identifier for this artifact within the DDP */
  id: string;
  /** Relative path inside the DDP container (e.g. "geometry/pump.stp") or external URI */
  path: string;
  /** Standard MIME / media content type */
  contentType: string;
  /** Domain classification */
  domain: "requirements" | "geometry" | "behavior" | "documentation" | "parameters" | "other";
  /** Format specification (e.g. "STEP AP242", "SysML v2", "FMI 3.0", "SSP 1.0", "ReqIF 1.2", "PDF") */
  format?: string | undefined;
  /** Version of the artifact */
  version?: string | undefined;
  /** Human-readable title or description */
  description?: string | undefined;
  /** SHA-256 or MD5 checksum for integrity verification */
  checksum?: string | undefined;
  /** File size in bytes (if known) */
  sizeBytes?: number | undefined;
}

/**
 * Domain-specific categorized artifact references.
 */
export interface DdpDomainArtifacts {
  /** Requirements / MBSE models (SysML v2, ReqIF) */
  requirements?: DdpArtifactDescriptor[] | undefined;
  /** 3D CAD, MBD, and PMI models (STEP AP242, JT, 3D PDF) */
  geometry?: DdpArtifactDescriptor[] | undefined;
  /** Dynamic behavioral and simulation models (SSP, FMU, Modelica) */
  behavior?: DdpArtifactDescriptor[] | undefined;
  /** System structure parameter sets (SSV, CSV, JSON) */
  parameters?: DdpArtifactDescriptor[] | undefined;
  /** Documentation, test reports, manufacturing instructions */
  documentation?: DdpArtifactDescriptor[] | undefined;
}

/**
 * Author / organization contact information.
 */
export interface DdpContact {
  name: string;
  organization?: string | undefined;
  email?: string | undefined;
  role?: string | undefined;
}

/**
 * Top-level Digital Data Package manifest according to prostep ivip PSI 21 / OMG CASCaRA.
 */
export interface DdpManifest {
  /** JSON-LD context for OMG CASCaRA / CASCaDE semantic interoperability */
  "@context"?: string | Record<string, string> | undefined;
  /** DDP specification version (default "1.0") */
  ddpVersion: string;
  /** Unique package identifier (UUID, URN, or reverse-domain string) */
  packageId: string;
  /** Human-readable display title of the package */
  title: string;
  /** Package version */
  version: string;
  /** Detailed summary or engineering intent */
  description?: string | undefined;
  /** Author or publishing entity */
  creator?: DdpContact | undefined;
  /** Recipient entity (e.g. OEM or Supplier) */
  recipient?: DdpContact | undefined;
  /** ISO 8601 creation timestamp */
  createdAt: string;
  /** ISO 8601 last modified timestamp */
  modifiedAt?: string | undefined;
  /** Security / export control classification (e.g. "Unclassified", "ITAR Restricted", "Proprietary") */
  securityClassification?: string | undefined;
  /** Intellectual property / licensing declaration */
  license?: string | undefined;
  /** Categorized domain artifacts */
  artifacts: DdpDomainArtifacts;
  /** Cross-domain semantic traceability relationships */
  relations?: DdpRelation[] | undefined;
  /** Package-level custom properties */
  properties?: Record<string, unknown> | undefined;
}

/**
 * An individual file entry to be packaged into a DDP archive.
 */
export interface DdpFileEntry {
  /** Relative path inside the .ddp container (e.g. "geometry/valve.stp") */
  path: string;
  /** Binary data or text content */
  data: Uint8Array | string;
  /** Content MIME type */
  contentType?: string | undefined;
}

/**
 * Options for assembling and packaging a .ddp archive.
 */
export interface DdpPackageOptions {
  /** The DDP manifest (object or raw JSON string) */
  manifest: DdpManifest | string;
  /** Supplementary artifact files to include in the package */
  files?: DdpFileEntry[] | undefined;
  /** Compression level (0 = store, 6 = default, 9 = maximum) */
  compressionLevel?: number | undefined;
}

/**
 * Result of extracting a .ddp archive.
 */
export interface DdpPackageContent {
  /** Parsed manifest */
  manifest: DdpManifest;
  /** Raw JSON manifest string */
  rawManifest: string;
  /** Map of relative file paths to raw binary data */
  files: Map<string, Uint8Array>;
}

/**
 * Verification result evaluating cross-domain requirements against simulation/geometry.
 */
export interface DdpVerificationReport {
  packageId: string;
  timestamp: string;
  totalRequirements: number;
  verifiedCount: number;
  failedCount: number;
  unverifiedCount: number;
  details: {
    requirementId: string;
    description?: string;
    verifyingArtifact?: string;
    relationType: string;
    status: "passed" | "failed" | "unverified";
    evidence?: string;
  }[];
}
