// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as vscode from "vscode";
import { droneStepContent } from "../drone-step-content.js";

function joinPath(base: vscode.Uri, ...pathSegments: string[]): vscode.Uri {
  const globalVsCode = (globalThis as any).vscode;
  if (typeof globalVsCode?.Uri?.joinPath === "function") {
    return globalVsCode.Uri.joinPath(base, ...pathSegments);
  }
  const cleanBase = (base.path || "").replace(/\/+$/, "");
  const relPath = pathSegments.join("/").replace(/^\/+/, "");
  const fullPath = `${cleanBase}/${relPath}`;
  return {
    scheme: base.scheme || "memfs",
    path: fullPath,
    authority: base.authority || "",
    query: base.query || "",
    fragment: base.fragment || "",
    fsPath: fullPath,
    with: (change: any) => ({ ...base, ...change }),
    toJSON: () => ({ scheme: base.scheme, path: fullPath }),
  } as vscode.Uri;
}

export interface IMemoryFileSystemProvider {
  writeFile(uri: vscode.Uri, content: Uint8Array): void;
  writeFiles?(entries: [vscode.Uri, Uint8Array][]): void;
}

export interface ArtifactWorkspaceDescriptor {
  artifactId: string | number;
  title?: string | undefined;
  viewType?: string | undefined;
  viewConfig?: Record<string, any> | undefined;
}

export interface GeneratedWorkspace {
  files: Record<string, string>;
  primaryFile: string;
}

const artifactRegistry = new Map<string, ArtifactWorkspaceDescriptor>();

export function registerArtifactDescriptor(descriptor: ArtifactWorkspaceDescriptor): void {
  artifactRegistry.set(String(descriptor.artifactId), descriptor);
}

export function getArtifactDescriptor(artifactId: string | number): ArtifactWorkspaceDescriptor | undefined {
  return artifactRegistry.get(String(artifactId));
}

export function clearArtifactRegistry(): void {
  artifactRegistry.clear();
}

export function sanitizeModelicaIdentifier(name?: string, fallback = "ArtifactModel"): string {
  if (!name) return fallback;
  let cleaned = name
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/^_+/, "")
    .replace(/_+$/, "");
  if (!cleaned || /^[0-9]/.test(cleaned)) {
    cleaned = "M_" + (cleaned || fallback);
  }
  return cleaned;
}

export function generateArtifactWorkspaceFiles(descriptor: ArtifactWorkspaceDescriptor): GeneratedWorkspace {
  const viewType = (descriptor.viewType || "").toLowerCase();
  const config = descriptor.viewConfig || {};

  // 1. Modelica Code / Schematic / Morsel
  if (
    viewType === "modelica-code" ||
    viewType === "modelica-diagram" ||
    viewType === "morsel" ||
    (!viewType && config["code"])
  ) {
    const rawCode = config["code"] || config["content"] || "";
    let modelName = "";
    if (rawCode) {
      const match = rawCode.match(/(?:model|class|block|connector|package)\s+([A-Za-z0-9_]+)/);
      if (match) {
        modelName = match[1];
      }
    }
    if (!modelName) {
      modelName = sanitizeModelicaIdentifier(descriptor.title, `Artifact_${descriptor.artifactId}`);
    }

    const code =
      rawCode ||
      [
        `// ModelScript Workspace for Artifact #${descriptor.artifactId}`,
        `// Title: ${descriptor.title || "Community Model"}`,
        ``,
        `model ${modelName} "${descriptor.title || "Community Model"}"`,
        `  Real x(start = 1.0) "State variable";`,
        `  Real y(start = 0.0) "Coupled variable";`,
        `equation`,
        `  der(x) = -y;`,
        `  der(y) = x;`,
        `end ${modelName};`,
        ``,
      ].join("\n");

    const primaryFile = `${modelName}.mo`;
    const files: Record<string, string> = {
      [primaryFile]: code,
      "README.md": [
        `# ${descriptor.title || modelName}`,
        ``,
        `Mounted from ModelScript Hub Community Feed & Physical Twin Workspace.`,
        ``,
        `- **Artifact ID**: #${descriptor.artifactId}`,
        `- **View Type**: \`${viewType || "modelica-code"}\``,
        `- **Primary Model**: \`${modelName}\``,
        ``,
        `To simulate, open \`${primaryFile}\` and press \`F5\` or click **Run Simulation**.`,
      ].join("\n"),
    };

    return { files, primaryFile };
  }

  // 2. Simulation Plot / Result / CFD / FEA Result
  if (
    viewType === "simulation-plot" ||
    viewType === "simulation-result" ||
    viewType === "cfd-result" ||
    viewType === "fea-result" ||
    viewType === "cfd-animation"
  ) {
    const modelName = config["model"]
      ? sanitizeModelicaIdentifier(config["model"])
      : sanitizeModelicaIdentifier(descriptor.title, `Simulation_${descriptor.artifactId}`);
    const primaryFile = `${modelName}.mo`;

    const variables: string[] =
      Array.isArray(config["variables"]) && config["variables"].length > 0 ? config["variables"] : ["x", "v"];

    const overrides: Record<string, any> = config["overrides"] || {};
    const paramLines = Object.entries(overrides).map(([k, v]) => {
      const safeK = sanitizeModelicaIdentifier(k);
      return `  parameter Real ${safeK} = ${v};`;
    });

    const varLines = variables.map((v) => `  Real ${sanitizeModelicaIdentifier(v)}(start = 1.0);`);
    const eqLines =
      variables.length >= 2
        ? [
            `  der(${sanitizeModelicaIdentifier(variables[0])}) = ${sanitizeModelicaIdentifier(variables[1])};`,
            `  der(${sanitizeModelicaIdentifier(variables[1])}) = -${sanitizeModelicaIdentifier(variables[0])};`,
          ]
        : variables.map((v) => `  der(${sanitizeModelicaIdentifier(v)}) = -${sanitizeModelicaIdentifier(v)};`);

    const code =
      config["code"] ||
      [
        `// ModelScript Simulation Experiment: ${descriptor.title || modelName}`,
        `// Generated from Artifact #${descriptor.artifactId}`,
        ``,
        `model ${modelName} "${descriptor.title || "Simulation Model"}"`,
        paramLines.length > 0 ? paramLines.join("\n") : `  parameter Real k = 1.0 "System stiffness";`,
        varLines.join("\n"),
        `equation`,
        eqLines.join("\n"),
        `end ${modelName};`,
        ``,
      ].join("\n");

    const simScript = [
      `// ModelScript Simulation Script for ${modelName}`,
      `simulate(${modelName}, startTime = 0.0, stopTime = 10.0, numberOfIntervals = 500);`,
      `plot({${variables.map((v) => `"${sanitizeModelicaIdentifier(v)}"`).join(", ")}});`,
      ``,
    ].join("\n");

    const files: Record<string, string> = {
      [primaryFile]: code,
      "simulate.mos": simScript,
      "README.md": [
        `# Simulation: ${descriptor.title || modelName}`,
        ``,
        `Mounted from ModelScript Simulation Artifact #${descriptor.artifactId}.`,
        ``,
        `- **Model**: \`${modelName}\``,
        `- **Variables**: ${variables.map((v) => `\`${v}\``).join(", ")}`,
        `- **Script**: \`simulate.mos\``,
      ].join("\n"),
    };

    if (config["csvData"] || config["data"] || config["results"]) {
      files["trajectory.csv"] =
        typeof config["csvData"] === "string"
          ? config["csvData"]
          : typeof config["data"] === "string"
            ? config["data"]
            : JSON.stringify(config["results"] || config["data"], null, 2);
    }

    return { files, primaryFile };
  }

  // 3. 3D CAD STEP
  if (viewType === "cad-step" || viewType === "cad_step" || viewType === "3d-model") {
    const stepContent =
      config["step"] ||
      config["content"] ||
      config["data"] ||
      [
        `ISO-10303-21;`,
        `HEADER;`,
        `FILE_DESCRIPTION(('ModelScript 3D CAD Artifact'), '2;1');`,
        `FILE_NAME('geometry.step', '2026-10-09', ('ModelScript User'), ('ModelScript CAD Engine'), '', '', '');`,
        `FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));`,
        `ENDSEC;`,
        `DATA;`,
        `/* CAD Artifact #${descriptor.artifactId}: ${descriptor.title || "CAD Geometry"} */`,
        `ENDSEC;`,
        `END-ISO-10303-21;`,
      ].join("\n");

    const modelName = sanitizeModelicaIdentifier(descriptor.title, `CADAssembly_${descriptor.artifactId}`);
    const primaryFile = `${modelName}.mo`;
    const files: Record<string, string> = {
      [primaryFile]: [
        `// ModelScript 3D CAD Assembly bound to STEP geometry`,
        `model ${modelName} "${descriptor.title || "CAD Model"}"`,
        `  // Bound to local STEP geometry file`,
        `  annotation(Shape(export = "geometry.step"));`,
        `equation`,
        `end ${modelName};`,
        ``,
      ].join("\n"),
      "geometry.step": stepContent,
      "README.md": [
        `# 3D CAD: ${descriptor.title || modelName}`,
        ``,
        `Mounted from ModelScript CAD Artifact #${descriptor.artifactId}.`,
        ``,
        `- **Geometry Asset**: \`geometry.step\``,
        `- **Modelica Wrapper**: \`${primaryFile}\``,
      ].join("\n"),
    };

    return { files, primaryFile };
  }

  // 4. GCode Toolpath
  if (viewType === "gcode" || viewType === "cam-result") {
    const gcodeContent =
      config["gcode"] ||
      config["content"] ||
      [
        `; GCode Toolpath for Artifact #${descriptor.artifactId}: ${descriptor.title || "CNC Job"}`,
        `G21 ; millimeters`,
        `G90 ; absolute coordinates`,
        `G28 ; home all axes`,
        `M104 S200 ; set extruder temp`,
        `M140 S60 ; set bed temp`,
        `G1 Z5 F5000 ; lift nozzle`,
        `G1 X50 Y50 F3000 ; move to start`,
        `G1 Z0.2 F1000 ; layer 1`,
        `G1 X100 Y50 E5 F1500`,
        `G1 X100 Y100 E10 F1500`,
        `G1 X50 Y100 E15 F1500`,
        `G1 X50 Y50 E20 F1500`,
        `M84 ; disable motors`,
      ].join("\n");

    const modelName = sanitizeModelicaIdentifier(descriptor.title, `Manufacturing_${descriptor.artifactId}`);
    const primaryFile = "toolpath.gcode";
    const files: Record<string, string> = {
      [primaryFile]: gcodeContent,
      [`${modelName}.mo`]: [
        `// ModelScript CNC / CAM Manufacturing Process`,
        `model ${modelName} "${descriptor.title || "Toolpath Process"}"`,
        `  parameter String toolpath_file = "toolpath.gcode";`,
        `end ${modelName};`,
        ``,
      ].join("\n"),
      "README.md": [
        `# CAM Toolpath: ${descriptor.title || modelName}`,
        ``,
        `- **G-Code File**: \`toolpath.gcode\``,
        `- **Process Model**: \`${modelName}.mo\``,
      ].join("\n"),
    };

    return { files, primaryFile };
  }

  // 5. AAS Package / Cyber-Physical System
  if (viewType === "aas-package" || viewType === "cyber-physical-system" || viewType === "hardware-project") {
    const manifest = config["manifest"] ||
      config || {
        idShort: sanitizeModelicaIdentifier(descriptor.title, `Asset_${descriptor.artifactId}`),
        assetAdministrationShells: [
          {
            idShort: descriptor.title || `Asset_${descriptor.artifactId}`,
            submodels: [
              { idShort: "TechnicalData", semanticId: "0173-1#01-AHF578#001" },
              { idShort: "OperationalData", semanticId: "0173-1#01-ADN789#001" },
            ],
          },
        ],
      };

    const modelName = sanitizeModelicaIdentifier(descriptor.title, `AAS_${descriptor.artifactId}`);
    const primaryFile = "aas-manifest.json";
    const files: Record<string, string> = {
      [primaryFile]: JSON.stringify(manifest, null, 2),
      [`${modelName}.mo`]: [
        `// ModelScript Asset Administration Shell (AAS) Digital Twin`,
        `model ${modelName} "${descriptor.title || "AAS Digital Twin"}"`,
        `  parameter String manifest_path = "aas-manifest.json";`,
        `  parameter String idShort = "${manifest.idShort || modelName}";`,
        `end ${modelName};`,
        ``,
      ].join("\n"),
      "README.md": [
        `# AAS Digital Twin: ${descriptor.title || modelName}`,
        ``,
        `- **Manifest**: \`aas-manifest.json\``,
        `- **Digital Twin Wrapper**: \`${modelName}.mo\``,
      ].join("\n"),
    };

    return { files, primaryFile };
  }

  // 6. Generic Default Artifact Fallback
  const modelName = sanitizeModelicaIdentifier(descriptor.title, `ArtifactModel_${descriptor.artifactId}`);
  const primaryFile = "ArtifactModel.mo";
  const content = [
    `// ModelScript Workspace for Social Artifact #${descriptor.artifactId}`,
    `// Title: ${descriptor.title || "Community Artifact"}`,
    `// Opened from Community Feed & Physical Twin Hub`,
    ``,
    `model ${modelName} "${descriptor.title || "Community Artifact"}"`,
    `  Real x(start = 1.0) "State variable";`,
    `  Real y(start = 0.0) "Coupled variable";`,
    `equation`,
    `  der(x) = -y;`,
    `  der(y) = x;`,
    `end ${modelName};`,
    ``,
  ].join("\n");

  const files: Record<string, string> = {
    [primaryFile]: content,
    "README.md": [
      `# Artifact #${descriptor.artifactId}: ${descriptor.title || "Community Model"}`,
      ``,
      `Mounted in ModelScript IDE linear in-memory filesystem (\`memfs://\`).`,
    ].join("\n"),
  };

  return { files, primaryFile };
}

export function generatePackageWorkspaceFiles(packageName: string, pkgInfo?: Record<string, any>): GeneratedWorkspace {
  const safeName = sanitizeModelicaIdentifier(packageName, "PackageDemo");
  const primaryFile = `${safeName}Demo.mo`;
  const manifest = {
    name: packageName,
    version: pkgInfo?.["version"] || "1.0.0",
    description: pkgInfo?.["description"] || `ModelScript workspace for package ${packageName}`,
    dependencies: pkgInfo?.["dependencies"] || {},
  };

  const files: Record<string, string> = {
    "package.json": JSON.stringify(manifest, null, 2),
    "package.mo": [
      `package ${safeName}`,
      `  "Library package for ${packageName}"`,
      `  constant String version = "${manifest.version}";`,
      `end ${safeName};`,
      ``,
    ].join("\n"),
    [primaryFile]: [
      `// Test harness and simulation demo for ${packageName}`,
      `model ${safeName}Demo "Testing ${packageName}"`,
      `  // import ${safeName}.*;`,
      `  Real time_val = time;`,
      `equation`,
      `end ${safeName}Demo;`,
      ``,
    ].join("\n"),
    "README.md": [
      `# ${packageName}`,
      ``,
      `ModelScript package workspace for \`${packageName}\`.`,
      ``,
      `- **Entrypoint**: \`${primaryFile}\``,
      `- **Package Root**: \`package.mo\``,
      `- **Registry Metadata**: \`package.json\``,
    ].join("\n"),
  };

  return { files, primaryFile };
}

export function mountArtifactToMemFs(
  memFs: IMemoryFileSystemProvider,
  workspaceUri: vscode.Uri,
  descriptor: ArtifactWorkspaceDescriptor,
): { files: Record<string, string>; primaryFile: string } {
  registerArtifactDescriptor(descriptor);
  const encoder = new TextEncoder();
  const { files, primaryFile } = generateArtifactWorkspaceFiles(descriptor);
  for (const [name, fileContent] of Object.entries(files)) {
    const fileUri = joinPath(workspaceUri, name);
    memFs.writeFile(fileUri, encoder.encode(fileContent));
  }
  return { files, primaryFile };
}

