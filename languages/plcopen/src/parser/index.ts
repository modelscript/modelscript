// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PlcProject } from "../types.js";
import { parsePlcopenXml } from "./plcopen-xml-parser.js";
import {
  parseStructuredTextFile,
  parseStructuredTextStatements,
  StructuredTextParser,
  tokenizeStructuredText,
} from "./st-parser.js";

export {
  parsePlcopenXml,
  parseStructuredTextFile,
  parseStructuredTextStatements,
  StructuredTextParser,
  tokenizeStructuredText,
};

/**
 * Parses PLCopen TC6 XML or Structured Text source into a unified PlcProject AST.
 */
export function parsePlcopen(source: string, filename?: string): PlcProject {
  const trimmed = source.trim();
  if (trimmed.startsWith("<") || (filename && (filename.endsWith(".xml") || filename.endsWith(".plcopen")))) {
    return parsePlcopenXml(source, filename);
  }
  return parseStructuredTextFile(source, filename);
}
