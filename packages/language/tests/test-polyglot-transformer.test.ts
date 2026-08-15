import {
  modelicaToSysML2,
  PolyglotTransformer,
  sysml2ToModelica,
  type ModelicaModel,
  type SysML2PartDef,
} from "../src/transformers/polyglot-transformer.js";

describe("Polyglot Transformer (SysML v2 <-> Modelica)", () => {
  it("should transform Modelica AST to SysML v2 Part Definition", () => {
    const modelica: ModelicaModel = {
      name: "ElectricalSystem",
      kind: "model",
      components: [
        { name: "voltage", typeSpecifier: "Real", variability: "parameter", defaultValue: "12.0" },
        { name: "current", typeSpecifier: "Real", variability: "parameter", defaultValue: "2.5" },
        { name: "power", typeSpecifier: "Real" },
      ],
      connections: [{ source: "voltagePin.p", target: "resistorPin.p" }],
    };

    const sysmlCode = modelicaToSysML2(modelica);
    expect(sysmlCode).toContain("part def ElectricalSystem {");
    expect(sysmlCode).toContain("attribute voltage: Real = 12.0;");
    expect(sysmlCode).toContain("attribute current: Real = 2.5;");
    expect(sysmlCode).toContain("port power: Real;");
    expect(sysmlCode).toContain("connection c1 connect voltagePin.p to resistorPin.p;");
  });

  it("should transform SysML v2 Part Definition to Modelica model", () => {
    const sysml: SysML2PartDef = {
      name: "ThermalSystem",
      attributes: [{ name: "temp", type: "Real", value: "293.15" }],
      ports: [{ name: "heatFlow", type: "Real" }],
      connections: [{ source: "tempSensor.port", target: "heatSink.port" }],
    };

    const modelicaCode = sysml2ToModelica(sysml);
    expect(modelicaCode).toContain("model ThermalSystem");
    expect(modelicaCode).toContain("parameter Real temp = 293.15;");
    expect(modelicaCode).toContain("Real heatFlow;");
    expect(modelicaCode).toContain("connect(tempSensor.port, heatSink.port);");
    expect(modelicaCode).toContain("end ThermalSystem;");
  });

  it("should seamlessly include synthetic/inferred features from reasoner fact store", () => {
    const transformer = new PolyglotTransformer();

    // Register reasoner facts for inherited features from base classes
    transformer.addReasonerFact("hasFeature", "ElectricVehicle", "motorTorque:Real");
    transformer.addReasonerFact("hasFeature", "ElectricVehicle", "batteryCapacity:Real");

    const sysml: SysML2PartDef = {
      name: "ElectricVehicle",
      superclasses: ["VehicleBase"],
      attributes: [{ name: "speed", type: "Real", value: "100.0" }],
      ports: [],
      connections: [],
    };

    const modelicaCode = transformer.transformSysML2ToModelica(sysml);
    expect(modelicaCode).toContain("extends VehicleBase;");
    expect(modelicaCode).toContain("parameter Real speed = 100.0;");
    expect(modelicaCode).toContain("parameter Real motorTorque; // inferred");
    expect(modelicaCode).toContain("parameter Real batteryCapacity; // inferred");
  });
});
