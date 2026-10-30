// SPDX-License-Identifier: AGPL-3.0-or-later

import { OpcAasxPackager } from "../aasx/opc-packager.js";
import {
  type AdaptedPackageManifest,
  detectAndAdaptArchiveManifest,
  type KparIndexJson,
  type KparMetaJson,
  KparPackageAdapter,
  parseDataPackageResources,
} from "../adapters/native-package-adapters.js";
import { DdpPackager } from "../ddp/packager.js";
import type { DdpArtifactDescriptor, DdpManifest, DdpPackageContent } from "../ddp/types.js";
import type {
  AasJsonProjection,
  CanonicalWorkspaceManifest,
  DataPackageJsonProjection,
  DataPackageResourceDescriptor,
  OkhJsonProjection,
  PackageJsonProjection,
} from "./types.js";

/**
 * Standard Semantic ID constants (ECLASS / IEC / IDTA standard Submodels).
 */
export const SUBMODEL_SEMANTIC_IDS = {
  DIGITAL_NAMEPLATE: "https://admin-shell.io/zvei/nameplate/2/0/Nameplate",
  TECHNICAL_DATA: "https://admin-shell.io/ZVEI/TechnicalData/Submodel/1/2",
  BILL_OF_MATERIALS: "https://admin-shell.io/idta/HierarchicalStructures/1/1/Submodel",
  CAD: "https://admin-shell.io/idta/CAD/1/0/Submodel",
  SIMULATION: "https://admin-shell.io/idta/Simulation/1/0/Submodel",
  HANDOVER_DOCUMENTATION: "https://admin-shell.io/vdi/2770/1/0/Documentation",
  CARBON_FOOTPRINT: "https://admin-shell.io/idta/CarbonFootprint/0/9/Submodel",
} as const;

/**
 * ManifestLensEngine provides bidirectional projection between a canonical
 * cyber-physical asset description and target ecosystem formats (NPM, AAS, OKH, DataPackage).
 */
export class ManifestLensEngine {
  /**
   * Project canonical workspace into an NPM-compatible package.json object.
   */
  static projectToPackageJson(
    manifest: CanonicalWorkspaceManifest,
    options?: { mainFile?: string | undefined; dependencies?: Record<string, string> | undefined },
  ): PackageJsonProjection {
    const pkgName = manifest.scope ? `${manifest.scope}/${manifest.idShort}` : manifest.idShort;

    // Convert BOM items with packageDependency into npm dependencies
    const deps: Record<string, string> = { ...manifest.dependencies, ...options?.dependencies };
    if (manifest.bom) {
      for (const item of manifest.bom) {
        if (item.packageDependency) {
          const parts = item.packageDependency.split("@");
          // Handle scoped packages like @scope/name@^1.0.0
          if (item.packageDependency.startsWith("@")) {
            const scopeAndName = `@${parts[1]}`;
            const versionSpec = parts[2] ?? "*";
            deps[scopeAndName] = versionSpec;
          } else {
            const name = parts[0] ?? item.name;
            const versionSpec = parts[1] ?? "*";
            deps[name] = versionSpec;
          }
        }
      }
    }

    const defaultScripts: Record<string, string> = {
      simulate: "modelscript simulate",
      "check:thread": "modelscript thread verify",
      ...manifest.scripts,
    };

    const authorString = manifest.author
      ? manifest.author.email
        ? `${manifest.author.name} <${manifest.author.email}>`
        : manifest.author.name
      : undefined;

    return {
      name: pkgName,
      version: manifest.version,
      profile: manifest.profile,
      description: manifest.description ?? manifest.title,
      main: options?.mainFile ?? "system.ssp",
      author: authorString,
      license: manifest.license ?? "UNLICENSED",
      homepage: manifest.homepage,
      repository: manifest.repository,
      dependencies: Object.keys(deps).length > 0 ? deps : undefined,
      scripts: defaultScripts,
      resources: manifest.resources,
      modelscript: {
        globalAssetId: manifest.globalAssetId,
        profile: manifest.profile,
        variants: manifest.variants ? Object.keys(manifest.variants) : undefined,
        submodels: manifest.submodels ? manifest.submodels.map((s) => s.idShort) : undefined,
        resourcesCount: manifest.resources ? manifest.resources.length : undefined,
      },
    };
  }

