// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Canonical ModelScript Port & Connector Type Compatibility API.
 *
 * Shared by both the 2D Diagram Editor (`packages/diagram/src/canvas-init.ts`)
 * and the 3D WebXR Spatial Diagram Editor (`packages/editor/src/workbench/vr-rotunda/`).
 *
 * Evaluates plug compatibility using ModelScript / Modelica / SysML v2 / SPICE
 * connector type semantics:
 *  1. Exact & paired physical connector types (e.g. `PositivePin` ↔ `NegativePin`,
 *     `Flange_a` ↔ `Flange_b`, `HeatPort_a` ↔ `HeatPort_b`, `FluidPort_a` ↔ `FluidPort_b`,
 *     `Frame_a` ↔ `Frame_b`, `RealInput` ↔ `RealOutput`, `BooleanInput` ↔ `BooleanOutput`,
 *     `IntegerInput` ↔ `IntegerOutput`).
 *  2. SysML v2 conjugated port matching (`isConjugated`).
 *  3. Physical domain compatibility (`electrical`, `power`, `mechanical`, `thermal`,
 *     `fluid`, `signal`, `systems`, `generic`) when connector FQNs are omitted.
 *  4. Causal directionality guards (rejecting `output → output` and `input → input`
 *     collisions on signal/causal ports).
 */

export type CanonicalPortDomain =
  "electrical" | "power" | "mechanical" | "thermal" | "fluid" | "signal" | "systems" | "generic";

export type CanonicalPortPolarity = "positive" | "negative" | "input" | "output" | "neutral";

export interface ModelScriptPortDescriptor {
  readonly nodeId: string;
  readonly portId: string;
  /** Optional Modelica / SysML2 / ModelScript connector FQN or type (e.g. `Modelica.Electrical.Analog.Interfaces.PositivePin`). */
  readonly connectorType?: string | undefined;
  /** Optional explicit physical domain. */
  readonly domain?: CanonicalPortDomain | string | undefined;
  /** Optional port direction / causality (`"in"`, `"out"`, `"inout"`, `"input"`, `"output"`, `"positive"`, `"negative"`). */
  readonly direction?: string | undefined;
  /** Optional SysML v2 conjugation flag (`~PortType`). */
  readonly isConjugated?: boolean | undefined;
  /** Optional owning component class name / FQN used as fallback domain context. */
  readonly nodeClassName?: string | undefined;
  /** Optional owning component label used as fallback domain context. */
  readonly nodeLabel?: string | undefined;
}

export interface ModelScriptPortCompatibilityOptions {
  /** Allow connecting two distinct ports on the same component (default: false). */
  readonly allowSameNode?: boolean | undefined;
  /** Optional language/dialect hint (`"modelica"`, `"sysml2"`, `"spice"`, etc.). */
  readonly languageId?: string | undefined;
}

export interface ModelScriptPortCompatibilityResult {
  readonly compatible: boolean;
  readonly reason?: string | undefined;
  readonly inferredSourceDomain: CanonicalPortDomain;
  readonly inferredTargetDomain: CanonicalPortDomain;
  readonly rule:
    | "self-port"
    | "same-node"
    | "connector-type-match"
    | "connector-type-mismatch"
    | "sysml2-conjugation-mismatch"
    | "causality-conflict"
    | "domain-match"
    | "domain-mismatch";
}

const DOMAIN_DISPLAY_LABELS: Record<CanonicalPortDomain, string> = {
  electrical: "Electrical",
  power: "Power Grid",
  mechanical: "Mechanical",
  thermal: "Thermal",
  fluid: "Fluid",
  signal: "Control Signal",
  systems: "Systems",
  generic: "Generic",
};

const VALID_DOMAINS = new Set<string>([
  "electrical",
  "power",
  "mechanical",
  "thermal",
  "fluid",
  "signal",
  "systems",
  "generic",
]);

/**
 * Normalizes a Modelica / ModelScript connector type FQN to its canonical
 * plug-compatibility family so complementary acausal connectors match
 * (e.g. `PositivePin` and `NegativePin` both map to `electrical:pin`,
 * `Flange_a` and `Flange_b` both map to `mechanical:flange`).
 */
