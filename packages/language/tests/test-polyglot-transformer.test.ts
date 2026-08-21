import { PolyglotNode, PolyglotTransformer } from "../src/transformers/polyglot-transformer.js";
import { emitModelica, sysml2ToModelica, type SysML2PartDef } from "./fixtures/modelica-transformer.js";
import { emitSysML2, modelicaToSysML2, type ModelicaModel } from "./fixtures/sysml2-transformer.js";

describe("Polyglot Transformer Core & Language Adapters", () => {
  describe("Language-Specific Transformation Emitters", () => {
    it("should transform Modelica AST to SysML v2 Part Definition via modelica transformer", () => {
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

      const sysmlCode = emitSysML2(modelica);
      expect(sysmlCode).toContain("part def ElectricalSystem {");
      expect(sysmlCode).toContain("attribute voltage: Real = 12.0;");
      expect(sysmlCode).toContain("attribute current: Real = 2.5;");
      expect(sysmlCode).toContain("port power: Real;");
      expect(sysmlCode).toContain("connection c1 connect voltagePin.p to resistorPin.p;");
    });

    it("should transform SysML v2 Part Definition to Modelica model via sysml2 transformer", () => {
      const sysml: SysML2PartDef = {
        name: "ThermalSystem",
        attributes: [{ name: "temp", type: "Real", value: "293.15" }],
        ports: [{ name: "heatFlow", type: "Real" }],
        connections: [{ source: "tempSensor.port", target: "heatSink.port" }],
      };

      const modelicaCode = emitModelica(sysml);
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

      const modelicaCode = emitModelica(sysml, transformer);
      expect(modelicaCode).toContain("extends VehicleBase;");
      expect(modelicaCode).toContain("parameter Real speed = 100.0;");
      expect(modelicaCode).toContain("parameter Real motorTorque; // inferred");
      expect(modelicaCode).toContain("parameter Real batteryCapacity; // inferred");
    });

    it("supports standalone language helper functions", () => {
      const modelica: ModelicaModel = {
        name: "SimpleResistor",
        components: [{ name: "R", typeSpecifier: "Real", variability: "parameter", defaultValue: "100" }],
        connections: [],
      };
      expect(modelicaToSysML2(modelica)).toContain("part def SimpleResistor");

      const sysml: SysML2PartDef = {
        name: "SimpleResistor",
        attributes: [{ name: "R", type: "Real", value: "100" }],
        ports: [],
        connections: [],
      };
      expect(sysml2ToModelica(sysml)).toContain("model SimpleResistor");
    });
  });

  describe("Generic Polyglot Engine & Dynamic Emitter Registration", () => {
    it("allows registering and executing custom language emitters on generic PolyglotNode", () => {
      const transformer = new PolyglotTransformer();

      transformer.registerEmitter("json-schema", (node) => {
        return JSON.stringify({
          title: node.name,
          type: "object",
          properties: Object.fromEntries((node.attributes || []).map((a) => [a.name, { type: a.type }])),
        });
      });

      expect(transformer.hasEmitter("json-schema")).toBe(true);
      expect(transformer.hasEmitter("unknown")).toBe(false);

      const genericNode: PolyglotNode = {
        name: "SensorDefinition",
        attributes: [
          { name: "sampleRate", type: "number" },
          { name: "enabled", type: "boolean" },
        ],
      };

      const jsonOutput = transformer.transform(genericNode, "json-schema");
      const parsed = JSON.parse(jsonOutput);
      expect(parsed.title).toBe("SensorDefinition");
      expect(parsed.properties.sampleRate.type).toBe("number");
    });

    it("throws a descriptive error when target language emitter is missing", () => {
      const transformer = new PolyglotTransformer();
      const node: PolyglotNode = { name: "Test" };
      expect(() => transformer.transform(node, "nonexistent-lang")).toThrow(
        "No polyglot emitter registered for target language 'nonexistent-lang'",
      );
    });
  });
});
