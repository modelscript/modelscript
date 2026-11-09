// SPDX-License-Identifier: AGPL-3.0-or-later

import { readSpaceGitFileAtRef } from "./space-git-vault.js";

export interface EcoBomPart {
  partNumber: string;
  name: string;
  category: string;
  changeStatus: "added" | "removed" | "modified" | "unchanged";
  baselineQuantity: number;
  targetQuantity: number;
  unitCostUsd: number;
  massKg: number;
  packageDependency?: string | undefined;
  variantOverrides?: Record<string, unknown> | undefined;
}

export interface EcoBomResult {
  sourceBranch: string;
  targetBranch: string;
  summary: {
    totalPartsDelta: number;
    massDeltaKg: number;
    costDeltaUsd: number;
    carbonDeltaKgCo2: number;
  };
  parts: EcoBomPart[];
}

export interface RawComponentEntry {
  type: string;
  name: string;
  description: string;
  modifiers: Record<string, string>;
  annotation: Record<string, string>;
  massKg: number;
  unitCostUsd: number;
  partNumber: string;
  category: string;
  packageDependency?: string | undefined;
}

const RESERVED_KEYWORDS = new Set([
  "model",
  "block",
  "package",
  "record",
  "class",
  "end",
  "equation",
  "algorithm",
  "initial",
  "public",
  "protected",
  "connect",
  "extends",
  "import",
  "annotation",
  "constant",
  "type",
  "function",
  "external",
  "then",
  "else",
  "elseif",
  "when",
  "while",
  "for",
  "loop",
  "in",
]);

function inferCategory(type: string, name: string): string {
  const combined = `${type} ${name}`.toLowerCase();
  if (/motor|actuator|pump|valve|servo|solenoid|stepper|generator|thruster/.test(combined)) {
    return "Actuator";
  }
  if (/sensor|probe|transducer|hall|encoder|gyro|imu|thermocouple|gauge|detector/.test(combined)) {
    return "Sensor";
  }
  if (
    /inverter|bridge|transceiver|can|mcu|controller|board|pcb|battery|cell|bus|resistor|capacitor|inductor/.test(
      combined,
    )
  ) {
    return "Electronics";
  }
  if (/bracket|chassis|frame|body|mount|strut|beam|arm|plate|housing|enclosure|gear|bearing/.test(combined)) {
    return "Structural";
  }
  if (/pipe|tank|duct|manifold|tube|hose|valve|chamber|radiator/.test(combined)) {
    return "Fluid";
  }
  return "Subsystem";
}

function defaultMass(category: string, _name: string): number {
  switch (category) {
    case "Actuator":
      return 0.85;
    case "Sensor":
      return 0.04;
    case "Electronics":
      return 0.12;
    case "Structural":
      return 0.45;
    case "Fluid":
      return 0.65;
    default:
      return 0.25;
  }
}

function defaultCost(category: string, _name: string): number {
  switch (category) {
    case "Actuator":
      return 145.0;
    case "Sensor":
      return 32.5;
    case "Electronics":
      return 18.0;
    case "Structural":
      return 16.5;
    case "Fluid":
      return 42.0;
    default:
      return 25.0;
  }
}