export function normalizeConnectorTypeFamily(rawType: string | undefined): {
  family: string;
  polarity?: CanonicalPortPolarity;
  domain: CanonicalPortDomain;
} | null {
  if (!rawType) return null;
  const trimmed = rawType.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  const shortName = lower.split(".").pop() ?? lower;

  // Electrical pins & plugs
  if (shortName === "positivepin" || shortName === "negativepin" || shortName === "pin") {
    return {
      family: "electrical:pin",
      polarity: shortName === "positivepin" ? "positive" : shortName === "negativepin" ? "negative" : "neutral",
      domain: "electrical",
    };
  }
  if (shortName === "positiveplug" || shortName === "negativeplug" || shortName === "plug") {
    return {
      family: "electrical:plug",
      polarity: shortName === "positiveplug" ? "positive" : shortName === "negativeplug" ? "negative" : "neutral",
      domain: "power",
    };
  }
  if (shortName.includes("quasi") && shortName.includes("pin")) {
    return { family: "electrical:quasistatic-pin", domain: "power" };
  }

  // Mechanical rotational / translational / multibody
  if (shortName === "flange_a" || shortName === "flange_b" || shortName === "flange") {
    const isRot = lower.includes("rotational");
    const isTrans = lower.includes("translational");
    return {
      family: isRot
        ? "mechanical:rotational-flange"
        : isTrans
          ? "mechanical:translational-flange"
          : "mechanical:flange",
      polarity: shortName.endsWith("_a") ? "positive" : shortName.endsWith("_b") ? "negative" : "neutral",
      domain: "mechanical",
    };
  }
  if (shortName === "frame_a" || shortName === "frame_b" || shortName === "frame") {
    return {
      family: "mechanical:multibody-frame",
      polarity: shortName.endsWith("_a") ? "positive" : shortName.endsWith("_b") ? "negative" : "neutral",
      domain: "mechanical",
    };
  }

  // Thermal heat ports
  if (shortName === "heatport_a" || shortName === "heatport_b" || shortName === "heatport") {
    return {
      family: "thermal:heatport",
      polarity: shortName.endsWith("_a") ? "positive" : shortName.endsWith("_b") ? "negative" : "neutral",
      domain: "thermal",
    };
  }

  // Fluid ports
  if (shortName === "fluidport_a" || shortName === "fluidport_b" || shortName === "fluidport") {
    return {
      family: "fluid:fluidport",
      polarity: shortName.endsWith("_a") ? "positive" : shortName.endsWith("_b") ? "negative" : "neutral",
      domain: "fluid",
    };
  }

  // Causal signal connectors (Real / Boolean / Integer)
  if (shortName === "realinput" || shortName === "realoutput") {
    return {
      family: "signal:real",
      polarity: shortName === "realinput" ? "input" : "output",
      domain: "signal",
    };
  }
  if (shortName === "booleaninput" || shortName === "booleanoutput") {
    return {
      family: "signal:boolean",
      polarity: shortName === "booleaninput" ? "input" : "output",
      domain: "signal",
    };
  }
  if (shortName === "integerinput" || shortName === "integeroutput") {
    return {
      family: "signal:integer",
      polarity: shortName === "integerinput" ? "input" : "output",
      domain: "signal",
    };
  }

  return {
    family: `type:${shortName}`,
    domain: inferCanonicalPortDomain({ nodeId: "", portId: shortName, connectorType: trimmed }),
  };
}

/**
 * Infers the canonical physical domain of a port from its explicit domain,
 * connector type FQN, port identifier, or owning component class/label.
 */
