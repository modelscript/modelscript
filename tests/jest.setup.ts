// SPDX-License-Identifier: AGPL-3.0-or-later

import { Context } from "../src/compiler/context.js";
import Parser from "tree-sitter";
import Modelica from "@modelscript/tree-sitter-modelica";

const parser = new Parser();
parser.setLanguage(Modelica);
Context.registerParser(".mo", parser);
