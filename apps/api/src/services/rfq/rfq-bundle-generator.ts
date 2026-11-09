// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Smart RFQ Package Generator.
 *
 * Compiles a self-contained, vendor-neutral manufacturing release bundle:
 *   - Open single-source IPC-2581C (assembly.xml)
 *   - Open ODB++ v8.1 directory archive
 *   - Legacy RS-274X Gerbers and Excellon drill files
 *   - Normalized IPC-7351 pick-and-place centroid files
 *   - Multi-level BOM (eBOM & mBOM) with live sourcing intelligence
 *   - Cryptographic manifest with SHA-256 hashes of all assets
 */

import {
  compileToIPC2581,
  compileToODB,
  formatJlcpcbCplCsv,
  formatMacrofabXy,
  formatStandardCentroidCsv,
  generateCentroidRecords,
  generateDefaultRegulatoryPackage,
  generateManufacturingFiles,
  packUstarArchive,
  type PCBLayout,
} from "@modelscript/cad/ecad";
import { createHash } from "node:crypto";
import type { SupplyChainOrchestrator } from "../supply-chain/orchestrator.js";
import type { BOMComponentInput, BOMScrubResult } from "../supply-chain/types.js";

export interface FabricationRequirements {
  layers: number;
  thicknessMm: number;
  copperWeightOz: number;
  material: string;
  surfaceFinish: "ENIG" | "HASL_LEAD_FREE" | "ENEPIG" | "OSP" | "IMMERSION_SILVER";
  solderMaskColor: "Matte Black" | "Green" | "Blue" | "Red" | "White";
  silkscreenColor: "White" | "Black";
  ipcClass: "Class 2" | "Class 3" | "Class 3A";
  impedanceControlled: boolean;
  minTraceMm: number;
  minClearanceMm: number;
}

export interface RFQBundleOptions {
  projectName: string;
  revision: string;
  oemName: string;
  oemContact: string;
  layout: PCBLayout;
  bomComponents: BOMComponentInput[];
  targetQuantity?: number | undefined;
  fabricationSpecs?: Partial<FabricationRequirements> | undefined;
  supplyChainOrchestrator?: SupplyChainOrchestrator | undefined;
}

export interface ManifestFileEntry {
  path: string;
  format: string;
  sha256: string;
  sizeBytes: number;
}

export interface SmartRfqManifest {
  schemaVersion: "1.0.0";
  project: string;
  revision: string;
  timestamp: string;
  oem: {
    name: string;
    contact: string;
  };
  fabricationSpecs: FabricationRequirements;
  sourcingSummary: {
    targetQuantity: number;
    totalExtendedPrice: number;
    healthScore: number;
    uniquePartCount: number;
  };
  files: ManifestFileEntry[];
}

export interface SmartRfqBundle {
  manifest: SmartRfqManifest;
  files: Map<string, string>;
  tarArchive: Uint8Array;
}

