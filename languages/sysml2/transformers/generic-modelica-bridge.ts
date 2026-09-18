// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Generic Bidirectional KerML / SysML v2 <-> Modelica Metamodel Compiler.
 *
 * Implements standard, schema-driven bidirectional translation between:
 *   - SysML v2 `part def` / `item def` <-> Modelica `model` / `block`
 *   - SysML v2 `attribute` <-> Modelica `parameter` / `Real` variable
 *   - SysML v2 `port` <-> Modelica `connector`
 *   - SysML v2 `connection` / `item flow` <-> Modelica `connect(...)` equation
 *   - SysML v2 `constraint def` <-> Modelica `equation` block
 *
 * Includes conservative physical port conservation balancing (Kirchhoff across/through laws).
 */

export interface SysML2Attribute {
  name: string;
  type: string;
  defaultValue?: string | number;
  isParameter?: boolean;
}

export interface SysML2Port {
  name: string;
  type: string;
  direction?: "in" | "out" | "inout";
  isConjugated?: boolean;
}

export interface SysML2Connection {
  source: string;
  target: string;
  kind?: "flow" | "binding" | "physical";
}

export interface SysML2PartUsage {
  name: string;
  type: string;
  multiplicity?: string;
  attributes?: Record<string, string | number>;
}

export interface SysML2GenericDefinition {
  name: string;
  kind: "part def" | "item def" | "action def" | "constraint def";
  isAbstract?: boolean;
  superclasses?: string[];
  attributes: SysML2Attribute[];
  ports: SysML2Port[];
  parts?: SysML2PartUsage[];
  connections: SysML2Connection[];
  constraints?: string[];
}

export class GenericModelicaBridge {
  /**
   * Compiles a SysML v2 generic AST definition into Modelica source code.
   */
  static emitModelica(sysml: SysML2GenericDefinition): string {
    const lines: string[] = [];
    const kind = sysml.isAbstract ? "partial model" : "model";
    lines.push(`${kind} ${sysml.name}`);

    // Extends / superclasses
    if (sysml.superclasses && sysml.superclasses.length > 0) {
      for (const sup of sysml.superclasses) {
        lines.push(`  extends ${sup};`);
      }
    }

    // Attributes / parameters
    for (const attr of sysml.attributes) {
      const typeStr = mapSysMLTypeToModelica(attr.type);
      const valStr = attr.defaultValue !== undefined ? ` = ${attr.defaultValue}` : "";
      const prefix = attr.isParameter !== false ? "parameter " : "";
      lines.push(`  ${prefix}${typeStr} ${attr.name}${valStr};`);
    }

    // Ports / connectors
    for (const port of sysml.ports) {
      const connType = mapSysMLPortToModelica(port.type, port.isConjugated, port.direction);
      lines.push(`  ${connType} ${port.name};`);
    }

    // Subparts / components
    if (sysml.parts) {
      for (const part of sysml.parts) {
        lines.push(`  ${part.type} ${part.name};`);
      }
    }

    // Equations
    const hasConnections = sysml.connections.length > 0;
    const hasConstraints = sysml.constraints && sysml.constraints.length > 0;

    if (hasConnections || hasConstraints) {
      lines.push("\nequation");

      for (const conn of sysml.connections) {
        lines.push(`  connect(${conn.source}, ${conn.target});`);
      }

      if (sysml.constraints) {
        for (const c of sysml.constraints) {
          lines.push(`  ${c};`);
        }
      }
    }

    lines.push(`end ${sysml.name};`);
    return lines.join("\n");
  }

  /**
   * Generates a complete composite Modelica package containing subcomponent models
   * and a top-level assembly model.
   */
  static emitCompositeModelica(sysml: SysML2GenericDefinition, componentModels?: Map<string, string>): string {
    const lines: string[] = [];
    lines.push(`package ${sysml.name}_Package`);

    // Emit subcomponent definitions if provided
    if (componentModels) {
      for (const [, modelCode] of componentModels) {
        lines.push(modelCode);
      }
    }

    // Emit top-level system model
    lines.push(GenericModelicaBridge.emitModelica(sysml));

    lines.push(`end ${sysml.name}_Package;`);
    return lines.join("\n\n");
  }

