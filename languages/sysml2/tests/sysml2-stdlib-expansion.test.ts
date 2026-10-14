// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createSysML2QueryEngine, createSysML2WorkspaceIndex, loadEmbeddedKerMLStdlib } from "../src/factory.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sysmlWasm = path.resolve(__dirname, "../dist/parser.wasm");

describe("SysML v2 Comprehensive Standard Library Expansion (Phase 4)", () => {
  it("hydrates expanded 675-symbol standard library snapshot instantly (< 50ms)", () => {
    const ws = createSysML2WorkspaceIndex();
    const start = performance.now();
    const uri = loadEmbeddedKerMLStdlib(ws);
    const elapsed = performance.now() - start;

    assert.strictEqual(uri, "sysml2://stdlib/KerML.sysml");
    assert.ok(elapsed < 50, `Snapshot hydration must be fast (< 50ms), took ${elapsed.toFixed(2)}ms`);

    const unified = ws.toUnified();
    assert.strictEqual(unified.symbols.size, 675);
  });

  it("indexes and verifies all standard library packages across domains", () => {
    const ws = createSysML2WorkspaceIndex();
    loadEmbeddedKerMLStdlib(ws);
    const unified = ws.toUnified();
    const qe = createSysML2QueryEngine(unified);
    const db = qe.toQueryDB();

    const expectedPackages = [
      "ScalarValues",
      "Base",
      "CoreTypes",
      "Collections",
      "Control",
      "Transfers",
      "Performances",
      "ISQ",
      "SIBaseUnits",
      "SIDerivedUnits",
      "SI",
      "USCustomaryUnits",
      "CauseAndEffect",
      "SpatialFrames",
      "StateMachines",
    ];

    for (const pkg of expectedPackages) {
      const entries = db.byName(pkg);
      assert.ok(entries.length > 0, `Package '${pkg}' must be indexed in stdlib`);
    }
  });

  it("verifies comprehensive ISO/IEC 80000 ISQ quantities across multiple engineering domains", () => {
    const ws = createSysML2WorkspaceIndex();
    loadEmbeddedKerMLStdlib(ws);
    const unified = ws.toUnified();
    const qe = createSysML2QueryEngine(unified);
    const db = qe.toQueryDB();

    const isqQuantities = [
      // Space and time
      "Time",
      "Duration",
      "Period",
      "Length",
      "Width",
      "Height",
      "Distance",
      "Position",
      "Displacement",
      "Radius",
      "Diameter",
      "Thickness",
      "Area",
      "Volume",
      "Angle",
      "SolidAngle",
      "Velocity",
      "LinearVelocity",
      "Speed",
      "AngularVelocity",
      "Acceleration",
      "LinearAcceleration",
      "AngularAcceleration",
      "Frequency",
      // Mechanics
      "Mass",
      "MassDensity",
      "Momentum",
      "AngularMomentum",
      "MomentOfInertia",
      "Force",
      "Weight",
      "Torque",
      "Stress",
      "Strain",
      "Work",
      "Energy",
      "KineticEnergy",
      "PotentialEnergy",
      "Power",
      // Fluid dynamics
      "DynamicViscosity",
      "KinematicViscosity",
      "SurfaceTension",
      "VolumeFlowRate",
      "MassFlowRate",
      "ReynoldsNumber",
      "MachNumber",
      // Thermodynamics
      "ThermodynamicTemperature",
      "CelsiusTemperature",
      "Heat",
      "HeatFlowRate",
      "ThermalConductivity",
      "SpecificHeatCapacity",
      "Entropy",
      "Enthalpy",
      "InternalEnergy",
      // Electromagnetism
      "ElectricCurrent",
      "ElectricCharge",
      "Voltage",
      "ElectricPotential",
      "ElectromotiveForce",
      "ElectricFieldStrength",
      "MagneticFlux",
      "MagneticFluxDensity",
      "Permittivity",
      "Permeability",
      "Conductance",
      "Resistivity",
      "Inductance",
      "Impedance",
      "Reactance",
      // Chemistry & Light
      "AmountOfSubstance",
      "MolarMass",
      "LuminousIntensity",
      "LuminousFlux",
      "Illuminance",
      "Luminance",
    ];

    for (const q of isqQuantities) {
      const entries = db.byName(q);
      assert.ok(entries.length > 0, `ISQ quantity '${q}' must be present in stdlib`);
    }
  });

  it("verifies unified SI unit symbols, prefixes, and derived quantities", () => {
    const ws = createSysML2WorkspaceIndex();
    loadEmbeddedKerMLStdlib(ws);
    const unified = ws.toUnified();
    const qe = createSysML2QueryEngine(unified);
    const db = qe.toQueryDB();

    const siSymbols = [
      "s",
      "kg",
      "m",
      "A",
      "K",
      "mol",
      "cd",
      "N",
      "Pa",
      "kPa",
      "MPa",
      "bar",
      "J",
      "kJ",
      "W",
      "kW",
      "MW",
      "V",
      "kV",
      "C",
      "ohm",
      "F",
      "uF",
      "H",
      "mH",
      "Hz",
      "kHz",
      "MHz",
      "GHz",
      "rad",
      "sr",
      "kat",
      "degC",
      // Scaled names
      "Millimetre",
      "Centimetre",
      "Kilometre",
      "Gram",
      "Milligram",
      "Millisecond",
      "Minute",
      "Hour",
      "Day",
      "Kilowatt",
      "Kilojoule",
      "Kilopascal",
      "Bar",
      "Litre",
      // Prefixes
      "Kilo",
      "Mega",
      "Giga",
      "Tera",
      "Milli",
      "Micro",
      "Nano",
      "Pico",
      "kilo",
      "mega",
      "giga",
      "milli",
      "micro",
      "nano",
      "pico",
    ];

    for (const s of siSymbols) {
      const entries = db.byName(s);
      assert.ok(entries.length > 0, `SI symbol/prefix '${s}' must be present in stdlib`);
    }
  });

  it("verifies US Customary and Imperial units coverage", () => {
    const ws = createSysML2WorkspaceIndex();
    loadEmbeddedKerMLStdlib(ws);
    const unified = ws.toUnified();
    const qe = createSysML2QueryEngine(unified);
    const db = qe.toQueryDB();

    const usUnits = [
      "Inch",
      "inch",
      "Foot",
      "ft",
      "Yard",
      "yd",
      "Mile",
      "mi",
      "SquareFoot",
      "Acre",
      "Pound",
      "lb",
      "lbf",
      "Slug",
      "Ton",
      "Gallon",
      "gal",
      "PoundPerSquareInch",
      "psi",
      "ksi",
      "BritishThermalUnit",
      "Btu",
      "Horsepower",
      "hp",
      "MilePerHour",
      "mph",
      "DegreeFahrenheit",
      "degF",
      "Rankine",
    ];

    for (const u of usUnits) {
      const entries = db.byName(u);
      assert.ok(entries.length > 0, `US Customary unit '${u}' must be present in stdlib`);
    }
  });

  it("verifies CauseAndEffect and SpatialFrames safety and geometric types", () => {
    const ws = createSysML2WorkspaceIndex();
    loadEmbeddedKerMLStdlib(ws);
    const unified = ws.toUnified();
    const qe = createSysML2QueryEngine(unified);
    const db = qe.toQueryDB();

    const safetyTypes = [
      "Cause",
      "Effect",
      "Causation",
      "CausalConnection",
      "Hazard",
      "FailureMode",
      "Fault",
      "HazardousEvent",
      "Risk",
      "HazardousState",
      "Mitigation",
      "SafetyCase",
      "SafetyRequirement",
    ];
    for (const st of safetyTypes) {
      const entries = db.byName(st);
      assert.ok(entries.length > 0, `Safety type '${st}' must be present in stdlib`);
    }

    const spatialTypes = [
      "SpatialFrame",
      "WorldFrame",
      "CoordinateFrame",
      "CartesianFrame",
      "Cartesian3DFrame",
      "PositionVector",
      "OrientationVector",
      "Orientation",
      "DisplacementVector",
      "Transform",
      "Transform3D",
      "Point3D",
    ];
    for (const spt of spatialTypes) {
      const entries = db.byName(spt);
      assert.ok(entries.length > 0, `Spatial type '${spt}' must be present in stdlib`);
    }

    const stateTypes = ["StateDefinition", "Transition", "Trigger", "Guard", "EntryAction", "ExitAction", "DoAction"];
    for (const st of stateTypes) {
      const entries = db.byName(st);
      assert.ok(entries.length > 0, `State machine type '${st}' must be present in stdlib`);
    }
  });

  it("resolves user model types importing from expanded standard library packages", async () => {
    const { parser } = await createWasmParser(sysmlWasm);
    const ws = createSysML2WorkspaceIndex();
    loadEmbeddedKerMLStdlib(ws);

    const userModel = `
      package UserRoboticsSystem {
        import ScalarValues::*;
        import ISQ::*;
        import SI::*;
        import USCustomaryUnits::*;
        import CauseAndEffect::*;
        import SpatialFrames::*;
        import StateMachines::*;

        part def AutonomousRover {
          attribute dt : Duration;
          attribute period : Period;
          attribute robotWidth : Width;
          attribute robotHeight : Height;
          attribute thermalEnthalpy : Enthalpy;
          attribute coilInductance : Inductance;
          attribute capStorage : Capacitance;

          attribute roverSpeed : mph;
          attribute terrainArea : Acre;
          attribute tirePressure : psi;

          attribute motorPower : Kilowatt;
          attribute batteryCapacity : Kilojoule;
          attribute cabinPressure : Kilopascal;
          attribute coolantVolume : Litre;

          item world : WorldFrame;
          item hazardLink : CausalConnection;
          item certification : SafetyCase;
          item fsm : StateDefinition;
        }
      }
    `;

    const userUri = "file:///workspace/UserRoboticsSystem.sysml";
    ws.register(userUri, () => {
      const tree = parser.parse(userModel);
      return tree ? (tree.rootNode as any) : null;
    });

    const unified = await ws.toUnifiedAsync();
    const qe = createSysML2QueryEngine(unified);
    const db = qe.toQueryDB();

    const roverDefs = db.byName("AutonomousRover");
    assert.strictEqual(roverDefs.length, 1);
    const rover = roverDefs[0];
    const children = db.childrenOf(rover.id);

    const checkAttributeType = (attrName: string, expectedTypeName: string) => {
      const attr = children.find((c: any) => c.name === attrName);
      assert.ok(attr, `Child attribute '${attrName}' must exist`);
      const resolved = qe.fetch("resolvedType", attr.id);
      assert.ok(resolved, `Type of '${attrName}' must resolve`);
      assert.strictEqual(
        (resolved as any).name,
        expectedTypeName,
        `'${attrName}' must resolve to '${expectedTypeName}'`,
      );
    };

    checkAttributeType("dt", "Duration");
    checkAttributeType("period", "Period");
    checkAttributeType("robotWidth", "Width");
    checkAttributeType("robotHeight", "Height");
    checkAttributeType("thermalEnthalpy", "Enthalpy");
    checkAttributeType("coilInductance", "Inductance");
    checkAttributeType("capStorage", "Capacitance");
    checkAttributeType("roverSpeed", "mph");
    checkAttributeType("terrainArea", "Acre");
    checkAttributeType("tirePressure", "psi");
    checkAttributeType("motorPower", "Kilowatt");
    checkAttributeType("batteryCapacity", "Kilojoule");
    checkAttributeType("cabinPressure", "Kilopascal");
    checkAttributeType("coolantVolume", "Litre");
    checkAttributeType("world", "WorldFrame");
    checkAttributeType("hazardLink", "CausalConnection");
    checkAttributeType("certification", "SafetyCase");
    checkAttributeType("fsm", "StateDefinition");
  });
});