export class RfqBundleGenerator {
  /**
   * Generates a complete Smart RFQ bundle.
   */
  static async generateBundle(options: RFQBundleOptions): Promise<SmartRfqBundle> {
    const files = new Map<string, string>();
    const targetQty = options.targetQuantity ?? 1000;

    const specs: FabricationRequirements = {
      layers: options.fabricationSpecs?.layers ?? 4,
      thicknessMm: options.fabricationSpecs?.thicknessMm ?? 1.6,
      copperWeightOz: options.fabricationSpecs?.copperWeightOz ?? 1.0,
      material: options.fabricationSpecs?.material ?? "FR4-TG170",
      surfaceFinish: options.fabricationSpecs?.surfaceFinish ?? "ENIG",
      solderMaskColor: options.fabricationSpecs?.solderMaskColor ?? "Matte Black",
      silkscreenColor: options.fabricationSpecs?.silkscreenColor ?? "White",
      ipcClass: options.fabricationSpecs?.ipcClass ?? "Class 2",
      impedanceControlled: options.fabricationSpecs?.impedanceControlled ?? true,
      minTraceMm: options.fabricationSpecs?.minTraceMm ?? 0.1,
      minClearanceMm: options.fabricationSpecs?.minClearanceMm ?? 0.1,
    };

    // 1. Compile IPC-2581C (Single-source modern XML)
    const ipcXml = compileToIPC2581(options.layout, {
      assemblyName: options.projectName,
      revision: options.revision,
      enterprise: options.oemName,
      designer: options.oemContact,
      surfaceFinish: specs.surfaceFinish,
    });
    files.set("ecad/assembly.xml", ipcXml);

    // 2. Compile ODB++ v8.1 file tree
    const odbJob = compileToODB(options.layout, { jobName: options.projectName.toLowerCase() });
    for (const [odbPath, content] of odbJob.files) {
      files.set(`ecad/odb/${odbPath}`, content);
    }

    // 3. Compile Legacy Gerbers & Drill
    const gerbers = generateManufacturingFiles(options.layout);
    for (const g of gerbers) {
      files.set(`ecad/gerber/${g.filename}`, g.content);
    }

    // 4. Centroid & Pick-and-Place Generation
    const centroids = generateCentroidRecords(options.layout);
    files.set("assembly/pnp_normalized.csv", formatStandardCentroidCsv(centroids));
    files.set("assembly/pnp_jlcpcb.csv", formatJlcpcbCplCsv(centroids));
    files.set("assembly/pnp_macrofab.xy", formatMacrofabXy(centroids));

    // 5. Supply Chain BOM Scrubbing & Alternate Verification
    let scrubResult: BOMScrubResult | null = null;
    if (options.supplyChainOrchestrator) {
      scrubResult = await options.supplyChainOrchestrator.scrubBOM(options.bomComponents, targetQty);
    }

    // eBOM
    const ebomLines = ["Designator,MPN,Footprint,Description"];
    for (const c of options.bomComponents) {
      ebomLines.push(`${c.refDes},${c.mpn},${c.footprint ?? "SMD"},${c.description ?? ""}`);
    }
    files.set("supply-chain/bom_engineering.csv", ebomLines.join("\n"));

    // mBOM
    const mbomLines = [
      "Designator,RequestedMPN,SelectedDistributor,SelectedSKU,UnitPrice,ExtendedPrice,RiskFlags,ApprovedAlternates",
    ];
    if (scrubResult) {
      for (const p of scrubResult.componentPlans) {
        const dist = p.selectedQuote?.distributor ?? "Pending";
        const sku = p.selectedQuote?.sku ?? "N/A";
        const unitP = p.selectedQuote ? (p.extendedPrice / p.totalQuantity).toFixed(4) : "0.0000";
        const extP = p.extendedPrice.toFixed(2);
        const risks = p.riskFlags.join("|");
        const alts = p.qualifiedAlternates.map((a) => a.mpn).join(";");
        mbomLines.push(`${p.refDes.join(";")},${p.requestedMpn},${dist},${sku},${unitP},${extP},${risks},${alts}`);
      }
      files.set("supply-chain/sourcing_report.json", JSON.stringify(scrubResult, null, 2));
    }
    files.set("supply-chain/bom_manufacturing.csv", mbomLines.join("\n"));

    // 6. Fabrication & Assembly Notes
    const fabNotes = [
      `FABRICATION AND ASSEMBLY SPECIFICATION`,
      `Project: ${options.projectName}`,
      `Revision: ${options.revision}`,
      `OEM: ${options.oemName} (${options.oemContact})`,
      `Date: ${new Date().toISOString()}`,
      `-----------------------------------------`,
      `Layer Count: ${specs.layers}`,
      `Overall Board Thickness: ${specs.thicknessMm} mm +/- 10%`,
      `Base Laminate: ${specs.material}`,
      `Copper Weight: ${specs.copperWeightOz} oz outer / 0.5 oz inner`,
      `Surface Finish: ${specs.surfaceFinish}`,
      `Solder Mask: ${specs.solderMaskColor}`,
      `Silkscreen: ${specs.silkscreenColor}`,
      `IPC Conformance: IPC-A-600 / IPC-A-610 ${specs.ipcClass}`,
      `Impedance Controlled: ${specs.impedanceControlled ? "YES (refer to stackup drawing)" : "NO"}`,
      `Minimum Trace: ${specs.minTraceMm} mm`,
      `Minimum Clearance: ${specs.minClearanceMm} mm`,
      `-----------------------------------------`,
      `ALL ENGINEERING QUERIES (EQ) MUST BE FILED IN THE ANSATZ CM PORTAL SPACE.`,
    ].join("\n");
    files.set("assembly/fabrication_notes.txt", fabNotes);

    // 7. Regulatory & Environmental Compliance (IPC-1752A, CMRT, RoHS/REACH)
    const regPkg = generateDefaultRegulatoryPackage(options.projectName, options.oemName, options.oemContact);
    files.set("compliance/IPC-1752A_Materials_Declaration.xml", regPkg.ipc1752AXml);
    files.set("compliance/CMRT_v6.4_Conflict_Minerals.json", regPkg.cmrtJson);
    files.set("compliance/RoHS_REACH_Certificate_of_Conformance.md", regPkg.certificateMd);

    // 8. Compute SHA-256 Hashes and Build Manifest
    const manifestEntries: ManifestFileEntry[] = [];
    for (const [path, content] of files) {
      const hash = createHash("sha256").update(content, "utf8").digest("hex");
      const sizeBytes = Buffer.byteLength(content, "utf8");
      manifestEntries.push({
        path,
        format: detectFormat(path),
        sha256: hash,
        sizeBytes,
      });
    }

    const manifest: SmartRfqManifest = {
      schemaVersion: "1.0.0",
      project: options.projectName,
      revision: options.revision,
      timestamp: new Date().toISOString(),
      oem: {
        name: options.oemName,
        contact: options.oemContact,
      },
      fabricationSpecs: specs,
      sourcingSummary: {
        targetQuantity: targetQty,
        totalExtendedPrice: scrubResult?.totalExtendedPrice ?? 0,
        healthScore: scrubResult?.overallHealthScore ?? 100,
        uniquePartCount: options.bomComponents.length,
      },
      files: manifestEntries,
    };

    files.set("manifest.json", JSON.stringify(manifest, null, 2));

    // 8. Package all files into in-memory USTAR tar archive
    const tarArchive = packUstarArchive(files);

    return {
      manifest,
      files,
      tarArchive,
    };
  }
}

function detectFormat(filePath: string): string {
  if (filePath.endsWith("assembly.xml")) return "IPC-2581C (DPMX)";
  if (filePath.includes("odb/")) return "ODB++ v8.1";
  if (filePath.endsWith(".gbr")) return "RS-274X Gerber";
  if (filePath.endsWith(".xln")) return "Excellon Drill";
  if (filePath.endsWith(".csv")) return "Comma-Separated Values (CSV)";
  if (filePath.endsWith(".xy")) return "MacroFab XY Centroid";
  if (filePath.endsWith(".json")) return "JSON Structured Data";
  return "Plain Text / Drawing";
}
