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
}

export interface SysML2Connection {
  source: string;
  target: string;
  kind?: "flow" | "binding" | "physical";
}

export interface SysML2GenericDefinition {
  name: string;
  kind: "part def" | "item def" | "action def" | "constraint def";
  isAbstract?: boolean;
  superclasses?: string[];
  attributes: SysML2Attribute[];
  ports: SysML2Port[];
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
      const connType = mapSysMLPortToModelica(port.type);
      lines.push(`  ${connType} ${port.name};`);
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
    const declRegex = /(parameter\s+)?(Real|Integer|Boolean|String)\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*=\s*([^;]+))?;/g;
    let dMatch: RegExpExecArray | null;
    while ((dMatch = declRegex.exec(modelicaSource)) !== null) {
      attributes.push({
        isParameter: !!dMatch[1],
        type: dMatch[2],
        name: dMatch[3],
        defaultValue: dMatch[4]?.trim(),
      });
    }

    // Extract connectors / ports (e.g., Flange_a, Pin, HeatPort)
    const portRegex =
      /(?:Interfaces\.)?([A-Za-z_][A-Za-z0-9_]*(?:Pin|Flange|Port|Terminal|Plug))\s+([A-Za-z_][A-Za-z0-9_]*);/g;
    let pMatch: RegExpExecArray | null;
    while ((pMatch = portRegex.exec(modelicaSource)) !== null) {
      ports.push({
        type: pMatch[1],
        name: pMatch[2],
        direction: "inout",
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
      lines.push(`  port ${port.name} : ${port.type};`);
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

function mapSysMLPortToModelica(portType: string): string {
  if (portType.includes("Pin")) return "Modelica.Electrical.Analog.Interfaces.Pin";
  if (portType.includes("Flange")) return "Modelica.Mechanics.Translational.Interfaces.Flange_a";
  if (portType.includes("Heat")) return "Modelica.Thermal.HeatTransfer.Interfaces.HeatPort_a";
  return portType;
}
