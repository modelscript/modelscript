// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ide — One-Click Multi-Domain Scaffolding & Digital Thread Synchronization.
 *
 * Implements automated polyglot scaffolding from SysML v2 architectural definitions:
 *   1. Compiles SysML v2 generic AST into Modelica physics model (<name>.mo) via GenericModelicaBridge.
 *   2. Synthesizes parameterized OpenSCAD CSG solid geometry (<name>.scad) from SysML attributes.
 *   3. Emits multi-fidelity physics study stubs:
 *      - Structural FEA Simulation Study (<name>.fea.mo)
 *      - Aerodynamic CFD Simulation Study (<name>.cfd.mo)
 *   4. Provides VS Code CodeLens on SysML v2 part definitions for one-click developer workflows.
 */

import { GenericModelicaBridge, type SysML2GenericDefinition } from "@modelscript/sysml2";
import * as vscode from "vscode";

export interface ScaffoldingArtifacts {
  name: string;
  modelicaSource: string;
  scadSource: string;
  feaMoSource: string;
  cfdMoSource: string;
}

export interface ScaffoldingResult extends ScaffoldingArtifacts {
  moUri: vscode.Uri;
  scadUri: vscode.Uri;
  feaUri: vscode.Uri;
  cfdUri: vscode.Uri;
}

/**
 * Pure generator function to synthesize multi-domain files from SysML v2 source text.
 */
export function generateMultiDomainScaffold(
  sysmlSource: string,
  fallbackBaseName = "SystemModel",
): ScaffoldingArtifacts {
  let sysmlDef: SysML2GenericDefinition;
  try {
    sysmlDef = GenericModelicaBridge.parseSysML2(sysmlSource);
  } catch {
    sysmlDef = {
      name: fallbackBaseName,
      kind: "part def",
      attributes: [],
      ports: [],
      connections: [],
    };
  }

  const name = sysmlDef.name || fallbackBaseName;

  // 1. Modelica physical model source
  const modelicaSource = GenericModelicaBridge.emitModelica(sysmlDef);

  // 2. OpenSCAD CSG geometric model source
  const attrs = new Map<string, any>();
  for (const a of sysmlDef.attributes || []) {
    attrs.set(a.name.toLowerCase(), a.defaultValue ?? 10);
  }

  const length = attrs.get("length") ?? attrs.get("len") ?? attrs.get("l") ?? 120.0;
  const width = attrs.get("width") ?? attrs.get("w") ?? 60.0;
  const height = attrs.get("height") ?? attrs.get("h") ?? 30.0;
  const fillet = attrs.get("filletradius") ?? attrs.get("fillet") ?? attrs.get("radius") ?? attrs.get("r") ?? 3.0;
  const wallThickness = attrs.get("wallthickness") ?? attrs.get("thickness") ?? attrs.get("t") ?? 4.0;

  const scadSource = `// SPDX-License-Identifier: AGPL-3.0-or-later
// Auto-generated Parametric Constructive Solid Geometry (CSG) for ${name}
// Synchronized with SysML v2 architectural attributes

length = ${length};
width = ${width};
height = ${height};
fillet_radius = ${fillet};
wall_thickness = ${wallThickness};

module ${name}_solid() {
    difference() {
        // Outer housing envelope
        minkowski() {
            cube([length - 2 * fillet_radius, width - 2 * fillet_radius, height - 2 * fillet_radius], center = true);
            sphere(r = fillet_radius, $fn = 32);
        }

        // Inner cavity / weight-reduction pocket
        translate([0, 0, wall_thickness / 2])
            cube([length - 2 * wall_thickness, width - 2 * wall_thickness, height], center = true);

        // Mounting clearance holes
        translate([-(length / 2 - 2 * fillet_radius), -(width / 2 - 2 * fillet_radius), 0])
            cylinder(r = fillet_radius / 2, h = height * 2, center = true, $fn = 24);
        translate([(length / 2 - 2 * fillet_radius), -(width / 2 - 2 * fillet_radius), 0])
            cylinder(r = fillet_radius / 2, h = height * 2, center = true, $fn = 24);
        translate([-(length / 2 - 2 * fillet_radius), (width / 2 - 2 * fillet_radius), 0])
            cylinder(r = fillet_radius / 2, h = height * 2, center = true, $fn = 24);
        translate([(length / 2 - 2 * fillet_radius), (width / 2 - 2 * fillet_radius), 0])
            cylinder(r = fillet_radius / 2, h = height * 2, center = true, $fn = 24);
    }
}

${name}_solid();
`;

  // 3. Structural FEA study file
  const feaMoSource = `// SPDX-License-Identifier: AGPL-3.0-or-later
// Structural FEA Simulation Study for ${name}
// Extends base physical model and enforces structural stress contracts

model ${name}_FEA_Study
  extends ${name};

  // Material & load parameters
  parameter Real youngsModulus = 70e9 "Pa (Aluminum 6061-T6)";
  parameter Real poissonsRatio = 0.33;
  parameter Real yieldStrength = 276e6 "Pa";
  parameter Real allowableStress = 220e6 "Pa (Safety Factor = 1.25)";
  parameter Real appliedNodalLoad = 2500.0 "N (Peak dynamic load)";

  // Observables and verification indicators
  Real effectiveArea(unit = "m2");
  Real maxVonMisesStress(unit = "Pa");
  Real safetyMargin;
  Boolean isStressCompliant;

equation
  effectiveArea = (width * 1e-3) * (height * 1e-3);
  maxVonMisesStress = appliedNodalLoad / effectiveArea;
  safetyMargin = (allowableStress / maxVonMisesStress) - 1.0;
  isStressCompliant = maxVonMisesStress <= allowableStress;
end ${name}_FEA_Study;
`;

  // 4. Aerodynamic CFD study file
  const cfdMoSource = `// SPDX-License-Identifier: AGPL-3.0-or-later
// Aerodynamic CFD Simulation Study for ${name}
// Extends base physical model and computes drag force and pressure drop

model ${name}_CFD_Study
  extends ${name};

  // Fluid dynamics domain parameters
  parameter Real fluidDensity = 1.225 "kg/m^3 (Air at STP)";
  parameter Real freestreamVelocity = 28.0 "m/s (Operating cruise airspeed)";
  parameter Real dragCoefficient = 0.38 "Baseline bluff body Cd";

  // Aerodynamic observables
  Real frontalArea(unit = "m2");
  Real dynamicPressure(unit = "Pa");
  Real aerodynamicDragForce(unit = "N");
  Real pressureDropPa(unit = "Pa");

equation
  frontalArea = (width * 1e-3) * (height * 1e-3);
  dynamicPressure = 0.5 * fluidDensity * (freestreamVelocity ^ 2);
  aerodynamicDragForce = dynamicPressure * frontalArea * dragCoefficient;
  pressureDropPa = dynamicPressure * dragCoefficient;
end ${name}_CFD_Study;
`;

  return {
    name,
    modelicaSource,
    scadSource,
    feaMoSource,
    cfdMoSource,
  };
}