  /**
   * Project canonical workspace into an IEC 63278-1 compliant AAS JSON object.
   */
  static projectToAasJson(
    manifest: CanonicalWorkspaceManifest,
    options?: { assetKind?: "Type" | "Instance" | undefined },
  ): AasJsonProjection {
    const shellId = `${manifest.globalAssetId}/shell`;
    const assetKind = options?.assetKind ?? "Type";

    // Build standard submodels
    const submodels: AasJsonProjection["submodels"] = [];
    const submodelRefs: NonNullable<AasJsonProjection["assetAdministrationShells"][0]["submodels"]> = [];

    // 1. Digital Nameplate Submodel
    const nameplateId = `${manifest.globalAssetId}/submodels/Nameplate`;
    submodelRefs.push({
      type: "ModelReference",
      keys: [{ type: "Submodel", value: nameplateId }],
    });
    submodels.push({
      id: nameplateId,
      idShort: "Nameplate",
      semanticId: {
        type: "ExternalReference",
        keys: [{ type: "GlobalReference", value: SUBMODEL_SEMANTIC_IDS.DIGITAL_NAMEPLATE }],
      },
      submodelElements: [
        {
          idShort: "ManufacturerName",
          modelType: "Property",
          valueType: "xs:string",
          value: manifest.author?.organization ?? manifest.author?.name ?? "Unknown",
        },
        {
          idShort: "ManufacturerProductDesignation",
          modelType: "Property",
          valueType: "xs:string",
          value: manifest.title,
        },
        {
          idShort: "ProductArticleNumberOfManufacturer",
          modelType: "Property",
          valueType: "xs:string",
          value: manifest.idShort,
        },
      ],
    });

    // 2. Bill of Materials Submodel (if BOM present)
    if (manifest.bom && manifest.bom.length > 0) {
      const bomSubmodelId = `${manifest.globalAssetId}/submodels/BillOfMaterials`;
      submodelRefs.push({
        type: "ModelReference",
        keys: [{ type: "Submodel", value: bomSubmodelId }],
      });

      const bomElements = manifest.bom.map((item, index) => ({
        idShort: `Item_${index + 1}_${item.name.replace(/[^a-zA-Z0-9_]/g, "_")}`,
        modelType: "SubmodelElementCollection",
        value: [
          { idShort: "PartName", modelType: "Property", valueType: "xs:string", value: item.name },
          { idShort: "PartNumber", modelType: "Property", valueType: "xs:string", value: item.partNumber ?? "" },
          { idShort: "Quantity", modelType: "Property", valueType: "xs:integer", value: String(item.quantity) },
          { idShort: "Category", modelType: "Property", valueType: "xs:string", value: item.category ?? "other" },
          { idShort: "SourcingUrl", modelType: "Property", valueType: "xs:string", value: item.sourcingUrl ?? "" },
        ],
      }));

      submodels.push({
        id: bomSubmodelId,
        idShort: "BillOfMaterials",
        semanticId: {
          type: "ExternalReference",
          keys: [{ type: "GlobalReference", value: SUBMODEL_SEMANTIC_IDS.BILL_OF_MATERIALS }],
        },
        submodelElements: bomElements,
      });
    }

    // 3. User-defined submodels
    if (manifest.submodels) {
      for (const sm of manifest.submodels) {
        const smId = `${manifest.globalAssetId}/submodels/${sm.idShort}`;
        submodelRefs.push({
          type: "ModelReference",
          keys: [{ type: "Submodel", value: smId }],
        });
        submodels.push({
          id: smId,
          idShort: sm.idShort,
          semanticId: sm.semanticId
            ? {
                type: "ExternalReference",
                keys: [{ type: "GlobalReference", value: sm.semanticId }],
              }
            : undefined,
          submodelElements: sm.data
            ? Object.entries(sm.data).map(([k, v]) => ({
                idShort: k,
                modelType: "Property",
                valueType: typeof v === "number" ? "xs:double" : typeof v === "boolean" ? "xs:boolean" : "xs:string",
                value: String(v),
              }))
            : [],
        });
      }
    }

    return {
      assetAdministrationShells: [
        {
          id: shellId,
          idShort: manifest.idShort,
          assetInformation: {
            assetKind,
            globalAssetId: manifest.globalAssetId,
            assetType: manifest.idShort,
          },
          submodels: submodelRefs,
        },
      ],
      submodels,
    };
  }