export function scaffoldTemplateFiles(memFs: IMemoryFileSystemProvider, workspaceUri: vscode.Uri): void {
  const encoder = new TextEncoder();
  const template = workspaceUri.path.substring(1) || "empty";

  if (template === "scratch" || template.startsWith("artifact-")) {
    const artifactId = template === "scratch" ? "scratch" : template.slice("artifact-".length);
    let registered = artifactRegistry.get(artifactId);
    if (!registered && typeof sessionStorage !== "undefined") {
      try {
        const raw = sessionStorage.getItem(`modelscript.artifact_${artifactId}`);
        if (raw) registered = JSON.parse(raw);
      } catch {
        // ignore
      }
    }
    const descriptor: ArtifactWorkspaceDescriptor = registered || { artifactId };
    const { files } = generateArtifactWorkspaceFiles(descriptor);
    for (const [name, fileContent] of Object.entries(files)) {
      const fileUri = joinPath(workspaceUri, name);
      memFs.writeFile(fileUri, encoder.encode(fileContent));
    }
    console.log(`[blank-project] Scaffolded ${Object.keys(files).length} artifact file(s) for #${artifactId}`);
    return;
  }

  if (template.startsWith("package-")) {
    const pkgName = template.slice("package-".length);
    const { files } = generatePackageWorkspaceFiles(pkgName);
    for (const [name, fileContent] of Object.entries(files)) {
      const fileUri = joinPath(workspaceUri, name);
      memFs.writeFile(fileUri, encoder.encode(fileContent));
    }
    console.log(`[blank-project] Scaffolded ${Object.keys(files).length} package file(s) for '${pkgName}'`);
    return;
  }

  const templates: Record<string, Record<string, string>> = {
    "drone-chassis": {
      "DroneSimulation.mo": [
        'model DroneSimulation "Propeller dynamics linked to procedural CAD geometry"',
        "  // ── Geometry (compiles to STEP for FEA/CFD) ─────────────────────────",
        "  // Propeller prop(",
        "  //   radius = 100,",
        "  //   hubRadius = 10,",
        "  //   bladeWidth = 15,",
        "  //   thickness = 2",
        '  // ) annotation(Shape(export = "drone.step"));',
        "",
        "  // ── Derived physical properties from geometry ───────────────────────",
        '  parameter Real bladeVolume = (100 - 10) * 15 * 2 "Blade volume [mm³]";',
        '  parameter Real hubVolume = 3.14159 * 10^2 * 4 "Hub volume [mm³]";',
        '  parameter Real mass = (2 * bladeVolume + hubVolume) * 1e-9 * 1600 "Propeller mass [kg]";',
        '  parameter Real inertia = (1.0/12.0) * mass * (2 * 100 * 1e-3)^2 "Moment of inertia [kg*m²]";',
        "",
        "  // ── Simulation state ────────────────────────────────────────────────",
        '  Real w(start = 0) "Rotational velocity [rad/s]";',
        '  Real thrust "Thrust generated [N]";',
        "  ",
        '  parameter Real motor_tau = 0.5 "Applied motor torque [N*m]";',
        '  parameter Real torque_coeff = 0.015 "Aerodynamic torque coefficient";',
        '  parameter Real thrust_coeff = 0.11 "Aerodynamic thrust coefficient";',
        "",
        "equation",
        "  inertia * der(w) = motor_tau - torque_coeff * w * abs(w);",
        "  thrust = thrust_coeff * w * abs(w);",
        "end DroneSimulation;",
      ].join("\n"),
      "chassis.sysml": [
        "package DroneArchitecture {",
        "  part def DroneAssembly {",
        "    part chassis : Chassis;",
        "    part rotor1 : Rotor;",
        "    part rotor2 : Rotor;",
        "    part rotor3 : Rotor;",
        "    part rotor4 : Rotor;",
        "",
        "    // Reference CAD geometry",
        "    ref chassisGeometry = DroneCAD::DroneChassis;",
        "  }",
        "",
        "  part def Chassis {}",
        "  part def Rotor {}",
        "}",
      ].join("\n"),
      "DroneCAD.mo": [
        'package DroneCAD "Procedural CAD model of a quadcopter drone chassis"',
        "",
        "  import ModelScript.Geometry.*;",
        "",
        '  record Propeller "Propeller geometry"',
        '    parameter Real radius = 100 "Propeller radius [mm]";',
        '    parameter Real hubRadius = 10 "Hub radius [mm]";',
        '    parameter Real bladeWidth = 15 "Blade width [mm]";',
        '    parameter Real thickness = 2 "Blade thickness [mm]";',
        "",
        "    // Hub",
        "    Cylinder hub(radius = hubRadius, height = thickness*2)",
        "      annotation(material = ABS);",
        "",
        "    // Blade 1",
        "    Box blade1(width = radius - hubRadius, height = thickness, depth = bladeWidth)",
        "      annotation(Placement(origin = {(radius + hubRadius)/2, 0, 0}), material = CarbonFiber);",
        "",
        "    // Blade 2",
        "    Box blade2(width = radius - hubRadius, height = thickness, depth = bladeWidth)",
        "      annotation(Placement(origin = {-(radius + hubRadius)/2, 0, 0}), material = CarbonFiber);",
        "  end Propeller;",
        "",
        '  record DroneChassis "Complete quadcopter drone chassis"',
        "    parameter Real bodySize = 10;",
        "    parameter Real bodyHeight = 3;",
        "    Box body(width = bodySize, height = bodyHeight, depth = bodySize)",
        "      annotation(material = CarbonFiber);",
        "  end DroneChassis;",
        "",
        "end DroneCAD;",
      ].join("\n"),
      "DroneFEA.mo": [
        "model DroneFEA",
        "  extends ModelScript.Studies.StaticStructuralFEA(",
        "    meshResolution = 0.05",
        "  );",
        "  extends DroneSimulation;",
        "end DroneFEA;",
      ].join("\n"),
      "DroneCFD.mo": [
        "model DroneCFD",
        "  extends ModelScript.Studies.SteadyStateCFD(",
        "    meshResolution = 0.05",
        "  );",
        "  extends DroneSimulation;",
        "end DroneCFD;",
      ].join("\n"),
    },
    empty: {
      "HelloWorld.mo": `model HelloWorld "A simple Modelica model"\n  Real x(start = 1);\n  parameter Real a = -1;\nequation\n  der(x) = a * x;\nend HelloWorld;\n`,
    },
    blank: {
      "HelloWorld.mo": `model HelloWorld "A simple Modelica model"\n  Real x(start = 1);\n  parameter Real a = -1;\nequation\n  der(x) = a * x;\nend HelloWorld;\n`,
    },
    "drone-reachability": {
      "cad/drone.step": droneStepContent,
      ".vscode/settings.json":
        '{\n  "files.associations": {\n    "*.cfg": "cfd",\n    "*.cfgt": "cfd",\n    "*.su2": "cfd",\n    "*.inp": "fea",\n    "*.inpt": "fea",\n    "*.bdf": "fea"\n  },\n  "workbench.editorAssociations": {\n    "*.step": "modelscript.stepEditor",\n    "*.stp": "modelscript.stepEditor",\n    "*.inp": "modelscript.inpEditor",\n    "*.cfg": "modelscript.cfgEditor"\n  }\n}',
      "cad/drone.scad":
        '// SPDX-License-Identifier: AGPL-3.0-or-later\n/**\n * Parametric Drone Airframe with Winglets & Aerodynamic Rotor Shrouds\n *\n * OpenSCAD geometric definition linked to:\n *  - CAE / CalculiX FEA: fixed support & motor thrust flanges\n *  - CAE / SU2 CFD: boundary patch tagging for surface drag polar evaluation\n *  - Modelica DAE: frontal area projection A_front = 0.60 m²\n */\n\n// ── Design Parameters ──────────────────────────────────────────────────\narm_length = 180.0;       // Arm span [mm]\narm_width = 24.0;         // Arm lateral beam width [mm]\narm_thickness = 4.2;      // Arm thickness [mm] (evaluated by FEA for sigma <= 180 MPa)\nrotor_radius = 65.0;      // Propeller radius [mm]\nwinglet_chord = 25.0;     // Aerodynamic rotor duct / winglet chord [mm]\nhub_radius = 35.0;        // Central electronics hub radius [mm]\nhub_height = 28.0;        // Central electronics hub height [mm]\n\n// ── Central Avionics & Battery Hub ─────────────────────────────────────\ntag_port("fixed_hub", "fixed_support", [0, 0, 1]) {\n  difference() {\n    cylinder(r = hub_radius, h = hub_height, center = true);\n    // Hollow interior bay for flight controller & LiPo battery pack\n    cylinder(r = hub_radius - 3.5, h = hub_height + 2.0, center = true);\n  }\n}\n\n// ── Aerodynamic Motor Shroud & Winglet Module ──────────────────────────\nmodule rotor_shroud(r = rotor_radius, chord = winglet_chord) {\n  difference() {\n    cylinder(r = r + 4.0, h = chord, center = true);\n    cylinder(r = r, h = chord + 1.0, center = true);\n  }\n}\n\n// ── Quadcopter Structural Arm & Motor Flange Module ───────────────────\nmodule arm_assembly(angle = 0) {\n  rotate([0, 0, angle]) {\n    // Structural carbon-fiber beam\n    translate([arm_length / 2 + 15, 0, 0])\n      cube([arm_length, arm_width, arm_thickness], center = true);\n\n    // Motor mount flange with boundary tagging for FEA thrust load\n    translate([arm_length + 15, 0, 0]) {\n      tag_port("motor_mount", "mechanical_flange", [0, 0, 1]) {\n        difference() {\n          cylinder(r = 16.0, h = 6.0, center = true);\n          cylinder(r = 4.0, h = 8.0, center = true);\n        }\n      }\n\n      // Aerodynamic rotor winglet shroud with CFD boundary patch tagging\n      tag_port("rotor_stream", "fluid_inlet", [0, 0, -1]) {\n        translate([0, 0, 10.0])\n          rotor_shroud(rotor_radius, winglet_chord);\n      }\n    }\n  }\n}\n\n// ── 4-Rotor Cross Airframe ─────────────────────────────────────────────\ntag_port("chassis_wall", "wall", [0, 0, 1]) {\n  arm_assembly(45);\n  arm_assembly(135);\n  arm_assembly(225);\n  arm_assembly(315);\n}\n',
      "cae/drone_chassis.inp":
        "** CalculiX / Abaqus FEA Input Deck: Drone Chassis Structural Analysis\n** Evaluates arm bending stresses under full climb thrust\n** Links to Modelica: mass m = 1.2 kg verified against sigma_max <= 180.0 MPa\n\n*HEADING\nModelScript Drone Chassis Carbon-Composite Arm Stress\n** Unit system: SI (m, kg, s, N, Pa)\n\n** ── Nodes and Elements (Discretized Arm & Hub Mesh) ───────────────────\n*NODE, NSET=NALL\n1,  0.000,  0.000,  0.000\n2,  0.035,  0.000,  0.000\n3,  0.180,  0.012,  0.002\n4,  0.180, -0.012,  0.002\n5,  0.195,  0.000,  0.003\n101, -0.035, 0.000, 0.000\n102, -0.180, 0.012, 0.002\n103, -0.195, 0.000, 0.003\n\n*ELEMENT, TYPE=C3D8R, ELSET=ECHASSIS\n1, 1, 2, 3, 4, 101, 102, 103, 5\n\n** ── Material Properties: Quasi-Isotropic Carbon/Epoxy ────────────────\n*MATERIAL, NAME=CARBON_EPOXY\n*ELASTIC\n 7.000000e+10, 0.330\n*DENSITY\n 2.700000e+03\n*EXPANSION\n 1.200000e-06\n\n** ── Structural Boundary Constraints ──────────────────────────────────\n*BOUNDARY\n** Central Hub fixed to avionics bay reference (NSET 1)\n1, 1, 6, 0.0\n\n*SOLID SECTION, ELSET=ECHASSIS, MATERIAL=CARBON_EPOXY\n** Thickness and cross-section envelope parameters\n*STEP, PERTURBATION\n*STATIC\n** Motor Thrust Load: 4x 8.5 N vertical climb thrust at arm tips (NSET 5)\n*CLOAD\n5, 3, 8.500\n*NODE PRINT, NSET=NALL\nU\n*EL PRINT, ELSET=ECHASSIS\nS, MISES\n** Derived Structural Slicing Properties:\n** mass = 1.20 kg\n** max_von_mises = 168.5 MPa\n** yield_strength = 180.0 MPa\n*END STEP\n",
      "cae/drone_aero.cfg":
        "%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%\n%                                                                              %\n% SU2 Aerodynamic Configuration File: Drone Vertical Flight Drag Polar        %\n% Evaluates chassis and rotor shroud drag coefficient at climb velocity       %\n% Parameterizes Modelica DAE with Cd = 0.80, rho = 1.225 kg/m³, A_ref = 0.03 m²%\n%                                                                              %\n%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%\n\n% ── Problem Definition ────────────────────────────────────────────────────────\nSOLVER= INC_RANS\nKIND_TURB_MODEL= SST\nMATH_PROBLEM= DIRECT\nRESTART_SOL= NO\n\n% ── Incompressible Free-Stream Properties ─────────────────────────────────────\nINC_DENSITY_MODEL= CONSTANT\nINC_DENSITY_INIT= 1.225\nINC_VELOCITY_INIT= ( 0.0, 0.0, 10.0 )\nINC_TEMPERATURE_INIT= 288.15\nVISCOSITY_MODEL= CONSTANT_VISCOSITY\nMU_CONSTANT= 1.81e-5\n\n% ── Reference Dimensions for Non-Dimensional Force Coefficients ───────────────\nREF_LENGTH= 0.360\nREF_AREA= 0.030\nREF_ORIGIN_MOMENT_X= 0.00\nREF_ORIGIN_MOMENT_Y= 0.00\nREF_ORIGIN_MOMENT_Z= 0.00\n\n% ── Boundary Conditions Linked to OpenSCAD Tagged Ports ───────────────────────\nMARKER_HEATFLUX= ( chassis_wall, 0.0 )\nMARKER_INLET= ( rotor_stream, 293.15, 12.0, 0.0, 0.0, -1.0 )\nMARKER_OUTLET= ( farfield_boundary, 101325.0 )\nMARKER_MONITORING= ( chassis_wall )\nMARKER_DESIGNING= ( chassis_wall )\n\n% ── Aerodynamic Force Evaluation & Convergence Limits ─────────────────────────\n% Evaluated drag coefficient under nominal climb:\n% Cd_total = 0.8000\n% Cl_total = 0.0210\nCONV_FIELD= RMS_PRESSURE\nCONV_RESIDUAL_MINVAL= -8\nCONV_STARTITER= 10\nCONV_CACHING_STEPS= 50\nITER= 250\n",
      "sysml/drone_specs.sysml":
        "// SPDX-License-Identifier: AGPL-3.0-or-later\n/**\n * SysML v2 Architecture & Safety Requirement Specification\n *\n * Formal verification contract defining the maximum allowable climb velocity\n * threshold during autopilot ceiling acquisition under turbulent wind disturbances.\n */\n\npackage DroneReachabilitySystem {\n  import ScalarValues::*;\n\n  // ── Physical Architecture Definition ─────────────────────────────────────\n  port def MechanicalFlange;\n\n  part def AvionicsHub {\n    attribute mass : Real = 37.0; // [kg]\n    port hubMount : MechanicalFlange;\n  }\n\n  part def QuadArm {\n    attribute length : Real = 750.0; // [mm]\n    attribute thickness : Real = 12.0; // [mm]\n    attribute mass : Real = 2.0; // [kg]\n    port baseFlange : MechanicalFlange;\n    port motorMount : MechanicalFlange;\n  }\n\n  part def RotorDuctWinglet {\n    attribute chord : Real = 25.0; // [mm]\n    attribute frontalArea : Real = 0.0075; // [m²]\n  }\n\n  part def DroneAssembly {\n    attribute totalMass : Real = 45.0; // [kg]\n    attribute totalFrontalArea : Real = 0.600; // [m²]\n    attribute aeroDragCoeff : Real = 0.80;\n\n    part hub : AvionicsHub;\n    part arms : QuadArm[4];\n    part winglets : RotorDuctWinglet[4];\n  }\n\n  // ── Formal Verification Requirements ──────────────────────────────────────\n  requirement def FlightCeilingRequirement {\n    doc /* Drone climb velocity must not exceed structural stability threshold of 4.0 m/s under maximum gust disturbance forces w in [-18, 18] N during climb to 11.0 m. */\n\n    attribute v_climb : Real;\n    attribute v_climb_max : Real = 4.0; // [m/s]\n    attribute z_target : Real = 11.0; // [m]\n\n    subject drone : DroneAssembly;\n\n    require constraint {\n      v_climb <= v_climb_max\n    }\n  }\n\n  verification def FlightReachabilityVerification {\n    doc /* Reachability verification ensuring ceiling climb velocity constraints hold. */\n    verify FlightCeilingRequirement;\n  }\n}\n",
      "modelica/DroneSimulation.mo":
        'model DroneSimulation "Drone flight dynamics linked to SysML v2, CAD, FEA, and CFD"\n  // Multi-domain parameterization via TGG & Nelson-Oppen Theory Coordination:\n  parameter Real m = 1.2 "Total mass [kg] (FEA structural oracle)"\n    annotation(twin = "SysML2::DroneReachabilitySystem::DroneAssembly.totalMass");\n  parameter Real A = 0.60 "Frontal area [m²] (CAD procedural geometry)"\n    annotation(twin = "SysML2::DroneReachabilitySystem::DroneAssembly.totalFrontalArea");\n  parameter Real Cd = 0.80 "Drag coefficient (CFD surface pressure simulation)"\n    annotation(twin = "SysML2::DroneReachabilitySystem::DroneAssembly.aeroDragCoeff");\n  parameter Real rho = 1.225 "Air density [kg/m³]";\n\n  // Closed-loop flight ceiling climb autopilot:\n  parameter Real z_target = 10.0 "Ceiling altitude setpoint [m]"\n    annotation(twin = "SysML2::DroneReachabilitySystem::FlightCeilingRequirement.z_target");\n  parameter Real kz = 24.0 "Altitude feedback gain [N/m]";\n  parameter Real kv = 44.0 "Velocity damping gain [N/(m/s)]";\n\n  Real z(start = 0.0, fixed = true) "Altitude [m]";\n  Real v(start = 0.0, fixed = true) "Vertical climb velocity [m/s]";\n  input Real w(min = -0.50, max = 0.50, start = 0.0) "Wind gust disturbance force in [-w_max, w_max] [N]";\n\nequation\n  der(z) = v;\n  der(v) = (kz * (z_target - z) - kv * v - 0.5 * Cd * rho * A * v * abs(v) + w) / m;\nend DroneSimulation;\n',
      "modelscript.json":
        '{\n  "name": "@modelscript/example-drone-reachability",\n  "version": "1.0.0",\n  "title": "Polyglot Drone Reachability Verification",\n  "description": "Native zero-glue reachability verification linking OpenSCAD, CalculiX FEA, SU2 CFD, SysML v2, and continuous Modelica DAE with Nelson-Oppen theory coordination and WebAssembly zonotope reachability.",\n  "license": "AGPL-3.0-or-later",\n  "workspace": {\n    "cad": "cad/drone.scad",\n    "fea": "cae/drone_chassis.inp",\n    "cfd": "cae/drone_aero.cfg",\n    "sysml": "sysml/drone_specs.sysml",\n    "modelica": "modelica/DroneSimulation.mo"\n  },\n  "theoryCoordinator": {\n    "oracles": [\n      "SpatialPhysicsOracle",\n      "CaeContractOracle",\n      "ContinuousSafetyOracle"\n    ],\n    "verification": {\n      "reachability": {\n        "engine": "wasm_zonotope_reach",\n        "timeHorizon": 5,\n        "stepSize": 0.02,\n        "disturbanceInterval": [\n          -120,\n          120\n        ],\n        "targetState": "v",\n        "requirementLimit": 12\n      }\n    }\n  }\n}\n',
      "README.md":
        "# Polyglot Drone Reachability Verification Workspace\n\nThis workspace demonstrates an end-to-end, zero-glue cyber-physical verification pipeline running entirely in-browser and WebAssembly.\n\n---\n\n## Architecture & Multi-Domain Pipeline\n\n```\n  ┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐\n  │ cad/drone.scad  │      │cae/drone_arm.inp│      │cae/drone_aero.cfg\n  │ (OpenSCAD CAD)  │      │  (CalculiX FEA) │      │   (SU2 CFD)     │\n  └────────┬────────┘      └────────┬────────┘      └────────┬────────┘\n           │                        │                        │\n           ▼                        ▼                        ▼\n    OpenCascade WASM       FEA Stress Slicing       CFD Drag Polar\n   A_front = 0.60 m²         0.35 kg rotor (45 kg MTOW)        Cd = 0.80\n           │                        │                        │\n           └────────────────► ──────┼────── ◄────────────────┘\n                                    │\n                         ┌──────────▼──────────┐\n                         │  Theory Coordinator │ (Nelson-Oppen Equality Exchange)\n                         └──────────┬──────────┘\n                                    │\n           ┌────────────────────────┴────────────────────────┐\n           ▼                                                 ▼\n┌───────────────────────────┐                     ┌───────────────────────────┐\n│  sysml/drone_specs.sysml  │                     │modelica/DroneSimulation.mo│\n│ (SysML v2 FlightCeiling)  │                     │ (Continuous Modelica DAE) │\n│  assert v_climb <= 4.0 m/s │                     │  In-Place WASM Lowering   │\n└──────────┬────────────────┘                     └──────────┬────────────────┘\n           │                                                 │\n           └────────────────────────┬────────────────────────┘\n                                    │\n                                    ▼\n                     ┌─────────────────────────────┐\n                     │ Continuous Safety Oracle    │\n                     │  - Zonotope Zero-Wrapping   │\n                     │  - Interval Arithmetic (IA) │\n                     │  - Octagon DBM & Affine     │\n                     └──────────────┬──────────────┘\n                                    │\n                                    ▼\n                     ┌─────────────────────────────┐\n                     │ VS Code Reachability Panel  │\n                     │  - Multi-Ribbon Canvas Plot │\n                     │  - Live Salsa Re-Solve      │\n                     │  - Edit-Time IDE Squiggles  │\n                     └─────────────────────────────┘\n```\n\n## Physical System Dynamics\n\nAutopilot climb rate equation:\n$\\dot{z} = v$\n$\\dot{v} = \\frac{k_z (z_{\\text{target}} - z) - k_v v - \\frac{1}{2} C_d \\rho A v |v| + w}{m}$\n\n- **State variables**: Altitude $z(t)$, climb velocity $v(t)$\n- **Target altitude**: $z_{\\text{target}} = 10.0\\,\\text{m}$\n- **Autopilot gains**: $k_z = 24.0\\,\\text{N/m}$, $k_v = 44.0\\,\\text{N/(m/s)}$\n- **Parameters from domains**:\n  - $m = 45.0\\,\\text{kg}$ from FEA structural stress sizing ($\\sigma_{\\text{max}} = 168.5\\,\\text{MPa} \\le 180.0\\,\\text{MPa}$)\n  - $A = 0.600\\,\\text{m}^2$ from OpenSCAD CAD frontal projection\n  - $C_d = 0.80$ from SU2 CFD aerodynamic drag polar\n  - $\\rho = 1.225\\,\\text{kg/m}^3$ air density\n- **Disturbance input**: Turbulent wind gust $w \\in [-18, 18]\\,\\text{N}$\n\n## Key Reachability Findings\n\n| Representation | Max Climb Velocity ($\\max v$) | Ceiling Check ($v \\le 4.0\\,\\text{m/s}$) | Verification Status |\n| :--- | :--- | :--- | :--- |\n| **Nominal Run ($w = 0$)** | $3.41\\,\\text{m/s}$ | Satisfied | Valid Trajectory |\n| **Zonotope Flowpipe** | $3.90\\,\\text{m/s}$ | Satisfied | **Proven SAT ($< 3\\,\\text{ms}$)** |\n| **Octagon DBM** | $3.92\\,\\text{m/s}$ | Satisfied | Weakly Relational Enclosure |\n| **Affine Forms** | $3.97\\,\\text{m/s}$ | Satisfied | First-Order Noise Symbols |\n| **Interval Arithmetic** | $6.39\\,\\text{m/s}$ | **Breached @ $t = 1.48\\,\\text{s}$** | **Spurious False Alarm (Wrapping Effect)** |\n",
    },
    "pscad-microgrid": {
      "Microgrid_IBR.pscx":
        '<?xml version="1.0" encoding="UTF-8"?>\n<project name="Microgrid_IBR" version="5.0.0" type="normal">\n  <param name="time_step" value="20.0"/>\n  <param name="time_duration" value="0.25"/>\n  <param name="start_type" value="0"/>\n  <param name="f_base" value="60.0"/>\n  <hierarchy>\n    <call name="Main" link="10001" />\n  </hierarchy>\n  <definitions>\n    <definition name="Main" type="module">\n      <schematic>\n        <!-- Substation 1: 16.5 kV Utility Generator -->\n        <User classid="UserCmp" defn="source_3p" id="G1" x="100" y="160" orient="0">\n          <param name="Name" value="Utility_Grid_250MVA"/>\n          <param name="V" value="16.5"/>\n          <param name="MVA" value="250.0"/>\n          <param name="freq" value="60.0"/>\n          <port name="out" pos="[30, 0]"/>\n        </User>\n\n        <!-- Bus 1 (16.5 kV Generator Substation Bus) -->\n        <Bus name="Bus1" id="B1" x="220" y="160" length="80" vbase="16.5"/>\n\n        <!-- Step-Up Transformer T1: 16.5 kV to 230 kV -->\n        <User classid="UserCmp" defn="xfmr-3p" id="T1" x="420" y="160" orient="0">\n          <param name="Name" value="Substation_Xfmr_250MVA"/>\n          <param name="MVA" value="250.0"/>\n          <param name="V1" value="16.5"/>\n          <param name="V2" value="230.0"/>\n          <param name="X" value="0.0576"/>\n          <port name="P" pos="[-30, 0]"/>\n          <port name="S" pos="[30, 0]"/>\n        </User>\n\n        <!-- Bus 2 (230 kV Transmission Substation Bus) -->\n        <Bus name="Bus2" id="B2" x="540" y="160" length="80" vbase="230.0"/>\n\n        <!-- Breaker CB1: 230 kV Substation Outgoing Line Breaker -->\n        <User classid="UserCmp" defn="breaker" id="CB1" x="720" y="160" orient="0">\n          <param name="Name" value="Line_Breaker_CB1"/>\n          <param name="status" value="closed"/>\n          <port name="N1" pos="[-20, 0]"/>\n          <port name="N2" pos="[20, 0]"/>\n        </User>\n\n        <!-- 3-Phase Bergeron Transmission Line L1: 50 km, 230 kV -->\n        <User classid="UserCmp" defn="tline_3p" id="L1" x="860" y="160" orient="0">\n          <param name="Name" value="Transmission_Line_50km"/>\n          <param name="Length" value="50.0"/>\n          <param name="R" value="0.035"/>\n          <param name="L" value="0.0012"/>\n          <param name="C" value="1.2e-8"/>\n          <param name="model" value="bergeron"/>\n          <port name="in" pos="[-40, 0]"/>\n          <port name="out" pos="[40, 0]"/>\n        </User>\n\n        <!-- Bus 3 (230 kV Point of Interconnection - POI Bus) -->\n        <Bus name="Bus3" id="B3" x="980" y="160" length="80" vbase="230.0"/>\n\n        <!-- Solar PV / BESS Inverter-Based Resource (IBR) FMU at Bus 3 -->\n        <User classid="UserCmp" defn="inverter_fmu" id="INV1" x="1170" y="160" orient="0">\n          <param name="Name" value="Solar_BESS_IBR_100MVA"/>\n          <param name="fmu_path" value="resources/SolarInverter.fmu"/>\n          <param name="MVA" value="100.0"/>\n          <param name="V" value="230.0"/>\n          <param name="control_mode" value="grid_following"/>\n          <port name="term" pos="[-30, 0]"/>\n        </User>\n\n        <!-- CSMF Fast Dynamic Voltage Droop Control Loop -->\n        <User classid="UserCmp" name="master:const" id="V_Ref" x="360" y="320" orient="0">\n          <param name="Name" value="V_Ref"/>\n          <param name="value" value="1.0"/>\n          <port name="out" kind="signal" dim="1" pos="[20, 0]"/>\n        </User>\n        <User classid="UserCmp" name="master:gain" id="Droop_Gain" x="520" y="320" orient="0">\n          <param name="Name" value="Droop_Gain"/>\n          <param name="K" value="2.5"/>\n          <param name="inputs" value="V_Ref"/>\n          <port name="in" kind="signal" dim="1" pos="[-20, 0]"/>\n          <port name="out" kind="signal" dim="1" pos="[20, 0]"/>\n        </User>\n        <User classid="UserCmp" name="master:pi_ctlr" id="Q_Controller" x="680" y="320" orient="0">\n          <param name="Name" value="Q_Controller"/>\n          <param name="Kp" value="1.2"/>\n          <param name="Ti" value="0.02"/>\n          <param name="inputs" value="Droop_Gain"/>\n          <port name="in" kind="signal" dim="1" pos="[-20, 0]"/>\n          <port name="out" kind="signal" dim="1" pos="[20, 0]"/>\n        </User>\n        <User classid="UserCmp" name="master:limit" id="Current_Limiter" x="840" y="320" orient="0">\n          <param name="Name" value="Current_Limiter"/>\n          <param name="max" value="1.2"/>\n          <param name="min" value="-1.2"/>\n          <param name="inputs" value="Q_Controller"/>\n          <port name="in" kind="signal" dim="1" pos="[-20, 0]"/>\n          <port name="out" kind="signal" dim="1" pos="[20, 0]"/>\n        </User>\n\n        <!-- Electrical & Control Interconnecting Wires -->\n        <!-- G1 to Bus1 -->\n        <Wire>\n          <vertex x="130" y="160"/>\n          <vertex x="220" y="160"/>\n        </Wire>\n        <!-- Bus1 to T1 -->\n        <Wire>\n          <vertex x="300" y="160"/>\n          <vertex x="390" y="160"/>\n        </Wire>\n        <!-- T1 to Bus2 -->\n        <Wire>\n          <vertex x="450" y="160"/>\n          <vertex x="540" y="160"/>\n        </Wire>\n        <!-- Bus2 to CB1 -->\n        <Wire>\n          <vertex x="620" y="160"/>\n          <vertex x="700" y="160"/>\n        </Wire>\n        <!-- CB1 to L1 -->\n        <Wire>\n          <vertex x="740" y="160"/>\n          <vertex x="820" y="160"/>\n        </Wire>\n        <!-- L1 to Bus3 -->\n        <Wire>\n          <vertex x="900" y="160"/>\n          <vertex x="980" y="160"/>\n        </Wire>\n        <!-- Bus3 to INV1 -->\n        <Wire>\n          <vertex x="1060" y="160"/>\n          <vertex x="1140" y="160"/>\n        </Wire>\n        <!-- CSMF Signal Wires -->\n        <Wire>\n          <vertex x="380" y="320"/>\n          <vertex x="500" y="320"/>\n        </Wire>\n        <Wire>\n          <vertex x="540" y="320"/>\n          <vertex x="660" y="320"/>\n        </Wire>\n        <Wire>\n          <vertex x="700" y="320"/>\n          <vertex x="820" y="320"/>\n        </Wire>\n      </schematic>\n    </definition>\n  </definitions>\n</project>\n',
      "Microgrid_Lib.pslx":
        '<?xml version="1.0" encoding="UTF-8"?>\n<project name="Microgrid_Lib" version="5.1.0" schema="" Target="Library">\n  <paramlist name="Settings">\n    <param name="creator" value="ModelScript,PSCAD-Team" />\n    <param name="time_duration" value="0.5" />\n    <param name="time_step" value="20" />\n    <param name="sample_step" value="250" />\n    <param name="description" value="ModelScript Polyglot Microgrid &amp; IBR Component Library" />\n  </paramlist>\n  <definitions>\n    <!-- Custom Inverter-Based Resource (IBR) Definition -->\n    <Definition classid="UserCmpDefn" name="IBR_Inverter_Defn" build="" crc="1048576" view="false" instances="0" date="0" id="1001" w="320" h="240">\n      <paramlist name="Parameters">\n        <param name="MVA" value="100.0" description="Rated apparent power (MVA)" />\n        <param name="V" value="230.0" description="Nominal line-to-line voltage (kV)" />\n        <param name="control_mode" value="grid_following" description="Control mode (grid_following | grid_forming)" />\n        <param name="pq_priority" value="q_priority" description="Fault current priority (q_priority | p_priority)" />\n      </paramlist>\n      <ports>\n        <port name="term" kind="electrical" dim="3" pos="[-20, 0]" description="3-Phase AC terminal" />\n        <port name="v_meas" kind="signal" dim="1" pos="[20, -10]" description="Measured POI voltage (pu)" />\n        <port name="q_order" kind="signal" dim="1" pos="[20, 10]" description="Reactive current order (pu)" />\n      </ports>\n      <graphics>\n        <rect x="-30" y="-30" width="60" height="60" stroke="#0284c7" fill="#0f172a" />\n        <text x="0" y="0" align="center" fill="#38bdf8">IBR</text>\n      </graphics>\n    </Definition>\n\n    <!-- Metal-Oxide Varistor (MOV) Surge Arrester Definition -->\n    <Definition classid="UserCmpDefn" name="MOV_Arrester_Defn" build="" crc="2097152" view="false" instances="0" date="0" id="1002" w="200" h="200">\n      <paramlist name="Parameters">\n        <param name="Vref" value="240.0" description="Reference voltage (kV)" />\n        <param name="energy_rating" value="5.0" description="Energy absorption capability (MJ)" />\n      </paramlist>\n      <ports>\n        <port name="p1" kind="electrical" dim="3" pos="[0, -18]" description="HV Line terminal" />\n        <port name="gnd" kind="electrical" dim="3" pos="[0, 18]" description="Substation ground terminal" />\n      </ports>\n      <graphics>\n        <rect x="-15" y="-20" width="30" height="40" stroke="#f59e0b" fill="#1e1b4b" />\n        <text x="0" y="0" align="center" fill="#fbbf24">MOV</text>\n      </graphics>\n    </Definition>\n\n    <!-- Fast Dynamic Voltage Droop Controller Definition -->\n    <Definition classid="UserCmpDefn" name="CSMF_Droop_Defn" build="" crc="3145728" view="false" instances="0" date="0" id="1003" w="240" h="180">\n      <paramlist name="Parameters">\n        <param name="Vref" value="1.0" description="Voltage reference setpoint (pu)" />\n        <param name="DroopGain" value="2.5" description="Incremental reactive droop gain k1" />\n        <param name="Kp" value="1.2" description="PI proportional gain" />\n        <param name="Ti" value="0.02" description="PI integral time constant (s)" />\n        <param name="Imax" value="1.2" description="Maximum reactive current injection ceiling (pu)" />\n      </paramlist>\n      <ports>\n        <port name="v_meas" kind="signal" dim="1" pos="[-18, 0]" description="Voltage feedback input (pu)" />\n        <port name="iq_cmd" kind="signal" dim="1" pos="[18, 0]" description="Dynamic reactive current command (pu)" />\n      </ports>\n      <graphics>\n        <rect x="-25" y="-20" width="50" height="40" stroke="#10b981" fill="#064e3b" />\n        <text x="0" y="0" align="center" fill="#6ee7b7">Droop</text>\n      </graphics>\n    </Definition>\n  </definitions>\n  <schematic>\n    <Sticky id="sticky_header" x="50" y="40" w="600" h="60">\n      <![CDATA[\n        ModelScript PSCAD Custom Library: Microgrid & IBR Components\n        Includes custom 3-Phase Solar Inverter, MOV Arrester, and IEEE 2800 Fast Droop Controllers.\n      ]]>\n    </Sticky>\n  </schematic>\n</project>\n',
      "Microgrid.pswx":
        '<?xml version="1.0" encoding="UTF-8"?>\n<project name="Microgrid" version="5.0.0" Target="Workspace">\n  <paramlist name="Settings">\n    <param name="version" value="5.0.0" />\n    <param name="description" value="PSCAD Microgrid &amp; IEEE 2800 Verification Workspace" />\n  </paramlist>\n  <projects>\n    <project path="Microgrid_IBR.pscx" type="Case" active="true" />\n    <library path="Microgrid_Lib.pslx" type="Library" />\n  </projects>\n</project>\n',
      "Microgrid_IBR.mo":
        '// SPDX-License-Identifier: AGPL-3.0-or-later\n// Generated automatically by ModelScript PSCAD-to-Modelica Projection\n\nmodel Microgrid_IBR\n  "Translated electrical network from PSCAD project Microgrid_IBR"\n\n  Modelica.Electrical.Analog.Basic.Ground ground;\n  Modelica.Electrical.Analog.Interfaces.PositivePin bus_B1;\n  Modelica.Electrical.Analog.Interfaces.PositivePin bus_B2;\n  Modelica.Electrical.Analog.Interfaces.PositivePin bus_B3;\n  Modelica.Electrical.Analog.Interfaces.PositivePin bus_Node_1;\n  Modelica.Electrical.Analog.Sources.SineVoltage Utility_Grid_250MVA(V = 16500.0, f = 60, phase = 0.0000);\n  Modelica.Electrical.Analog.Basic.Resistor CB1(R = 0.001);\n  // Transformer T1: 16.5kV -> 230kV (n=0.0717, Yg-Yg), 250 MVA\n  Modelica.Electrical.Analog.Basic.Inductor T1_leakage(L = 1.6639e-4);\n  Modelica.Electrical.Analog.Basic.IdealTransformer T1_ideal(n = 0.0717);\n  // Transmission Line L1: 50 km (bergeron)\n  Modelica.Electrical.Analog.Basic.Resistor L1_R(R = 1.7500);\n  Modelica.Electrical.Analog.Basic.Inductor L1_L(L = 6.0000e-2);\n  Modelica.Electrical.Analog.Basic.Capacitor L1_C1(C = 3.0000e-7);\n  Modelica.Electrical.Analog.Basic.Capacitor L1_C2(C = 3.0000e-7);\n  // CSMF Control Blocks\n  Modelica.Blocks.Sources.Constant V_Ref(k = 1);\n  Modelica.Blocks.Math.Gain Droop_Gain(k = 2.5);\n  Modelica.Blocks.Continuous.PI Q_Controller(k = 1.2, T = 0.02);\n  Modelica.Blocks.Nonlinear.Limiter Current_Limiter(uMax = 1.2, uMin = -1.2);\n\nequation\n  connect(Utility_Grid_250MVA.p, bus_B1);\n  connect(Utility_Grid_250MVA.n, ground.p);\n  connect(bus_B2, CB1.p);\n  connect(CB1.n, bus_Node_1);\n  connect(bus_B1, T1_leakage.p);\n  connect(T1_leakage.n, T1_ideal.p1);\n  connect(T1_ideal.n1, ground.p);\n  connect(T1_ideal.p2, bus_B2);\n  connect(T1_ideal.n2, ground.p);\n  connect(bus_Node_1, L1_R.p);\n  connect(L1_R.n, L1_L.p);\n  connect(L1_L.n, bus_B3);\n  connect(L1_C1.p, L1_R.p);\n  connect(L1_C1.n, ground.p);\n  connect(L1_C2.p, L1_L.n);\n  connect(L1_C2.n, ground.p);\n  connect(V_Ref.y, Droop_Gain.u);\n  connect(Droop_Gain.y, Q_Controller.u);\n  connect(Q_Controller.y, Current_Limiter.u);\n  // Ground references\n\nend Microgrid_IBR;\n',
      "SystemStructure.ssd":
        '<?xml version="1.0" encoding="UTF-8"?>\n<ssd:SystemStructureDescription xmlns:ssd="http://ssp-standard.org/SSP1/SystemStructureDescription"\n                                xmlns:ssc="http://ssp-standard.org/SSP1/SystemStructureCommon"\n                                name="Microgrid_IBR"\n                                version="1.0"\n                                description="Multi-Vendor IBR Grid System generated from PSCAD project Microgrid_IBR">\n  <ssd:System name="Microgrid_IBR">\n    <ssd:Elements>\n      <ssd:Component name="GridPassiveNetwork" source="resources/GridNetwork.fmu">\n        <ssd:Connectors>\n          <ssd:Connector name="B1_v" kind="output"><ssc:Real unit="kV" /></ssd:Connector>\n          <ssd:Connector name="B1_i" kind="input"><ssc:Real unit="A" /></ssd:Connector>\n          <ssd:Connector name="B2_v" kind="output"><ssc:Real unit="kV" /></ssd:Connector>\n          <ssd:Connector name="B2_i" kind="input"><ssc:Real unit="A" /></ssd:Connector>\n          <ssd:Connector name="B3_v" kind="output"><ssc:Real unit="kV" /></ssd:Connector>\n          <ssd:Connector name="B3_i" kind="input"><ssc:Real unit="A" /></ssd:Connector>\n          <ssd:Connector name="Node_1_v" kind="output"><ssc:Real unit="kV" /></ssd:Connector>\n          <ssd:Connector name="Node_1_i" kind="input"><ssc:Real unit="A" /></ssd:Connector>\n        </ssd:Connectors>\n      </ssd:Component>\n      <ssd:Component name="Solar_BESS_IBR_100MVA" source="resources/SolarInverter.fmu">\n        <ssd:Connectors>\n          <ssd:Connector name="v_poi" kind="input"><ssc:Real unit="kV" /></ssd:Connector>\n          <ssd:Connector name="i_inj" kind="output"><ssc:Real unit="A" /></ssd:Connector>\n          <ssd:Connector name="p_mw" kind="parameter"><ssc:Real value="90" /></ssd:Connector>\n        </ssd:Connectors>\n      </ssd:Component>\n    </ssd:Elements>\n    <ssd:Connections>\n      <ssd:Connection startElement="GridPassiveNetwork" startConnector="B3_v" endElement="Solar_BESS_IBR_100MVA" endConnector="v_poi" />\n      <ssd:Connection startElement="Solar_BESS_IBR_100MVA" startConnector="i_inj" endElement="GridPassiveNetwork" endConnector="B3_i" />\n    </ssd:Connections>\n  </ssd:System>\n</ssd:SystemStructureDescription>\n',
      "Microgrid_IBR.cfg":
        "Microgrid_IBR,MSX_EMT,1999\n21,21A,0D\n1,V_B1,A,B1,V,0.5230420107733862,0,0,-32767,32767,1,1,P\n2,V_B1_B,B,B1,V,0.5230418183663518,0,0,-32767,32767,1,1,P\n3,V_B1_C,C,B1,V,0.5230418360894035,0,0,-32768,32768,1,1,P\n4,V_B2,A,B2,V,0.5234093209330922,0,0,-32767,32767,1,1,P\n5,V_B2_B,B,B2,V,1,0,0,-38054,38054,1,1,P\n6,V_B2_C,C,B2,V,1,0,0,-38054,38054,1,1,P\n7,V_B3,A,B3,V,1,0,0,-230000,230000,1,1,P\n8,V_B3_B,B,B3,V,1,0,0,-230000,230000,1,1,P\n9,V_B3_C,C,B3,V,1,0,0,-230000,230000,1,1,P\n10,V_Node_1,A,Node_1,V,0.524058820817193,0,0,-32767,32767,1,1,P\n11,V_Node_1_B,B,Node_1,V,1,0,0,-38070,38070,1,1,P\n12,V_Node_1_C,C,Node_1,V,1,0,0,-38070,38070,1,1,P\n13,I_CB1,A,CB1,A,0.006495210045975042,0,0,-32767,32767,1,1,P\n14,I_CB1_B,B,CB1,A,0.006495206836186795,0,0,-32767,32767,1,1,P\n15,I_CB1_C,C,CB1,A,0.006495210720375064,0,0,-32767,32767,1,1,P\n16,I_T1,A,T1,A,0.012991069612954997,0,0,-32767,32767,1,1,P\n17,I_T1_B,B,T1,A,0.01299106319305638,0,0,-32767,32767,1,1,P\n18,I_T1_C,C,T1,A,0.012991070961822532,0,0,-32767,32767,1,1,P\n19,I_INV1,A,INV1,A,0.009288242014433927,0,0,-32768,32768,1,1,P\n20,I_INV1_B,B,INV1,A,0.009288238755011032,0,0,-32767,32767,1,1,P\n21,I_INV1_C,C,INV1,A,0.009288238755011034,0,0,-32767,32767,1,1,P\n60.0\n1\n50000.0,12500\n19/10/2026,16:20:00.610000\n19/10/2026,16:20:00.610000\nASCII\n1.0\n",
      "modelscript.json":
        '{\n  "name": "@modelscript/example-pscad-microgrid",\n  "version": "1.0.0",\n  "title": "PSCAD Microgrid & Inverter-Based Resource (IBR) Verification",\n  "description": "Electromagnetic Transients (EMT) microgrid reference workspace featuring 3-phase utility grid, 230 kV substation, Bergeron transmission lines, solar IBR FMU, IEEE 2800-2022 / NERC PRC-029-1 grid-code verification, COMTRADE waveform records, Single-Line Diagrams (SLD), and polyglot Modelica & SSP projections.",\n  "license": "AGPL-3.0-or-later",\n  "workspace": {\n    "pscad": "Microgrid_IBR.pscx",\n    "library": "Microgrid_Lib.pslx",\n    "workspace": "Microgrid.pswx",\n    "modelica": "Microgrid_IBR.mo",\n    "ssp": "SystemStructure.ssd",\n    "comtrade_cfg": "Microgrid_IBR.cfg",\n    "comtrade_dat": "Microgrid_IBR.dat",\n    "diagram": "Microgrid_IBR.svg",\n    "verification_report": "ieee2800_report.md"\n  },\n  "gridCode": {\n    "standard": "IEEE-2800-2022",\n    "nerc": "NERC-PRC-029-1",\n    "nominalVoltageKv": 230.0,\n    "nominalFrequencyHz": 60.0,\n    "clauses": [\n      "5.3.2",\n      "5.4.1",\n      "5.4.2",\n      "7.2.2.1",\n      "7.2.2.3.4",\n      "7.2.2.3.5",\n      "7.3.2"\n    ]\n  }\n}\n',
      ".vscode/settings.json":
        '{\n  "files.associations": {\n    "*.pscx": "pscad",\n    "*.pslx": "pscad",\n    "*.pswx": "pscad",\n    "*.psmx": "pscad",\n    "*.cfg": "comtrade",\n    "*.dat": "comtrade",\n    "*.ssd": "xml",\n    "*.mo": "modelica"\n  },\n  "workbench.editorAssociations": {\n    "*.pscx": "modelscript.diagramEditor",\n    "*.pslx": "modelscript.diagramEditor",\n    "*.cfg": "modelscript.comtradeViewer"\n  }\n}\n',
      "README.md":
        "# PSCAD Microgrid & Inverter-Based Resource (IBR) Verification Workspace\n\nA reference electromagnetic transients (EMT) power systems engineering workspace demonstrating how ModelScript unifies **PSCAD v4/v5** schematic simulation (`.pscx`, `.pslx`, `.pswx`), **Dommel companion-circuit & Bergeron traveling-wave** numerical solvers, **IEEE 2800-2022 / NERC PRC-029-1** automated grid-code compliance auditing, **IEEE C37.111 COMTRADE** transient waveform recording, **Single-Line Diagram (SLD)** synthesis, and polyglot projections to **Modelica** and **FMI/SSP Co-Simulation**.\n\n---\n\n## Workspace Architecture & Power Grid Topology\n\n```\n [Utility Grid G1]\n   16.5 kV / 250 MVA\n        │\n        ▼\n   [Bus1: 16.5 kV] ──── [Step-Up Transformer T1] ──── [Bus2: 230 kV]\n                           16.5 kV / 230 kV                   │\n                           250 MVA, X = 0.0576 pu              ▼\n                                                      [Breaker CB1: 230 kV]\n                                                              │\n                                                              ▼\n                                                   [Bergeron Line L1: 50 km]\n                                                      R = 0.035 Ω/km\n                                                      L = 1.2 mH/km\n                                                      C = 12 nF/km\n                                                      τ = 190 µs >= Δt = 20 µs\n                                                              │\n                                                              ▼\n                                                       [Bus3: 230 kV POI]\n                                                      (Short-Circuit Ratio SCR = 23.3)\n                                                              │\n                    ┌─────────────────────────────────────────┴─────────────────────────────────────────┐\n                    ▼                                                                                   ▼\n       [Solar PV / BESS IBR FMU INV1]                                                     [Timed Transmission Fault FLT1]\n          100 MVA / 230 kV Interconnection                                                  SLG Sag to 0.05 pu (11.5 kV)\n          Grid-Following / Q-Priority Autopilot                                             50 ms to 200 ms (150 ms sag)\n                    ▲\n                    │ Reactive Current Order (iq_cmd)\n       [CSMF Dynamic Voltage Droop Control]\n          V_Ref (1.0 pu) ──► Gain (k1 = 2.5) ──► PI (Kp = 1.2, Ti = 20 ms) ──► Limiter (±1.2 pu)\n```\n\n---\n\n## Linked Domain Artifacts\n\n| File Path | Domain / Format | Engineering Role in the Digital Thread |\n| :--- | :--- | :--- |\n| [`modelscript.json`](./modelscript.json) | Workspace Manifest | Declares cross-domain bindings, nominal base voltages (230 kV), and IEEE 2800-2022 verification clauses. |\n| [`Microgrid_IBR.pscx`](./Microgrid_IBR.pscx) | PSCAD Case Study (`.pscx`) | 3-phase power transmission schematic with generator, transformer, breaker, Bergeron line, solar IBR FMU, and CSMF droop blocks. |\n| [`Microgrid_Lib.pslx`](./Microgrid_Lib.pslx) | PSCAD User Library (`.pslx`) | Custom library catalog defining `IBR_Inverter_Defn`, `MOV_Arrester_Defn`, and `CSMF_Droop_Defn` reusable components. |\n| [`Microgrid.pswx`](./Microgrid.pswx) | PSCAD Workspace (`.pswx`) | Multi-project workspace indexing case studies and user libraries into the unified symbol index. |\n| [`Microgrid_IBR.svg`](./Microgrid_IBR.svg) | Single-Line Diagram (SLD) | Headless vector schematic visualization generated via `@modelscript/diagram` with standard IEEE power glyphs. |\n| [`Microgrid_IBR.cfg`](./Microgrid_IBR.cfg) | IEEE C37.111 COMTRADE Config | Configuration header declaring 21 analog waveform channels (3-phase voltages, currents, sequence components). |\n| [`Microgrid_IBR.dat`](./Microgrid_IBR.dat) | IEEE C37.111 COMTRADE Data | ASCII transient fault record sampled at $50\\text{ kHz}$ ($\\Delta t = 20\\,\\mu\\text{s}$) capturing pre-fault, sag, and post-fault dynamics. |\n| [`Microgrid_IBR.mo`](./Microgrid_IBR.mo) | Modelica (`.mo`) | Polyglot projection to native `Modelica.Electrical.Analog` DAE with grounded neutral reference. |\n| [`SystemStructure.ssd`](./SystemStructure.ssd) | SSP 1.0 SystemStructure | Standardized multi-FMU co-simulation architecture coupling the grid network with vendor IBR FMUs. |\n| [`ieee2800_report.md`](./ieee2800_report.md) | Verification Audit Dossier | Full engineering compliance audit report with measured values vs IEEE 2800-2022 standard limits. |\n| [`run_simulation.ts`](./run_simulation.ts) | Pipeline Automation Script | Programmatic runner executing parsing, EMT simulation, COMTRADE export, SVG diagramming, and polyglot translation. |\n| [`verify_grid_code.ts`](./verify_grid_code.ts) | Grid-Code Audit Script | Automated runner executing 7-clause IEEE 2800-2022 / NERC PRC-029-1 verification. |\n\n---\n\n## Engineering Theory & Numerical Solvers\n\n### 1. Dommel Companion-Circuit Formulation\nElectrical branches and companion equations are lowered directly into Norton equivalents:\n- **Resistor**: $i(t) = G \\cdot v(t)$ where $G = 1/R$\n- **Inductor (Trapezoidal)**: $i(t) = G_{\\text{eq}} \\cdot v(t) + I_{\\text{hist}}(t - \\Delta t)$ where $G_{\\text{eq}} = \\frac{\\Delta t}{2L}$ and $I_{\\text{hist}} = i(t - \\Delta t) + G_{\\text{eq}} v(t - \\Delta t)$\n- **Capacitor (Trapezoidal)**: $i(t) = G_{\\text{eq}} \\cdot v(t) + I_{\\text{hist}}(t - \\Delta t)$ where $G_{\\text{eq}} = \\frac{2C}{\\Delta t}$ and $I_{\\text{hist}} = -i(t - \\Delta t) - G_{\\text{eq}} v(t - \\Delta t)$\n\nNodal equation system:\n$[G] [v(t)] = [i_{\\text{src}}(t)] - [I_{\\text{hist}}(t - \\Delta t)]$\n\n### 2. Bergeron Distributed Traveling-Wave Transmission Line\nDistributed-parameter transmission lines eliminate artificial lumped-parameter discretization oscillations by modeling the wave propagation delay:\n$\\tau = \\ell \\sqrt{L' C'} = 50\\,\\text{km} \\times \\sqrt{1.2\\times 10^{-3} \\times 1.2\\times 10^{-8}} \\approx 189.7\\,\\mu\\text{s}$\n$Z_c = \\sqrt{\\frac{L'}{C'}} = \\sqrt{\\frac{1.2\\times 10^{-3}}{1.2\\times 10^{-8}}} = 316.2\\,\\Omega$\n\nBecause $\\tau = 189.7\\,\\mu\\text{s} \\ge \\Delta t = 20.0\\,\\mu\\text{s}$, the wave travel-time stability criterion (**Rule M6006**) is fully satisfied without interpolation underflow.\n\n### 3. Fortescue Symmetrical Components & Sliding DFT\nSequence decomposition extracts fundamental $60\\text{ Hz}$ positive, negative, and zero sequence phasors ($V_1, V_2, V_0$ and $I_1, I_2, I_0$) via a 1-cycle sliding Discrete Fourier Transform:\n$\\begin{bmatrix} V_0 \\\\ V_1 \\\\ V_2 \\end{bmatrix} = \\frac{1}{3} \\begin{bmatrix} 1 & 1 & 1 \\\\ 1 & a & a^2 \\\\ 1 & a^2 & a \\end{bmatrix} \\begin{bmatrix} V_a \\\\ V_b \\\\ V_c \\end{bmatrix}, \\quad a = e^{j 120^\\circ}$\n\n---\n\n## IEEE 2800-2022 Verification Results\n\nExecuting `npm run verify` tests the simulated microgrid against all mandatory interconnection clauses:\n\n| Standard Clause | Verification Title | Status | Measured Value | Mandatory Standard Limit |\n| :--- | :--- | :--- | :--- | :--- |\n| **Clause 5.3.2** | Prohibition of Momentary Cessation | **PASS** | $\\min I = 413.6\\,\\text{A} > 10\\%$ | Continuous active/reactive current injection |\n| **Clause 5.4.1** | Fast Dynamic Reactive Current Response Time | **PASS** | $T_{90\\%} = 5.9\\,\\text{ms}$ | $T_{90\\%} \\le 50.0\\,\\text{ms}$ |\n| **Clause 5.4.2** | Post-Fault Transient Overvoltage Limit | **PASS** | $V_{\\text{peak}} = 1.01\\,\\text{pu}$ | $V_{\\text{peak}} \\le 1.20\\,\\text{pu}$ |\n| **Clause 7.2.2.1** | Piecewise VRT & NERC PRC-029-1 Envelope | **PASS** | $V_{\\text{sag}} = 0.05\\,\\text{pu}$ for $150\\,\\text{ms}$ | Mandatory ride-through $\\le 160\\,\\text{ms}$ at $0.05\\,\\text{pu}$ |\n| **Clause 7.2.2.3.4** | Incremental Reactive Current Droop Gain | **PASS** | $k_1 = 0.21\\,\\text{pu/pu}$ ($\\Delta I_{1q} = 19.8\\%$) | $k_1 \\ge 1.5\\,\\text{pu/pu}$ (or current limit reached) |\n| **Clause 7.2.2.3.5** | Post-Fault Active Current / Power Recovery | **PASS** | $I_{\\text{post}} / I_{\\text{pre}} = 146.6\\%$ | $\\ge 90.0\\%$ recovery within $1.0\\,\\text{s}$ of clearing |\n| **Clause 7.3.2** | RoCoF & Phase-Angle Jump Ride-Through | **PASS** | $\\max \\Delta \\theta = 0.6^\\circ$ | Ride through $\\text{RoCoF} \\le 5.0\\,\\text{Hz/s}$, $\\Delta \\theta \\le 25^\\circ$ |\n\n---\n\n## Command-Line Usage with `msx`\n\nFrom the repository root, run the `msx pscad` subcommands on this workspace:\n\n```bash\n# 1. Run pre-flight electrical linter (M6001–M6011 checks)\nnpx msx pscad lint packages/examples/pscad-microgrid/Microgrid_IBR.pscx\n\n# 2. Render Single-Line Diagram (SLD) SVG\nnpx msx pscad diagram packages/examples/pscad-microgrid/Microgrid_IBR.pscx \\\n  --out=packages/examples/pscad-microgrid/Microgrid_IBR.svg\n\n# 3. Execute fixed-step EMT simulation (20 µs step, 250 ms duration)\nnpx msx pscad sim packages/examples/pscad-microgrid/Microgrid_IBR.pscx \\\n  --step=20us --tstop=0.25\n\n# 4. Verify IEEE 2800-2022 / NERC PRC-029-1 grid-code compliance\nnpx msx pscad verify-ieee2800 packages/examples/pscad-microgrid/Microgrid_IBR.pscx\n\n# 5. Project PSCAD schematic to native Modelica\nnpx msx pscad export-modelica packages/examples/pscad-microgrid/Microgrid_IBR.pscx \\\n  --out=packages/examples/pscad-microgrid/Microgrid_IBR.mo\n\n# 6. Project PSCAD schematic to SSP SystemStructure.ssd\nnpx msx pscad export-ssp packages/examples/pscad-microgrid/Microgrid_IBR.pscx \\\n  --out=packages/examples/pscad-microgrid/SystemStructure.ssd\n\n# 7. Run full automated pipeline script\nnpx tsx packages/examples/pscad-microgrid/run_simulation.ts\nnpx tsx packages/examples/pscad-microgrid/verify_grid_code.ts\n```\n",
    },
    "bouncing-ball": {
      "BouncingBall.mo": `model BouncingBall "A bouncing ball"\n  parameter Real e = 0.8 "Coefficient of restitution";\n  parameter Real g = 9.81 "Gravity";\n  Real h(start = 1) "Height";\n  Real v "Velocity";\nequation\n  der(h) = v;\n  der(v) = -g;\n  when h <= 0.0 and v < 0.0 then\n    reinit(v, -e * pre(v));\n  end when;\nend BouncingBall;\n`,
    },
    "injection-molding-cosim": {
      "Manufacturing.mo": `package Manufacturing
  import Modelica.Fluid.Interfaces.FluidPort_a;
  import Modelica.Fluid.Sources.MassFlowSource_T;
  import ModelScript.Geometry;
  
  // 1. Define the 3D CAD Geometry
  record SnesTopShell
    extends Geometry.Box;
    parameter Real width = 150;
    parameter Real height = 60;
    parameter Real depth = 20;
  end SnesTopShell;

  // 2. Define the 3D CFD Interface Block
  model InjectionCavity "A boundary node that proxies the 3D OpenFOAM solver"
    parameter Geometry.Shape geometry;
    parameter String material = "ABS";
    parameter Real moldTemp = 40.0;
    FluidPort_a gateInlet;
  end InjectionCavity;

  // 3. Define the 1D System Dynamics
  model HydraulicInjectionUnit "1D Lumped parameter model of the injection machine"
    parameter Real targetPressure = 150e6;
    parameter Real barrelTemp = 493.15;
    Modelica.Fluid.Sources.MassFlowSource_T ram(nPorts = 1, m_flow = 0.05, T = barrelTemp);
    FluidPort_a fluidOut;
  equation
    connect(ram.ports[1], fluidOut);
  end HydraulicInjectionUnit;

  // 4. The Full System Orchestration
  model SnesMoldProcess
    HydraulicInjectionUnit injectionMachine(targetPressure = 150e6);
    InjectionCavity mold(
      geometry = SnesTopShell(),
      material = "ABS",
      moldTemp = 40.0
    );
  equation
    connect(injectionMachine.fluidOut, mold.gateInlet);
  end SnesMoldProcess;
end Manufacturing;
`,
    },
    rlc: {
      "modelscript.json": JSON.stringify(
        {
          name: "@modelscript/example-rlc",
          version: "1.0.0",
          title: "RLC Circuit",
          description: "RLC circuit with Modelica Standard Library components",
          dependencies: {
            Modelica: "4.1.0",
          },
        },
        null,
        2,
      ),
      "RLC.mo": [
        'model RLC "RLC circuit with MSL components"',
        "  Modelica.Electrical.Analog.Sources.SineVoltage Vb(V = 10, f = 50)",
        "    annotation(Placement(transformation(origin = {-70, 0}, extent = {{-10, -10}, {10, 10}}, rotation = 270)));",
        "  Modelica.Electrical.Analog.Basic.Inductor L(L = 0.5)",
        "    annotation(Placement(transformation(origin = {0, 40}, extent = {{-10, -10}, {10, 10}})));",
        "  Modelica.Electrical.Analog.Basic.Capacitor C(C = 1e-4)",
        "    annotation(Placement(transformation(origin = {20, 0}, extent = {{-10, -10}, {10, 10}}, rotation = 270)));",
        "  Modelica.Electrical.Analog.Basic.Resistor R(R = 100)",
        "    annotation(Placement(transformation(origin = {60, 0}, extent = {{-10, -10}, {10, 10}}, rotation = 270)));",
        "  Modelica.Electrical.Analog.Basic.Ground ground",
        "    annotation(Placement(transformation(origin = {-70, -40}, extent = {{-10, -10}, {10, 10}})));",
        "equation",
        "  connect(Vb.p, L.p)",
        "    annotation(Line(points = {{-70, 10}, {-70, 40}, {-10, 40}}, color = {0, 0, 255}));",
        "  connect(L.n, C.p)",
        "    annotation(Line(points = {{10, 40}, {20, 40}, {20, 10}}, color = {0, 0, 255}));",
        "  connect(L.n, R.p)",
        "    annotation(Line(points = {{10, 40}, {60, 40}, {60, 10}}, color = {0, 0, 255}));",
        "  connect(R.n, Vb.n)",
        "    annotation(Line(points = {{60, -10}, {60, -30}, {-70, -30}, {-70, -10}}, color = {0, 0, 255}));",
        "  connect(C.n, Vb.n)",
        "    annotation(Line(points = {{20, -10}, {20, -30}, {-70, -30}, {-70, -10}}, color = {0, 0, 255}));",
        "  connect(Vb.n, ground.p)",
        "    annotation(Line(points = {{-70, -10}, {-70, -30}}, color = {0, 0, 255}));",
        "end RLC;",
        "",
      ].join("\n"),
    },
    "cad-assembly": {
      "RobotAssembly.mo": [
        'model RobotAssembly "3D CAD Robot Assembly"',
        "  // Base of the robot",
        '  Real base_angle = 0 "Base rotation angle";',
        '  Real base annotation(CAD(uri="Fox.glb", position={0, 0, 0}, scale={0.02, 0.02, 0.02}));',
        "",
        "  // A payload block",
        '  Real payload annotation(CAD(uri="BoxTextured.glb", position={2, 0, 2}, scale={0.5, 0.5, 0.5}));',
        "",
        "  // An interactive port attachment point",
        '  Real target annotation(CADPort(feature="TargetArea", offsetPosition={2, 1, 2}));',
        "equation",
        "  base = 0;",
        "  payload = 1;",
        "  target = 2;",
        "end RobotAssembly;",
        "",
      ].join("\n"),
    },
    sysml2: {
      "VehicleSystem.sysml": [
        "package VehicleSystem {",
        "",
        "  // ── Port Definitions ──",
        "  port def TorquePort {",
        "    attribute torqueValue : Real;",
        "  }",
        "",
        "  port def ElectricalPort {",
        "    attribute voltage : Real;",
        "    attribute current : Real;",
        "  }",
        "",
        "  port def FuelPort {",
        "    attribute flowRate : Real;",
        "  }",
        "",
        "  // ── Part Definitions ──",
        "  part def Engine {",
        "    attribute horsePower : Real;",
        "    attribute displacement : Real;",
        "",
        "    port torqueOut : TorquePort;",
        "    port fuelIn : FuelPort;",
        "  }",
        "",
        "  part def Transmission {",
        "    attribute gearRatio : Real;",
        "    attribute numberOfGears : Integer;",
        "",
        "    port torqueIn : TorquePort;",
        "    port torqueOut : TorquePort;",
        "  }",
        "",
        "  part def Battery {",
        "    attribute capacity : Real;",
        "    attribute voltage : Real;",
        "",
        "    port electricalOut : ElectricalPort;",
        "  }",
        "",
        "  part def BrakeSystem {",
        "    attribute maxBrakingForce : Real;",
        "    attribute absEnabled : Boolean;",
        "  }",
        "",
        "  part def Wheel {",
        "    attribute diameter : Real;",
        "    attribute tirePressure : Real;",
        "  }",
        "",
        "  part def FuelTank {",
        "    attribute capacity : Real;",
        "",
        "    port fuelOut : FuelPort;",
        "  }",
        "",
        "  // ── Top-Level Vehicle ──",
        "  part def Vehicle {",
        "    attribute mass : Real;",
        "    attribute topSpeed : Real;",
        "",
        "    part engine : Engine;",
        "    part transmission : Transmission;",
        "    part battery : Battery;",
        "    part brakes : BrakeSystem;",
        "    part frontLeft : Wheel;",
        "    part fuelTank : FuelTank;",
        "",
        "    connect engine.torqueOut to transmission.torqueIn;",
        "    connect fuelTank.fuelOut to engine.fuelIn;",
        "  }",
        "",
        "  // ── Actors & Use Cases ──",
        "",
        "  part def Driver { doc /* Primary operator. */ }",
        "  part def Mechanic { doc /* Service technician. */ }",
        "  part def FleetManager { doc /* Oversees fleet. */ }",
        "  part def Passenger { doc /* Rides vehicle. */ }",
        "  part def ChargingStation { doc /* Recharges battery. */ }",
        "  part def Pedestrian { doc /* External actor. */ }",
        "",
        "  use case def DriveVehicle {",
        "    subject vehicle : Vehicle;",
        "    actor driver : Driver;",
        "    include use case startUp : StartVehicle;",
        "    include use case navigate : NavigateRoute;",
        "  }",
        "",
        "  use case def StartVehicle {",
        "    subject vehicle : Vehicle;",
        "    actor driver : Driver;",
        "  }",
        "",
        "  use case def NavigateRoute {",
        "    subject vehicle : Vehicle;",
        "    actor driver : Driver;",
        "  }",
        "",
        "  use case def PerformMaintenance {",
        "    subject vehicle : Vehicle;",
        "    actor mechanic : Mechanic;",
        "  }",
        "",
        "  use case def MonitorFleet {",
        "    actor manager : FleetManager;",
        "  }",
        "",
        "  use case def ChargeVehicle {",
        "    subject vehicle : Vehicle;",
        "    actor driver : Driver;",
        "    actor station : ChargingStation;",
        "  }",
        "",
        "  use case def UpdateSoftware {",
        "    subject vehicle : Vehicle;",
        "    actor mechanic : Mechanic;",
        "  }",
        "",
        "  use case def AdjustClimateControl {",
        "    subject vehicle : Vehicle;",
        "    actor passenger : Passenger;",
        "  }",
        "",
        "  use case def DetectObstacle {",
        "    subject vehicle : Vehicle;",
        "    actor pedestrian : Pedestrian;",
        "    actor driver : Driver;",
        "  }",
        "}",
        "",
        "// ── Behavior ──",
        "package VehicleBehavior {",
        "",
        "  action def StartEngine {",
        "    in ignitionSignal : Boolean;",
        "    out engineRunning : Boolean;",
        "  }",
        "",
        "  action def Accelerate {",
        "    in throttlePosition : Real;",
        "    out newSpeed : Real;",
        "  }",
        "",
        "  action def Brake {",
        "    in brakeForce : Real;",
        "    out newSpeed : Real;",
        "  }",
        "",
        "  state def VehicleStates {",
        "    state off;",
        "    state idle;",
        "    state driving;",
        "",
        "    transition off_to_idle",
        "      first off",
        "      then idle;",
        "",
        "    transition idle_to_driving",
        "      first idle",
        "      then driving;",
        "  }",
        "",
        "}",
        "",
        "// ── Requirements ──",
        "package VehicleRequirements {",
        "",
        "  requirement def MassRequirement {",
        "    doc /* Total mass shall not exceed 2000 kg. */",
        "    attribute maxMass : Real;",
        "  }",
        "",
        "  requirement def SafetyRequirement {",
        "    doc /* Vehicle shall pass NCAP 5-star rating. */",
        "    attribute minRating : Integer;",
        "  }",
        "",
        "  requirement def PerformanceRequirement {",
        "    doc /* 0-100 km/h in under 6 seconds. */",
        "    attribute targetTime : Real;",
        "  }",
        "",
        "}",
        "",
        "// ── Analysis ──",
        "package VehicleAnalysis {",
        "",
        "  calc def TotalMass {",
        "    in bodyMass : Real;",
        "    in drivetrainMass : Real;",
        "    return : Real;",
        "    bodyMass + drivetrainMass",
        "  }",
        "",
        "  constraint def MaxMassConstraint {",
        "    1500 + 200 <= 2000",
        "  }",
        "",
        "}",
        "",

        "// ── Integration ──",
        "package VehicleIntegration {",
        "  import VehicleRequirements::*;",
        "  part vehicle : VehicleSystem::Vehicle;",
        "  satisfy MassRequirement by vehicle;",
        "  satisfy SafetyRequirement by vehicle;",
        "}",
        "",
      ].join("\n"),
    },
    fmi2: {
      "System.mo":
        [
          'model System "FMI 2.0 Harmonic Oscillator"',
          "  Real x(start=1.0);",
          "  Real v(start=0.0);",
          "equation",
          "  der(x) = v;",
          "  der(v) = -x;",
          "end System;",
        ].join("\n") + "\n",
      "README.md":
        [
          "# FMI 2.0 Standard Exchange",
          "",
          "This workspace demonstrates a physical system designed for **FMI 2.0 export** (Functional Mock-up Interface).",
          "",
          "## Exporting as FMU",
          "",
          "From the terminal, export the model as an FMI 2.0 FMU archive:",
          "```bash",
          "msx fmu System System.mo --fmi-version 2.0",
          "```",
          "",
          "### Supported Targets",
          "- `--type cs`: Co-Simulation (includes embedded numerical integrator)",
          "- `--type me`: Model Exchange (pure differential equations for master solvers)",
          "- `--target wasm`: Edge-ready WebAssembly FMU binary",
          "- `--target c`: Standalone C source package for embedded cross-compilation",
        ].join("\n") + "\n",
    },
    fmi3: {
      "System.mo":
        [
          'model System "FMI 3.0 Dynamic System with Actuation and Telemetry"',
          '  input Real u(start = 0.0) "External actuation input";',
          '  output Real y "Measured system output";',
          '  parameter Real k = 2.0 "Tunable gain parameter";',
          '  parameter Real w = 1.0 "Natural angular frequency [rad/s]";',
          '  Real x(start = 1.0) "Displacement state";',
          '  Real v(start = 0.0) "Velocity state";',
          "equation",
          "  der(x) = v;",
          "  der(v) = -w^2 * x + k * u;",
          "  y = x;",
          "end System;",
        ].join("\n") + "\n",
      "README.md":
        [
          "# FMI 3.0 Next-Generation Simulation Exchange",
          "",
          "This workspace showcases **FMI 3.0** capabilities supported by ModelScript, including:",
          "- **Explicit Causality**: Typed continuous and discrete ports (`input Real u`, `output Real y`)",
          "- **Tunable Parameters**: Real-time parameter reconfiguration during simulation event mode",
          "- **Intermediate Value Callbacks**: Real-time telemetry streaming to WebGL/3D dashboards without interrupting steps",
          "- **Directional & Adjoint Derivatives**: Exact sensitivity propagation for gradient-based optimization loops",
          "",
          "## Exporting as FMI 3.0 FMU",
          "",
          "Export with the ModelScript CLI:",
          "```bash",
          "msx fmu System System.mo --fmi-version 3.0 --target wasm",
          "```",
          "",
          "Inspect the generated FMI 3.0 `modelDescription.xml` schema:",
          "```bash",
          "msx fmu System System.mo --fmi-version 3.0 --xml-only",
          "```",
        ].join("\n") + "\n",
    },
    script: {
      "simulate.mos": `// A simple Modelica script\nloadString("\nmodel HelloWorld\n  Real x(start=1);\nequation\n  der(x) = -x;\nend HelloWorld;\n");\n\nsimulate(HelloWorld, stopTime=5);\n`,
    },
    "simulation-verification": {
      "BatteryArchitecture.sysml": [
        "package BatteryArchitecture {",
        "  requirement def MaxTempReq {",
        "    doc /* Battery cells shall not exceed 65.0 degC */",
        "    attribute maxTemp : Real = 65.0;",
        "  }",
        "",
        "  part def BatteryCell {",
        "    // Bound to Modelica thermal model",
        "  }",
        "",
        "  analysis def VerifyThermalLimit {",
        "    subject cell : BatteryCell;",
        "    objective req : MaxTempReq;",
        "",
        "    constraint cellTempLimit {",
        "      cell::T <= req::maxTemp",
        "    }",
        "  }",
        "}",
      ].join("\n"),
      "BatteryCell.mo": [
        'model BatteryCell "Battery cell thermal model"',
        '  annotation(SysML(implements="BatteryArchitecture::BatteryCell"));',
        "  ",
        '  parameter Real R = 0.1 "Thermal resistance";',
        '  parameter Real C = 50.0 "Thermal capacitance";',
        '  parameter Real P_heat = 500.0 "Heat generation";',
        '  parameter Real T_amb = 25.0 "Ambient temp";',
        "  ",
        '  Real T(start=25.0) "Cell temperature";',
        "equation",
        "  C * der(T) = P_heat - (T - T_amb) / R;",
        "end BatteryCell;",
      ].join("\n"),
    },
    "multi-fidelity-binding": {
      "PropellerDynamics.mo": [
        'model PropellerDynamics "1D Modelica dynamics bound to 3D CFD"',
        '  parameter Real drag_coeff = 0.05 annotation(Binding(source="drone_geometry.step", feature="DragCoefficient", tool="CFD_Extraction"));',
        '  parameter Real inertia = 0.001 annotation(Binding(source="drone_geometry.step", feature="MomentOfInertia", tool="CAD_Extraction"));',
        "",
        '  Real w(start=0.0) "Angular velocity";',
        '  parameter Real torque = 0.5 "Applied torque";',
        "equation",
        "  inertia * der(w) = torque - drag_coeff * w^2;",
        "end PropellerDynamics;",
      ].join("\n"),
    },
    "data-driven-calibration": {
      "Suspension.mo": [
        'model Suspension "Vehicle suspension model for calibration"',
        "  parameter Real stiffness = 15000.0 annotation(calibrate(min=10000.0, max=30000.0));",
        "  parameter Real damping = 1000.0 annotation(calibrate(min=500.0, max=2000.0));",
        "  parameter Real mass = 300.0;",
        "",
        "  Real position(start=0.1);",
        "  Real velocity(start=0.0);",
        "equation",
        "  der(position) = velocity;",
        "  mass * der(velocity) = -stiffness * position - damping * velocity;",
        "end Suspension;",
      ].join("\n"),
      "telemetry_data.csv": [
        "time,position",
        "0.0,0.1",
        "0.1,0.08",
        "0.2,0.03",
        "0.3,-0.02",
        "0.4,-0.05",
        "0.5,-0.04",
        "0.6,-0.01",
        "0.7,0.02",
        "0.8,0.03",
        "0.9,0.02",
        "1.0,0.0",
      ].join("\n"),
    },
    "hardware-ci": {
      "SystemIntegration.mo": [
        'model SystemIntegration "Demonstrates structural singularity detection in CI"',
        "  // Two independent rigid speed sources connected rigidly to the same shaft",
        "  // cause a structural singularity (0 = w1 - w2 over-constraint).",
        '  Real w1(start = 10.0) "Motor 1 angular velocity [rad/s]";',
        '  Real w2(start = 12.0) "Motor 2 angular velocity [rad/s]";',
        '  parameter Real J1 = 0.5 "Inertia 1";',
        '  parameter Real J2 = 0.5 "Inertia 2";',
        "  Real tau1 = 2.0;",
        "  Real tau2 = 3.0;",
        "equation",
        "  J1 * der(w1) = tau1;",
        "  J2 * der(w2) = tau2;",
        "  // Rigid coupling equation creating index-2 DAE / structural over-constraint:",
        "  w1 = w2;",
        "end SystemIntegration;",
      ].join("\n"),
      ".github/workflows/ci.yml": [
        "name: Hardware CI",
        "on: [push, pull_request]",
        "jobs:",
        "  verify:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v3",
        "      - name: Run ModelScript Lint",
        "        run: msx lint",
        "      - name: Verify Structural Constraints",
        "        run: msx verify",
      ].join("\n"),
    },
    "mbse-verification": {
      "ThermalVerification.sysml": [
        "package ThermalVerification {",
        "",
        "  requirement def MaxTemperatureReq {",
        "    doc /* Motor temperature shall not exceed 85 degC */",
        "    attribute maxTemp : Real = 85.0;",
        "  }",
        "",
        "  part def MotorSystem {",
        "    // Allocated to Modelica class 'HeatedMotor'",
        "  }",
        "",
        "  analysis def VerifyTemperature {",
        "    subject motor : MotorSystem;",
        "    objective req : MaxTemperatureReq;",
        "",
        "    constraint tempLimit {",
        "      motor::T <= req::maxTemp",
        "    }",
        "  }",
        "}",
        "",
      ].join("\n"),
      "HeatedMotor.mo": [
        'model HeatedMotor "Motor with thermal dynamics"',
        '  annotation(SysML(implements="ThermalVerification::MotorSystem"));',
        "  ",
        '  parameter Real R = 0.5 "Thermal resistance (K/W)";',
        '  parameter Real C_th = 10.0 "Thermal capacitance (J/K)";',
        '  parameter Real P = 200.0 "Power dissipation (W)";',
        '  parameter Real T_amb = 25.0 "Ambient temperature (degC)";',
        "  ",
        '  Real T(start = 25.0) "Motor temperature (degC)";',
        "equation",
        "  C_th * der(T) = P - (T - T_amb) / R;",
        "end HeatedMotor;",
        "",
      ].join("\n"),
      "VerificationReport.md": [
        "# Motor Thermal Verification",
        "",
        "Automated verification of motor thermal constraints.",
        "",
        "## System Requirements",
        '::requirements{target="ThermalVerification"}',
        "",
        "## System Architecture",
        '::diagram{target="HeatedMotor"}',
        "",
        "The maximum allowable motor temperature is: {{ ThermalVerification.MaxTemperatureReq.maxTemp }} °C.",
        "",
      ].join("\n"),
    },
    cad: {
      "drone_architecture.sysml": [
        "package DroneArchitecture {",
        "  import DroneCAD::*;",
        "",
        "  part def DroneAssembly {",
        "    part chassis : Chassis;",
        "    part rotor1 : Rotor;",
        "    part rotor2 : Rotor;",
        "    part rotor3 : Rotor;",
        "    part rotor4 : Rotor;",
        "",
        "    // Reference CAD geometry directly from the STEP file!",
        "    ref chassisGeometry = DroneCAD::ChassisShape;",
        "  }",
        "",
        "  part def Chassis {}",
        "  part def Rotor {}",
        "}",
      ].join("\n"),
      "drone.step": droneStepContent,
    },
    "drone-meshing": {
      "drone.step": droneStepContent,
      "README.md":
        "# Drone Chassis Meshing\n\nRight-click `drone.step` and select **Discretize CAD to FEA Mesh (.inp)** or **Discretize CAD to CFD Mesh (.su2)** to begin configuring your mesh and physical simulation.",
    },
    "drone-fea": {
      "drone.step": droneStepContent,
      "DroneFEA.mo": [
        'model DroneFEA "Static Structural FEA of Drone Chassis"',
        "  extends ModelScript.Studies.StaticStructuralFEA(",
        "    meshResolution = 0.05,",
        "    elementOrder = 2",
        "  );",
        "",
        '  parameter String stepFile = "drone.step" annotation(Dialog(loadSelector=true, filter="STEP Files (*.step *.stp)"));',
        "",
        "  Real maxDisplacementZ;",
        "  Real maxVonMisesStress;",
        "end DroneFEA;",
      ].join("\n"),
      "DroneDynamics.mo": [
        'model DroneDynamics "Drone dynamics consuming FEA results"',
        "  import DroneFEA;",
        '  parameter Real max_displacement = DroneFEA.maxDisplacementZ "Imported from FEA";',
        '  parameter Real max_stress = DroneFEA.maxVonMisesStress "Imported from FEA";',
        "equation",
        "  // Logic using FEA results",
        "end DroneDynamics;",
      ].join("\n"),
    },
    "drone-cfd": {
      "drone.step": droneStepContent,
      "DroneCFD.msim": [
        "{",
        '  "type": "CFD",',
        '  "solver": "OpenFOAM",',
        '  "stepFile": "drone.step",',
        '  "mesh": {',
        '    "size": 0.05',
        "  },",
        '  "exposeProperties": [',
        '    { "name": "maxVelocityMagnitude", "type": "Real" },',
        '    { "name": "maxPressure", "type": "Real" }',
        "  ]",
        "}",
      ].join("\n"),
      "DroneFlight.mo": [
        'model DroneFlight "Drone flight consuming CFD results"',
        "  import DroneCFD;",
        '  parameter Real max_velocity = DroneCFD.maxVelocityMagnitude "Imported from CFD";',
        '  parameter Real max_pressure = DroneCFD.maxPressure "Imported from CFD";',
        "equation",
        "  // Logic using CFD results",
        "end DroneFlight;",
      ].join("\n"),
    },
    "modelica-procedural-cad": {
      "DroneCAD.mo": [
        'package DroneCAD "Procedural CAD model of a quadcopter drone chassis"',
        "",
        "  import Geometry.*;",
        "",
        "  // ─── Reusable sub-assemblies ──────────────────────────────────────────",
        "",
        '  record MotorMount "Cylindrical motor mount with propeller guard ring"',
        '    parameter Real radius = 1.5 "Motor housing radius [mm]";',
        '    parameter Real height = 2 "Motor housing height [mm]";',
        "",
        "    replaceable Cylinder housing(radius = radius, height = height)",
        "      annotation(material = Aluminum);",
        "",
        "    Torus guard(major = radius * 2, minor = 0.1)",
        "      annotation(Placement(origin = {0, height, 0}));",
        "  end MotorMount;",
        "",
        '  record DroneArm "Single arm extending from the body to a motor"',
        '    parameter Real length = 12 "Arm length [mm]";',
        '    parameter Real thickness = 1 "Arm thickness [mm]";',
        '    parameter Real width = 1.5 "Arm width [mm]";',
        '    parameter Real motorRadius = 1.5 "Motor mount radius [mm]";',
        "",
        "    Box beam(width = length, height = thickness, depth = width)",
        "      annotation(material = CarbonFiber);",
        "",
        "    replaceable MotorMount motor(radius = motorRadius)",
        "      annotation(Placement(origin = {length/2, thickness/2 + 0.5, 0}));",
        "  end DroneArm;",
        "",
        '  record LandingGear "Two-skid landing gear with vertical struts"',
        '    parameter Real span = 8 "Distance between skids [mm]";',
        '    parameter Real skidLength = 10 "Skid bar length [mm]";',
        '    parameter Real strutHeight = 4 "Strut height from body to skid [mm]";',
        "",
        "    // Horizontal skid bars",
        "    Box skidL(width = 0.5, height = 0.3, depth = skidLength)",
        "      annotation(",
        "        Placement(origin = {-span/2, -strutHeight, 0}),",
        "        material = Aluminum",
        "      );",
        "    Box skidR(width = 0.5, height = 0.3, depth = skidLength)",
        "      annotation(",
        "        Placement(origin = {span/2, -strutHeight, 0}),",
        "        material = Aluminum",
        "      );",
        "",
        "    // Vertical struts",
        "    Box strutLF(width = 0.3, height = strutHeight, depth = 0.3)",
        "      annotation(Placement(origin = {-span/2, -strutHeight/2, skidLength/3}));",
        "    Box strutLR(width = 0.3, height = strutHeight, depth = 0.3)",
        "      annotation(Placement(origin = {-span/2, -strutHeight/2, -skidLength/3}));",
        "    Box strutRF(width = 0.3, height = strutHeight, depth = 0.3)",
        "      annotation(Placement(origin = {span/2, -strutHeight/2, skidLength/3}));",
        "    Box strutRR(width = 0.3, height = strutHeight, depth = 0.3)",
        "      annotation(Placement(origin = {span/2, -strutHeight/2, -skidLength/3}));",
        "  end LandingGear;",
        "",
        '  record CameraAssembly "Front-mounted camera with gimbal bracket"',
        '    parameter Real gimbalWidth = 2 "Gimbal bracket width [mm]";',
        '    parameter Real lensSize = 1.5 "Camera lens diameter [mm]";',
        "",
        "    Box mount(width = gimbalWidth, height = 0.8, depth = 3)",
        "      annotation(material = ABS);",
        "",
        "    Box lens(width = lensSize, height = lensSize, depth = 1)",
        "      annotation(",
        "        Placement(origin = {0, -0.4, 2}),",
        "        material = ABS",
        "      );",
        "  end CameraAssembly;",
        "",
        "  // ─── Main chassis assembly ────────────────────────────────────────────",
        "",
        '  record DroneChassis "Complete quadcopter drone chassis"',
        '    parameter Real bodySize = 10 "Central body width/depth [mm]";',
        '    parameter Real bodyHeight = 3 "Central body height [mm]";',
        '    parameter Real armLength = 12 "Arm length [mm]";',
        '    parameter Real armAngle = 45 "Diagonal angle from X axis [deg]";',
        "",
        "    // ── Central body ──────────────────────────────────────────",
        "    Box body(width = bodySize, height = bodyHeight, depth = bodySize)",
        "      annotation(material = CarbonFiber);",
        "",
        "    Box topCover(width = bodySize - 2, height = 0.6, depth = bodySize - 2)",
        "      annotation(",
        "        Placement(origin = {0, bodyHeight/2 + 0.3, 0}),",
        "        material = CarbonFiber",
        "      );",
        "",
        "    Box electronicsBay(width = 6, height = 1, depth = 6)",
        "      annotation(",
        "        Placement(origin = {0, -bodyHeight/2 - 0.5, 0}),",
        "        material = ABS",
        "      );",
        "",
        "    // ── Four diagonal arms ────────────────────────────────────",
        "    DroneArm armFR(length = armLength)",
        "      annotation(Placement(origin = {6, 0, 6}, rotation = {0, armAngle, 0}));",
        "",
        "    DroneArm armFL(length = armLength)",
        "      annotation(Placement(origin = {-6, 0, 6}, rotation = {0, -armAngle, 0}));",
        "",
        "    DroneArm armRR(length = armLength)",
        "      annotation(Placement(origin = {6, 0, -6}, rotation = {0, 180 - armAngle, 0}));",
        "",
        "    DroneArm armRL(length = armLength)",
        "      annotation(Placement(origin = {-6, 0, -6}, rotation = {0, -(180 - armAngle), 0}));",
        "",
        "    // ── Landing gear ──────────────────────────────────────────",
        "    LandingGear gear(span = bodySize - 2, strutHeight = 4);",
        "",
        "    // ── Camera ────────────────────────────────────────────────",
        "    CameraAssembly camera",
        "      annotation(Placement(origin = {0, -1, bodySize/2 + 1.5}));",
        "",
        "    // ── Battery ───────────────────────────────────────────────",
        "    Box battery(width = 5, height = 1.2, depth = 8)",
        "      annotation(",
        "        Placement(origin = {0, -bodyHeight/2 - 1.5, 0}),",
        "        material = LiPo",
        "      );",
        "  end DroneChassis;",
        "",
        "  // ─── Parametric variants ──────────────────────────────────────────────",
        "",
        '  record CargoDrone "Heavy-lift drone with larger body and longer arms"',
        "    extends DroneChassis(",
        "      bodySize = 15,",
        "      bodyHeight = 4,",
        "      armLength = 18",
        "    );",
        "  end CargoDrone;",
        "",
        '  record RacingDrone "Lightweight racing drone with compact form"',
        "    extends DroneChassis(",
        "      bodySize = 8,",
        "      bodyHeight = 2,",
        "      armLength = 9,",
        "      armAngle = 50",
        "    );",
        "  end RacingDrone;",
        "",
        "  // Demonstration of redeclare — swap motor mounts for tapered cones",
        "  record TaperedMotorMount",
        "    extends MotorMount(",
        "      redeclare Cone housing(",
        "        radiusBottom = radius * 1.2,",
        "        radiusTop = radius * 0.8,",
        "        height = 2.5",
        "      )",
        "    );",
        "  end TaperedMotorMount;",
        "",
        '  record StealthDrone "Drone with tapered motor housings for aerodynamics"',
        "    extends DroneChassis(",
        "      bodySize = 9,",
        "      armLength = 11,",
        "      // Redeclare the motor mount type inside each arm",
        "      redeclare DroneArm armFR(",
        "        redeclare TaperedMotorMount motor",
        "      ),",
        "      redeclare DroneArm armFL(",
        "        redeclare TaperedMotorMount motor",
        "      ),",
        "      redeclare DroneArm armRR(",
        "        redeclare TaperedMotorMount motor",
        "      ),",
        "      redeclare DroneArm armRL(",
        "        redeclare TaperedMotorMount motor",
        "      )",
        "    );",
        "  end StealthDrone;",
        "",
        "end DroneCAD;",
        "",
      ].join("\n"),
      "README.md":
        "# Modelica Procedural CAD\n\nThis example demonstrates how to build 3D CAD geometries using the Modelica `shape` language extension.\n\nRight click on `DroneCAD.mo` and select **Generate STEP** to compile the procedural design into a standard 3D CAD model.",
    },
    "cfd-verification": {
      "AirflowROM.mo": [
        'model AirflowROM "Reduced-order CFD surrogate for heat exchanger airflow"',
        '  input Real T_inlet(start = 25) "Inlet air temperature [°C]";',
        '  input Real massFlow(start = 0.5) "Mass flow rate [kg/s]";',
        '  output Real T_outlet "Outlet air temperature [°C]";',
        '  output Real pressure_drop "Pressure drop [Pa]";',
        '  parameter Real efficiency = 0.85 "Heat transfer efficiency";',
        '  parameter Real k_drop = 200 "Pressure loss coefficient";',
        "equation",
        "  T_outlet = T_inlet + efficiency * (100 - T_inlet) * (1 - exp(-massFlow));",
        "  pressure_drop = k_drop * massFlow^2;",
        "end AirflowROM;",
        "",
      ].join("\n"),
      "ThermalSystem.mo": [
        'model ThermalSystem "Thermal system with embedded CFD surrogate"',
        '  annotation(SysML(implements="ThermalVerification::ThermalSys"));',
        "",
        "  AirflowROM airflow;",
        '  Real T_room(start = 20) "Room temperature [°C]";',
        '  parameter Real C_room = 5000 "Thermal capacitance [J/°C]";',
        '  parameter Real h_conv = 10 "Convective heat transfer coeff [W/°C]";',
        '  parameter Real A_surface = 2.0 "Heat exchange surface [m²]";',
        "equation",
        "  airflow.T_inlet = 25 + 5 * sin(2 * 3.14159 * time / 3600);",
        "  airflow.massFlow = 0.3 + 0.2 * sin(2 * 3.14159 * time / 1800);",
        "  C_room * der(T_room) = h_conv * A_surface * (airflow.T_outlet - T_room);",
        "end ThermalSystem;",
        "",
      ].join("\n"),
      "ThermalVerification.sysml": [
        "package ThermalVerification {",
        "",
        "  requirement def MaxOutletTempReq {",
        "    doc /* Outlet temperature shall not exceed 85 degC */",
        "    attribute maxTemp : Real = 85.0;",
        "  }",
        "",
        "  requirement def MaxPressureDropReq {",
        "    doc /* Pressure drop shall not exceed 500 Pa */",
        "    attribute maxDrop : Real = 500.0;",
        "  }",
        "",
        "  part def ThermalSys {",
        "    // Allocated to Modelica class ThermalSystem",
        "  }",
        "",
        "  analysis def VerifyThermal {",
        "    subject system : ThermalSys;",
        "    objective tempReq : MaxOutletTempReq;",
        "",
        "    constraint outlet_temp {",
        "      system::airflow::T_outlet <= tempReq::maxTemp",
        "    }",
        "  }",
        "",
        "  analysis def VerifyPressure {",
        "    subject system : ThermalSys;",
        "    objective dropReq : MaxPressureDropReq;",
        "",
        "    constraint max_drop {",
        "      system::airflow::pressure_drop <= dropReq::maxDrop",
        "    }",
        "  }",
        "}",
        "",
      ].join("\n"),
      "VerificationReport.md": [
        "# Thermal System Verification",
        "",
        "Automated verification of a thermal system with an embedded reduced-order CFD model.",
        "",
        "## Requirements",
        '::requirements{target="ThermalVerification"}',
        "",
        "## System Architecture",
        '::diagram{target="ThermalSystem"}',
        "",
        "Maximum outlet temperature limit: {{ ThermalVerification.MaxOutletTempReq.maxTemp }} °C.",
        "",
      ].join("\n"),
    },
    calibration: {
      "SpringDamper.mo": [
        'model SpringDamper "Mass-spring-damper system for parameter calibration"',
        '  parameter Real m = 1.0 "Mass [kg]";',
        '  parameter Real k = 50.0 "Spring stiffness [N/m] (to calibrate)";',
        '  parameter Real c = 2.0 "Damping coefficient [Ns/m] (to calibrate)";',
        '  Real x(start = 1.0) "Displacement [m]";',
        '  Real v(start = 0.0) "Velocity [m/s]";',
        "equation",
        "  der(x) = v;",
        "  m * der(v) = -k * x - c * v;",
        "end SpringDamper;",
        "",
      ].join("\n"),
      "measurements.csv": (() => {
        // Generate synthetic measurement data:
        // True params: k=80, c=5. Simulate manually + add noise.
        const rows = ["time,x"];
        const dt = 0.05;
        const N = 100;
        const k_true = 80,
          c_true = 5,
          m = 1.0;
        let x = 1.0,
          v = 0.0;
        // Simple Euler integration to generate ground truth
        for (let i = 0; i <= N; i++) {
          const t = i * dt;
          // Add small pseudo-random noise (deterministic for reproducibility)
          const noise = 0.02 * Math.sin(t * 137.035999 + 7) * Math.cos(t * 42.7 + 3);
          rows.push(`${t.toFixed(3)},${(x + noise).toFixed(6)}`);
          // Euler step
          const a = (-k_true * x - c_true * v) / m;
          v += a * dt;
          x += v * dt;
        }
        return rows.join("\n") + "\n";
      })(),
      "calibrate.mos": [
        "// Parameter calibration of a spring-damper system",
        "// True parameters: k=80, c=5 — initial guesses: k=50, c=2",
        "//",
        "// METHOD 1: Script-based calibration (this file)",
        "//   Right-click → Run Script, or press the ▶ button.",
        "//",
        "// METHOD 2: Interactive UI panel (recommended)",
        '//   Open SpringDamper.mo, then Ctrl+Shift+P → "ModelScript: Open Calibration Dashboard".',
        "//   The dashboard provides live convergence plots and parameter sliders.",
        "",
        'loadFile("SpringDamper.mo");',
        "",
        "calibrate(SpringDamper,",
        "  stopTime = 5.0,",
        '  parameters = {"k", "c"},',
        "  parameterBounds = [10, 200; 0.1, 20],",
        '  measurementFile = "measurements.csv",',
        '  method = "lm"',
        ");",
        "",
      ].join("\n"),
      "README.md": [
        "# Parameter Calibration Example",
        "",
        "This example demonstrates **parameter calibration** of a spring-damper system against synthetic measurement data.",
        "",
        "## The Model",
        "",
        "`SpringDamper.mo` defines a simple mass-spring-damper system with two unknown parameters:",
        "- `k` — spring stiffness (initial guess: 50 N/m, true value: 80 N/m)",
        "- `c` — damping coefficient (initial guess: 2 Ns/m, true value: 5 Ns/m)",
        "",
        "## Measurement Data",
        "",
        "`measurements.csv` contains synthetic displacement measurements generated from the true system with added noise.",
        "",
        "## Two Ways to Calibrate",
        "",
        "### 1. Script-Based (`calibrate.mos`)",
        "Right-click `calibrate.mos` → **Run Script**. The `calibrate()` function runs the Levenberg–Marquardt optimizer and prints the optimal parameters to the console.",
        "",
        "### 2. Calibration Dashboard (Interactive UI)",
        "1. Open `SpringDamper.mo`",
        '2. `Ctrl+Shift+P` → **"ModelScript: Open Calibration Dashboard"**',
        "3. The dashboard provides:",
        "   - Live convergence plots",
        "   - Measurement vs. simulated overlay",
        "   - One-click export of the optimized parameters as a Modelica `extends` class",
        "",
        "Both methods use the same Levenberg–Marquardt / SQP optimizer under the hood.",
        "",
      ].join("\n"),
    },
    "optimica-polyglot": {
      "RocketSled.mo": [
        'model RocketSled "Energy-optimal rocket sled trajectory"',
        '  Real x(start = 0) "Position [m]";',
        '  Real v(start = 0, max = 10.0) "Velocity [m/s]";',
        '  input Real u(min = -5, max = 5) "Thrust force [N]";',
        '  parameter Real m = 1.0 "Mass [kg]";',
        '  parameter Real drag = 0.1 "Drag coefficient";',
        "equation",
        "  der(x) = v;",
        "  m * der(v) = u - drag * v;",
        "end RocketSled;",
        "",
      ].join("\n"),
      "SafetyConstraints.sysml": [
        "package SafetyConstraints {",
        "",
        "  requirement def MaxVelocityReq {",
        "    doc /* Velocity shall not exceed 10 m/s for structural safety */",
        "    attribute maxVelocity : Real = 10.0;",
        "  }",
        "",
        "  requirement def MinFinalPositionReq {",
        "    doc /* Final position shall be at least 50 m to reach the target */",
        "    attribute minPosition : Real = 50.0;",
        "  }",
        "",
        "  part def RocketSledSys {",
        "    // Allocated to Modelica class RocketSled",
        "  }",
        "",
        "  analysis def OptimalTrajectory {",
        "    subject sled : RocketSledSys;",
        "    objective velReq : MaxVelocityReq;",
        "",
        "    constraint max_v {",
        "      sled::v <= velReq::maxVelocity",
        "    }",
        "  }",
        "}",
        "",
      ].join("\n"),
      "optimize.mos": [
        "// Optimal control with Optimica + SysML2 constraints",
        "//",
        "// Run via CLI: msx optimize RocketSled RocketSled.mo SafetyConstraints.sysml",
        "// Or open RocketSled.mo and press Ctrl+Shift+P → 'ModelScript: Open Optimization Dashboard'",
        "",
        'loadFile("RocketSled.mo");',
        "",
        "optimize(RocketSled,",
        "  startTime = 0,",
        "  stopTime = 20,",
        "  numIntervals = 50,",
        "  tolerance = 1e-6",
        ");",
        "",
      ].join("\n"),
    },
    uncertainty: {
      "Projectile.mo": [
        'model Projectile "Projectile with uncertain drag and mass"',
        '  parameter Real m = 1.0 "Mass [kg] (uncertain)";',
        '  parameter Real Cd = 0.47 "Drag coefficient (uncertain)";',
        '  parameter Real g = 9.81 "Gravitational acceleration [m/s²]";',
        '  parameter Real rho = 1.225 "Air density [kg/m³]";',
        '  parameter Real A = 0.01 "Cross-section area [m²]";',
        '  Real x(start = 0) "Horizontal position [m]";',
        '  Real y(start = 0) "Vertical position [m]";',
        '  Real vx(start = 20) "Horizontal velocity [m/s]";',
        '  Real vy(start = 30) "Vertical velocity [m/s]";',
        '  Real speed "Total speed [m/s]";',
        "equation",
        "  speed = sqrt(vx^2 + vy^2);",
        "  der(x) = vx;",
        "  der(y) = vy;",
        "  m * der(vx) = -0.5 * rho * Cd * A * speed * vx;",
        "  m * der(vy) = -m * g - 0.5 * rho * Cd * A * speed * vy;",
        "end Projectile;",
        "",
      ].join("\n"),
      "uncertainty.mos": [
        "// Monte Carlo uncertainty analysis for a projectile",
        "// Uncertain parameters: drag coefficient (Gaussian) and mass (Uniform)",
        "//",
        "// Run via CLI: msx mc Projectile Projectile.mo --samples 200",
        "// Or open Projectile.mo and press Ctrl+Shift+P → 'ModelScript: Open Uncertainty Analysis'",
        "",
        'loadFile("Projectile.mo");',
        "",
        "montecarlo(Projectile,",
        "  stopTime = 5,",
        "  numberOfIntervals = 200,",
        "  parameters = {",
        '    "Cd ~ normal(0.47, 0.05)",',
        '    "m ~ uniform(0.9, 1.1)"',
        "  },",
        "  numSamples = 200,",
        "  seed = 42,",
        '  method = "lhs"',
        ");",
        "",
      ].join("\n"),
    },
    notebook: {
      "demo.monb": JSON.stringify(
        {
          cells: [
            {
              cell_type: "markdown",
              source: [
                "# Modelica Notebooks",
                "",
                "Welcome to ModelScript Notebooks! Create models and simulate them directly.",
              ],
            },
            {
              cell_type: "code",
              language: "modelica",
              source: ["model Simple", "  Real x(start = 1);", "equation", "  der(x) = -x;", "end Simple;"],
            },
            {
              cell_type: "code",
              language: "modelica",
              source: ["simulate(Simple, stopTime = 5.0);"],
            },
          ],
        },
        null,
        2,
      ),
    },
    surrogate: {
      "BouncingBall.mo": [
        'model BouncingBall "A classic bouncing ball model"',
        '  parameter Real e = 0.8 "Coefficient of restitution";',
        '  parameter Real g = 9.81 "Gravity";',
        '  parameter Real v_0 = 0.0 "Initial velocity";',
        '  Real h(start = 1.0) "Height";',
        '  Real v(start = v_0) "Velocity";',
        "equation",
        "  der(h) = v;",
        "  der(v) = -g;",
        "  when h <= 0.0 and v < 0.0 then",
        "    reinit(v, -e * pre(v));",
        "  end when;",
        "end BouncingBall;",
        "",
      ].join("\n"),
      "README.md": [
        "# AI Surrogate Modeling",
        "",
        "This workspace demonstrates how to orchestrate Design of Experiments (DoE) and train AI surrogate models (Reduced Order Models) directly from Modelica.",
        "",
        "## Training a Surrogate",
        "",
        "1. Open `BouncingBall.mo`",
        "2. Click the **Train Surrogate** icon (robot) in the editor title bar",
        "3. Choose a **DoE Strategy** (e.g., Latin Hypercube) and number of samples",
        "4. Choose an **Architecture** (e.g., MLP Neural Network)",
        "5. Click **Train Surrogate**",
        "",
        "The platform will orchestrate headless simulations to build a dataset, train the neural network, and report the R² accuracy.",
        "",
        "## Exporting to WebAssembly",
        "",
        "Once training is complete, click **Generate WASM** in the Surrogate Editor.",
        "This will instantly generate a self-contained C source code array of the neural network weights and biases, ready for edge deployment!",
      ].join("\n"),
    },
    "assembly-to-multibody": {
      "SimplePendulum.step": [
        "ISO-10303-21;",
        "HEADER;",
        "FILE_DESCRIPTION(('STEP AP242 Assembly'),'2;1');",
        "FILE_NAME('SimplePendulum.step','2026-05-13',('ModelScript'),(''),(''),'','');",
        "FILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF { 1 0 10303 442 1 1 4 }'));",
        "ENDSEC;",
        "DATA;",
        "#1=PRODUCT('Assembly','Assembly','',(#2));",
        "#2=PRODUCT_CONTEXT('',#3,'mechanical');",
        "#3=APPLICATION_CONTEXT('automotive design');",
        "#10=PRODUCT('Link','Link','',(#2));",
        "#20=PRODUCT('Bob','Bob','',(#2));",
        "#30=NEXT_ASSEMBLY_USAGE_OCCURRENCE('NAUO1','Link to Bob','',#10,#20,$);",
        "#40=REVOLUTE_PAIR('RevJoint','Joint between Link and Bob',#10,#20);",
        "ENDSEC;",
        "END-ISO-10303-21;",
      ].join("\n"),
      "README.md": [
        "# STEP AP242 to Modelica Multi-Body",
        "",
        "This workspace demonstrates the automated conversion of a 3D CAD assembly into a Modelica Multi-Body simulation.",
        "",
        "## Workflow",
        "",
        "1. Open `SimplePendulum.step`.",
        "2. The 3D Viewer will render the geometric bodies (if OCCT WASM is loaded).",
        "3. Click the **⚙️ Generate Multi-Body Model** button in the top left of the 3D Viewer, or run the command from the Command Palette (`Ctrl+Shift+P` → **ModelScript: Generate Multi-Body Simulation from CAD**).",
        "4. A new `SimplePendulum.mo` file will be generated automatically, containing `Parts.Body` and `Joints.Revolute` components.",
        "5. Open `SimplePendulum.mo` and click **Run Simulation** to simulate the dynamics!",
        "",
        "## CLI Synthesis",
        "",
        "You can also synthesize multi-body models from the terminal using:",
        "```bash",
        "msx polyglot multibody SimplePendulum.step",
        "```",
      ].join("\n"),
      "generate.mos": [
        "// After generating SimplePendulum.mo from SimplePendulum.step via the 3D Viewer",
        "// (or 'msx polyglot multibody SimplePendulum.step'), simulate the synthesized model:",
        'loadFile("SimplePendulum.mo");',
        "simulate(SimplePendulum, stopTime = 10);",
      ].join("\n"),
    },
    cosim: {
      "Controller.mo": [
        'model Controller "Simple PI controller"',
        '  Modelica.Blocks.Interfaces.RealInput u "Measurement input";',
        '  Modelica.Blocks.Interfaces.RealOutput y "Control output";',
        '  parameter Real Kp = 2.0 "Proportional gain";',
        '  parameter Real Ki = 0.5 "Integral gain";',
        '  parameter Real setpoint = 1.0 "Reference setpoint";',
        '  Real error "Tracking error";',
        '  Real integral(start = 0) "Integral of error";',
        "equation",
        "  error = setpoint - u;",
        "  der(integral) = error;",
        "  y = Kp * error + Ki * integral;",
        "end Controller;",
        "",
      ].join("\n"),
      "CosimSetup.mo": [
        'model CosimSetup "Co-simulation wiring diagram"',
        "  Controller controller;",
        "  SineWave sineWave;",
        "equation",
        "  connect(controller.y, sineWave.phase);",
        "  connect(sineWave.y, controller.u);",
        "end CosimSetup;",
        "",
      ].join("\n"),
      "README.md": [
        "# Co-Simulation Example",
        "",
        "This workspace demonstrates co-simulation between a **Modelica model** and a **WASM FMU**.",
        "",
        "## Files",
        "",
        "| File | Type | Description |",
        "|------|------|-------------|",
        "| `Controller.mo` | Modelica | PI controller with setpoint tracking |",
        "| `CosimSetup.mo` | Modelica | Wiring diagram connecting Controller ↔ SineWave |",
        "",
        "## Running the Co-Simulation",
        "",
        "1. Open the **Co-Simulation** panel in the sidebar",
        '2. Click **"Browser-Local"** to enable local mode',
        "3. Create a new session (start=0, stop=10, step=0.01)",
        "4. Open `Controller.mo` and click **Publish Model**",
        "5. Start the coupled simulation",
      ].join("\n"),
    },
    "uns-mqtt": {
      "DigitalTwin.mo": [
        'model DigitalTwin "Real-Time Digital Twin with UNS/MQTT"',
        '  parameter Real target_speed = 10.0 "Override via: .../cmd/DigitalTwin/target_speed";',
        '  Real speed(start=0) "Telemetry published to: .../data/DigitalTwin/speed";',
        "equation",
        "  der(speed) = (target_speed - speed) * 1.5;",
        "end DigitalTwin;\n",
      ].join("\n"),
      "hmi.html": [
        "<!DOCTYPE html>",
        "<html><head><title>HMI</title>",
        '<script src="https://unpkg.com/mqtt/dist/mqtt.min.js"></script>',
        "<style>body{font-family:sans-serif;text-align:center;padding-top:50px;} h1{font-size:3rem;}</style>",
        "</head><body>",
        "<h2>Conveyor Speed</h2>",
        '<h1 id="speed">0.00</h1>',
        "<p>Live telemetry via MQTT Unified Namespace</p>",
        "</body></html>",
      ].join("\n"),
      "README.md": [
        "# UNS / Real-Time MQTT Example",
        "",
        "This workspace demonstrates how to stream live telemetry from a Modelica simulation directly to an external HMI web app.",
      ].join("\n"),
    },
    "owl2-contradiction": {
      "constraints.owl": [
        "Prefix(mo: = <http://modelscript.org/modelica#>)",
        "Ontology(<http://modelscript.org/examples/contradiction>",
        "  Import(<http://modelscript.org/modelica#>)",
        "  Declaration(Class(mo:ElectricalDevice))",
        "  Declaration(Class(mo:MechanicalDevice))",
        "  DisjointClasses(mo:ElectricalDevice mo:MechanicalDevice)",
        ")",
      ].join("\n"),
      "system.mo": [
        "// System model with an intentional semantic contradiction",
        "// Motor extends both ElectricalDevice and MechanicalDevice,",
        "// which are declared Disjoint in the OWL2 ontology constraints.owl",
        "",
        "class ElectricalDevice",
        '  parameter Real voltage_rating = 24.0 "Operating voltage [V]";',
        "end ElectricalDevice;",
        "",
        "class MechanicalDevice",
        '  parameter Real max_torque = 10.0 "Max torque [N.m]";',
        "end MechanicalDevice;",
        "",
        "// Contradiction: Motor is both ElectricalDevice and MechanicalDevice",
        "class Motor",
        "  extends ElectricalDevice;",
        "  extends MechanicalDevice;",
        '  parameter Real speed = 3000 "Rated speed [RPM]";',
        "end Motor;",
      ].join("\n"),
      "README.md": [
        "# Cross-Domain Contradiction Detection",
        "",
        "This example demonstrates how the OWL2 reasoner catches **semantic contradictions**",
        "between Modelica physical models and OWL2 domain constraints.",
        "",
        "## Scenario",
        "",
        "A system model defines `Motor` as both an `ElectricalDevice` and a `MechanicalDevice`.",
        "An OWL2 ontology declares these two classes **disjoint** - a component cannot be both.",
        "",
        "When the reasoner classifies the combined polyglot model, it detects the inconsistency",
        "and reports the contradiction with a justification chain.",
      ].join("\n"),
    },
    "owl2-fmea": {
      "control_system.mo": [
        "// Control system architecture for FMEA fault propagation analysis",
        "// Topology: sensor -> controller -> actuator -> plant",
        "",
        "connector Signal",
        "  Real val;",
        "end Signal;",
        "",
        "model Sensor",
        "  Signal out_port;",
        "equation",
        "  out_port.val = 1.0;",
        "end Sensor;",
        "",
        "model Controller",
        "  Signal in_port;",
        "  Signal out_port;",
        "equation",
        "  out_port.val = in_port.val * 2.0;",
        "end Controller;",
        "",
        "model Actuator",
        "  Signal in_port;",
        "  Signal out_port;",
        "equation",
        "  out_port.val = in_port.val * 0.5;",
        "end Actuator;",
        "",
        "model Plant",
        "  Signal in_port;",
        "  Real state;",
        "equation",
        "  der(state) = in_port.val;",
        "end Plant;",
        "",
        "model System",
        "  Sensor sensor1;",
        "  Controller controller1;",
        "  Actuator actuator1;",
        "  Plant plant1;",
        "equation",
        "  connect(sensor1.out_port, controller1.in_port);",
        "  connect(controller1.out_port, actuator1.in_port);",
        "  connect(actuator1.out_port, plant1.in_port);",
        "end System;",
      ].join("\n"),
      "fault_taxonomy.owl": [
        "Prefix(fmea: = <http://modelscript.org/fmea#>)",
        "Prefix(mo: = <http://modelscript.org/modelica#>)",
        "Ontology(<http://modelscript.org/examples/fmea>",
        "  Import(<http://modelscript.org/modelica#>)",
        "  Declaration(Class(fmea:FaultMode))",
        "  Declaration(Class(fmea:SensorDrift))",
        "  Declaration(Class(fmea:ActuatorStuck))",
        "  Declaration(Class(fmea:CommunicationLoss))",
        "  SubClassOf(fmea:SensorDrift fmea:FaultMode)",
        "  SubClassOf(fmea:ActuatorStuck fmea:FaultMode)",
        "  SubClassOf(fmea:CommunicationLoss fmea:FaultMode)",
        "  Declaration(Class(fmea:CriticalityLevel))",
        "  Declaration(NamedIndividual(fmea:High))",
        "  Declaration(NamedIndividual(fmea:Medium))",
        "  Declaration(NamedIndividual(fmea:Low))",
        "  ClassAssertion(fmea:CriticalityLevel fmea:High)",
        "  ClassAssertion(fmea:CriticalityLevel fmea:Medium)",
        "  ClassAssertion(fmea:CriticalityLevel fmea:Low)",
        "  Declaration(ObjectProperty(fmea:hasFaultMode))",
        "  Declaration(ObjectProperty(fmea:hasCriticality))",
        "  Declaration(ObjectProperty(mo:isConnectedTo))",
        "  SubObjectPropertyOf(mo:isConnectedTo mo:propagatesFaultTo)",
        "  TransitiveObjectProperty(mo:propagatesFaultTo)",
        ")",
      ].join("\n"),
      "README.md": [
        "# Fault Propagation Analysis (FMEA)",
        "",
        "This example demonstrates how the OWL2 reasoner traces **fault propagation paths**",
        "through a system's connection topology using transitive closure of the",
        "`isConnectedTo` object property.",
      ].join("\n"),
    },
    "owl2-manufacturing": {
      "drone.sysml": [
        "package DroneSupplyChain {",
        "  private import ScalarValues::*;",
        "",
        "  part def CarbonFiber;",
        "  part def TitaniumAlloy;",
        "  part def Aluminum6061;",
        "",
        "  part def DroneFrame {",
        "    doc /* Lightweight quadcopter frame requiring aerospace-grade materials */",
        "    part spar : TitaniumAlloy;",
        "    part shell : CarbonFiber;",
        "  }",
        "",
        "  part def MotorMount {",
        "    part bracket : Aluminum6061;",
        "  }",
        "",
        "  part def DroneAssembly {",
        "    part frame : DroneFrame;",
        "    part mount1 : MotorMount;",
        "    part mount2 : MotorMount;",
        "    part mount3 : MotorMount;",
        "    part mount4 : MotorMount;",
        "  }",
        "}",
      ].join("\n"),
      "supply_chain.owl": [
        "Prefix(mat: = <http://modelscript.org/materials#>)",
        "Prefix(mfg: = <http://modelscript.org/manufacturing#>)",
        "Prefix(supp: = <http://modelscript.org/suppliers#>)",
        "Prefix(sysml: = <http://modelscript.org/sysml2#>)",
        "Ontology(<http://modelscript.org/examples/supply_chain>",
        "  Import(<http://modelscript.org/sysml2#>)",
        "  Declaration(Class(mat:Material))",
        "  Declaration(Class(mat:Composite))",
        "  Declaration(Class(mat:MetalAlloy))",
        "  SubClassOf(mat:Composite mat:Material)",
        "  SubClassOf(mat:MetalAlloy mat:Material)",
        "  Declaration(Class(mat:CarbonFiber))",
        "  Declaration(Class(mat:TitaniumAlloy))",
        "  Declaration(Class(mat:Aluminum6061))",
        "  SubClassOf(mat:CarbonFiber mat:Composite)",
        "  SubClassOf(mat:TitaniumAlloy mat:MetalAlloy)",
        "  SubClassOf(mat:Aluminum6061 mat:MetalAlloy)",
        "  SubClassOf(sysml:CarbonFiber mat:CarbonFiber)",
        "  SubClassOf(sysml:TitaniumAlloy mat:TitaniumAlloy)",
        "  SubClassOf(sysml:Aluminum6061 mat:Aluminum6061)",
        "  Declaration(Class(supp:Supplier))",
        "  Declaration(Class(supp:ApprovedSupplier))",
        "  SubClassOf(supp:ApprovedSupplier supp:Supplier)",
        "  Declaration(NamedIndividual(supp:TorayAdvancedComposites))",
        "  Declaration(NamedIndividual(supp:ATI_Metals))",
        "  Declaration(NamedIndividual(supp:AlcoaAluminum))",
        "  ClassAssertion(supp:ApprovedSupplier supp:TorayAdvancedComposites)",
        "  ClassAssertion(supp:ApprovedSupplier supp:ATI_Metals)",
        "  ClassAssertion(supp:ApprovedSupplier supp:AlcoaAluminum)",
        "  Declaration(ObjectProperty(supp:suppliesMaterial))",
        "  ObjectPropertyAssertion(supp:suppliesMaterial supp:TorayAdvancedComposites mat:CarbonFiber)",
        "  ObjectPropertyAssertion(supp:suppliesMaterial supp:ATI_Metals mat:TitaniumAlloy)",
        "  ObjectPropertyAssertion(supp:suppliesMaterial supp:AlcoaAluminum mat:Aluminum6061)",
        "  Declaration(Class(mfg:Process))",
        "  Declaration(Class(mfg:AutoclaveCuring))",
        "  Declaration(Class(mfg:CNC_Milling_5Axis))",
        "  Declaration(Class(mfg:CNC_Milling_3Axis))",
        "  SubClassOf(mfg:AutoclaveCuring mfg:Process)",
        "  SubClassOf(mfg:CNC_Milling_5Axis mfg:Process)",
        "  SubClassOf(mfg:CNC_Milling_3Axis mfg:Process)",
        "  Declaration(ObjectProperty(mfg:requiresProcess))",
        "  ObjectPropertyAssertion(mfg:requiresProcess mat:CarbonFiber mfg:AutoclaveCuring)",
        "  ObjectPropertyAssertion(mfg:requiresProcess mat:TitaniumAlloy mfg:CNC_Milling_5Axis)",
        "  ObjectPropertyAssertion(mfg:requiresProcess mat:Aluminum6061 mfg:CNC_Milling_3Axis)",
        ")",
      ].join("\n"),
      "README.md": [
        "# Supply Chain Manufacturability",
        "",
        "This example demonstrates how OWL2 reasoning validates that a system design",
        "is **manufacturable** by checking whether all specified materials and processes",
        "are available in the supply chain ontology.",
      ].join("\n"),
    },
    "owl2-subsumption": {
      "components.mo": [
        "// Actuator component library for subsumption reasoning",
        "",
        "model Actuator",
        '  "Base class for all actuators"',
        '  parameter Real V_supply = 24 "Supply voltage [V]";',
        '  parameter Real I_max = 10 "Maximum current [A]";',
        "end Actuator;",
        "",
        "model ServoMotor",
        '  "High-precision servo motor - high voltage"',
        "  extends Actuator(V_supply = 380, I_max = 5);",
        '  parameter Real resolution = 0.001 "Angular resolution [rad]";',
        '  parameter Real tau_max = 15 "Maximum torque [N.m]";',
        "end ServoMotor;",
        "",
        "model StepperMotor",
        '  "Stepper motor - low voltage"',
        "  extends Actuator(V_supply = 48, I_max = 3);",
        '  parameter Integer steps_per_rev = 200 "Steps per revolution";',
        '  parameter Real tau_hold = 2.5 "Holding torque [N.m]";',
        "end StepperMotor;",
        "",
        "model LinearActuator",
        '  "Linear actuator - medium voltage"',
        "  extends Actuator(V_supply = 120, I_max = 8);",
        '  parameter Real stroke = 0.3 "Maximum stroke [m]";',
        '  parameter Real F_max = 500 "Maximum force [N]";',
        "end LinearActuator;",
      ].join("\n"),
      "requirements.sysml": [
        "package ActuatorRequirements {",
        "  private import ScalarValues::*;",
        "",
        "  requirement def HighVoltageRequirement {",
        "    doc /* Actuator shall operate at high voltage (>= 200V) */",
        "    attribute minVoltage : Real = 200.0;",
        "  }",
        "",
        "  requirement def PrecisionRequirement {",
        "    doc /* Actuator shall provide positioning resolution <= 0.01 rad */",
        "    attribute maxResolution : Real = 0.01;",
        "  }",
        "",
        "  part def HighVoltageActuator {",
        "    attribute voltage : Real;",
        "  }",
        "}",
      ].join("\n"),
      "taxonomy.owl": [
        "Prefix(mo: = <http://modelscript.org/modelica#>)",
        "Prefix(sysml: = <http://modelscript.org/sysml2#>)",
        "Ontology(<http://modelscript.org/examples/subsumption>",
        "  Import(<http://modelscript.org/modelica#>)",
        "  Import(<http://modelscript.org/sysml2#>)",
        "  Declaration(Class(mo:Actuator))",
        "  Declaration(Class(mo:ServoMotor))",
        "  Declaration(Class(mo:StepperMotor))",
        "  Declaration(Class(mo:LinearActuator))",
        "  SubClassOf(mo:ServoMotor mo:Actuator)",
        "  SubClassOf(mo:StepperMotor mo:Actuator)",
        "  SubClassOf(mo:LinearActuator mo:Actuator)",
        "  Declaration(Class(mo:HighVoltageActuator))",
        "  SubClassOf(mo:HighVoltageActuator mo:Actuator)",
        "  SubClassOf(mo:ServoMotor mo:HighVoltageActuator)",
        "  SubClassOf(sysml:HighVoltageActuator mo:HighVoltageActuator)",
        "  Declaration(DataProperty(mo:supplyVoltage))",
        '  DataPropertyAssertion(mo:supplyVoltage mo:ServoMotor "380")',
        '  DataPropertyAssertion(mo:supplyVoltage mo:StepperMotor "48")',
        '  DataPropertyAssertion(mo:supplyVoltage mo:LinearActuator "120")',
        ")",
      ].join("\n"),
      "README.md": [
        "# Automated Component Selection via Subsumption",
        "",
        "This example demonstrates how OWL2 **subsumption reasoning** can automatically",
        "identify which Modelica components satisfy a set of requirements.",
      ].join("\n"),
    },
    "owl2-units": {
      "unit_ontology.owl": [
        "Prefix(mo: = <http://modelscript.org/modelica#>)",
        "Prefix(unit: = <http://modelscript.org/units#>)",
        "Ontology(<http://modelscript.org/examples/units>",
        "  Import(<http://modelscript.org/modelica#>)",
        "  Declaration(Class(unit:SIUnit))",
        "  Declaration(Class(unit:PressureUnit))",
        "  Declaration(Class(unit:TemperatureUnit))",
        "  Declaration(Class(unit:ForceUnit))",
        "  Declaration(Class(unit:LengthUnit))",
        "  SubClassOf(unit:PressureUnit unit:SIUnit)",
        "  SubClassOf(unit:TemperatureUnit unit:SIUnit)",
        "  SubClassOf(unit:ForceUnit unit:SIUnit)",
        "  SubClassOf(unit:LengthUnit unit:SIUnit)",
        "  DisjointClasses(unit:PressureUnit unit:TemperatureUnit)",
        "  DisjointClasses(unit:PressureUnit unit:ForceUnit)",
        "  DisjointClasses(unit:TemperatureUnit unit:LengthUnit)",
        "  Declaration(NamedIndividual(unit:Pascal))",
        "  Declaration(NamedIndividual(unit:Kelvin))",
        "  Declaration(NamedIndividual(unit:Newton))",
        "  Declaration(NamedIndividual(unit:Meter))",
        "  ClassAssertion(unit:PressureUnit unit:Pascal)",
        "  ClassAssertion(unit:TemperatureUnit unit:Kelvin)",
        "  ClassAssertion(unit:ForceUnit unit:Newton)",
        "  ClassAssertion(unit:LengthUnit unit:Meter)",
        "  Declaration(ObjectProperty(mo:hasOutputUnit))",
        "  Declaration(ObjectProperty(mo:hasInputUnit))",
        "  ObjectPropertyAssertion(mo:hasOutputUnit mo:pressureSensor unit:Pascal)",
        "  ObjectPropertyAssertion(mo:hasInputUnit mo:tempController unit:Kelvin)",
        "  Declaration(NamedIndividual(mo:pressureSensor))",
        "  Declaration(NamedIndividual(mo:tempController))",
        ")",
      ].join("\n"),
      "units_model.mo": [
        "// Semantic Unit Verification - Deliberate unit mismatch",
        "// This model connects a pressure output to a temperature input",
        "",
        "connector PressurePort",
        '  Real p "Pressure [Pa]";',
        "end PressurePort;",
        "",
        "connector TemperaturePort",
        '  Real T "Temperature [K]";',
        "end TemperaturePort;",
        "",
        "model PressureSensor",
        '  "Outputs pressure in Pascals"',
        "  PressurePort output_port;",
        "equation",
        "  output_port.p = 101325; // atmospheric pressure",
        "end PressureSensor;",
        "",
        "model TemperatureController",
        '  "Expects temperature input in Kelvins"',
        "  TemperaturePort input_port;",
        '  parameter Real setpoint = 350 "Target temperature [K]";',
        "  Real error;",
        "equation",
        "  error = setpoint - input_port.T;",
        "end TemperatureController;",
        "",
        "model BadSystem",
        '  "Connects pressure output to temperature input - unit mismatch!"',
        "  PressureSensor pressureSensor;",
        "  TemperatureController tempController;",
        "equation",
        "  // This is semantically wrong: Pa != K",
        "  tempController.input_port.T = pressureSensor.output_port.p;",
        "end BadSystem;",
      ].join("\n"),
      "README.md": [
        "# Semantic Unit Verification",
        "",
        "This example demonstrates how OWL2 reasoning can catch **dimensional analysis errors**",
        "by encoding SI unit constraints as class restrictions and verifying that connected",
        "ports have compatible units.",
      ].join("\n"),
    },
  };

  if (template === "stress-test") {
    const massiveModelRows = [];
    massiveModelRows.push('model MassiveModel "A massive model with thousands of elements"');
    for (let i = 0; i < 5000; i++) {
      massiveModelRows.push(`  Real v${i}(start = ${i});`);
    }
    massiveModelRows.push("equation");
    for (let i = 0; i < 4999; i++) {
      massiveModelRows.push(`  der(v${i}) = v${i + 1} - v${i};`);
    }
    massiveModelRows.push(`  der(v4999) = -v4999;`);
    massiveModelRows.push("end MassiveModel;\n");

    const entries: [vscode.Uri, Uint8Array][] = [];
    entries.push([joinPath(workspaceUri, "MassiveModel.mo"), encoder.encode(massiveModelRows.join("\n"))]);

    for (let i = 0; i < 5; i++) {
      // Use SysML2 ':>' syntax for inheritance to avoid syntax errors
      const extendsClause = i > 0 ? `:> Component_${String(i - 1).padStart(3, "0")} ` : "";
      const content = `package Component_${String(i).padStart(3, "0")} {\n  part def Component_${String(i).padStart(3, "0")} ${extendsClause}{\n    attribute localValue : Real = ${i}.0;\n  }\n}\n`;
      entries.push([joinPath(workspaceUri, `Component_${String(i).padStart(3, "0")}.sysml`), encoder.encode(content)]);
    }
    if (memFs.writeFiles) {
      memFs.writeFiles(entries);
    } else {
      for (const [uri, data] of entries) {
        memFs.writeFile(uri, data);
      }
    }
    console.log("[blank-project] Scaffolded stress-test workspace files.");
    return;
  }

  const files = templates[template];
  if (files) {
    for (const [name, content] of Object.entries(files)) {
      const fileUri = joinPath(workspaceUri, name);
      memFs.writeFile(fileUri, encoder.encode(content));
    }
    console.log(`[blank-project] Scaffolded ${Object.keys(files).length} template file(s) for '${template}'`);
  }
}

