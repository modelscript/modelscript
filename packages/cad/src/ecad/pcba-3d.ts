// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cad — 3D Populated PCBA Assembly Builder & Enclosure Interference Verifier.
 *
 * Bridges ECAD placed footprints and component packages into full 3D solid geometry,
 * assemblies, and ISO-10303-21 STEP models, and evaluates 3D mechanical clearance and
 * collision against chassis / enclosure cavities.
 */

import { assembly, part } from "../assembly.js";
import { type ClearanceConstraint, type SpatialClearanceReport, verifyAssemblyClearance } from "../clearance.js";
import { box } from "../primitives.js";
import { compileAssemblyToStep } from "../step-compiler.js";
import { rotate, translate } from "../transforms.js";
import type { Assembly, PartEntry, Vec3 } from "../types.js";

export interface ComponentDimensions3D {
  width: number; // Dimension along X at 0 deg (mm)
  length: number; // Dimension along Z at 0 deg (mm)
  height: number; // Dimension along Y (thickness/height above board, mm)
}

/** Standard JEDEC / EIA package dimensions lookup in millimeters (W x L x H) */
export const DEFAULT_PACKAGE_DIMENSIONS: Record<string, ComponentDimensions3D> = {
  "0201": { width: 0.3, length: 0.6, height: 0.3 },
  "0402": { width: 0.5, length: 1.0, height: 0.5 },
  "0603": { width: 0.8, length: 1.6, height: 0.8 },
  "0805": { width: 1.25, length: 2.0, height: 1.0 },
  "1206": { width: 1.6, length: 3.2, height: 1.2 },
  "1210": { width: 2.5, length: 3.2, height: 1.5 },
  "SOT-23": { width: 1.3, length: 2.9, height: 1.1 },
  "SOT-223": { width: 3.5, length: 6.5, height: 1.8 },
  "SOIC-8": { width: 4.0, length: 5.0, height: 1.75 },
  "SOIC-16": { width: 4.0, length: 10.0, height: 1.75 },
  "TSSOP-20": { width: 4.4, length: 6.5, height: 1.1 },
  "QFN-32": { width: 5.0, length: 5.0, height: 0.9 },
  "QFN-48": { width: 7.0, length: 7.0, height: 0.9 },
  "LQFP-48": { width: 7.0, length: 7.0, height: 1.4 },
  "LQFP-64": { width: 10.0, length: 10.0, height: 1.4 },
  "BGA-256": { width: 14.0, length: 14.0, height: 1.4 },
  "USB-C": { width: 8.94, length: 7.35, height: 3.26 },
  "MICRO-USB": { width: 7.5, length: 5.0, height: 3.0 },
  "SMA-CONNECTOR": { width: 6.35, length: 9.5, height: 6.35 },
  ELECTROLYTIC_CAN_8x10: { width: 8.0, length: 8.0, height: 10.2 },
  ELECTROLYTIC_CAN_10x10: { width: 10.0, length: 10.0, height: 10.5 },
  POWER_INDUCTOR_12x12: { width: 12.0, length: 12.0, height: 6.0 },
  "TO-220": { width: 10.0, length: 4.5, height: 15.0 },
};

export interface PlacedComponent3D {
  refDes: string;
  package: string;
  center: { x: number; y: number }; // In board 2D coordinates (X, Y in mm)
  rotation?: number | undefined; // In degrees (default 0)
  layer?: "Top" | "Bottom" | undefined; // Default "Top"
  dimensions?: ComponentDimensions3D | undefined;
  keepoutClearanceMm?: number | undefined; // Air gap requirement (default 0.5 mm)
}

export interface PcbBoardGeometry {
  name?: string | undefined;
  width: number; // Board width along X (mm)
  length: number; // Board length along Z (mm)
  thickness?: number | undefined; // Board substrate thickness along Y (default 1.6 mm)
}

export interface EnclosureGeometry {
  name: string;
  wallThicknessMm: number;
  internalCavity: {
    minX: number;
    maxX: number;
    minY: number; // Bottom of internal cavity relative to board center
    maxY: number; // Top lid of internal cavity relative to board center
    minZ: number;
    maxZ: number;
  };
  standoffHeightMm?: number | undefined; // Height of bottom standoffs supporting PCB (mm, default 3.0)
}

export interface PcbaEnclosureAssembly {
  assembly: Assembly;
  boardPart: PartEntry;
  componentParts: Map<string, PartEntry>;
  enclosureParts: PartEntry[];
  maxComponentHeightAboveBoardMm: number;
  enclosureHeadroomMm?: number | undefined;
}

