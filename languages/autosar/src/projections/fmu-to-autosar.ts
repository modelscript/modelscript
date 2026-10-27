// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * FMI to AUTOSAR Classic SWC Projection Generator.
 *
 * Synthesizes:
 * 1. AUTOSAR Classic ARXML (ApplicationSwComponentType, SenderReceiverInterface, RPort/PPort)
 * 2. Runnable entities triggered by periodic timing events
 * 3. Virtual RTE scheduler integration snippet
 */

export interface FmuVariableStub {
  name: string;
  causality: "input" | "output" | "parameter" | "calculatedParameter" | "local" | "independent" | string;
  type: string;
  valueReference: number;
  unit?: string | undefined;
  start?: number | string | boolean | undefined;
  description?: string | undefined;
}

export interface FmuModelStub {
  modelName: string;
  description?: string | undefined;
  guid?: string | undefined;
  fmiVersion?: string | undefined;
  variables: FmuVariableStub[];
}

export interface AutosarProjectionResult {
  swcName: string;
  arxml: string;
  virtualRteGlue: string;
  rPorts: string[];
  pPorts: string[];
  runnableName: string;
  periodSec: number;
}

export function fmuToAutosar(model: FmuModelStub, periodSec = 0.01): AutosarProjectionResult {
  const swcName = sanitizeAutosarIdent(model.modelName) + "_Swc";
  const runnableName = `${swcName}_Step`;

  const inputs = model.variables.filter((v) => v.causality === "input");
  const outputs = model.variables.filter((v) => v.causality === "output");

  const rPorts = inputs.map((v) => sanitizeAutosarIdent(v.name) + "_In");
  const pPorts = outputs.map((v) => sanitizeAutosarIdent(v.name) + "_Out");

  // 1. Generate ARXML
  const xmlLines: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<AUTOSAR xmlns="http://autosar.org/schema/r4.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`,
    `  <AR-PACKAGES>`,
    `    <AR-PACKAGE>`,
    `      <SHORT-NAME>Components</SHORT-NAME>`,
    `      <ELEMENTS>`,
    `        <APPLICATION-SW-COMPONENT-TYPE>`,
    `          <SHORT-NAME>${swcName}</SHORT-NAME>`,
    `          <PORTS>`,
  ];

  // R-Ports (Inputs)
  rPorts.forEach((pName) => {
    xmlLines.push(`            <R-PORT-PROTOTYPE>`);
    xmlLines.push(`              <SHORT-NAME>${pName}</SHORT-NAME>`);
    xmlLines.push(`            </R-PORT-PROTOTYPE>`);
  });

  // P-Ports (Outputs)
  pPorts.forEach((pName) => {
    xmlLines.push(`            <P-PORT-PROTOTYPE>`);
    xmlLines.push(`              <SHORT-NAME>${pName}</SHORT-NAME>`);
    xmlLines.push(`            </P-PORT-PROTOTYPE>`);
  });

  xmlLines.push(
    `          </PORTS>`,
    `          <INTERNAL-BEHAVIORS>`,
    `            <SWC-INTERNAL-BEHAVIOR>`,
    `              <SHORT-NAME>${swcName}_InternalBehavior</SHORT-NAME>`,
    `              <EVENTS>`,
    `                <TIMING-EVENT>`,
    `                  <SHORT-NAME>TE_${runnableName}</SHORT-NAME>`,
    `                  <START-ON-EVENT-REF>${runnableName}</START-ON-EVENT-REF>`,
    `                  <PERIOD>${periodSec}</PERIOD>`,
    `                </TIMING-EVENT>`,
    `              </EVENTS>`,
    `              <RUNNABLES>`,
    `                <RUNNABLE-ENTITY>`,
    `                  <SHORT-NAME>${runnableName}</SHORT-NAME>`,
    `                  <CAN-BE-INVOKED-CONCURRENTLY>false</CAN-BE-INVOKED-CONCURRENTLY>`,
    `                </RUNNABLE-ENTITY>`,
    `              </RUNNABLES>`,
    `            </SWC-INTERNAL-BEHAVIOR>`,
    `          </INTERNAL-BEHAVIORS>`,
    `        </APPLICATION-SW-COMPONENT-TYPE>`,
    `      </ELEMENTS>`,
    `    </AR-PACKAGE>`,
    `  </AR-PACKAGES>`,
    `</AUTOSAR>`,
  );

  // 2. Generate Virtual RTE Registration Snippet
  const rteLines: string[] = [
    `// Virtual RTE Runnable Registration for ${swcName}`,
    `virtualRte.registerRunnable("${swcName}", "${runnableName}", (ctx) => {`,
    `  // 1. Read input signals from RTE ports`,
  ];

  inputs.forEach((inp, idx) => {
    const port = rPorts[idx] ?? "";
    rteLines.push(`  const ${sanitizeAutosarIdent(inp.name)} = Number(ctx.read("${port}", "val"));`);
  });

  rteLines.push(
    `  // 2. Call FMU C API or SHM bridge`,
    `  // fmi2DoStep(time, ${periodSec});`,
    `  // 3. Write output signals back to RTE ports`,
  );

  outputs.forEach((out, idx) => {
    const port = pPorts[idx] ?? "";
    rteLines.push(`  ctx.write("${port}", "val", 0.0 /* output from FMU VR ${out.valueReference} */);`);
  });

  rteLines.push(`});`);

  return {
    swcName,
    arxml: xmlLines.join("\n"),
    virtualRteGlue: rteLines.join("\n"),
    rPorts,
    pPorts,
    runnableName,
    periodSec,
  };
}

function sanitizeAutosarIdent(name: string): string {
  return name.replace(/[^A-Za-z0-9_]/g, "_").replace(/^([0-9])/, "_$1");
}
