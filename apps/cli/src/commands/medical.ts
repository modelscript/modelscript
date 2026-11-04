// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export const OpenSimCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "opensim <action> [files...]",
  describe:
    "Inspect, validate musculoskeletal kinematics & Hill-type muscles (M9101–M9110), simulate muscle activation, and project OpenSim models (.osim)",
  builder: (yargs) =>
    yargs
      .positional("action", {
        type: "string",
        describe: "Action: inspect | validate | simulate | to-modelica | to-urdf | to-dae",
        choices: ["inspect", "validate", "simulate", "to-modelica", "to-urdf", "to-dae"],
      })
      .positional("files", {
        type: "string",
        array: true,
        describe: "Input OpenSim (.osim) files",
      }),
  handler: async (argv) => {
    const {
      lintOpenSimDocument,
      lowerOpenSimToDae,
      openSimToModelica,
      openSimToUrdf,
      parseOpenSim,
      simulateMuscleDynamics,
    } = await import("@modelscript/opensim");
    const action = argv["action"] as string;
    const files = (argv["files"] as string[]) ?? [];
    for (const file of files) {
      const content = fs.readFileSync(path.resolve(process.cwd(), file), "utf-8");
      const doc = parseOpenSim(content, file);
      if (action === "validate") {
        console.log(JSON.stringify(lintOpenSimDocument(doc), null, 2));
      } else if (action === "simulate") {
        console.log(JSON.stringify(simulateMuscleDynamics(doc), null, 2));
      } else if (action === "to-modelica") {
        console.log(openSimToModelica(doc));
      } else if (action === "to-urdf") {
        console.log(openSimToUrdf(doc));
      } else if (action === "to-dae") {
        const dae = lowerOpenSimToDae(doc);
        console.log(JSON.stringify({ variables: dae.getVarCount(), equations: dae.getEqCount() }, null, 2));
      } else {
        console.log(
          JSON.stringify(
            {
              modelName: doc.modelName,
              bodies: doc.bodies.length,
              joints: doc.joints.length,
              muscles: doc.muscles.length,
              markers: doc.markers.length,
            },
            null,
            2,
          ),
        );
      }
    }
  },
};

export const DicomRtCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "dicom-rt <action> [files...]",
  describe:
    "Inspect, verify QUANTEC OAR dose constraints & MLC leaf kinematics (M9201–M9210), compute DVH/BED/EQD2, and project DICOM-RT plans (.rtplan, .rtstruct, .rtdose)",
  builder: (yargs) =>
    yargs
      .positional("action", {
        type: "string",
        describe: "Action: inspect | validate | dosimetry | to-scad | to-sysml | to-dae",
        choices: ["inspect", "validate", "dosimetry", "to-scad", "to-sysml", "to-dae"],
      })
      .positional("files", {
        type: "string",
        array: true,
        describe: "Input DICOM-RT (.rtplan, .rtstruct, .rtdose) files",
      }),
  handler: async (argv) => {
    const {
      dicomRtToScad,
      dicomRtToSysML2,
      evaluateDicomRtDosimetry,
      lintDicomRtDocument,
      lowerDicomRtToDae,
      parseDicomRt,
    } = await import("@modelscript/dicom-rt");
    const action = argv["action"] as string;
    const files = (argv["files"] as string[]) ?? [];
    for (const file of files) {
      const content = fs.readFileSync(path.resolve(process.cwd(), file), "utf-8");
      const doc = parseDicomRt(content, file);
      if (action === "validate") {
        console.log(JSON.stringify(lintDicomRtDocument(doc), null, 2));
      } else if (action === "dosimetry") {
        console.log(JSON.stringify(evaluateDicomRtDosimetry(doc), null, 2));
      } else if (action === "to-scad") {
        console.log(dicomRtToScad(doc));
      } else if (action === "to-sysml") {
        console.log(dicomRtToSysML2(doc));
      } else if (action === "to-dae") {
        const dae = lowerDicomRtToDae(doc);
        console.log(JSON.stringify({ variables: dae.getVarCount(), equations: dae.getEqCount() }, null, 2));
      } else {
        console.log(
          JSON.stringify(
            {
              planId: doc.planId,
              prescribedDoseGy: doc.prescribedDoseGy,
              fractions: doc.fractions,
              structures: doc.structures.length,
              beams: doc.beams.length,
            },
            null,
            2,
          ),
        );
      }
    }
  },
};

