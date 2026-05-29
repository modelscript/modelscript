import * as fs from "fs";
import * as path from "path";
import Parser from "tree-sitter";
import Modelica from "../../../languages/modelica/bindings/node/index.cjs";
import { StudyFlattener } from "../../../languages/modelica/study-flattener.js";
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

  const source = `
model MyModel
  parameter Real x = 1;
end MyModel;

study MyStudy
  extends ModelScript.Studies.TransientSimulation(
    startTime = 2.0,
    stopTime = 10.0
  );
  extends MyModel(x = 5.0);
end MyStudy;
  `;

  ctx.load(source, "TestStudy.mo");

  const classInst = ctx.queryEngine.index.byName.get("MyStudy");
  if (!classInst || classInst.length === 0) {
    console.error("Could not resolve MyStudy");
    return;
  }

  const flattener = new StudyFlattener(ctx.queryEngine.toQueryDB());
  const config = flattener.flatten(classInst[0]);

  console.log("Study Config:", JSON.stringify(config, null, 2));
}

run().catch(console.error);
