// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulink — Native Open Packaging Conventions (OPC) SLX Parser.
 *
 * Unpacks the .slx zip container and parses simulink/blockdiagram.xml using @modelscript/dsl/xml.
 */

import AdmZip from "adm-zip";
import type { SimulinkModel } from "../types.js";
import { parseSlxXml } from "./slx-xml-parser.js";

export { parseSlxXml } from "./slx-xml-parser.js";

/**
 * Parses an SLX buffer or raw XML string into a strongly-typed SimulinkModel.
 */
export function parseSlx(input: string | Buffer | Uint8Array, defaultName = "simulink_model"): SimulinkModel {
  let xmlContent: string;

  if (typeof input === "string") {
    const trimmed = input.trim();
    if (trimmed.startsWith("<") || trimmed.includes("<ModelInformation") || trimmed.includes("<BlockDiagram")) {
      xmlContent = input;
    } else {
      try {
        const zip = new AdmZip(input);
        const entry =
          zip.getEntry("simulink/blockdiagram.xml") ??
          zip.getEntry("simulink/systems/system_root.xml") ??
          zip.getEntries().find((e) => e.entryName.endsWith(".xml"));
        xmlContent = entry ? zip.readAsText(entry) : input;
      } catch {
        xmlContent = input;
      }
    }
  } else {
    try {
      const zip = new AdmZip(Buffer.from(input));
      const entry =
        zip.getEntry("simulink/blockdiagram.xml") ??
        zip.getEntry("simulink/systems/system_root.xml") ??
        zip.getEntries().find((e) => e.entryName.endsWith(".xml"));
      xmlContent = entry ? zip.readAsText(entry) : "";
    } catch {
      xmlContent = Buffer.from(input).toString("utf-8");
    }
  }

  return parseSlxXml(xmlContent, defaultName);
}
