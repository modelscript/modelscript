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

export type DiagramPortFlowKind = "potential" | "flow" | "stream" | "signal";

export type DiagramPortDirection = "in" | "out" | "inout";

export interface DiagramPortVariable {
  /** Variable name within the connector (e.g. `v`, `i`, `T`, `Q_flow`, or `value` for primitive connectors). */
  readonly name: string;
  /** Canonical base type (`Real`, `Integer`, `Boolean`, `String`, or enum/custom type name). */
  readonly type: string;
  /** Flow category (`potential`, `flow`, `stream`, or `signal`). */
  readonly flowKind: DiagramPortFlowKind;
  /** Causal direction (`in`, `out`, or `inout`). */
  readonly direction: DiagramPortDirection;
  /** Optional array dimensions (e.g. `["3"]`, `["m"]`). Omitted for scalars. */
  readonly dims?: readonly string[] | undefined;
}

export interface DiagramPortSignature {
  /** True for Modelica `expandable connector` (bus) ports. */
  readonly isExpandable?: boolean | undefined;
  /** True when the port is an inside connector declared directly on the enclosing model (Modelica §9.3). */
  readonly isInsideConnector?: boolean | undefined;
  /** Optional outer connector array dimensions (e.g. `PositivePin p[3]` -> `["3"]`). */
  readonly dims?: readonly string[] | undefined;
  /** Optional instance-level redeclared packages (e.g. `{ Medium: "Modelica.Media.Water.StandardWater" }`). */
  readonly redeclarePackages?: Readonly<Record<string, string>> | undefined;
  /** Flattened leaf variables of the connector (with nested sub-connectors expanded). */
  readonly variables: readonly DiagramPortVariable[];
}

export interface ModelScriptPortDescriptor {
  readonly nodeId: string;
  readonly portId: string;
  /** Optional Modelica / SysML2 / ModelScript connector FQN or type (e.g. `Modelica.Electrical.Analog.Interfaces.PositivePin`). */
  readonly connectorType?: string | undefined;
  /** Optional resolved structural connector signature for full Modelica §9.3 plug-compatibility checking. */
  readonly portSignature?: DiagramPortSignature | undefined;
  /** Optional flag indicating an inside connector on the enclosing model (flips causal direction matching vs outside component ports). */
  readonly isInsideConnector?: boolean | undefined;
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
    | "structural-signature-match"
    | "structural-signature-mismatch"
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

function normalizeStructuralBaseType(rawType: string): string {
  const trimmed = rawType.trim();
  if (!trimmed) return "";
  const lower = trimmed.toLowerCase();
  const leaf = lower.split(".").pop() ?? lower;
  if (leaf === "real" || leaf === "float" || leaf === "double") return "real";
  if (leaf === "integer" || leaf === "int") return "integer";
  if (leaf === "boolean" || leaf === "bool") return "boolean";
  if (leaf === "string") return "string";
  return leaf;
}

function areConcreteDimsCompatible(a?: readonly string[] | undefined, b?: readonly string[] | undefined): boolean {
  if (!a?.length || !b?.length) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const da = a[i]!.trim();
    const db = b[i]!.trim();
    if (!da || !db || da === ":" || db === ":") continue;
    const na = /^\d+$/.test(da) ? Number(da) : NaN;
    const nb = /^\d+$/.test(db) ? Number(db) : NaN;
    if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) {
      return false;
    }
  }
  return true;
}

function areDirectionsConnectable(a: DiagramPortDirection, b: DiagramPortDirection, sameSide = true): boolean {
  if (a === "inout" || b === "inout") return true;
  return sameSide ? a !== b : a === b;
}

function causalityConflictReason(a: DiagramPortDirection, sameSide: boolean, varName?: string): string {
  const suffix = varName ? ` on '${varName}'` : "";
  if (sameSide) {
    return a === "out" ? `Output → Output conflict${suffix}` : `Input → Input conflict${suffix}`;
  }
  return a === "in"
    ? `Inside/outside causality mismatch (Input ↔ Output)${suffix}`
    : `Inside/outside causality mismatch (Output ↔ Input)${suffix}`;
}

