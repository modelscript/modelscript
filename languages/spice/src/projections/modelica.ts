// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/spice — Bidirectional SPICE <-> Modelica 3.x Projection.
 *
 * Translates SPICE netlists into idiomatic Modelica physical models using the
 * standard Modelica.Electrical.Analog library, and reconstructs SPICE netlists
 * from Modelica electrical schemas.
 */

import { flattenSpiceCircuit } from "../solvers/mna.js";
import type { SpiceCircuit, SpiceComponent } from "../types.js";

/**
 * Projects a SPICE circuit into Modelica 3.x source code.
 */
export function spiceToModelica(circuit: SpiceCircuit, modelName?: string): string {
  const name = modelName ?? sanitizeIdentifier(circuit.title || "SpiceModel");
  const components = flattenSpiceCircuit(circuit);

  const decls: string[] = [];
  const connects: string[] = [];

  // Ground declaration
  decls.push("  Modelica.Electrical.Analog.Basic.Ground ground;");

  // Track electrical nodes and which component pins attach to each node
  // node -> Array of pin strings like "R1.p", "C1.n", "V1.p"
  const nodePins = new Map<string, string[]>();
  const addPin = (node: string, pin: string) => {
    const norm = node.toUpperCase();
    const list = nodePins.get(norm) ?? [];
    list.push(pin);
    nodePins.set(norm, list);
  };

  for (const comp of components) {
    const cName = sanitizeIdentifier(comp.name);
    const n1 = comp.nodes[0] ?? "";
    const n2 = comp.nodes[1] ?? "";

    switch (comp.kind) {
      case "R": {
        const val = comp.value ?? 1e3;
        decls.push(`  Modelica.Electrical.Analog.Basic.Resistor ${cName}(R=${val});`);
        addPin(n1, `${cName}.p`);
        addPin(n2, `${cName}.n`);
        break;
      }
      case "C": {
        const val = comp.value ?? 1e-9;
        decls.push(`  Modelica.Electrical.Analog.Basic.Capacitor ${cName}(C=${val});`);
        addPin(n1, `${cName}.p`);
        addPin(n2, `${cName}.n`);
        break;
      }
      case "L": {
        const val = comp.value ?? 1e-6;
        decls.push(`  Modelica.Electrical.Analog.Basic.Inductor ${cName}(L=${val});`);
        addPin(n1, `${cName}.p`);
        addPin(n2, `${cName}.n`);
        break;
      }
      case "V": {
        const wf = comp.sourceSpec?.waveform;
        if (wf && wf.kind === "SINE") {
          decls.push(`  Modelica.Electrical.Analog.Sources.SineVoltage ${cName}(V=${wf.va}, f=${wf.freq});`);
        } else if (wf && wf.kind === "PULSE") {
          decls.push(
            `  Modelica.Electrical.Analog.Sources.PulseVoltage ${cName}(V=${wf.v2}, width=${wf.pw}, period=${wf.per});`,
          );
        } else {
          const val = comp.sourceSpec?.dc ?? comp.value ?? 0;
          decls.push(`  Modelica.Electrical.Analog.Sources.ConstantVoltage ${cName}(V=${val});`);
        }
        addPin(n1, `${cName}.p`);
        addPin(n2, `${cName}.n`);
        break;
      }
      case "I": {
        const val = comp.sourceSpec?.dc ?? comp.value ?? 0;
        decls.push(`  Modelica.Electrical.Analog.Sources.ConstantCurrent ${cName}(I=${val});`);
        addPin(n1, `${cName}.n`); // Current leaves n1
        addPin(n2, `${cName}.p`); // Enters n2
        break;
      }
      default: {
        // Fallback representation as a resistor
        const val = comp.value ?? 1e3;
        decls.push(`  Modelica.Electrical.Analog.Basic.Resistor ${cName}(R=${val});`);
        addPin(n1, `${cName}.p`);
        addPin(n2, `${cName}.n`);
        break;
      }
    }
  }

  // Generate connect equations for each node
  for (const [node, pins] of nodePins) {
    if (pins.length === 0) continue;

    if (node === "0" || node === "GND") {
      for (const p of pins) {
        connects.push(`    connect(ground.p, ${p});`);
      }
    } else {
      // Connect first pin to all subsequent pins on the same node
      const rootPin = pins[0];
      if (rootPin) {
        for (let i = 1; i < pins.length; i++) {
          const nextPin = pins[i];
          if (nextPin) {
            connects.push(`    connect(${rootPin}, ${nextPin});`);
          }
        }
      }
    }
  }

  return `model ${name}
${decls.join("\n")}
equation
${connects.join("\n")}
end ${name};
`;
}