export interface PcbaClearanceReport {
  isCompliant: boolean;
  totalComponentsChecked: number;
  maxComponentHeightMm: number;
  enclosureHeadroomMm?: number | undefined;
  collisions: Array<{
    partA: string;
    partB: string;
    penetrationDepthMm: number;
    description: string;
  }>;
  clearanceViolations: Array<{
    partA: string;
    partB: string;
    actualDistanceMm: number;
    requiredClearanceMm: number;
    description: string;
  }>;
  rawReport: SpatialClearanceReport;
}

/**
 * Resolves 3D dimensions for an electronic component footprint.
 */
export function resolveComponentDimensions(comp: PlacedComponent3D): ComponentDimensions3D {
  if (comp.dimensions) return comp.dimensions;
  const pkgUpper = comp.package.toUpperCase();
  for (const [key, dim] of Object.entries(DEFAULT_PACKAGE_DIMENSIONS)) {
    if (pkgUpper === key.toUpperCase() || pkgUpper.includes(key.toUpperCase())) {
      return dim;
    }
  }
  // Generic passive fallback
  return { width: 2.0, length: 2.0, height: 1.0 };
}

/**
 * Constructs a 3D populated PCBA CAD Assembly from ECAD board and placed component data.
 */
export function buildPopulatedPcbaAssembly(
  pcb: PcbBoardGeometry,
  components: PlacedComponent3D[],
  enclosure?: EnclosureGeometry,
): PcbaEnclosureAssembly {
  const pcbThick = pcb.thickness ?? 1.6;
  const boardName = pcb.name ?? "PCB_Substrate";

  // 1. Create PCB substrate solid centered at origin [0, 0, 0]
  // Dimensions: width = X, height = Y (thickness), depth = Z (length)
  const rawBoardSolid = box({
    name: boardName,
    width: pcb.width,
    height: pcbThick,
    depth: pcb.length,
  });

  const boardPartEntry = part(rawBoardSolid, {
    material: "FR4_Glass_Epoxy",
    color: [0.1, 0.45, 0.2] as Vec3, // Characteristic green solder mask
  });

  const partsList: PartEntry[] = [boardPartEntry];
  const compPartsMap = new Map<string, PartEntry>();
  let maxHeight = 0;

  // 2. Instantiate each 3D component solid
  for (const comp of components) {
    const dim = resolveComponentDimensions(comp);
    const isTop = (comp.layer ?? "Top") === "Top";
    const rotDeg = comp.rotation ?? 0;
    const rotRad = (rotDeg * Math.PI) / 180;

    // Component solid centered at its local origin
    const rawCompSolid = box({
      name: `Comp_${comp.refDes}`,
      width: dim.width,
      height: dim.height,
      depth: dim.length,
    });

    // Rotate component around Y axis (normal to board)
    const rotatedSolid = rotDeg !== 0 ? rotate(rawCompSolid, [0, 1, 0], rotRad) : rawCompSolid;

    // Translate to its board location:
    // X = comp.center.x - pcb.width / 2 (relative to board center)
    // Z = comp.center.y - pcb.length / 2 (relative to board center)
    // Y = top surface (+pcbThick/2 + dim.height/2) or bottom surface (-pcbThick/2 - dim.height/2)
    const posX = comp.center.x - pcb.width / 2;
    const posZ = comp.center.y - pcb.length / 2;
    const posY = isTop ? pcbThick / 2 + dim.height / 2 : -pcbThick / 2 - dim.height / 2;

    const placedSolid = translate(rotatedSolid, [posX, posY, posZ]);

    // Choose visual color based on package type
    let color: Vec3 = [0.2, 0.2, 0.2]; // Black plastic IC body
    if (comp.package.includes("CAN") || comp.package.includes("ELECTROLYTIC")) {
      color = [0.8, 0.8, 0.85]; // Aluminum can
    } else if (comp.package.includes("USB") || comp.package.includes("SMA")) {
      color = [0.9, 0.75, 0.2]; // Gold / brass / steel shield
    }

    const compPart = part(placedSolid, {
      material: "Molded_Epoxy_Compound",
      color,
    });

    partsList.push(compPart);
    compPartsMap.set(comp.refDes, compPart);

    if (isTop && dim.height > maxHeight) {
      maxHeight = dim.height;
    }
  }

  // 3. Create Enclosure Solids if specified
  const enclosureParts: PartEntry[] = [];
  let enclosureHeadroom: number | undefined = undefined;

  if (enclosure) {
    const cav = enclosure.internalCavity;
    const wallThick = enclosure.wallThicknessMm;
    const cavW = cav.maxX - cav.minX;
    const cavL = cav.maxZ - cav.minZ;

    // Top Lid Solid: Sits above the cavity maxY
    const lidHeight = wallThick;
    const lidCenterY = cav.maxY + wallThick / 2;
    const lidSolid = translate(
      box({
        name: `${enclosure.name}_TopLid`,
        width: cavW + wallThick * 2,
        height: lidHeight,
        depth: cavL + wallThick * 2,
      }),
      [0, lidCenterY, 0],
    );

    const lidPart = part(lidSolid, {
      material: "Anodized_Aluminum",
      color: [0.3, 0.35, 0.4] as Vec3,
    });

    // Bottom Base Solid: Sits below the cavity minY
    const baseHeight = wallThick;
    const baseCenterY = cav.minY - wallThick / 2;
    const baseSolid = translate(
      box({
        name: `${enclosure.name}_BottomBase`,
        width: cavW + wallThick * 2,
        height: baseHeight,
        depth: cavL + wallThick * 2,
      }),
      [0, baseCenterY, 0],
    );

    const basePart = part(baseSolid, {
      material: "Anodized_Aluminum",
      color: [0.3, 0.35, 0.4] as Vec3,
    });

    enclosureParts.push(lidPart, basePart);
    partsList.push(lidPart, basePart);

    // Compute headroom: distance from top of tallest component to cavity maxY
    const topOfTallestComponent = pcbThick / 2 + maxHeight;
    enclosureHeadroom = cav.maxY - topOfTallestComponent;
  }

  const asm = assembly(pcb.name ? `${pcb.name}_Assembly` : "PCBA_3D_Assembly", partsList);

  return {
    assembly: asm,
    boardPart: boardPartEntry,
    componentParts: compPartsMap,
    enclosureParts,
    maxComponentHeightAboveBoardMm: maxHeight,
    enclosureHeadroomMm: enclosureHeadroom,
  };
}

