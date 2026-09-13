#!/usr/bin/env node

// SPDX-License-Identifier: AGPL-3.0-or-later

import PackageJson from "@npmcli/package-json";
import path from "node:path";
import yargs from "yargs/yargs";
import { Build } from "./commands/build.js";
import { Compile } from "./commands/compile.js";
import { Cosim } from "./commands/cosim.js";
import { BuildCSG } from "./commands/csg.js";
import { Fmu } from "./commands/fmu.js";
import { Generate } from "./commands/generate.js";
import { I18n } from "./commands/i18n.js";
import { Init } from "./commands/init.js";
import { Instantiate } from "./commands/instantiate.js";
import { Lint } from "./commands/lint.js";
import { Login } from "./commands/login.js";
import { Logout } from "./commands/logout.js";
import { Lsp } from "./commands/lsp.js";
import { MC } from "./commands/mc.js";
import { Optimize } from "./commands/optimize.js";
import { Parse } from "./commands/parse.js";
import { Playground } from "./commands/playground.js";
import { Publish } from "./commands/publish.js";
import { Render } from "./commands/render.js";
import { Sandbox } from "./commands/sandbox.js";
import { Simulate } from "./commands/simulate.js";
import { Surrogate } from "./commands/surrogate.js";
import { Unpublish } from "./commands/unpublish.js";
import { Verify } from "./commands/verify.js";

const packagePath = path.dirname(import.meta.dirname);
const pkg = await PackageJson.load(packagePath);

yargs(process.argv.slice(2))
  .scriptName("msc")
  .usage(`CLI for ModelScript ${pkg.content.version}`)
  // Modeling & Simulation
  .command(Simulate)
  .command(Compile)
  .command(Instantiate)
  .command(Fmu)
  .command(BuildCSG)
  .command(MC)
  .command(Optimize)
  .command(Surrogate)
  .command(Verify)
  .command(Cosim)
  // Verification, Linting & Translation
  .command(Lint)
  .command(Render)
  .command(I18n)
  // Language Engineering & DSL Tooling
  .command(Build)
  .command(Generate)
  .command(Parse)
  .command(Lsp)
  .command(Playground)
  .command(Sandbox)
  // Package Management & Registry
  .command(Init)
  .command(Login)
  .command(Logout)
  .command(Publish)
  .command(Unpublish)
  .strictCommands()
  .demandCommand()
  .help()
  .version(pkg.content.version ?? "")
  .parse();