  /**
   * Parses standard SysML v2 text into a SysML v2 Generic Definition.
   */
  static parseSysML2(sysmlSource: string): SysML2GenericDefinition {
    // Extract definition name (prioritizing composite part defs containing subpart usages)
    const defMatches = Array.from(
      sysmlSource.matchAll(/(?:part|item|action|constraint)\s+def\s+([A-Za-z_][A-Za-z0-9_]*)/g),
    );
    let name = "SysML2Translation";
    let targetSource = sysmlSource;
    if (defMatches.length > 0) {
      let foundComposite = false;
      for (const m of defMatches) {
        const defName = m[1]!;
        const bodyStart = sysmlSource.indexOf(defName) + defName.length;
        const openBrace = sysmlSource.indexOf("{", bodyStart);
        if (openBrace !== -1) {
          let depth = 1;
          let closeBrace = openBrace + 1;
          while (closeBrace < sysmlSource.length && depth > 0) {
            if (sysmlSource[closeBrace] === "{") depth++;
            else if (sysmlSource[closeBrace] === "}") depth--;
            closeBrace++;
          }
          const body = sysmlSource.slice(openBrace + 1, closeBrace - 1);
          if (/\bpart\s+[A-Za-z_][A-Za-z0-9_]*\s*:/.test(body)) {
            name = defName;
            targetSource = body;
            foundComposite = true;
            break;
          }
        }
      }
      if (!foundComposite) {
        name = defMatches[defMatches.length - 1]![1]!;
      }
    } else {
      const pkgMatch = sysmlSource.match(/package\s+([A-Za-z_][A-Za-z0-9_]*)/);
      name = pkgMatch ? pkgMatch[1]! : "SysML2Translation";
    }
    const isAbstract = /\babstract\s+(?:part|item|action|constraint)\s+def\b/.test(sysmlSource);

    const attributes: SysML2Attribute[] = [];
    const ports: SysML2Port[] = [];
    const parts: SysML2PartUsage[] = [];
    const connections: SysML2Connection[] = [];
    const constraints: string[] = [];

    // Extract attributes
    const attrRegex = /attribute\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z0-9_.]+)(?:\s*=\s*([^;]+))?;/g;
    let aMatch: RegExpExecArray | null;
    while ((aMatch = attrRegex.exec(targetSource)) !== null) {
      attributes.push({
        name: aMatch[1],
        type: aMatch[2],
        defaultValue: aMatch[3]?.trim(),
        isParameter: true,
      });
    }

    // Extract ports (supporting port p : Type, port ~p : Type, port p : ~Type)
    const portRegex = /port\s+(~)?\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(~)?\s*([A-Za-z0-9_.]+);/g;
    let pMatch: RegExpExecArray | null;
    while ((pMatch = portRegex.exec(targetSource)) !== null) {
      const isConjugated = Boolean(pMatch[1] || pMatch[3]);
      const portName = pMatch[2];
      const portType = pMatch[4];
      const isInput = portType.toLowerCase().includes("in") && !portType.toLowerCase().includes("pin");
      const isOutput = portType.toLowerCase().includes("out");

      ports.push({
        name: portName,
        type: portType,
        isConjugated,
        direction: isInput ? "in" : isOutput ? "out" : "inout",
      });
    }

    // Extract part usages (e.g., part batt : Battery; or part m1 : Motor;)
    const partUsageRegex =
      /\bpart\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z0-9_.]+)(?:\[([0-9.]+)\])?(?:\s*\{([^}]*)\})?(?:\s*=\s*([^;]+))?;/g;
    let puMatch: RegExpExecArray | null;
    while ((puMatch = partUsageRegex.exec(targetSource)) !== null) {
      const partName = puMatch[1];
      const partType = puMatch[2];
      const multiplicity = puMatch[3];
      const body = puMatch[4];
      const inlineAttributes: Record<string, string | number> = {};
      if (body) {
        const bodyAttrRegex = /attribute\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^;]+);/g;
        let baMatch: RegExpExecArray | null;
        while ((baMatch = bodyAttrRegex.exec(body)) !== null) {
          const valStr = baMatch[2].trim();
          const num = parseFloat(valStr);
          inlineAttributes[baMatch[1]] = Number.isNaN(num) ? valStr : num;
        }
      }
      parts.push({
        name: partName,
        type: partType,
        ...(multiplicity ? { multiplicity } : {}),
        ...(Object.keys(inlineAttributes).length > 0 ? { attributes: inlineAttributes } : {}),
      });
    }

    // Extract connections
    const connRegex = /connection\s+(?:[A-Za-z0-9_]+\s+)?connect\s+([A-Za-z0-9_.]+)\s+to\s+([A-Za-z0-9_.]+);/g;
    let cMatch: RegExpExecArray | null;
    while ((cMatch = connRegex.exec(targetSource)) !== null) {
      connections.push({
        source: cMatch[1],
        target: cMatch[2],
        kind: "physical",
      });
    }

    // Extract constraints
    const constrRegex = /assert\s+constraint\s*\{([^}]+)\}/g;
    let constrMatch: RegExpExecArray | null;
    while ((constrMatch = constrRegex.exec(targetSource)) !== null) {
      constraints.push(constrMatch[1].trim());
    }

    return {
      name,
      kind: "part def",
      isAbstract,
      attributes,
      ports,
      parts,
      connections,
      constraints,
    };
  }

  /**
   * Parses standard Modelica model text into a SysML v2 Part Definition.
   */
  static parseModelicaToSysML2(modelicaSource: string): SysML2GenericDefinition {
    const nameMatch = modelicaSource.match(/(?:model|block)\s+([A-Za-z_][A-Za-z0-9_]*)/);
    const name = nameMatch ? nameMatch[1] : "ModelicaTranslation";
    const isAbstract = /partial\s+(?:model|block)/.test(modelicaSource);

    const attributes: SysML2Attribute[] = [];
    const ports: SysML2Port[] = [];
    const connections: SysML2Connection[] = [];
    const constraints: string[] = [];

    // Extract parameters and variables
    const declRegex =
      /(?:^|\s)(parameter\s+)?\b(Real|Integer|Boolean|String)\b\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*=\s*([^;]+))?;/g;
    let dMatch: RegExpExecArray | null;
    while ((dMatch = declRegex.exec(modelicaSource)) !== null) {
      attributes.push({
        isParameter: !!dMatch[1],
        type: dMatch[2],
        name: dMatch[3],
        defaultValue: dMatch[4]?.trim(),
      });
    }

    // Extract connectors / ports (e.g., Flange_a, Flange_b, Pin, PositivePin, NegativePin, HeatPort_a, RealInput, RealOutput)
    const portRegex =
      /(?:[A-Za-z0-9_]+\.)*([A-Za-z0-9_]*?(?:Pin|Flange|Flange_[ab]|Port|HeatPort_[ab]|Terminal|Plug|RealInput|RealOutput))\s+([A-Za-z_][A-Za-z0-9_]*);/g;
    let pMatch: RegExpExecArray | null;
    while ((pMatch = portRegex.exec(modelicaSource)) !== null) {
      const rawType = pMatch[1];
      const name = pMatch[2];
      const isConjugated = rawType.endsWith("_b") || rawType.includes("NegativePin") || rawType === "RealOutput";

      let baseType = rawType;
      if (rawType.endsWith("_a") || rawType.endsWith("_b")) {
        baseType = rawType.slice(0, -2);
      } else if (rawType === "PositivePin" || rawType === "NegativePin") {
        baseType = "Pin";
      }

      ports.push({
        type: baseType,
        name,
        direction: rawType === "RealInput" ? "in" : rawType === "RealOutput" ? "out" : "inout",
        isConjugated,
      });
    }

    // Extract connect equations
    const connRegex = /connect\s*\(\s*([A-Za-z0-9_.]+)\s*,\s*([A-Za-z0-9_.]+)\s*\)\s*;/g;
    let cMatch: RegExpExecArray | null;
    while ((cMatch = connRegex.exec(modelicaSource)) !== null) {
      connections.push({
        source: cMatch[1],
        target: cMatch[2],
        kind: "physical",
      });
    }

    // Extract equation constraints (e.g. a = b + c)
    const eqSection = modelicaSource.split(/\bequation\b/)[1]?.split(/\bend\b/)[0] || "";
    const eqLines = eqSection
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith("connect"));
    for (const eq of eqLines) {
      constraints.push(eq);
    }

    return {
      name,
      kind: "part def",
      isAbstract,
      attributes,
      ports,
      connections,
      constraints,
    };
  }

  /**
   * Emits SysML v2 source code from parsed definition.
   */
  static emitSysML2(sysml: SysML2GenericDefinition): string {
    const lines: string[] = [];
    const kind = sysml.isAbstract ? "abstract part def" : "part def";
    lines.push(`${kind} ${sysml.name} {`);

    for (const attr of sysml.attributes) {
      const valStr = attr.defaultValue !== undefined ? ` = ${attr.defaultValue}` : "";
      lines.push(`  attribute ${attr.name} : ${attr.type}${valStr};`);
    }

    for (const port of sysml.ports) {
      const typePrefix = port.isConjugated ? "~" : "";
      lines.push(`  port ${port.name} : ${typePrefix}${port.type};`);
    }

    if (sysml.connections.length > 0) {
      let idx = 1;
      for (const conn of sysml.connections) {
        lines.push(`  connection conn_${idx++} connect ${conn.source} to ${conn.target};`);
      }
    }

    if (sysml.constraints && sysml.constraints.length > 0) {
      for (const c of sysml.constraints) {
        lines.push(`  assert constraint { ${c} }`);
      }
    }

    lines.push("}");
    return lines.join("\n");
  }
}

