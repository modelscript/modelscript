#!/usr/bin/env node

// SPDX-License-Identifier: AGPL-3.0-or-later

import PackageJson from "@npmcli/package-json";
import path from "node:path";
import yargs from "yargs/yargs";
// import { Compile } from "./commands/compile.js";
// import { Cosim } from "./commands/cosim.js";
// import { Fmu } from "./commands/fmu.js";
import { Build } from "./commands/build.js";
import { BuildCSG } from "./commands/csg.js";
import { Generate } from "./commands/generate.js";
// import { I18n } from "./commands/i18n.js";
// import { Init } from "./commands/init.js";
// import { Instantiate } from "./commands/instantiate.js";
// import { Lint } from "./commands/lint.js";
// import { Login } from "./commands/login.js";
// import { Logout } from "./commands/logout.js";
// import { Optimize } from "./commands/optimize.js";
import { Parse } from "./commands/parse.js";
import { Playground } from "./commands/playground.js";
// import { Publish } from "./commands/publish.js";
// import { Render } from "./commands/render.js";
// import { Simulate } from "./commands/simulate.js";
// import { Unpublish } from "./commands/unpublish.js";

// import { MC } from "./commands/mc.js";
// import { Surrogate } from "./commands/surrogate.js";
// import { Verify } from "./commands/verify.js";

const packagePath = path.dirname(import.meta.dirname);
const pkg = await PackageJson.load(packagePath);

yargs(process.argv.slice(2))
  .scriptName("msc")
  .usage(`CLI for ModelScript ${pkg.content.version}`)
  // .command(Compile)
  // .command(Cosim)
  // .command(Fmu)
  .command(Build)
  .command(Generate)
  // .command(I18n)
  // .command(Init)
  // .command(Instantiate)
  // .command(Lint)
  // .command(Login)
  // .command(Logout)
  // .command(Optimize)
  .command(Parse)
  .command(Playground)
  // .command(Publish)
  // .command(Render)
  // .command(Simulate)
  // .command(Surrogate)
  // .command(MC)
  // .command(Verify)
  // .command(Unpublish)
  .command(BuildCSG)
  .strictCommands()
  .demandCommand()
  .help()
  .version(pkg.content.version ?? "")
  .parse();
