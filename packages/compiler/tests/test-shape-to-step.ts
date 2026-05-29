import * as fs from "fs";
import * as path from "path";
import Parser from "tree-sitter";
import Modelica from "../../../languages/modelica/bindings/node/index.cjs";
import { ShapeFlattener } from "../../../languages/modelica/shape-flattener.js";
import { compileAssemblyToStep } from "../../cad/src/step-compiler.js";
import { Context } from "../../core/src/compiler/context.js";

const parser = new Parser();
parser.setLanguage(Modelica);
Context.registerParser(".mo", parser);

async function run() {
  const fsMock = {
    readFileSync: (p: string) => fs.readFileSync(p),
    existsSync: (p: string) => fs.existsSync(p),
    readdirSync: (p: string) => fs.readdirSync(p),
    statSync: (p: string) => fs.statSync(p),
    join: (...args: string[]) => path.join(...args),
  };
  // @ts-expect-error fs mock lacks many methods
  const ctx = new Context(fsMock);

  const geomSource = fs.readFileSync(path.resolve("packages/examples/drone-chassis/cad/Geometry.mo"), "utf8");
  const droneSource = fs.readFileSync(path.resolve("packages/examples/drone-chassis/cad/DroneCAD.mo"), "utf8");

  ctx.load(geomSource, "Geometry.mo");
  ctx.load(droneSource, "DroneCAD.mo");

  const classInst = ctx.queryEngine.index.byName.get("DroneChassis");
  if (!classInst || classInst.length === 0) {
    console.error("Could not resolve DroneChassis");
    return;
  }

  const flattener = new ShapeFlattener(ctx.queryEngine.toQueryDB());
  const assembly = flattener.flatten(classInst[0]);

  const stepText = compileAssemblyToStep(assembly);
  console.log("Generated step. Length:", stepText.length);

  fs.writeFileSync("/tmp/drone.step", stepText);
  console.log("Wrote /tmp/drone.step");
}

run().catch(console.error);