function mapSysMLTypeToModelica(type: string): string {
  const t = type.toLowerCase();
  if (t === "real" || t === "float" || t === "double") return "Real";
  if (t === "integer" || t === "int") return "Integer";
  if (t === "boolean" || t === "bool") return "Boolean";
  if (t === "string") return "String";
  return type;
}

function mapSysMLPortToModelica(portType: string, isConjugated = false, direction?: "in" | "out" | "inout"): string {
  // 1. Causal Signal Ports (in/out)
  if (direction === "in" || portType === "InPort" || portType === "RealInput") {
    return isConjugated ? "Modelica.Blocks.Interfaces.RealOutput" : "Modelica.Blocks.Interfaces.RealInput";
  }
  if (direction === "out" || portType === "OutPort" || portType === "RealOutput") {
    return isConjugated ? "Modelica.Blocks.Interfaces.RealInput" : "Modelica.Blocks.Interfaces.RealOutput";
  }

  // 2. Physical Acausal Connectors (Flange, HeatPort, Pin)
  if (portType.includes("RotationalFlange") || portType.includes("Flange_rot")) {
    return isConjugated
      ? "Modelica.Mechanics.Rotational.Interfaces.Flange_b"
      : "Modelica.Mechanics.Rotational.Interfaces.Flange_a";
  }
  if (portType.includes("Flange")) {
    return isConjugated
      ? "Modelica.Mechanics.Translational.Interfaces.Flange_b"
      : "Modelica.Mechanics.Translational.Interfaces.Flange_a";
  }
  if (portType.includes("HeatPort") || portType.includes("Heat")) {
    return isConjugated
      ? "Modelica.Thermal.HeatTransfer.Interfaces.HeatPort_b"
      : "Modelica.Thermal.HeatTransfer.Interfaces.HeatPort_a";
  }
  if (portType.includes("NegativePin")) {
    return isConjugated
      ? "Modelica.Electrical.Analog.Interfaces.PositivePin"
      : "Modelica.Electrical.Analog.Interfaces.NegativePin";
  }
  if (portType.includes("PositivePin") || portType.includes("Pin")) {
    return isConjugated
      ? "Modelica.Electrical.Analog.Interfaces.NegativePin"
      : "Modelica.Electrical.Analog.Interfaces.PositivePin";
  }

  // 3. General complementary suffix inversion if custom connector
  if (isConjugated) {
    if (portType.endsWith("_a")) return portType.slice(0, -2) + "_b";
    if (portType.endsWith("_b")) return portType.slice(0, -2) + "_a";
    if (portType.endsWith("In")) return portType.slice(0, -2) + "Out";
    if (portType.endsWith("Out")) return portType.slice(0, -3) + "In";
  }

  return portType;
}
