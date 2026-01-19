#!/usr/bin/env node

// SPDX-License-Identifier: AGPL-3.0-or-later

import PackageJson from "@npmcli/package-json";
import path from "node:path";
import yargs from "yargs/yargs";
import { Flatten } from "./commands/flatten.js";
import { Instantiate } from "./commands/instantiate.js";
import { Lint } from "./commands/lint.js";
import { Parse } from "./commands/parse.js";
import { Render } from "./commands/render.js";

const packagePath = path.dirname(import.meta.dirname);
const pkg = await PackageJson.load(packagePath);

yargs(process.argv.slice(2))
  .scriptName("msc")
  .usage(`CLI for ModelScript ${pkg.content.version}`)
  .command(Flatten)
  .command(Instantiate)
  .command(Lint)
  .command(Parse)
  .command(Render)
  .strictCommands()
  .demandCommand()
  .help()
  .version(pkg.content.version ?? "")
  .parse();