function parseModifiersString(rawMod: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!rawMod) return result;
  const inner = rawMod
    .replace(/^\s*\(/, "")
    .replace(/\)\s*$/, "")
    .trim();
  if (!inner) return result;

  const pairs = inner.split(/,(?![^(]*\))/);
  for (const pair of pairs) {
    const eqIdx = pair.indexOf("=");
    if (eqIdx !== -1) {
      const key = pair.slice(0, eqIdx).trim();
      let val = pair.slice(eqIdx + 1).trim();
      val = val.replace(/^["']/, "").replace(/["']$/, "").trim();
      if (key) result[key] = val;
    }
  }
  return result;
}

export function extractComponentsFromSource(code: string, _filename: string): RawComponentEntry[] {
  const components: RawComponentEntry[] = [];
  if (!code || typeof code !== "string") return components;

  // Regex for Modelica/SysML component declarations:
  // e.g. "  Actuator.BrushlessMotor motor(V_nom = 24.0) "High-Flow Motor" annotation(...);"
  const compRegex =
    /(?:^|[\r\n])\s*(?:parameter\s+)?([A-Za-z0-9_.]+)\s+([A-Za-z0-9_]+)\s*(\([^);]*\))?\s*(?:"([^"]*)")?\s*(?:annotation\s*\(([^;]*)\))?\s*;/g;

  let match: RegExpExecArray | null;
  while ((match = compRegex.exec(code)) !== null) {
    const rawType = match[1]?.trim() || "";
    const name = match[2]?.trim() || "";
    const rawModifiers = match[3]?.trim() || "";
    const description = match[4]?.trim() || "";
    const rawAnnotation = match[5]?.trim() || "";

    if (
      !rawType ||
      !name ||
      RESERVED_KEYWORDS.has(rawType.toLowerCase()) ||
      RESERVED_KEYWORDS.has(name.toLowerCase())
    ) {
      continue;
    }
    // Filter out built-in scalar primitives unless they represent discrete physical parts
    if (/^(Real|Integer|Boolean|String)$/.test(rawType) && !description && !rawModifiers.includes("mass")) {
      continue;
    }

    const modifiers = parseModifiersString(rawModifiers);
    const annotation = parseModifiersString(rawAnnotation);
    const category = inferCategory(rawType, name);

    let massKg = defaultMass(category, name);
    if (modifiers["mass"] && !Number.isNaN(Number(modifiers["mass"]))) {
      massKg = Number(modifiers["mass"]);
    } else if (annotation["mass"] && !Number.isNaN(Number(annotation["mass"]))) {
      massKg = Number(annotation["mass"]);
    }

    let unitCostUsd = defaultCost(category, name);
    if (modifiers["cost"] && !Number.isNaN(Number(modifiers["cost"]))) {
      unitCostUsd = Number(modifiers["cost"]);
    } else if (modifiers["unitCost"] && !Number.isNaN(Number(modifiers["unitCost"]))) {
      unitCostUsd = Number(modifiers["unitCost"]);
    } else if (annotation["unitCost"] && !Number.isNaN(Number(annotation["unitCost"]))) {
      unitCostUsd = Number(annotation["unitCost"]);
    }

    const partPrefix = category.slice(0, 3).toUpperCase();
    const partNumber =
      annotation["partNumber"] ||
      annotation["__ModelScript_partNumber"] ||
      `${partPrefix}-${name.toUpperCase().slice(0, 10)}`;

    let packageDependency: string | undefined;
    if (rawType.includes(".")) {
      const rootPkg = rawType.split(".")[0];
      packageDependency = `@suppliers/${rootPkg?.toLowerCase() || "standard"}@^1.0.0`;
    }

    components.push({
      type: rawType,
      name,
      description: description || `${name} (${rawType})`,
      modifiers,
      annotation,
      massKg,
      unitCostUsd,
      partNumber,
      category,
      packageDependency,
    });
  }

  return components;
}