export const CellmlCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "cellml <action> [files...]",
  describe:
    "Inspect, validate SI dimensional units & component connections (M9301–M9310), integrate electrophysiology ODEs, and project CellML models (.cellml)",
  builder: (yargs) =>
    yargs
      .positional("action", {
        type: "string",
        describe: "Action: inspect | validate | simulate | to-modelica | to-sbml | to-dae",
        choices: ["inspect", "validate", "simulate", "to-modelica", "to-sbml", "to-dae"],
      })
      .positional("files", {
        type: "string",
        array: true,
        describe: "Input CellML (.cellml) files",
      }),
  handler: async (argv) => {
    const { cellmlToModelica, cellmlToSbml, lintCellmlDocument, lowerCellmlToDae, parseCellml, solveCellml } =
      await import("@modelscript/cellml");
    const action = argv["action"] as string;
    const files = (argv["files"] as string[]) ?? [];
    for (const file of files) {
      const content = fs.readFileSync(path.resolve(process.cwd(), file), "utf-8");
      const doc = parseCellml(content, file);
      if (action === "validate") {
        console.log(JSON.stringify(lintCellmlDocument(doc), null, 2));
      } else if (action === "simulate") {
        console.log(JSON.stringify(solveCellml(doc), null, 2));
      } else if (action === "to-modelica") {
        console.log(cellmlToModelica(doc));
      } else if (action === "to-sbml") {
        console.log(cellmlToSbml(doc));
      } else if (action === "to-dae") {
        const dae = lowerCellmlToDae(doc);
        console.log(JSON.stringify({ variables: dae.getVarCount(), equations: dae.getEqCount() }, null, 2));
      } else {
        console.log(
          JSON.stringify(
            {
              name: doc.name,
              version: doc.version,
              components: doc.components.size,
              connections: doc.connections.length,
            },
            null,
            2,
          ),
        );
      }
    }
  },
};

export const FebioCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "febio <action> [files...]",
  describe:
    "Inspect, validate hyperelastic/biphasic tissue mechanics & SOFA surgical scenes (M9401–M9410), solve strain energy, and project FEBio/SOFA models (.feb, .scn)",
  builder: (yargs) =>
    yargs
      .positional("action", {
        type: "string",
        describe: "Action: inspect | validate | solve | to-inp | to-modelica | to-dae",
        choices: ["inspect", "validate", "solve", "to-inp", "to-modelica", "to-dae"],
      })
      .positional("files", {
        type: "string",
        array: true,
        describe: "Input FEBio (.feb) or SOFA (.scn) files",
      }),
  handler: async (argv) => {
    const {
      febioToCalculixInp,
      febioToModelica,
      lintFebioDocument,
      lowerFebioToDae,
      parseFebio,
      solveHyperelasticMechanics,
    } = await import("@modelscript/febio");
    const action = argv["action"] as string;
    const files = (argv["files"] as string[]) ?? [];
    for (const file of files) {
      const content = fs.readFileSync(path.resolve(process.cwd(), file), "utf-8");
      const doc = parseFebio(content, file);
      if (action === "validate") {
        console.log(JSON.stringify(lintFebioDocument(doc), null, 2));
      } else if (action === "solve") {
        console.log(JSON.stringify(solveHyperelasticMechanics(doc), null, 2));
      } else if (action === "to-inp") {
        console.log(febioToCalculixInp(doc));
      } else if (action === "to-modelica") {
        console.log(febioToModelica(doc));
      } else if (action === "to-dae") {
        const dae = lowerFebioToDae(doc);
        console.log(JSON.stringify({ variables: dae.getVarCount(), equations: dae.getEqCount() }, null, 2));
      } else {
        console.log(
          JSON.stringify(
            {
              materials: doc.materials.length,
              nodes: doc.nodes.length,
              elements: doc.elements.length,
            },
            null,
            2,
          ),
        );
      }
    }
  },
};