/**
 * Evaluates full Modelica §9.3 structural plug-compatibility between two resolved
 * `DiagramPortSignature` payloads (variable names, flow/stream/potential/signal
 * prefixes, canonical base types, causal directions, array dimensions, and
 * expandable bus connectors).
 *
 * Returns `null` if neither port is expandable and at least one side has no
 * resolved variables (allowing callers to fall back to connector-family / domain checks).
 */
export function evaluateStructuralPortSignatureCompatibility(
  source: DiagramPortSignature | undefined,
  target: DiagramPortSignature | undefined,
  inferredSourceDomain: CanonicalPortDomain,
  inferredTargetDomain: CanonicalPortDomain,
  sameSide = Boolean(source?.isInsideConnector) === Boolean(target?.isInsideConnector),
): ModelScriptPortCompatibilityResult | null {
  if (!source && !target) return null;

  // Modelica §9.1.3: expandable (bus) connectors accept connections with any connector/signal.
  if (source?.isExpandable || target?.isExpandable) {
    return {
      compatible: true,
      inferredSourceDomain,
      inferredTargetDomain,
      rule: "structural-signature-match",
    };
  }

  if (!source || !target) return null;
  if (source.variables.length === 0 || target.variables.length === 0) return null;

  // Check outer connector array dimensions when both sides have explicit concrete sizes.
  if (!areConcreteDimsCompatible(source.dims, target.dims)) {
    return {
      compatible: false,
      reason: `Connector array dimension mismatch: [${source.dims?.join(", ")}] ↔ [${target.dims?.join(", ")}]`,
      inferredSourceDomain,
      inferredTargetDomain,
      rule: "structural-signature-mismatch",
    };
  }

  // Check instance-level redeclared packages (e.g. Modelica.Fluid `redeclare package Medium = ...`)
  if (source.redeclarePackages && target.redeclarePackages) {
    for (const [pkgKey, srcPkgRaw] of Object.entries(source.redeclarePackages)) {
      const tgtPkgRaw = target.redeclarePackages[pkgKey];
      if (!srcPkgRaw || !tgtPkgRaw) continue;
      const srcNormPkg = srcPkgRaw.trim().toLowerCase();
      const tgtNormPkg = tgtPkgRaw.trim().toLowerCase();
      if (!srcNormPkg || !tgtNormPkg) continue;
      if (srcNormPkg.includes("partialmedium") || tgtNormPkg.includes("partialmedium")) continue;
      const srcLeaf = srcNormPkg.split(".").pop() ?? srcNormPkg;
      const tgtLeaf = tgtNormPkg.split(".").pop() ?? tgtNormPkg;
      if (srcNormPkg !== tgtNormPkg && srcLeaf !== tgtLeaf) {
        return {
          compatible: false,
          reason: `Incompatible ${pkgKey}: ${srcPkgRaw.split(".").pop() ?? srcPkgRaw} ↔ ${tgtPkgRaw.split(".").pop() ?? tgtPkgRaw}`,
          inferredSourceDomain,
          inferredTargetDomain,
          rule: "structural-signature-mismatch",
        };
      }
    }
  }

  // Single-variable causal primitive connectors (e.g. RealInput ↔ RealOutput, BooleanInput ↔ BooleanOutput)
  if (
    source.variables.length === 1 &&
    target.variables.length === 1 &&
    source.variables[0]!.flowKind === "signal" &&
    target.variables[0]!.flowKind === "signal"
  ) {
    const lv = source.variables[0]!;
    const rv = target.variables[0]!;
    const lt = normalizeStructuralBaseType(lv.type);
    const rt = normalizeStructuralBaseType(rv.type);
    if (lt && rt && lt !== rt) {
      return {
        compatible: false,
        reason: `Signal type mismatch: ${lv.type} ↔ ${rv.type}`,
        inferredSourceDomain,
        inferredTargetDomain,
        rule: "structural-signature-mismatch",
      };
    }
    if (!areDirectionsConnectable(lv.direction, rv.direction, sameSide)) {
      return {
        compatible: false,
        reason: causalityConflictReason(lv.direction, sameSide),
        inferredSourceDomain,
        inferredTargetDomain,
        rule: "causality-conflict",
      };
    }
    if (!areConcreteDimsCompatible(lv.dims, rv.dims)) {
      return {
        compatible: false,
        reason: `Signal dimension mismatch: [${lv.dims?.join(", ")}] ↔ [${rv.dims?.join(", ")}]`,
        inferredSourceDomain,
        inferredTargetDomain,
        rule: "structural-signature-mismatch",
      };
    }
    return {
      compatible: true,
      inferredSourceDomain,
      inferredTargetDomain,
      rule: "structural-signature-match",
    };
  }

  // Structured connectors (Modelica §9.3): identical variable set (name, flow/stream prefix, base type, causality, dims)
  if (source.variables.length !== target.variables.length) {
    return {
      compatible: false,
      reason: `Incompatible connector structure: ${source.variables.length} variables ↔ ${target.variables.length} variables`,
      inferredSourceDomain,
      inferredTargetDomain,
      rule: "structural-signature-mismatch",
    };
  }

  const rhsByName = new Map(target.variables.map((v) => [v.name, v]));
  for (const lv of source.variables) {
    const rv = rhsByName.get(lv.name);
    if (!rv) {
      return {
        compatible: false,
        reason: `Connector variable '${lv.name}' has no matching counterpart`,
        inferredSourceDomain,
        inferredTargetDomain,
        rule: "structural-signature-mismatch",
      };
    }
    if (lv.flowKind !== rv.flowKind) {
      return {
        compatible: false,
        reason: `Flow/stream prefix mismatch on '${lv.name}': ${lv.flowKind} ↔ ${rv.flowKind}`,
        inferredSourceDomain,
        inferredTargetDomain,
        rule: "structural-signature-mismatch",
      };
    }
    const lt = normalizeStructuralBaseType(lv.type);
    const rt = normalizeStructuralBaseType(rv.type);
    if (lt && rt && lt !== rt) {
      return {
        compatible: false,
        reason: `Variable type mismatch on '${lv.name}': ${lv.type} ↔ ${rv.type}`,
        inferredSourceDomain,
        inferredTargetDomain,
        rule: "structural-signature-mismatch",
      };
    }
    if (!areDirectionsConnectable(lv.direction, rv.direction, sameSide)) {
      return {
        compatible: false,
        reason: causalityConflictReason(lv.direction, sameSide, lv.name),
        inferredSourceDomain,
        inferredTargetDomain,
        rule: "causality-conflict",
      };
    }
    if (!areConcreteDimsCompatible(lv.dims, rv.dims)) {
      return {
        compatible: false,
        reason: `Dimension mismatch on '${lv.name}': [${lv.dims?.join(", ")}] ↔ [${rv.dims?.join(", ")}]`,
        inferredSourceDomain,
        inferredTargetDomain,
        rule: "structural-signature-mismatch",
      };
    }
  }

  return {
    compatible: true,
    inferredSourceDomain,
    inferredTargetDomain,
    rule: "structural-signature-match",
  };
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

  // 0. Full structural plug-compatibility when resolved connector signatures are present
  const srcInside = Boolean(source.isInsideConnector ?? source.portSignature?.isInsideConnector);
  const tgtInside = Boolean(target.isInsideConnector ?? target.portSignature?.isInsideConnector);
  const sameSide = srcInside === tgtInside;

  const structuralResult = evaluateStructuralPortSignatureCompatibility(
    source.portSignature,
    target.portSignature,
    dA,
    dB,
    sameSide,
  );
  if (structuralResult) {
    return structuralResult;
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

    // SysML v1/v2 / MagicDraw conjugation guard when both ports explicitly specify conjugation on same custom port type
    const langLower = options.languageId?.toLowerCase() ?? "";
    if (
      (langLower === "sysml2" || langLower === "sysml" || langLower === "magicdraw") &&
      typeof source.isConjugated === "boolean" &&
      typeof target.isConjugated === "boolean" &&
      source.isConjugated === target.isConjugated &&
      srcNorm.family.startsWith("type:")
    ) {
      return {
        compatible: false,
        reason: "SysML requires complementary conjugated (~) and non-conjugated ports",
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