  /**
   * Project canonical workspace into an Open Know-How (DIN SPEC 3105) compliant okh.json object.
   */
  static projectToOkhJson(
    manifest: CanonicalWorkspaceManifest,
    options?: {
      cadFiles?: { path: string; type?: string | undefined; description?: string | undefined }[] | undefined;
      schematicsFile?: string | undefined;
      firmwareEntry?: string | undefined;
    },
  ): OkhJsonProjection {
    const manufacturingFiles: OkhJsonProjection["manufacturing-files"] = [];

    if (options?.cadFiles) {
      for (const cad of options.cadFiles) {
        manufacturingFiles.push({
          type: cad.type ?? (cad.path.endsWith(".step") || cad.path.endsWith(".stp") ? "step" : "cad-source"),
          path: cad.path,
          description: cad.description ?? "CAD Model",
        });
      }
    }

    const makingInstructions = manifest.makingInstructions?.map((inst) => ({
      step: inst.step,
      instruction: inst.instruction,
    }));

    const tools = new Set<string>();
    if (manifest.makingInstructions) {
      for (const inst of manifest.makingInstructions) {
        if (inst.tools) {
          for (const t of inst.tools) tools.add(t);
        }
      }
    }

    const software: OkhJsonProjection["software"] = options?.firmwareEntry
      ? [
          {
            platform: "embedded",
            "entry-point": options.firmwareEntry,
          },
        ]
      : undefined;

    return {
      title: manifest.title,
      name: manifest.idShort,
      version: manifest.version,
      description: manifest.description,
      license: manifest.license ?? "CERN-OHL-P-2.0",
      "standard-version": "OKH-LOSH-v1.0",
      bom: manifest.bom,
      schematics: options?.schematicsFile,
      "manufacturing-files": manufacturingFiles.length > 0 ? manufacturingFiles : undefined,
      "making-instructions": makingInstructions,
      "tool-list": tools.size > 0 ? Array.from(tools) : undefined,
      software,
    };
  }

  /**
   * Project canonical workspace into a prostep ivip PSI 21 / OMG CASCaRA DDP manifest.
   */
  static projectToDdp(
    manifest: CanonicalWorkspaceManifest,
    options?: {
      creator?: DdpManifest["creator"] | undefined;
      recipient?: DdpManifest["recipient"] | undefined;
      securityClassification?: string | undefined;
    },
  ): DdpManifest {
    const requirements: DdpArtifactDescriptor[] = [];
    if (manifest.requirements) {
      for (const req of manifest.requirements) {
        requirements.push({
          id: req.id,
          path: req.path,
          contentType: req.path.endsWith(".sysml") ? "text/x-sysml2" : "application/x-reqif+xml",
          domain: "requirements",
          format: req.format ?? (req.path.endsWith(".sysml") ? "SysML v2" : "ReqIF 1.2"),
          description: req.description,
        });
      }
    }

    const geometry: DdpArtifactDescriptor[] = [];
    if (manifest.geometry) {
      for (const geom of manifest.geometry) {
        geometry.push({
          id: geom.id,
          path: geom.path,
          contentType: geom.path.endsWith(".stp") || geom.path.endsWith(".step") ? "application/step" : "model/jt",
          domain: "geometry",
          format: geom.format ?? "STEP AP242",
          description: geom.description,
        });
      }
    }

    const behavior: DdpArtifactDescriptor[] = [];
    if (manifest.behavior) {
      for (const beh of manifest.behavior) {
        behavior.push({
          id: beh.id,
          path: beh.path,
          contentType: beh.path.endsWith(".fmu")
            ? "application/x-fmu"
            : beh.path.endsWith(".ssp")
              ? "application/x-ssp"
              : "text/x-modelica",
          domain: "behavior",
          format:
            beh.format ??
            (beh.path.endsWith(".fmu") ? "FMI 3.0" : beh.path.endsWith(".ssp") ? "SSP 1.0" : "Modelica 3.6"),
          description: beh.description,
        });
      }
    }

    return {
      "@context": "https://w3id.org/cascara/v1/context.jsonld",
      ddpVersion: "1.0",
      packageId: manifest.globalAssetId,
      title: manifest.title,
      version: manifest.version,
      description: manifest.description,
      creator:
        options?.creator ??
        (manifest.author
          ? {
              name: manifest.author.name,
              email: manifest.author.email,
              organization: manifest.author.organization,
            }
          : undefined),
      recipient: options?.recipient,
      createdAt: new Date().toISOString(),
      securityClassification: options?.securityClassification ?? "Unclassified",
      license: manifest.license,
      artifacts: {
        requirements,
        geometry,
        behavior,
        parameters: [],
        documentation: [],
      },
      relations: manifest.relations?.map((r, i) => ({
        id: `rel_${i + 1}`,
        relationType: r.relationType,
        source: r.source,
        target: r.target,
        description: r.description,
      })),
    };
  }