export const NiftiCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "nifti <action> [files...]",
  describe:
    "Inspect, validate qform/sform RAS affine transforms (M9501–M9510), extract iso-surface meshes, and project NIfTI/NRRD volumes (.nii, .nrrd, .nhdr)",
  builder: (yargs) =>
    yargs
      .positional("action", {
        type: "string",
        describe: "Action: inspect | validate | mesh | to-scad | to-step | to-dae",
        choices: ["inspect", "validate", "mesh", "to-scad", "to-step", "to-dae"],
      })
      .positional("files", {
        type: "string",
        array: true,
        describe: "Input NIfTI (.nii) or NRRD (.nrrd, .nhdr) files",
      }),
  handler: async (argv) => {
    const { extractIsoSurfaceMesh, lintNiftiDocument, lowerNiftiToDae, niftiToScad, niftiToStep, parseNifti } =
      await import("@modelscript/nifti");
    const action = argv["action"] as string;
    const files = (argv["files"] as string[]) ?? [];
    for (const file of files) {
      const content = fs.readFileSync(path.resolve(process.cwd(), file), "utf-8");
      const doc = parseNifti(content, file);
      if (action === "validate") {
        console.log(JSON.stringify(lintNiftiDocument(doc), null, 2));
      } else if (action === "mesh") {
        console.log(JSON.stringify(extractIsoSurfaceMesh(doc), null, 2));
      } else if (action === "to-scad") {
        console.log(niftiToScad(doc));
      } else if (action === "to-step") {
        console.log(niftiToStep(doc));
      } else if (action === "to-dae") {
        const dae = lowerNiftiToDae(doc);
        console.log(JSON.stringify({ variables: dae.getVarCount(), equations: dae.getEqCount() }, null, 2));
      } else {
        console.log(JSON.stringify({ format: doc.format, dims: doc.header.dim, pixdim: doc.header.pixdim }, null, 2));
      }
    }
  },
};

export const TopasCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "topas <action> [files...]",
  describe:
    "Inspect, validate TOPAS/GATE hadrontherapy beamlines (M9601–M9610), compute analytical Bragg peak depth-dose curves, and project to OpenSCAD/Modelica (.topas, .mac)",
  builder: (yargs) =>
    yargs
      .positional("action", {
        type: "string",
        describe: "Action: inspect | validate | bragg-peak | to-scad | to-modelica | to-dae",
        choices: ["inspect", "validate", "bragg-peak", "to-scad", "to-modelica", "to-dae"],
      })
      .positional("files", {
        type: "string",
        array: true,
        describe: "Input TOPAS (.topas) or GATE (.mac) files",
      }),
  handler: async (argv) => {
    const { computeBraggPeakDepthDose, lintTopasDocument, lowerTopasToDae, parseTopas, topasToModelica, topasToScad } =
      await import("@modelscript/topas");
    const action = argv["action"] as string;
    const files = (argv["files"] as string[]) ?? [];
    for (const file of files) {
      const content = fs.readFileSync(path.resolve(process.cwd(), file), "utf-8");
      const doc = parseTopas(content, file);
      if (action === "validate") {
        console.log(JSON.stringify(lintTopasDocument(doc), null, 2));
      } else if (action === "bragg-peak") {
        console.log(JSON.stringify(computeBraggPeakDepthDose(doc), null, 2));
      } else if (action === "to-scad") {
        console.log(topasToScad(doc));
      } else if (action === "to-modelica") {
        console.log(topasToModelica(doc));
      } else if (action === "to-dae") {
        const dae = lowerTopasToDae(doc);
        console.log(JSON.stringify({ variables: dae.getVarCount(), equations: dae.getEqCount() }, null, 2));
      } else {
        console.log(
          JSON.stringify(
            {
              components: doc.components.length,
              sources: doc.sources.length,
              scorers: doc.scorers.length,
            },
            null,
            2,
          ),
        );
      }
    }
  },
};