export function inferCanonicalPortDomain(port: ModelScriptPortDescriptor): CanonicalPortDomain {
  if (port.domain && VALID_DOMAINS.has(port.domain)) {
    return port.domain as CanonicalPortDomain;
  }

  const hint =
    `${port.connectorType ?? ""} ${port.portId} ${port.nodeClassName ?? ""} ${port.nodeLabel ?? ""}`.toLowerCase();

  if (hint.includes("heatport") || hint.includes("thermal") || hint.includes("temperature") || hint.includes("heat")) {
    return "thermal";
  }
  if (
    hint.includes("fluidport") ||
    hint.includes("fluid") ||
    hint.includes("pump") ||
    hint.includes("valve") ||
    hint.includes("pipe") ||
    hint.includes("hydraulic") ||
    hint.includes("water")
  ) {
    return "fluid";
  }
  if (
    hint.includes("flange") ||
    hint.includes("frame_a") ||
    hint.includes("frame_b") ||
    hint.includes("mechanical") ||
    hint.includes("mechanics") ||
    hint.includes("inertia") ||
    hint.includes("spring") ||
    hint.includes("damper") ||
    hint.includes("gear") ||
    hint.includes("revolute") ||
    hint.includes("prismatic") ||
    hint.includes("robot") ||
    hint.includes("urdf")
  ) {
    return "mechanical";
  }
  if (
    hint.includes("grid") ||
    hint.includes("genrou") ||
    hint.includes("feeder") ||
    hint.includes("pscad") ||
    hint.includes("psse") ||
    hint.includes("bus") ||
    hint.includes("inverter") ||
    hint.includes("transformer")
  ) {
    return "power";
  }
  if (
    hint.includes("electrical") ||
    hint.includes("spice") ||
    hint.includes("resistor") ||
    hint.includes("capacitor") ||
    hint.includes("inductor") ||
    hint.includes("voltage") ||
    hint.includes("battery") ||
    hint.includes("current") ||
    hint.includes("diode") ||
    hint.includes("mosfet") ||
    hint.includes("bjt") ||
    hint.includes("opamp") ||
    hint.includes("ground") ||
    hint.includes("pin")
  ) {
    return "electrical";
  }
  if (
    hint.includes("realinput") ||
    hint.includes("realoutput") ||
    hint.includes("booleaninput") ||
    hint.includes("booleanoutput") ||
    hint.includes("integerinput") ||
    hint.includes("integeroutput") ||
    hint.includes("blocks.") ||
    hint.includes("pid") ||
    hint.includes("transfer") ||
    hint.includes("integrator") ||
    hint.includes("feedback") ||
    hint.includes("firstorder") ||
    hint.includes("signal") ||
    hint.includes("sensor") ||
    hint.includes("step")
  ) {
    return "signal";
  }
  if (hint.includes("sysml") || hint.includes("autosar") || hint.includes("requirement") || hint.includes("systems")) {
    return "systems";
  }
  return "generic";
}

function normalizePolarity(direction: string | undefined, fallback?: CanonicalPortPolarity): CanonicalPortPolarity {
  const d = (direction ?? "").trim().toLowerCase();
  if (d === "in" || d === "input") return "input";
  if (d === "out" || d === "output") return "output";
  if (d === "positive" || d === "pos") return "positive";
  if (d === "negative" || d === "neg") return "negative";
  return fallback ?? "neutral";
}

/**
 * Evaluates whether two diagram ports are type- and plug-compatible according to
 * ModelScript's unified connector semantics. Used identically by both the 2D
 * Diagram Editor and the 3D VR Spatial Diagram Editor.
 */