/**
 * Scaffolds multi-domain files into the workspace directory containing the source SysML v2 file.
 */
export async function scaffoldMultiDomain(targetUri?: vscode.Uri | string): Promise<ScaffoldingResult | null> {
  let docUri: vscode.Uri | undefined;
  if (typeof targetUri === "string") {
    docUri = vscode.Uri.parse(targetUri);
  } else if (targetUri instanceof vscode.Uri) {
    docUri = targetUri;
  } else {
    docUri = vscode.window.activeTextEditor?.document.uri;
  }

  if (!docUri) {
    vscode.window.showWarningMessage("No active SysML v2 document found to scaffold multi-domain models.");
    return null;
  }

  try {
    const doc = await vscode.workspace.openTextDocument(docUri);
    const sysmlSource = doc.getText();
    const filePath = docUri.path;
    const baseDir = filePath.substring(0, filePath.lastIndexOf("/"));
    const fileName = filePath.split("/").pop() || "SystemModel.sysml";
    const fallbackBaseName = fileName.replace(/\.[^.]+$/, "");

    const artifacts = generateMultiDomainScaffold(sysmlSource, fallbackBaseName);
    const { name, modelicaSource, scadSource, feaMoSource, cfdMoSource } = artifacts;

    const moUri = docUri.with({ path: `${baseDir}/${name}.mo` });
    const scadUri = docUri.with({ path: `${baseDir}/${name}.scad` });
    const feaUri = docUri.with({ path: `${baseDir}/${name}.fea.mo` });
    const cfdUri = docUri.with({ path: `${baseDir}/${name}.cfd.mo` });

    const encoder = new TextEncoder();
    await vscode.workspace.fs.writeFile(moUri, encoder.encode(modelicaSource));
    await vscode.workspace.fs.writeFile(scadUri, encoder.encode(scadSource));
    await vscode.workspace.fs.writeFile(feaUri, encoder.encode(feaMoSource));
    await vscode.workspace.fs.writeFile(cfdUri, encoder.encode(cfdMoSource));

    vscode.window.showInformationMessage(
      `⚡ Successfully scaffolded multi-domain models for '${name}': ${name}.mo, ${name}.scad, ${name}.fea.mo, ${name}.cfd.mo`,
    );

    return {
      ...artifacts,
      moUri,
      scadUri,
      feaUri,
      cfdUri,
    };
  } catch (err: any) {
    vscode.window.showErrorMessage(`Multi-domain scaffolding failed: ${err.message || err}`);
    return null;
  }
}

/**
 * CodeLens Provider offering one-click multi-domain scaffolding directly above SysML definitions.
 */
export class SysmlScaffoldCodeLensProvider implements vscode.CodeLensProvider {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  provideCodeLenses(_document: vscode.TextDocument, _token: vscode.CancellationToken): vscode.CodeLens[] {
    // Disabled: code lens is messy in editor
    return [];
  }
}

/**
 * Registers multi-domain scaffolding commands and CodeLens providers in VS Code / Web IDE.
 */
export function registerMultiDomainScaffolding(_context: vscode.ExtensionContext): vscode.Disposable {
  const disposables: vscode.Disposable[] = [];

  // 1. Command registration
  disposables.push(
    vscode.commands.registerCommand("modelscript.scaffoldMultiDomain", async (targetUri?: vscode.Uri | string) => {
      return await scaffoldMultiDomain(targetUri);
    }),
  );

  // 2. CodeLens Provider registration for SysML v2 (disabled for now)
  // const documentSelector: vscode.DocumentFilter[] = [
  //   { language: "sysml" },
  //   { language: "sysml2" },
  //   { pattern: "**/*.sysml" },
  //   { pattern: "**/*.sysml2" },
  // ];
  // disposables.push(vscode.languages.registerCodeLensProvider(documentSelector, new SysmlScaffoldCodeLensProvider()));

  return new vscode.Disposable(() => {
    while (disposables.length) {
      const d = disposables.pop();
      if (d) d.dispose();
    }
  });
}
