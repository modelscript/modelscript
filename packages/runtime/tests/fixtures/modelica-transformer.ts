/**
 * SysML v2 to Modelica AST Transformation and Code Generation (Test Fixture).
 */

export interface SysML2PartDef {
  name: string;
  isAbstract?: boolean;
  superclasses?: string[];
  attributes: { name: string; type: string; value?: string; isInherited?: boolean }[];
  ports: { name: string; type: string; isInherited?: boolean }[];
  connections: { source: string; target: string }[];
}

export interface ReasonerFeatureProvider {
  getInferredFeatures?: (className: string) => { name: string; type: string }[];
}

export function emitModelica(sysml: SysML2PartDef, provider?: ReasonerFeatureProvider): string {
  const lines: string[] = [];
  const kind = sysml.isAbstract ? "partial model" : "model";
  lines.push(`${kind} ${sysml.name}`);

  if (sysml.superclasses && sysml.superclasses.length > 0) {
    for (const sup of sysml.superclasses) {
      lines.push(`  extends ${sup};`);
    }
  }

  for (const attr of sysml.attributes) {
    const valStr = attr.value ? ` = ${attr.value}` : "";
    lines.push(`  parameter ${attr.type} ${attr.name}${valStr};`);
  }

  for (const port of sysml.ports) {
    lines.push(`  ${port.type} ${port.name};`);
  }

  const inferred = provider?.getInferredFeatures ? provider.getInferredFeatures(sysml.name) : [];
  for (const feat of inferred) {
    if (!sysml.attributes.some((a) => a.name === feat.name) && !sysml.ports.some((p) => p.name === feat.name)) {
      lines.push(`  parameter ${feat.type} ${feat.name}; // inferred`);
    }
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

export function sysml2ToModelica(sysml: SysML2PartDef, provider?: ReasonerFeatureProvider): string {
  return emitModelica(sysml, provider);
}