  /**
   * Parse a CanonicalWorkspaceManifest from a DdpManifest.
   */
  static parseFromDdp(ddp: DdpManifest): CanonicalWorkspaceManifest {
    return {
      globalAssetId: ddp.packageId,
      idShort: ddp.packageId.split(/[:/]/).pop() || "ddp-package",
      title: ddp.title,
      version: ddp.version,
      description: ddp.description,
      author: ddp.creator
        ? {
            name: ddp.creator.name,
            email: ddp.creator.email,
            organization: ddp.creator.organization,
          }
        : undefined,
      license: ddp.license,
      requirements: ddp.artifacts.requirements?.map((r) => ({
        id: r.id,
        path: r.path,
        format: r.format,
        description: r.description,
      })),
      geometry: ddp.artifacts.geometry?.map((g) => ({
        id: g.id,
        path: g.path,
        format: g.format,
        description: g.description,
      })),
      behavior: ddp.artifacts.behavior?.map((b) => ({
        id: b.id,
        path: b.path,
        format: b.format,
        description: b.description,
      })),
      relations: ddp.relations?.map((r) => ({
        relationType: String(r.relationType),
        source: r.source,
        target: r.target,
        description: r.description,
      })),
    };
  }

  /**
   * Cross-compile an engineering Digital Data Package (.ddp) into an
   * operational Asset Administration Shell (.aasx) container with IDTA submodels.
   */
  static bridgeDdpToAasx(
    ddpPackage: Uint8Array | DdpPackageContent,
    options?: { assetKind?: "Type" | "Instance" | undefined },
  ): Uint8Array {
    const content = ddpPackage instanceof Uint8Array ? DdpPackager.extractDdp(ddpPackage) : ddpPackage;
    const canonical = ManifestLensEngine.parseFromDdp(content.manifest);

    // Build custom engineering submodels for AAS
    const submodels = canonical.submodels ?? [];

    // CAD Submodel (IDTA standard)
    if (content.manifest.artifacts.geometry && content.manifest.artifacts.geometry.length > 0) {
      for (const geom of content.manifest.artifacts.geometry) {
        submodels.push({
          idShort: `CAD_${geom.id.replace(/[^a-zA-Z0-9_]/g, "_")}`,
          semanticId: SUBMODEL_SEMANTIC_IDS.CAD,
          description: geom.description ?? `CAD Geometry for ${geom.id}`,
          data: {
            FileReference: geom.path,
            Format: geom.format ?? "STEP AP242",
          },
        });
      }
    }

    // Simulation Submodel (IDTA standard)
    if (content.manifest.artifacts.behavior && content.manifest.artifacts.behavior.length > 0) {
      for (const beh of content.manifest.artifacts.behavior) {
        submodels.push({
          idShort: `Sim_${beh.id.replace(/[^a-zA-Z0-9_]/g, "_")}`,
          semanticId: SUBMODEL_SEMANTIC_IDS.SIMULATION,
          description: beh.description ?? `Simulation model for ${beh.id}`,
          data: {
            ModelReference: beh.path,
            Format: beh.format ?? "SSP / FMU",
          },
        });
      }
    }

    canonical.submodels = submodels;

    // Project canonical to AAS JSON
    const aasJson = ManifestLensEngine.projectToAasJson(canonical, options);

    // Map files from DDP into supplementary AASX files
    const supplementaryFiles: { path: string; data: Uint8Array }[] = [];
    for (const [filePath, data] of content.files.entries()) {
      supplementaryFiles.push({
        path: filePath,
        data,
      });
    }

    // Build .aasx OPC container
    return OpcAasxPackager.buildAasx({
      aasJson,
      files: supplementaryFiles,
    });
  }

