/**
 * Modelica to SysML v2 AST Transformation and Code Generation (Test Fixture).
 */

export interface ModelicaComponent {
  name: string;
  typeSpecifier: string;
  variability?: string;
  causality?: string;
  defaultValue?: string;
  isInherited?: boolean;
}

export interface ModelicaConnection {
  source: string;
  target: string;
}

export interface ModelicaModel {
  name: string;
  kind?: "model" | "block" | "class";
  isPartial?: boolean;
  extends?: string[];
  components: ModelicaComponent[];
  connections: ModelicaConnection[];
}

export interface ReasonerFeatureProvider {
  getInferredFeatures?: (className: string) => { name: string; type: string }[];
}

export function emitSysML2(modelica: ModelicaModel, provider?: ReasonerFeatureProvider): string {
  const lines: string[] = [];
  const prefix = modelica.isPartial ? "abstract " : "";
  const extendsStr = modelica.extends && modelica.extends.length > 0 ? ` extends ${modelica.extends.join(", ")}` : "";
  lines.push(`${prefix}part def ${modelica.name}${extendsStr} {`);

  for (const comp of modelica.components) {
    if (comp.variability === "parameter") {
      const valStr = comp.defaultValue ? ` = ${comp.defaultValue}` : "";
      lines.push(`  attribute ${comp.name}: ${comp.typeSpecifier}${valStr};`);
    } else {
      lines.push(`  port ${comp.name}: ${comp.typeSpecifier};`);
    }
  }

  const inferred = provider?.getInferredFeatures ? provider.getInferredFeatures(modelica.name) : [];
  for (const feat of inferred) {
    if (!modelica.components.some((c) => c.name === feat.name)) {
      lines.push(`  attribute ${feat.name}: ${feat.type}; // inferred from base`);
    }
  }

  let connIdx = 1;
  for (const conn of modelica.connections) {
    lines.push(`  connection c${connIdx++} connect ${conn.source} to ${conn.target};`);
  }

  lines.push(`}`);
  return lines.join("\n");
}

export function modelicaToSysML2(modelica: ModelicaModel, provider?: ReasonerFeatureProvider): string {
  return emitSysML2(modelica, provider);
}