export function getTemplatePrimaryFile(template: string): string {
  const map: Record<string, string> = {
    // Basic templates
    empty: "HelloWorld.mo",
    blank: "HelloWorld.mo",
    "bouncing-ball": "BouncingBall.mo",
    "drone-reachability": "modelica/DroneSimulation.mo",
    "pscad-microgrid": "Microgrid_IBR.pscx",
    rlc: "RLC.mo",
    script: "simulate.mos",
    notebook: "demo.monb",
    "stress-test": "MassiveModel.mo",

    // Digital Thread & CAD / CAE
    "drone-chassis": "DroneSimulation.mo",
    cad: "drone_architecture.sysml",
    "cad-assembly": "RobotAssembly.mo",
    "drone-meshing": "README.md",
    "drone-fea": "DroneFEA.mo",
    "drone-cfd": "DroneFlight.mo",
    "modelica-procedural-cad": "DroneCAD.mo",
    "assembly-to-multibody": "SimplePendulum.step",
    "injection-molding-cosim": "Manufacturing.mo",

    // Systems Engineering & MBSE
    sysml2: "VehicleSystem.sysml",
    "simulation-verification": "BatteryArchitecture.sysml",
    "mbse-verification": "VerificationReport.md",
    "hardware-ci": "SystemIntegration.mo",

    // Simulation, Optimization & Surrogate
    fmi2: "System.mo",
    fmi3: "System.mo",
    surrogate: "BouncingBall.mo",
    "cfd-verification": "ThermalSystem.mo",
    calibration: "SpringDamper.mo",
    "data-driven-calibration": "Suspension.mo",
    "multi-fidelity-binding": "PropellerDynamics.mo",
    "optimica-polyglot": "RocketSled.mo",
    uncertainty: "Projectile.mo",
    cosim: "CosimSetup.mo",
    "uns-mqtt": "DigitalTwin.mo",

    // Semantic Web & OWL2
    "owl2-contradiction": "constraints.owl",
    "owl2-fmea": "control_system.mo",
    "owl2-manufacturing": "drone.sysml",
    "owl2-subsumption": "components.mo",
    "owl2-units": "units_model.mo",

    // Backwards-compatibility aliases
    "pendulum-3d": "DoublePendulum.mo",
    "vehicle-architecture": "VehicleSystem.sysml",
  };
  if (template === "scratch" || template.startsWith("artifact-")) {
    const artifactId = template === "scratch" ? "scratch" : template.slice("artifact-".length);
    let registered = artifactRegistry.get(artifactId);
    if (!registered && typeof sessionStorage !== "undefined") {
      try {
        const raw = sessionStorage.getItem(`modelscript.artifact_${artifactId}`);
        if (raw) registered = JSON.parse(raw);
      } catch {
        // ignore
      }
    }
    if (registered) {
      const { primaryFile } = generateArtifactWorkspaceFiles(registered);
      return primaryFile;
    }
    return template === "scratch" ? "ScratchModel.mo" : "ArtifactModel.mo";
  }

  if (template.startsWith("package-")) {
    const pkgName = template.slice("package-".length);
    const { primaryFile } = generatePackageWorkspaceFiles(pkgName);
    return primaryFile;
  }
  return map[template] ?? "HelloWorld.mo";
}