  /**
   * Project canonical workspace into OMG KerML/SysML v2 `.kpar` metadata (`.meta.json` + `.Index.json`).
   */
  static projectToKpar(
    manifest: CanonicalWorkspaceManifest,
    sysmlFiles?: { packageName: string; path: string }[],
  ): { metaJson: KparMetaJson; indexJson: KparIndexJson } {
    return KparPackageAdapter.projectToKpar(manifest, sysmlFiles);
  }

  /**
   * Ingest an OMG `.kpar` `.meta.json` and `.Index.json` into a CanonicalWorkspaceManifest.
   */
  static parseFromKpar(
    metaJson: string | KparMetaJson,
    indexJson?: string | KparIndexJson,
  ): CanonicalWorkspaceManifest {
    return KparPackageAdapter.ingestFromKpar(metaJson, indexJson).manifest;
  }

  /**
   * Project canonical workspace into a W3C / Frictionless Engineering Data Package (`datapackage.json`).
   * Unifies code packages, calibration/simulation datasets, CAD geometry, and FMUs under a single
   * schema-validated, content-addressed resource manifest.
   */
  static projectToDataPackageJson(
    manifest: CanonicalWorkspaceManifest,
    options?: {
      additionalResources?: DataPackageResourceDescriptor[] | undefined;
      languages?: string[] | undefined;
      created?: string | undefined;
    },
  ): DataPackageJsonProjection {
    const pkgName = manifest.scope ? `${manifest.scope}/${manifest.idShort}` : manifest.idShort;
    const resourcesMap = new Map<string, DataPackageResourceDescriptor>();

    if (manifest.resources) {
      for (const r of manifest.resources) {
        resourcesMap.set(r.path, r);
      }
    }

    if (options?.additionalResources) {
      for (const r of options.additionalResources) {
        const existing = resourcesMap.get(r.path);
        if (existing) {
          resourcesMap.set(r.path, {
            ...r,
            ...existing,
            schema: existing.schema ?? r.schema,
            hash: existing.hash ?? r.hash,
            bytes: existing.bytes ?? r.bytes,
            rowCount: existing.rowCount ?? r.rowCount,
          });
        } else {
          resourcesMap.set(r.path, r);
        }
      }
    }

    // Also include geometry & behavior descriptors if not already in resources
    if (manifest.geometry) {
      for (const g of manifest.geometry) {
        if (!resourcesMap.has(g.path)) {
          resourcesMap.set(g.path, {
            name: g.id.toLowerCase().replace(/[^a-z0-9_-]+/g, "-"),
            path: g.path,
            description: g.description,
            profile: "engineering-cad-resource",
            format: (g.format ?? "step").toLowerCase(),
            mediatype: "application/step",
            storage: "inline",
          });
        }
      }
    }

    if (manifest.behavior) {
      for (const b of manifest.behavior) {
        if (!resourcesMap.has(b.path)) {
          resourcesMap.set(b.path, {
            name: b.id.toLowerCase().replace(/[^a-z0-9_-]+/g, "-"),
            path: b.path,
            description: b.description,
            profile: b.path.endsWith(".fmu") ? "fmu-resource" : "simulation-model-resource",
            format: (b.format ?? (b.path.endsWith(".fmu") ? "fmu" : "modelica")).toLowerCase(),
            mediatype: b.path.endsWith(".fmu") ? "application/x-fmu" : "text/x-modelica",
            storage: "inline",
          });
        }
      }
    }

    const resources = Array.from(resourcesMap.values());
    const hasTabular = resources.some(
      (r) =>
        r.profile === "tabular-data-resource" ||
        r.format === "csv" ||
        r.format === "tsv" ||
        r.format === "parquet" ||
        Boolean(r.schema?.fields?.length),
    );
    const resolvedProfile =
      manifest.profile ?? (hasTabular || resources.length > 0 ? "engineering-data-package" : "engineering-package");

    return {
      $schema: "https://modelscript.org/schemas/datapackage-v2.json",
      profile: resolvedProfile,
      name: pkgName,
      id: manifest.globalAssetId,
      title: manifest.title,
      version: manifest.version,
      description: manifest.description,
      homepage: manifest.homepage,
      created: options?.created,
      contributors: manifest.author
        ? [
            {
              title: manifest.author.name,
              email: manifest.author.email,
              organization: manifest.author.organization,
              role: "author",
            },
          ]
        : undefined,
      licenses: manifest.license ? [{ name: manifest.license }] : undefined,
      dependencies:
        manifest.dependencies && Object.keys(manifest.dependencies).length > 0 ? manifest.dependencies : undefined,
      resources,
      modelscript: {
        globalAssetId: manifest.globalAssetId,
        languages: options?.languages,
      },
    };
  }

