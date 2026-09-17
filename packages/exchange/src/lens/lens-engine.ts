// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  AasJsonProjection,
  CanonicalWorkspaceManifest,
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
 * cyber-physical asset description and target ecosystem formats (NPM, AAS, OKH).
 */
export class ManifestLensEngine {
  /**
   * Project canonical workspace into an NPM-compatible package.json object.
   */
  static projectToPackageJson(
    manifest: CanonicalWorkspaceManifest,
    options?: { mainFile?: string; dependencies?: Record<string, string> },
  ): PackageJsonProjection {
    const pkgName = manifest.scope ? `${manifest.scope}/${manifest.idShort}` : manifest.idShort;

    // Convert BOM items with packageDependency into npm dependencies
    const deps: Record<string, string> = { ...options?.dependencies };
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
      description: manifest.description ?? manifest.title,
      main: options?.mainFile ?? "system.ssp",
      author: authorString,
      license: manifest.license ?? "UNLICENSED",
      homepage: manifest.homepage,
      repository: manifest.repository,
      dependencies: Object.keys(deps).length > 0 ? deps : undefined,
      scripts: defaultScripts,
      modelscript: {
        globalAssetId: manifest.globalAssetId,
        variants: manifest.variants ? Object.keys(manifest.variants) : undefined,
        submodels: manifest.submodels ? manifest.submodels.map((s) => s.idShort) : undefined,
      },
    };
  }

  /**
   * Project canonical workspace into an IEC 63278-1 compliant AAS JSON object.
   */
  static projectToAasJson(
    manifest: CanonicalWorkspaceManifest,
    options?: { assetKind?: "Type" | "Instance" },
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
      cadFiles?: { path: string; type?: string; description?: string }[];
      schematicsFile?: string;
      firmwareEntry?: string;
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
}
