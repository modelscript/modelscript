// SPDX-License-Identifier: AGPL-3.0-or-later

import { ThreadDomain } from "@modelscript/runtime";
import type { WorkspaceManager } from "../../src/services/workspace-manager.js";

/**
 * Seeds the digital thread hypergraph with reference cross-domain threads
 * (powertrain inverter, thermal cooling plate, and multi-domain drone assembly)
 * for testing fixtures.
 */
export function seedTestWorkspaceThreads(wm: WorkspaceManager, options?: { force?: boolean }): void {
  if (!options?.force && wm.hypergraph.getThreadCount() > 0) return;
  const s0 = wm.hypergraph.createThread(101, 1);
  wm.hypergraph.bindDomainNode(s0, ThreadDomain.Requirements, 1001);
  wm.hypergraph.bindDomainNode(s0, ThreadDomain.SysML2, 2001);
  wm.hypergraph.bindDomainNode(s0, ThreadDomain.Modelica, 3001);
  wm.hypergraph.bindDomainNode(s0, ThreadDomain.CAD, 4001);
  wm.hypergraph.bindDomainNode(s0, ThreadDomain.FEA, 5001);
  wm.hypergraph.bindDomainNode(s0, ThreadDomain.BOM, 6001);

  wm.threadMetadataMap.set("requirements:1001", {
    name: "REQ-TORQUE-01 (Peak Torque >= 350Nm)",
    uri: "file:///workspace/requirements/powertrain.reqif",
    line: 12,
    column: 1,
    domain: "requirements",
    properties: { status: "Verified" },
  });
  wm.threadMetadataMap.set("sysml2:2001", {
    name: "part def PowertrainInverter",
    uri: "file:///workspace/sysml/Powertrain.sysml",
    line: 45,
    column: 5,
    domain: "sysml2",
    properties: { mass: 1.0 },
  });
  wm.threadMetadataMap.set("modelica:3001", {
    name: "model InverterDrive",
    uri: "file:///workspace/modelica/InverterDrive.mo",
    line: 14,
    column: 1,
    domain: "modelica",
    properties: { mass: 1.0 },
  });
  wm.threadMetadataMap.set("cad:4001", {
    name: "Inverter_Chassis.step",
    uri: "file:///workspace/cad/Inverter_Chassis.step",
    line: 1,
    column: 1,
    domain: "cad",
    properties: { mass: 1.02 },
  });
  wm.threadMetadataMap.set("fea:5001", {
    name: "InverterMount_CalculiX.inp",
    uri: "file:///workspace/fea/InverterMount_CalculiX.inp",
    line: 1,
    column: 1,
    domain: "fea",
  });
  wm.threadMetadataMap.set("bom:6001", {
    name: "P/N 840-0219 (Inverter Assy)",
    uri: "file:///workspace/bom/parts.csv",
    line: 1,
    column: 1,
    domain: "bom",
  });

  const s1 = wm.hypergraph.createThread(102, 2);
  wm.hypergraph.bindDomainNode(s1, ThreadDomain.Requirements, 1002);
  wm.hypergraph.bindDomainNode(s1, ThreadDomain.SysML2, 2002);
  wm.hypergraph.bindDomainNode(s1, ThreadDomain.Modelica, 3002);
  wm.hypergraph.bindDomainNode(s1, ThreadDomain.CAD, 4002);
  wm.hypergraph.markStale(s1);

  wm.threadMetadataMap.set("requirements:1002", {
    name: "REQ-THERMAL-02 (Junction Temp <= 85C)",
    uri: "file:///workspace/requirements/thermal.reqif",
    line: 28,
    column: 1,
    domain: "requirements",
  });
  wm.threadMetadataMap.set("sysml2:2002", {
    name: "part def CoolingPlate",
    uri: "file:///workspace/sysml/Cooling.sysml",
    line: 88,
    column: 5,
    domain: "sysml2",
  });
  wm.threadMetadataMap.set("modelica:3002", {
    name: "model CoolingCircuit",
    uri: "file:///workspace/modelica/CoolingCircuit.mo",
    line: 32,
    column: 1,
    domain: "modelica",
    properties: { mass: 0.8 },
  });
  wm.threadMetadataMap.set("cad:4002", {
    name: "CoolingPlate.step",
    uri: "file:///workspace/cad/CoolingPlate.step",
    line: 1,
    column: 1,
    domain: "cad",
    properties: { mass: 1.15 },
  });

  const sDrone = wm.hypergraph.createThread(104, 3);
  wm.hypergraph.bindDomainNode(sDrone, ThreadDomain.SysML2, 2004);
  wm.hypergraph.bindDomainNode(sDrone, ThreadDomain.Modelica, 3004);
  wm.hypergraph.bindDomainNode(sDrone, ThreadDomain.CAD, 4004);
  wm.hypergraph.bindDomainNode(sDrone, ThreadDomain.FEA, 5004);
  wm.hypergraph.bindDomainNode(sDrone, ThreadDomain.CFD, 6004);
  wm.hypergraph.bindDomainNode(sDrone, ThreadDomain.Requirements, 7004);

  wm.threadMetadataMap.set("sysml2:2004", {
    name: "part def DroneAssembly",
    uri: "sysml/drone_specs.sysml",
    line: 30,
    column: 3,
    domain: "sysml2",
    properties: { mass: 1.2, frontalArea: 0.03, aeroDragCoeff: 0.8 },
  });
  wm.threadMetadataMap.set("modelica:3004", {
    name: "model DroneSimulation",
    uri: "modelica/DroneSimulation.mo",
    line: 1,
    column: 1,
    domain: "modelica",
    properties: { mass: 1.2, frontalArea: 0.03, aeroDragCoeff: 0.8 },
  });
  wm.threadMetadataMap.set("cad:4004", {
    name: "drone.scad",
    uri: "cad/drone.scad",
    line: 12,
    column: 1,
    domain: "cad",
    properties: { frontalArea: 0.03, mass: 1.2 },
  });
  wm.threadMetadataMap.set("fea:5004", {
    name: "drone_chassis.inp",
    uri: "cae/drone_chassis.inp",
    line: 33,
    column: 1,
    domain: "fea",
    properties: { mass: 1.2, maxStress: 172.4, yieldStrength: 180.0 },
  });
  wm.threadMetadataMap.set("cfd:6004", {
    name: "drone_aero.cfg",
    uri: "cae/drone_aero.cfg",
    line: 23,
    column: 1,
    domain: "cfd",
    properties: { aeroDragCoeff: 0.8, frontalArea: 0.03 },
  });
  wm.threadMetadataMap.set("requirements:7004", {
    name: "requirement FlightCeilingRequirement",
    uri: "sysml/drone_specs.sysml",
    line: 43,
    column: 3,
    domain: "requirements",
    properties: { v_climb_max: 12.0, status: "Verified" },
  });
}