export function evaluateModelScriptPortCompatibility(
  source: ModelScriptPortDescriptor,
  target: ModelScriptPortDescriptor,
  options: ModelScriptPortCompatibilityOptions = {},
): ModelScriptPortCompatibilityResult {
  const allowSameNode = Boolean(options.allowSameNode);
  const srcNorm = normalizeConnectorTypeFamily(source.connectorType);
  const tgtNorm = normalizeConnectorTypeFamily(target.connectorType);

  const dA = srcNorm?.domain ?? inferCanonicalPortDomain(source);
  const dB = tgtNorm?.domain ?? inferCanonicalPortDomain(target);

  if (source.nodeId === target.nodeId && source.portId === target.portId) {
    return {
      compatible: false,
      reason: "Cannot connect a port to itself",
      inferredSourceDomain: dA,
      inferredTargetDomain: dB,
      rule: "self-port",
    };
  }

  if (!allowSameNode && source.nodeId === target.nodeId) {
    return {
      compatible: false,
      reason: "Same component",
      inferredSourceDomain: dA,
      inferredTargetDomain: dB,
      rule: "same-node",
    };
  }

  // 1. Explicit connector type comparison (Modelica / SysML2 / ModelScript)
  if (srcNorm && tgtNorm) {
    const familiesMatch =
      srcNorm.family === tgtNorm.family ||
      (srcNorm.family === "mechanical:flange" && tgtNorm.family.startsWith("mechanical:")) ||
      (tgtNorm.family === "mechanical:flange" && srcNorm.family.startsWith("mechanical:"));

    if (!familiesMatch) {
      return {
        compatible: false,
        reason: `Incompatible connector types: ${source.connectorType} ↔ ${target.connectorType}`,
        inferredSourceDomain: dA,
        inferredTargetDomain: dB,
        rule: "connector-type-mismatch",
      };
    }

    // SysML v2 conjugation guard when both ports explicitly specify conjugation on same custom port type
    if (
      options.languageId?.toLowerCase() === "sysml2" &&
      typeof source.isConjugated === "boolean" &&
      typeof target.isConjugated === "boolean" &&
      source.isConjugated === target.isConjugated &&
      srcNorm.family.startsWith("type:")
    ) {
      return {
        compatible: false,
        reason: "SysML v2 requires complementary conjugated (~) and non-conjugated ports",
        inferredSourceDomain: dA,
        inferredTargetDomain: dB,
        rule: "sysml2-conjugation-mismatch",
      };
    }

    // Causal signal connector direction check (RealInput/RealOutput, etc.)
    const polA = normalizePolarity(source.direction, srcNorm.polarity);
    const polB = normalizePolarity(target.direction, tgtNorm.polarity);
    if (dA === "signal" && dB === "signal") {
      if (polA === "output" && polB === "output") {
        return {
          compatible: false,
          reason: "Output → Output conflict",
          inferredSourceDomain: dA,
          inferredTargetDomain: dB,
          rule: "causality-conflict",
        };
      }
      if (polA === "input" && polB === "input") {
        return {
          compatible: false,
          reason: "Input → Input conflict",
          inferredSourceDomain: dA,
          inferredTargetDomain: dB,
          rule: "causality-conflict",
        };
      }
    }

    return {
      compatible: true,
      inferredSourceDomain: dA,
      inferredTargetDomain: dB,
      rule: "connector-type-match",
    };
  }

  // 2. Domain-level physical compatibility check when connector FQNs are absent
  const wildcard = dA === "generic" || dB === "generic" || dA === "systems" || dB === "systems";
  const elecPower = (dA === "electrical" && dB === "power") || (dA === "power" && dB === "electrical");

  if (!wildcard && dA !== dB && !elecPower) {
    return {
      compatible: false,
      reason: `Incompatible: ${DOMAIN_DISPLAY_LABELS[dA]} ↔ ${DOMAIN_DISPLAY_LABELS[dB]}`,
      inferredSourceDomain: dA,
      inferredTargetDomain: dB,
      rule: "domain-mismatch",
    };
  }

  // 3. Causal signal directionality check
  const polA = normalizePolarity(source.direction, srcNorm?.polarity);
  const polB = normalizePolarity(target.direction, tgtNorm?.polarity);
  if (dA === "signal" && dB === "signal") {
    if (polA === "output" && polB === "output") {
      return {
        compatible: false,
        reason: "Output → Output conflict",
        inferredSourceDomain: dA,
        inferredTargetDomain: dB,
        rule: "causality-conflict",
      };
    }
    if (polA === "input" && polB === "input") {
      return {
        compatible: false,
        reason: "Input → Input conflict",
        inferredSourceDomain: dA,
        inferredTargetDomain: dB,
        rule: "causality-conflict",
      };
    }
  }

  return {
    compatible: true,
    inferredSourceDomain: dA,
    inferredTargetDomain: dB,
    rule: "domain-match",
  };
}
