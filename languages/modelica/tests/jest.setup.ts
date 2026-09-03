// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/language";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Context } from "../src/context.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");
const { parser } = await createWasmParser(modelicaWasm);
Context.registerParser(".mo", parser);
