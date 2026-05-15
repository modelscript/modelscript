// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    model: { type: "string" },
    N: { type: "string" },
    out: { type: "string" },
  },
});

if (!values.model || !values.N || !values.out) {
  console.error(
    "Usage: npx tsx scripts/generate-benchmark.ts --model=<heat|resistor|mass> --N=<num_nodes> --out=<path>",
  );
  process.exit(1);
}

const N = parseInt(values.N, 10);
if (isNaN(N) || N < 1) {
  console.error("--N must be a positive integer.");
  process.exit(1);
}

const modelMap: Record<string, (n: number) => string> = {
  heat: generateHeatConduction1D,
  resistor: generateResistorChain,
  mass: generateMassSpringDamper,
};

const generator = modelMap[values.model];
if (!generator) {
  console.error(`Unknown model: ${values.model}. Available: heat, resistor, mass`);
  process.exit(1);
}

const sourceCode = generator(N);

const outPath = path.resolve(values.out);
const outDir = path.dirname(outPath);
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}
fs.writeFileSync(outPath, sourceCode, "utf8");
console.log(`Generated ${N}-node ${values.model} benchmark at ${outPath}`);

// ---------------------------------------------------------
// Generators
// ---------------------------------------------------------

function generateHeatConduction1D(n: number): string {
  let code = `model HeatConduction1D_${n}\n`;
  code += `  parameter Integer N = ${n};\n`;
  code += `  parameter Real L = 1.0;\n`;
  code += `  parameter Real dx = L / N;\n`;
  code += `  parameter Real alpha = 1e-4;\n\n`;

  code += `  Real T[N] (start=zeros(N));\n\n`;
  code += `equation\n`;

  code += `  der(T[1]) = alpha * (100.0 - 2.0*T[1] + T[2]) / (dx^2);\n`;
  for (let i = 2; i <= n - 1; i++) {
    code += `  der(T[${i}]) = alpha * (T[${i - 1}] - 2.0*T[${i}] + T[${i + 1}]) / (dx^2);\n`;
  }
  if (n > 1) {
    code += `  der(T[${n}]) = alpha * (T[${n - 1}] - T[${n}]) / (dx^2);\n`;
  }

  code += `  annotation(\n`;
  code += `    experiment(StartTime = 0, StopTime = 10, Tolerance = 1e-6, Interval = 0.1)\n`;
  code += `  );\n`;
  code += `end HeatConduction1D_${n};`;
  return code;
}

function generateResistorChain(n: number): string {
  let code = `model ResistorChain_${n}\n`;
  code += `  parameter Integer N = ${n};\n`;
  code += `  parameter Real R = 1.0;\n`;
  code += `  parameter Real V_in = 10.0;\n\n`;

  // Voltages and Currents
  code += `  Real v[N+1];\n`;
  code += `  Real i[N];\n\n`;

  code += `equation\n`;
  // Boundary conditions
  code += `  v[1] = V_in;\n`;
  code += `  v[N+1] = 0.0;\n\n`;

  // Ohm's law and KCL
  for (let k = 1; k <= n; k++) {
    code += `  v[${k}] - v[${k + 1}] = R * i[${k}];\n`;
  }

  code += `  annotation(\n`;
  code += `    experiment(StartTime = 0, StopTime = 1, Tolerance = 1e-6, Interval = 0.1)\n`;
  code += `  );\n`;
  code += `end ResistorChain_${n};`;
  return code;
}

function generateMassSpringDamper(n: number): string {
  let code = `model MassSpringDamper_${n}\n`;
  code += `  parameter Integer N = ${n};\n`;
  code += `  parameter Real m = 1.0;\n`;
  code += `  parameter Real k = 100.0;\n`;
  code += `  parameter Real c = 1.0;\n\n`;

  code += `  Real x[N] (start=zeros(N));\n`;
  code += `  Real v[N] (start=zeros(N));\n\n`;

  code += `equation\n`;
  // Leftmost mass (fixed wall)
  if (n >= 1) {
    code += `  der(x[1]) = v[1];\n`;
    if (n > 1) {
      code += `  m * der(v[1]) = -k * x[1] - c * v[1] + k * (x[2] - x[1]) + c * (v[2] - v[1]) + 10.0 * sin(time);\n`;
    } else {
      code += `  m * der(v[1]) = -k * x[1] - c * v[1] + 10.0 * sin(time);\n`;
    }
  }

  // Interior masses
  for (let i = 2; i <= n - 1; i++) {
    code += `  der(x[${i}]) = v[${i}];\n`;
    code += `  m * der(v[${i}]) = -k * (x[${i}] - x[${i - 1}]) - c * (v[${i}] - v[${i - 1}]) + k * (x[${i + 1}] - x[${i}]) + c * (v[${i + 1}] - v[${i}]);\n`;
  }

  // Rightmost mass (free end)
  if (n >= 2) {
    code += `  der(x[${n}]) = v[${n}];\n`;
    code += `  m * der(v[${n}]) = -k * (x[${n}] - x[${n - 1}]) - c * (v[${n}] - v[${n - 1}]);\n`;
  }

  code += `  annotation(\n`;
  code += `    experiment(StartTime = 0, StopTime = 10, Tolerance = 1e-6, Interval = 0.01)\n`;
  code += `  );\n`;
  code += `end MassSpringDamper_${n};`;
  return code;
}
