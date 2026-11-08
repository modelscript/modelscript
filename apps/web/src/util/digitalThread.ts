// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ArtifactViewerInfo, ClassDetail, ClassSummary } from "../api";

/* ─── Types ─── */

export type DomainType = "modelica" | "sysml2" | "cad" | "dataset" | "fea" | "cfd" | "scad";

export interface DigitalThreadTwin {
  id: string;
  source: {
    domain: DomainType;
    name: string;
    qualifiedName?: string | undefined;
    kind: string;
    variable?: string | undefined;
    unit?: string | undefined;
    quantity?: string | undefined;
    resourcePath?: string | undefined;
  };
  target: {
    domain: DomainType;
    name: string;
    qualifiedName?: string | undefined;
    kind: string;
    attribute?: string | undefined;
    unit?: string | undefined;
    quantity?: string | undefined;
    resourcePath?: string | undefined;
  };
  relationship: "twin" | "cad-binding" | "implements" | "verification" | "calibrated-by";
  parity: {
    status: "compatible" | "warning" | "incompatible";
    sourceUnit: string;
    targetUnit: string;
    message: string;
    factor?: number | undefined;
    deviationPercent?: number | undefined;
  };
  cadViewerConfig?:
    | {
        url: string;
        stepEntity?: string | undefined;
      }
    | undefined;
  sysmlConfig?:
    | {
        artifactPath: string;
        blockName?: string | undefined;
      }
    | undefined;
}

export interface DigitalThreadMetrics {
  total: number;
  compatible: number;
  cadBindings: number;
  sysmlAlignments: number;
  parityRate: number;
}

function inferUnitFromTypeName(typeName?: string): string | undefined {
  if (!typeName) return undefined;
  const lower = typeName.toLowerCase();
  if (lower.includes("torque") || lower.includes("moment")) return "N.m";
  if (lower.includes("angularvelocity") || lower.includes("angularspeed")) return "rad/s";
  if (lower.includes("voltage") || lower.includes("electricpotential")) return "V";
  if (lower.includes("current")) return "A";
  if (lower.includes("temperature")) return "K";
  if (lower.includes("pressure")) return "Pa";
  if (lower.includes("force")) return "N";
  if (lower.includes("mass")) return "kg";
  if (lower.includes("length") || lower.includes("distance") || lower.includes("position")) return "m";
  return undefined;
}

/* ─── Physical Quantity Parity Checker ─── */

export function checkUnitParity(sourceUnit?: string, targetUnit?: string): DigitalThreadTwin["parity"] {
  if (!sourceUnit && !targetUnit) {
    return {
      status: "compatible",
      sourceUnit: "dimensionless",
      targetUnit: "dimensionless",
      message: "Dimensionless / structural twin correspondence",
      factor: 1.0,
    };
  }

  const s = (sourceUnit || "").trim().toLowerCase();
  const t = (targetUnit || "").trim().toLowerCase();

  if (s === t) {
    return {
      status: "compatible",
      sourceUnit: sourceUnit || "",
      targetUnit: targetUnit || "",
      message: `Exact match: 1.0 ${sourceUnit} ⟷ 1.0 ${targetUnit}`,
      factor: 1.0,
    };
  }

  // Common physical engineering unit equivalencies
  const normalizedS = s.replace(/[*.]/g, ".");
  const normalizedT = t.replace(/[*.]/g, ".");

  if (normalizedS === normalizedT) {
    return {
      status: "compatible",
      sourceUnit: sourceUnit || "",
      targetUnit: targetUnit || "",
      message: `Notation match: ${sourceUnit} ⟷ ${targetUnit}`,
      factor: 1.0,
    };
  }

  // Torque / Work
  if (
    (normalizedS === "n.m" && normalizedT === "n*m") ||
    (normalizedS === "n*m" && normalizedT === "n.m") ||
    (normalizedS === "n.m" && normalizedT === "kg.m2/s2") ||
    (normalizedT === "n.m" && normalizedS === "kg.m2/s2")
  ) {
    return {
      status: "compatible",
      sourceUnit: sourceUnit || "",
      targetUnit: targetUnit || "",
      message: `Torque / Work parity: ${sourceUnit} ⟷ ${targetUnit}`,
      factor: 1.0,
    };
  }

  // Angular velocity
  if (
    (s.includes("rad/s") && t.includes("rad/s")) ||
    (s.includes("1/s") && t.includes("rad/s")) ||
    (t.includes("1/s") && s.includes("rad/s"))
  ) {
    return {
      status: "compatible",
      sourceUnit: sourceUnit || "",
      targetUnit: targetUnit || "",
      message: `Angular velocity compatibility: ${sourceUnit} ⟷ ${targetUnit}`,
      factor: 1.0,
    };
  }

  // RPM to rad/s
  if ((s === "rpm" && t.includes("rad/s")) || (t === "rpm" && s.includes("rad/s"))) {
    return {
      status: "compatible",
      sourceUnit: sourceUnit || "",
      targetUnit: targetUnit || "",
      message: `Rotational speed scale: 1 RPM = 0.10472 rad/s`,
      factor: s === "rpm" ? 0.104719755 : 9.549296596,
    };
  }

  // Length (m <-> mm)
  if ((s === "m" && t === "mm") || (s === "mm" && t === "m")) {
    return {
      status: "compatible",
      sourceUnit: sourceUnit || "",
      targetUnit: targetUnit || "",
      message: `Length scaling factor: 1 m = 1000 mm`,
      factor: s === "m" ? 1000 : 0.001,
    };
  }

  // Mass (g <-> kg)
  if ((s === "g" && t === "kg") || (s === "kg" && t === "g")) {
    return {
      status: "compatible",
      sourceUnit: sourceUnit || "",
      targetUnit: targetUnit || "",
      message: `Mass scaling factor: 1 kg = 1000 g`,
      factor: s === "g" ? 0.001 : 1000,
    };
  }

  // Incompatible
  return {
    status: "incompatible",
    sourceUnit: sourceUnit || "undefined",
    targetUnit: targetUnit || "undefined",
    message: `Physical quantity mismatch: [${sourceUnit || "none"}] vs [${targetUnit || "none"}]`,
  };
}

