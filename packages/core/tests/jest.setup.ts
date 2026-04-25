// SPDX-License-Identifier: AGPL-3.0-or-later

import Modelica from "@modelscript/modelica/parser";
import Parser from "tree-sitter";
import { Context } from "../src/compiler/context.js";

const parser = new Parser();
parser.setLanguage(Modelica);
Context.registerParser(".mo", parser);
