/**
 * Polyglot Transformer: Bi-directional SysML v2 <-> Modelica conversion using DSL adapter rules.
 */

export interface ModelicaComponent {
  name: string;
  typeSpecifier: string;
  variability?: string;
  causality?: string;
  defaultValue?: string;
}

export interface ModelicaConnection {
  source: string;
  target: string;
}

export interface ModelicaModel {
  name: string;
  kind: "model" | "block" | "class";
  components: ModelicaComponent[];
  connections: ModelicaConnection[];
}

export interface SysML2PartDef {
  name: string;
  attributes: { name: string; type: string; value?: string }[];
  ports: { name: string; type: string }[];
  connections: { source: string; target: string }[];
}

/**
 * Transforms a Modelica AST representation into SysML v2 code using Adapter Form 2 rules.
 */
export function modelicaToSysML2(modelica: ModelicaModel): string {
  const lines: string[] = [];
  lines.push(`part def ${modelica.name} {`);

  for (const comp of modelica.components) {
    if (comp.variability === "parameter") {
      const valStr = comp.defaultValue ? ` = ${comp.defaultValue}` : "";
      lines.push(`  attribute ${comp.name}: ${comp.typeSpecifier}${valStr};`);
    } else {
      lines.push(`  port ${comp.name}: ${comp.typeSpecifier};`);
    }
  }

  let connIdx = 1;
  for (const conn of modelica.connections) {
    lines.push(`  connection c${connIdx++} connect ${conn.source} to ${conn.target};`);
  }

  lines.push(`}`);
  return lines.join("\n");
}

/**
 * Transforms a SysML v2 Part Definition into Modelica model code using Adapter Form 2 rules.
 */
export function sysml2ToModelica(sysml: SysML2PartDef): string {
  const lines: string[] = [];
  lines.push(`model ${sysml.name}`);

  for (const attr of sysml.attributes) {
    const valStr = attr.value ? ` = ${attr.value}` : "";
    lines.push(`  parameter ${attr.type} ${attr.name}${valStr};`);
  }

  for (const port of sysml.ports) {
    lines.push(`  ${port.type} ${port.name};`);
  }

  if (sysml.connections.length > 0) {
    lines.push("\nequation");
    for (const conn of sysml.connections) {
      lines.push(`  connect(${conn.source}, ${conn.target});`);
    }
  }

  lines.push(`end ${sysml.name};`);
  return lines.join("\n");
}