/**
 * Evaluates 3D spatial clearance between components, the PCB substrate, and the enclosure.
 */
export function checkPcbaInterference(
  pcba: PcbaEnclosureAssembly,
  options?: {
    defaultComponentToEnclosureClearanceMm?: number | undefined;
    defaultComponentToComponentClearanceMm?: number | undefined;
  },
): PcbaClearanceReport {
  const encClearance = options?.defaultComponentToEnclosureClearanceMm ?? 0.5;
  const compClearance = options?.defaultComponentToComponentClearanceMm ?? 0.2;

  // Build constraints: enforce minimum clearance from each component to the enclosure lids
  const constraints: ClearanceConstraint[] = [];
  for (const encPart of pcba.enclosureParts) {
    const encName = encPart.solid.name;
    constraints.push({
      partA: encName,
      minClearance: encClearance,
    });
  }

  const rawReport = verifyAssemblyClearance(pcba.assembly, compClearance, constraints);

  const collisions: PcbaClearanceReport["collisions"] = [];
  const clearanceViolations: PcbaClearanceReport["clearanceViolations"] = [];

  for (const v of rawReport.violations) {
    const cleanA = v.partA.replace(/^(Translate_|Rotate_)+/, "");
    const cleanB = v.partB.replace(/^(Translate_|Rotate_)+/, "");

    // Ignore board-to-component contacts since components are physically seated on the board
    const isBoardContact =
      (cleanA === pcba.boardPart.solid.name && cleanB.startsWith("Comp_")) ||
      (cleanB === pcba.boardPart.solid.name && cleanA.startsWith("Comp_"));

    if (isBoardContact) continue;

    if (v.status === "collision") {
      collisions.push({
        partA: cleanA,
        partB: cleanB,
        penetrationDepthMm: Math.abs(v.actualDistance),
        description: v.description,
      });
    } else {
      clearanceViolations.push({
        partA: cleanA,
        partB: cleanB,
        actualDistanceMm: v.actualDistance,
        requiredClearanceMm: v.requiredClearance,
        description: v.description,
      });
    }
  }

  return {
    isCompliant: collisions.length === 0 && clearanceViolations.length === 0,
    totalComponentsChecked: pcba.componentParts.size,
    maxComponentHeightMm: pcba.maxComponentHeightAboveBoardMm,
    enclosureHeadroomMm: pcba.enclosureHeadroomMm,
    collisions,
    clearanceViolations,
    rawReport,
  };
}

/**
 * Exports the complete 3D Populated PCBA and Enclosure Assembly into ISO-10303-21 STEP format.
 */
export function exportPopulatedPcbaToStep(pcba: PcbaEnclosureAssembly): string {
  return compileAssemblyToStep(pcba.assembly);
}