export const ThreeMfCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "three-mf <action> [files...]",
  describe:
    "Inspect, verify 2-manifold topology, wall thickness & osteotomy guides (M9701–M9710), and project 3MF Medical surgical guides & implants (.3mf)",
  builder: (yargs) =>
    yargs
      .positional("action", {
        type: "string",
        describe: "Action: inspect | validate | topology | to-step | to-scad | to-dae",
        choices: ["inspect", "validate", "topology", "to-step", "to-scad", "to-dae"],
      })
      .positional("files", {
        type: "string",
        array: true,
        describe: "Input 3MF Medical (.3mf) files",
      }),
  handler: async (argv) => {
    const { lintThreeMfDocument, lowerThreeMfToDae, parseThreeMf, threeMfToScad, threeMfToStep, verifyMeshTopology } =
      await import("@modelscript/three-mf");
    const action = argv["action"] as string;
    const files = (argv["files"] as string[]) ?? [];
    for (const file of files) {
      const content = fs.readFileSync(path.resolve(process.cwd(), file), "utf-8");
      const doc = parseThreeMf(content, file);
      if (action === "validate") {
        console.log(JSON.stringify(lintThreeMfDocument(doc), null, 2));
      } else if (action === "topology") {
        console.log(JSON.stringify(verifyMeshTopology(doc), null, 2));
      } else if (action === "to-step") {
        console.log(threeMfToStep(doc));
      } else if (action === "to-scad") {
        console.log(threeMfToScad(doc));
      } else if (action === "to-dae") {
        const dae = lowerThreeMfToDae(doc);
        console.log(JSON.stringify({ variables: dae.getVarCount(), equations: dae.getEqCount() }, null, 2));
      } else {
        console.log(
          JSON.stringify(
            {
              unit: doc.unit,
              objects: doc.objects.length,
              buildItems: doc.buildItems.length,
              surgicalGuides: doc.objects.filter((o) => Boolean(o.surgicalGuide)).length,
            },
            null,
            2,
          ),
        );
      }
    }
  },
};

export const IgtlCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "igtl <action> [files...]",
  describe:
    "Inspect, validate SE(3) transforms & surgical navigation chains (M9801–M9810), solve stylus pivot calibration & TRE, and project OpenIGTLink/PLUS configs (.igtl, .plus.xml)",
  builder: (yargs) =>
    yargs
      .positional("action", {
        type: "string",
        describe: "Action: inspect | validate | calibrate | to-urdf | to-modelica | to-dae",
        choices: ["inspect", "validate", "calibrate", "to-urdf", "to-modelica", "to-dae"],
      })
      .positional("files", {
        type: "string",
        array: true,
        describe: "Input OpenIGTLink (.igtl) or PLUS (.plus.xml) files",
      }),
  handler: async (argv) => {
    const { igtlToModelica, igtlToUrdf, lintIgtlDocument, lowerIgtlToDae, parseIgtl, solveTransformChainAndPivot } =
      await import("@modelscript/igtl");
    const action = argv["action"] as string;
    const files = (argv["files"] as string[]) ?? [];
    for (const file of files) {
      const content = fs.readFileSync(path.resolve(process.cwd(), file), "utf-8");
      const doc = parseIgtl(content, file);
      if (action === "validate") {
        console.log(JSON.stringify(lintIgtlDocument(doc), null, 2));
      } else if (action === "calibrate") {
        console.log(JSON.stringify(solveTransformChainAndPivot(doc), null, 2));
      } else if (action === "to-urdf") {
        console.log(igtlToUrdf(doc));
      } else if (action === "to-modelica") {
        console.log(igtlToModelica(doc));
      } else if (action === "to-dae") {
        const dae = lowerIgtlToDae(doc);
        console.log(JSON.stringify({ variables: dae.getVarCount(), equations: dae.getEqCount() }, null, 2));
      } else {
        console.log(
          JSON.stringify(
            {
              devices: doc.devices.length,
              transforms: doc.transforms.length,
              servers: doc.servers.length,
            },
            null,
            2,
          ),
        );
      }
    }
  },
};