/**
 * Projects a Modelica electrical circuit model text back into a SPICE netlist.
 */
export function modelicaToSpice(modelicaSource: string): SpiceCircuit {
  const components: SpiceComponent[] = [];
  const lines = modelicaSource.split("\n");

  // Track component declarations and pin connections
  const compTypes = new Map<string, { kind: string; paramVal: number }>();
  const pinNets = new Map<string, string>(); // e.g. "R1.p" -> "net_1"
  let netCounter = 1;

  // Simple parser of Modelica declarations and connect() statements
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith("Modelica.Electrical.Analog.")) {
      // e.g. Modelica.Electrical.Analog.Basic.Resistor R1(R=1000);
      const afterPkg = line.slice("Modelica.Electrical.Analog.".length);
      const openParen = afterPkg.indexOf("(");
      const spaceIdx = afterPkg.indexOf(" ");
      if (spaceIdx !== -1 && openParen !== -1) {
        const fullType = afterPkg.slice(0, spaceIdx);
        const nameAndParams = afterPkg.slice(spaceIdx + 1);
        const pOpen = nameAndParams.indexOf("(");
        const pClose = nameAndParams.lastIndexOf(")");
        const compName = nameAndParams.slice(0, pOpen).trim();
        const paramStr = nameAndParams.slice(pOpen + 1, pClose);

        let kind = "R";
        if (fullType.includes("Resistor")) kind = "R";
        else if (fullType.includes("Capacitor")) kind = "C";
        else if (fullType.includes("Inductor")) kind = "L";
        else if (fullType.includes("Voltage")) kind = "V";
        else if (fullType.includes("Current")) kind = "I";

        let val = 1.0;
        const eqIdx = paramStr.indexOf("=");
        if (eqIdx !== -1) {
          val = parseFloat(paramStr.slice(eqIdx + 1)) || 1.0;
        }
        compTypes.set(compName, { kind, paramVal: val });
      }
    } else if (line.startsWith("connect(") && line.endsWith(");")) {
      // e.g. connect(R1.p, C1.p);
      const inner = line.slice("connect(".length, -2);
      const parts = inner.split(",").map((s) => s.trim());
      if (parts.length === 2) {
        const p1 = parts[0] ?? "";
        const p2 = parts[1] ?? "";
        const net1 = pinNets.get(p1);
        const net2 = pinNets.get(p2);

        const isGround = p1.startsWith("ground") || p2.startsWith("ground");
        const assignedNet = isGround ? "0" : (net1 ?? net2 ?? `n${netCounter++}`);

        pinNets.set(p1, assignedNet);
        pinNets.set(p2, assignedNet);

        // If one was previously a different net, merge
        if (!isGround && net1 && net2 && net1 !== net2) {
          for (const [p, n] of pinNets) {
            if (n === net2) pinNets.set(p, net1);
          }
        }
      }
    }
  }

  // Build SPICE components from collected information
  for (const [name, info] of compTypes) {
    const pNet = pinNets.get(`${name}.p`) ?? `n_${name}_p`;
    const nNet = pinNets.get(`${name}.n`) ?? `n_${name}_n`;

    components.push({
      name,
      kind: info.kind as SpiceComponent["kind"],
      nodes: [pNet, nNet],
      value: info.paramVal,
      params: new Map(),
    });
  }

  return {
    title: "Extracted from Modelica",
    components,
    subcircuits: new Map(),
    models: new Map(),
    directives: [],
    globalNodes: new Set(["0", "GND"]),
    rawLines: lines,
    comments: [],
  };
}

function sanitizeIdentifier(name: string): string {
  const clean = name.replace(/[^a-zA-Z0-9_]/g, "_");
  if (/^[0-9]/.test(clean)) return `c_${clean}`;
  return clean || "Circuit";
}
