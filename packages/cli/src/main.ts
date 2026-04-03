#!/usr/bin/env node

// SPDX-License-Identifier: AGPL-3.0-or-later

import PackageJson from "@npmcli/package-json";
import path from "node:path";
import yargs from "yargs/yargs";
import { Cosim } from "./commands/cosim.js";
import { BuildCSG } from "./commands/csg.js";
import { ExportFmu } from "./commands/export-fmu.js";
import { Flatten } from "./commands/flatten.js";
import { I18n } from "./commands/i18n.js";
import { Instantiate } from "./commands/instantiate.js";
import { Lint } from "./commands/lint.js";
import { Login } from "./commands/login.js";
import { Logout } from "./commands/logout.js";
import { Optimize } from "./commands/optimize.js";
import { Parse } from "./commands/parse.js";
import { Publish } from "./commands/publish.js";
import { Render } from "./commands/render.js";
import { Simulate } from "./commands/simulate.js";
import { Unpublish } from "./commands/unpublish.js";

const packagePath = path.dirname(import.meta.dirname);
const pkg = await PackageJson.load(packagePath);

yargs(process.argv.slice(2))
  .scriptName("msc")
  .usage(`CLI for ModelScript ${pkg.content.version}`)
  .command(Flatten)
  .command(Cosim)
  .command(ExportFmu)
  .command(I18n)
  .command(Instantiate)
  .command(Lint)
  .command(Login)
  .command(Logout)
  .command(Optimize)
  .command(Parse)
  .command(Publish)
  .command(Render)
  .command(Simulate)
  .command(Unpublish)
  .command(BuildCSG)
  .strictCommands()
  .demandCommand()
  .help()
  .version(pkg.content.version ?? "")
  .parse();