export function computeEcoBomDelta(opts: {
  repoPath?: string | null | undefined;
  baseRef: string;
  targetRef: string;
  impactedModels?: string[] | undefined;
  defaultParts?: EcoBomPart[] | undefined;
}): EcoBomResult {
  const partsMap = new Map<string, EcoBomPart>();

  // If a real repo exists, inspect changed models between baseRef and targetRef
  if (opts.repoPath) {
    const candidateFiles =
      opts.impactedModels && opts.impactedModels.length > 0
        ? opts.impactedModels
        : ["models/SystemBaseline.mo", "package.mo", "models/StarterModel.mo"];

    for (const filePath of candidateFiles) {
      const cleanPath = filePath.replace(/^\/+/, "");
      const baseCode = readSpaceGitFileAtRef({ repoPath: opts.repoPath, ref: opts.baseRef, filePath: cleanPath });
      const targetCode = readSpaceGitFileAtRef({ repoPath: opts.repoPath, ref: opts.targetRef, filePath: cleanPath });

      if (baseCode != null || targetCode != null) {
        const baseComps = extractComponentsFromSource(baseCode || "", cleanPath);
        const targetComps = extractComponentsFromSource(targetCode || "", cleanPath);

        const baseCompMap = new Map(baseComps.map((c) => [c.name, c]));
        const targetCompMap = new Map(targetComps.map((c) => [c.name, c]));

        // Target components
        for (const [name, tComp] of targetCompMap.entries()) {
          const bComp = baseCompMap.get(name);
          if (!bComp) {
            // Added
            partsMap.set(tComp.partNumber, {
              partNumber: tComp.partNumber,
              name: tComp.description,
              category: tComp.category,
              changeStatus: "added",
              baselineQuantity: 0,
              targetQuantity: 1,
              unitCostUsd: tComp.unitCostUsd,
              massKg: tComp.massKg,
              packageDependency: tComp.packageDependency,
              variantOverrides: Object.keys(tComp.modifiers).length > 0 ? tComp.modifiers : undefined,
            });
          } else {
            // Present in both: check if modified
            const isMod =
              JSON.stringify(tComp.modifiers) !== JSON.stringify(bComp.modifiers) ||
              tComp.massKg !== bComp.massKg ||
              tComp.unitCostUsd !== bComp.unitCostUsd;

            partsMap.set(tComp.partNumber, {
              partNumber: tComp.partNumber,
              name: tComp.description,
              category: tComp.category,
              changeStatus: isMod ? "modified" : "unchanged",
              baselineQuantity: 1,
              targetQuantity: 1,
              unitCostUsd: tComp.unitCostUsd,
              massKg: tComp.massKg,
              packageDependency: tComp.packageDependency,
              variantOverrides: isMod ? tComp.modifiers : undefined,
            });
          }
        }

        // Base components not in target: removed
        for (const [name, bComp] of baseCompMap.entries()) {
          if (!targetCompMap.has(name) && !partsMap.has(bComp.partNumber)) {
            partsMap.set(bComp.partNumber, {
              partNumber: bComp.partNumber,
              name: bComp.description,
              category: bComp.category,
              changeStatus: "removed",
              baselineQuantity: 1,
              targetQuantity: 0,
              unitCostUsd: bComp.unitCostUsd,
              massKg: bComp.massKg,
              packageDependency: bComp.packageDependency,
            });
          }
        }
      }
    }
  }

  // Fallback to default parts if no parts could be extracted from Git
  if (partsMap.size === 0 && opts.defaultParts && opts.defaultParts.length > 0) {
    for (const p of opts.defaultParts) {
      partsMap.set(p.partNumber, p);
    }
  }

  const parts = Array.from(partsMap.values());
  const totalPartsDelta = parts.reduce((acc, p) => acc + (p.targetQuantity - p.baselineQuantity), 0);
  const costDeltaUsd = Number(
    parts.reduce((acc, p) => acc + (p.targetQuantity - p.baselineQuantity) * p.unitCostUsd, 0).toFixed(2),
  );
  const massDeltaKg = Number(
    parts.reduce((acc, p) => acc + (p.targetQuantity - p.baselineQuantity) * p.massKg, 0).toFixed(3),
  );
  const carbonDeltaKgCo2 = Number((-1.85 * (massDeltaKg < 0 ? Math.abs(massDeltaKg) : -massDeltaKg)).toFixed(2));

  return {
    sourceBranch: opts.targetRef,
    targetBranch: opts.baseRef,
    summary: {
      totalPartsDelta,
      massDeltaKg,
      costDeltaUsd,
      carbonDeltaKgCo2,
    },
    parts,
  };
}