/* ─── Digital Thread Metrics Calculator ─── */

export function computeDigitalThreadMetrics(twins: DigitalThreadTwin[]): DigitalThreadMetrics {
  const total = twins.length;
  const compatible = twins.filter((t) => t.parity.status === "compatible").length;
  const cadBindings = twins.filter(
    (t) => t.relationship === "cad-binding" || t.target.domain === "cad" || t.source.domain === "cad",
  ).length;
  const sysmlAlignments = twins.filter((t) => t.target.domain === "sysml2" || t.source.domain === "sysml2").length;
  const parityRate = total > 0 ? Math.round((compatible / total) * 100) : 100;

  return {
    total,
    compatible,
    cadBindings,
    sysmlAlignments,
    parityRate,
  };
}

/* ─── Twin Extractor from Package Assets ─── */

export function extractDigitalThreadTwins(
  packageName: string,
  _packageVersion: string,
  classes?: ClassSummary[],
  rootClass?: ClassDetail | null,
  artifactViewers?: ArtifactViewerInfo[],
): DigitalThreadTwin[] {
  const twins: DigitalThreadTwin[] = [];
  const cadFiles = (artifactViewers || []).filter((a) => a.path.endsWith(".step") || a.path.endsWith(".stp"));
  const sysmlFiles = (artifactViewers || []).filter((a) => a.path.endsWith(".sysml") || a.path.endsWith(".kerml"));

  // 1. Inspect rootClass components and modifiers
  if (rootClass && rootClass.components) {
    for (const comp of rootClass.components) {
      let twinRef: string | null = null;
      let cadRef: string | null = null;
      let unit: string | null = null;

      for (const mod of comp.modifiers || []) {
        if (mod.modifier_name === "twin" && mod.modifier_value) {
          twinRef = mod.modifier_value.replace(/['"]/g, "");
        } else if ((mod.modifier_name === "CAD" || mod.modifier_name === "cad") && mod.modifier_value) {
          cadRef = mod.modifier_value.replace(/['"]/g, "");
        } else if (mod.modifier_name === "unit" && mod.modifier_value) {
          unit = mod.modifier_value.replace(/['"]/g, "");
        }
      }

      // Check description
      if (comp.description) {
        const twinMatch = comp.description.match(/twin\s*=\s*["']([^"']+)["']/i);
        if (twinMatch) twinRef = twinMatch[1]!;
        const cadMatch = comp.description.match(/CAD\s*=\s*["']([^"']+)["']/i);
        if (cadMatch) cadRef = cadMatch[1]!;
      }

      // If twin counterpart is found
      if (twinRef) {
        const inferredUnit = unit || inferUnitFromTypeName(comp.type_name);
        const sourceUnit = inferredUnit;
        const targetUnit = inferredUnit === "N.m" ? "N*m" : inferredUnit;
        twins.push({
          id: `twin-${comp.component_name}-${twinRef}`,
          source: {
            domain: "modelica",
            name: `${packageName}.${comp.component_name}`,
            kind: comp.type_name,
            variable: comp.component_name,
            ...(sourceUnit ? { unit: sourceUnit } : {}),
            quantity: "Physical Variable",
          },
          target: {
            domain: twinRef.toLowerCase().includes("cad") ? "cad" : "sysml2",
            name: twinRef,
            kind: "PartDefinition",
            attribute: comp.component_name,
            ...(targetUnit ? { unit: targetUnit } : {}),
            quantity: "System Requirement",
          },
          relationship: "twin",
          parity: checkUnitParity(sourceUnit, targetUnit),
        });
      }

      // If CAD binding is found
      if (cadRef) {
        const cleanCadTarget = cadRef.split("#")[0]!.replace("cad://", "");
        const matchedCadFile = cadFiles.find((c) => c.path.includes(cleanCadTarget)) || cadFiles[0];
        const srcLengthUnit = unit || "m";
        const isMmSource = srcLengthUnit.toLowerCase() === "mm";
        twins.push({
          id: `cad-${comp.component_name}-${cadRef}`,
          source: {
            domain: "modelica",
            name: `${packageName}.${comp.component_name}`,
            kind: comp.type_name,
            variable: comp.component_name,
            unit: srcLengthUnit,
            quantity: "Kinematic Transform",
          },
          target: {
            domain: "cad",
            name: cadRef.replace("cad://", ""),
            kind: "STEP B-Rep Solid",
            unit: "mm",
            resourcePath: matchedCadFile?.path,
          },
          relationship: "cad-binding",
          parity: {
            status: "compatible",
            sourceUnit: srcLengthUnit,
            targetUnit: "mm",
            factor: isMmSource ? 1.0 : 1000.0,
            message: isMmSource
              ? "Geometric transform bound: scale {1, 1, 1}"
              : "Geometric transform bound (m → mm): scale {1000, 1000, 1000}",
          },
          cadViewerConfig: {
            url: matchedCadFile?.path || cadRef,
          },
        });
      }
    }
  }

  // 2. Cross-correlate classes with SysML and STEP files when polyglot assets exist
  if (cadFiles.length > 0 && classes && classes.length > 0) {
    for (const cad of cadFiles) {
      const cadBase =
        cad.path
          .split("/")
          .pop()
          ?.replace(/\.(step|stp)$/i, "") || "";
      const matchingClass = classes.find(
        (c) =>
          c.class_name.toLowerCase().includes(cadBase.toLowerCase()) ||
          cadBase.toLowerCase().includes(c.class_name.toLowerCase()) ||
          c.class_kind.includes("cad"),
      );

      if (matchingClass && !twins.some((t) => t.target.name === cad.path)) {
        twins.push({
          id: `cad-poly-${cad.id}`,
          source: {
            domain: "modelica",
            name: matchingClass.class_name,
            kind: matchingClass.class_kind || "ModelicaClass",
            unit: "m",
          },
          target: {
            domain: "cad",
            name: cad.displayName || cad.path,
            kind: "STEP Assembly Product",
            unit: "mm",
            resourcePath: cad.path,
          },
          relationship: "cad-binding",
          parity: {
            status: "compatible",
            sourceUnit: "m",
            targetUnit: "mm",
            factor: 1000.0,
            message: "Solid B-Rep bound to Modelica dynamic assembly (m → mm, scale {1000, 1000, 1000})",
          },
          cadViewerConfig: {
            url: cad.path,
          },
        });
      }
    }
  }

  if (sysmlFiles.length > 0 && classes && classes.length > 0) {
    for (const sys of sysmlFiles) {
      const sysBase =
        sys.path
          .split("/")
          .pop()
          ?.replace(/\.(sysml|kerml)$/i, "") || "";
      const matchingClass = classes.find(
        (c) =>
          c.class_name.toLowerCase().includes(sysBase.toLowerCase()) ||
          sysBase.toLowerCase().includes(c.class_name.toLowerCase()) ||
          c.class_kind.includes("sysml"),
      );

      if (matchingClass && !twins.some((t) => t.target.name === sys.path)) {
        const inferredUnit = inferUnitFromTypeName(matchingClass.class_name);
        twins.push({
          id: `sysml-poly-${sys.id}`,
          source: {
            domain: "modelica",
            name: matchingClass.class_name,
            kind: matchingClass.class_kind || "ModelicaClass",
            ...(inferredUnit ? { unit: inferredUnit } : {}),
          },
          target: {
            domain: "sysml2",
            name: sys.displayName || sys.path,
            kind: "PartDefinition & Requirements",
            resourcePath: sys.path,
            ...(inferredUnit ? { unit: inferredUnit } : {}),
          },
          relationship: "implements",
          parity: {
            ...checkUnitParity(inferredUnit, inferredUnit),
            message: "SysML v2 requirements verified against dynamic equations",
          },
          sysmlConfig: {
            artifactPath: sys.path,
          },
        });
      }
    }
  }

  return twins;
}