  /**
   * Parse a Frictionless / Engineering Data Package (`datapackage.json`) into a CanonicalWorkspaceManifest.
   */
  static parseFromDataPackageJson(dpRaw: string | Record<string, unknown>): CanonicalWorkspaceManifest {
    const dp = typeof dpRaw === "string" ? (JSON.parse(dpRaw) as Record<string, unknown>) : dpRaw;
    const rawName = typeof dp["name"] === "string" && dp["name"].trim() ? dp["name"].trim() : "data-package";
    const scope = rawName.startsWith("@") ? rawName.split("/")[0] : undefined;
    const idShort = rawName.startsWith("@") ? (rawName.split("/")[1] ?? rawName) : rawName;
    const version = typeof dp["version"] === "string" && dp["version"].trim() ? dp["version"].trim() : "1.0.0";
    const title = typeof dp["title"] === "string" ? dp["title"] : idShort;
    const description = typeof dp["description"] === "string" ? dp["description"] : title;
    const profile = typeof dp["profile"] === "string" ? dp["profile"] : "engineering-data-package";

    const licenses = Array.isArray(dp["licenses"]) ? dp["licenses"] : undefined;
    const firstLic =
      licenses?.[0] && typeof licenses[0] === "object" ? (licenses[0] as Record<string, unknown>) : undefined;
    const license =
      typeof firstLic?.["name"] === "string"
        ? firstLic["name"]
        : typeof dp["license"] === "string"
          ? dp["license"]
          : "UNLICENSED";

    const contribs = Array.isArray(dp["contributors"]) ? dp["contributors"] : undefined;
    const firstContrib =
      contribs?.[0] && typeof contribs[0] === "object" ? (contribs[0] as Record<string, unknown>) : undefined;
    const authorName =
      typeof firstContrib?.["title"] === "string"
        ? firstContrib["title"]
        : typeof firstContrib?.["name"] === "string"
          ? firstContrib["name"]
          : typeof dp["author"] === "string"
            ? dp["author"]
            : undefined;

    const resources = parseDataPackageResources(dp["resources"]);
    const dependencies =
      dp["dependencies"] && typeof dp["dependencies"] === "object"
        ? (dp["dependencies"] as Record<string, string>)
        : undefined;

    return {
      globalAssetId: typeof dp["id"] === "string" ? dp["id"] : `urn:modelscript:${rawName}:${version}`,
      idShort,
      title,
      version,
      scope,
      profile,
      description,
      author: authorName
        ? {
            name: authorName,
            email: typeof firstContrib?.["email"] === "string" ? firstContrib["email"] : undefined,
            organization: typeof firstContrib?.["organization"] === "string" ? firstContrib["organization"] : undefined,
          }
        : undefined,
      license,
      homepage: typeof dp["homepage"] === "string" ? dp["homepage"] : undefined,
      resources: resources.length > 0 ? resources : undefined,
      dependencies,
    };
  }

  /**
   * Automatically detect and adapt any native archive/directory manifest across all 44 languages
   * into both a CanonicalWorkspaceManifest and an NPM-compatible PackageJsonProjection.
   */
  static adaptNativeArchive(
    files: Map<string, string>,
    options?: { fallbackName?: string | undefined; fallbackVersion?: string | undefined },
  ): AdaptedPackageManifest {
    return detectAndAdaptArchiveManifest(files, options);
  }
}
