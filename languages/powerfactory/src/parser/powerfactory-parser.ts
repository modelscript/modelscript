// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * DIgSILENT PowerFactory Archive (.dz), Project Database (.pfd), and XML Parser.
 *
 * Ingests compressed PowerFactory project archives (.dz) using fflate decompression,
 * parses native XML export schemas, and reads ASCII .pfd object dumps into a
 * structured PowerFactoryModel.
 */

import { strFromU8, unzipSync } from "fflate";
import type {
  ElmBay,
  ElmGenstat,
  ElmLne,
  ElmLod,
  ElmShnt,
  ElmSubstat,
  ElmSym,
  ElmTerm,
  ElmTr2,
  ElmTr3,
  PowerFactoryModel,
  SetDesktop,
  StaSwitch,
  TypLne,
  TypSym,
  TypTr2,
  TypTr3,
} from "../types.js";

/** Creates an empty PowerFactory model container. */
export function createEmptyPowerFactoryModel(name = "PowerFactory_Grid"): PowerFactoryModel {
  return {
    name,
    version: "2024",
    substations: new Map<string, ElmSubstat>(),
    bays: new Map<string, ElmBay>(),
    terminals: new Map<string, ElmTerm>(),
    lines: new Map<string, ElmLne>(),
    lineTypes: new Map<string, TypLne>(),
    transformers2w: new Map<string, ElmTr2>(),
    trafo2Types: new Map<string, TypTr2>(),
    transformers3w: new Map<string, ElmTr3>(),
    trafo3Types: new Map<string, TypTr3>(),
    generators: new Map<string, ElmSym>(),
    symTypes: new Map<string, TypSym>(),
    staticGenerators: new Map<string, ElmGenstat>(),
    loads: new Map<string, ElmLod>(),
    shunts: new Map<string, ElmShnt>(),
    switches: new Map<string, StaSwitch>(),
    diagrams: new Map<string, SetDesktop>(),
  };
}

/**
 * Ingests a PowerFactory binary archive (.dz) or XML/ASCII text buffer.
 */
export function parsePowerFactoryFile(data: Uint8Array | string, fileName = "grid.dz"): PowerFactoryModel {
  if (typeof data === "string") {
    return parsePowerFactoryText(data, fileName);
  }

  // Check if buffer is a ZIP archive (magic bytes 0x50, 0x4B, 0x03, 0x04)
  if (data.length >= 4 && data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04) {
    const unzipped = unzipSync(data);
    const xmlEntries = Object.keys(unzipped).filter(
      (p) => p.endsWith(".xml") || p.endsWith(".pfd") || p.toLowerCase().includes("project"),
    );

    const model = createEmptyPowerFactoryModel(fileName.replace(/\.dz$/i, ""));
    for (const xmlPath of xmlEntries) {
      const fileBytes = unzipped[xmlPath];
      if (fileBytes) {
        const text = strFromU8(fileBytes);
        parsePowerFactoryXml(text, model);
      }
    }
    return model;
  }

  // Fallback: decode as UTF-8 string
  const text = strFromU8(data);
  return parsePowerFactoryText(text, fileName);
}

/** Parses XML or ASCII text format. */
export function parsePowerFactoryText(text: string, modelName = "PowerFactory_Grid"): PowerFactoryModel {
  const model = createEmptyPowerFactoryModel(modelName);
  const trimmed = text.trim();
  if (trimmed.startsWith("<?xml") || trimmed.startsWith("<")) {
    parsePowerFactoryXml(trimmed, model);
  } else {
    parsePowerFactoryAscii(trimmed, model);
  }
  return model;
}

/**
 * Parses PowerFactory XML data exchange documents.
 */
export function parsePowerFactoryXml(xmlText: string, targetModel?: PowerFactoryModel): PowerFactoryModel {
  const model = targetModel ?? createEmptyPowerFactoryModel();

  const dataObjectRegex =
    /<(DataObject|Elm[A-Za-z0-9_]+|Typ[A-Za-z0-9_]+|Sta[A-Za-z0-9_]+|Set[A-Za-z0-9_]+|Int[A-Za-z0-9_]+)\b([^>]*)>([\s\S]*?)<\/\1>/gi;

  let match: RegExpExecArray | null;
  while ((match = dataObjectRegex.exec(xmlText)) !== null) {
    const rawTag = match[1]!;
    const rawAttrs = match[2] || "";
    const innerContent = match[3] || "";

    const attrs = parseXmlAttributes(rawAttrs);
    parseChildTagsIntoAttributes(innerContent, attrs);

    const className = rawTag === "DataObject" ? attrs["class"] || "" : rawTag;

    const locName = attrs["loc_name"] || attrs["name"] || attrs["id"] || `obj_${Math.random().toString(36).slice(2, 8)}`;
    const id = attrs["id"] || attrs["ref"] || locName;

    switch (className) {
      case "ElmSubstat": {
        model.substations.set(id, {
          id,
          loc_name: locName,
          desc: attrs["desc"],
        });
        break;
      }
      case "ElmBay": {
        model.bays.set(id, {
          id,
          loc_name: locName,
          substatId: attrs["substat"] || attrs["cpSubstat"],
        });
        break;
      }
      case "ElmTerm": {
        model.terminals.set(id, {
          id,
          loc_name: locName,
          uknom: parseFloat(attrs["uknom"] ?? attrs["vnom"] ?? "110.0"),
          fnom: parseFloat(attrs["fnom"] ?? "50.0"),
          substatId: attrs["substat"] || attrs["cpSubstat"],
          bayId: attrs["bay"] || attrs["cpBay"],
          iPhtech: (attrs["iPhtech"] as "3-phase" | "1-phase" | "DC") ?? "3-phase",
          x: attrs["x"] ? parseFloat(attrs["x"]) : undefined,
          y: attrs["y"] ? parseFloat(attrs["y"]) : undefined,
        });
        break;
      }
      case "TypLne": {
        model.lineTypes.set(id, {
          id,
          loc_name: locName,
          uline: parseFloat(attrs["uline"] ?? "110.0"),
          snom: attrs["snom"] ? parseFloat(attrs["snom"]) : undefined,
          inom: attrs["inom"] ? parseFloat(attrs["inom"]) : undefined,
          r1: parseFloat(attrs["r1"] ?? "0.1"),
          x1: parseFloat(attrs["x1"] ?? "0.4"),
          b1: parseFloat(attrs["b1"] ?? "3.0"),
          r0: attrs["r0"] ? parseFloat(attrs["r0"]) : undefined,
          x0: attrs["x0"] ? parseFloat(attrs["x0"]) : undefined,
          b0: attrs["b0"] ? parseFloat(attrs["b0"]) : undefined,
        });
        break;
      }
      case "ElmLne": {
        model.lines.set(id, {
          id,
          loc_name: locName,
          bus1Id: cleanRef(attrs["bus1"] || attrs["fold_bus1"] || attrs["from"] || ""),
          bus2Id: cleanRef(attrs["bus2"] || attrs["fold_bus2"] || attrs["to"] || ""),
          dline: parseFloat(attrs["dline"] ?? attrs["length"] ?? "1.0"),
          typId: cleanRef(attrs["typ_id"] || attrs["type"]),
          r1: attrs["r1"] ? parseFloat(attrs["r1"]) : undefined,
          x1: attrs["x1"] ? parseFloat(attrs["x1"]) : undefined,
          b1: attrs["b1"] ? parseFloat(attrs["b1"]) : undefined,
          r0: attrs["r0"] ? parseFloat(attrs["r0"]) : undefined,
          x0: attrs["x0"] ? parseFloat(attrs["x0"]) : undefined,
          b0: attrs["b0"] ? parseFloat(attrs["b0"]) : undefined,
          inom: attrs["inom"] ? parseFloat(attrs["inom"]) : undefined,
          outserv: attrs["outserv"] === "1" || attrs["outserv"] === "true",
        });
        break;
      }
      case "TypTr2": {
        model.trafo2Types.set(id, {
          id,
          loc_name: locName,
          strn: parseFloat(attrs["strn"] ?? "40.0"),
          utrn_h: parseFloat(attrs["utrn_h"] ?? "110.0"),
          utrn_l: parseFloat(attrs["utrn_l"] ?? "20.0"),
          ukrr: parseFloat(attrs["ukrr"] ?? attrs["uk"] ?? "10.0"),
          pkr: parseFloat(attrs["pkr"] ?? "150.0"),
          pfe: attrs["pfe"] ? parseFloat(attrs["pfe"]) : undefined,
          i0: attrs["i0"] ? parseFloat(attrs["i0"]) : undefined,
          vecgrp: attrs["vecgrp"] ?? "Dyn11",
        });
        break;
      }
      case "ElmTr2": {
        model.transformers2w.set(id, {
          id,
          loc_name: locName,
          bushvId: cleanRef(attrs["bushv"] || attrs["bus1"] || ""),
          buslvId: cleanRef(attrs["buslv"] || attrs["bus2"] || ""),
          typId: cleanRef(attrs["typ_id"] || attrs["type"]),
          strn: attrs["strn"] ? parseFloat(attrs["strn"]) : undefined,
          nntap: attrs["nntap"] ? parseInt(attrs["nntap"], 10) : undefined,
          ntpmn: attrs["ntpmn"] ? parseInt(attrs["ntpmn"], 10) : undefined,
          ntpmx: attrs["ntpmx"] ? parseInt(attrs["ntpmx"], 10) : undefined,
          dutap: attrs["dutap"] ? parseFloat(attrs["dutap"]) : undefined,
          outserv: attrs["outserv"] === "1" || attrs["outserv"] === "true",
        });
        break;
      }
      case "TypSym": {
        model.symTypes.set(id, {
          id,
          loc_name: locName,
          snom: parseFloat(attrs["snom"] ?? "100.0"),
          unom: parseFloat(attrs["unom"] ?? "20.0"),
          cosn: parseFloat(attrs["cosn"] ?? "0.85"),
          xd: attrs["xd"] ? parseFloat(attrs["xd"]) : undefined,
          xq: attrs["xq"] ? parseFloat(attrs["xq"]) : undefined,
          xdp: attrs["xdp"] ? parseFloat(attrs["xdp"]) : undefined,
          xdpp: attrs["xdpp"] ? parseFloat(attrs["xdpp"]) : undefined,
          H: attrs["H"] || attrs["h"] ? parseFloat(attrs["H"] ?? attrs["h"] ?? "4.0") : undefined,
        });
        break;
      }
      case "ElmSym": {
        model.generators.set(id, {
          id,
          loc_name: locName,
          bus1Id: cleanRef(attrs["bus1"] || ""),
          pgini: parseFloat(attrs["pgini"] ?? attrs["p"] ?? "50.0"),
          qgini: parseFloat(attrs["qgini"] ?? attrs["q"] ?? "0.0"),
          usetp: parseFloat(attrs["usetp"] ?? attrs["vset"] ?? "1.0"),
          sgini: attrs["sgini"] ? parseFloat(attrs["sgini"]) : undefined,
          typId: cleanRef(attrs["typ_id"] || attrs["type"]),
          mode: (attrs["mode"] as "PV" | "PQ" | "SL") ?? "PV",
          qmax: attrs["qmax"] ? parseFloat(attrs["qmax"]) : undefined,
          qmin: attrs["qmin"] ? parseFloat(attrs["qmin"]) : undefined,
          outserv: attrs["outserv"] === "1" || attrs["outserv"] === "true",
        });
        break;
      }
      case "ElmGenstat": {
        model.staticGenerators.set(id, {
          id,
          loc_name: locName,
          bus1Id: cleanRef(attrs["bus1"] || ""),
          pgini: parseFloat(attrs["pgini"] ?? "10.0"),
          qgini: parseFloat(attrs["qgini"] ?? "0.0"),
          sgn: attrs["sgn"] ? parseFloat(attrs["sgn"]) : undefined,
          cosphi: attrs["cosphi"] ? parseFloat(attrs["cosphi"]) : undefined,
          mode: (attrs["mode"] as "PV" | "PQ") ?? "PQ",
          category: (attrs["cCategory"] as "PV" | "WIND" | "BESS" | "OTHER") ?? "PV",
          outserv: attrs["outserv"] === "1" || attrs["outserv"] === "true",
        });
        break;
      }
      case "ElmLod": {
        model.loads.set(id, {
          id,
          loc_name: locName,
          bus1Id: cleanRef(attrs["bus1"] || ""),
          plini: parseFloat(attrs["plini"] ?? attrs["p"] ?? "20.0"),
          qlini: parseFloat(attrs["qlini"] ?? attrs["q"] ?? "5.0"),
          slini: attrs["slini"] ? parseFloat(attrs["slini"]) : undefined,
          cosphi: attrs["cosphi"] ? parseFloat(attrs["cosphi"]) : undefined,
          mode: (attrs["mode"] as "PC" | "IC" | "ZC") ?? "PC",
          outserv: attrs["outserv"] === "1" || attrs["outserv"] === "true",
        });
        break;
      }
      case "ElmShnt": {
        model.shunts.set(id, {
          id,
          loc_name: locName,
          bus1Id: cleanRef(attrs["bus1"] || ""),
          qtot: parseFloat(attrs["qtot"] ?? "10.0"),
          ncap: attrs["ncap"] ? parseInt(attrs["ncap"], 10) : 1,
          ncapx: attrs["ncapx"] ? parseInt(attrs["ncapx"], 10) : undefined,
          ushnom: attrs["ushnom"] ? parseFloat(attrs["ushnom"]) : undefined,
          outserv: attrs["outserv"] === "1" || attrs["outserv"] === "true",
        });
        break;
      }
      case "StaSwitch": {
        model.switches.set(id, {
          id,
          loc_name: locName,
          bus1Id: cleanRef(attrs["bus1"] || ""),
          bus2Id: cleanRef(attrs["bus2"] || ""),
          on_off: parseInt(attrs["on_off"] ?? attrs["closed"] ?? "1", 10),
          isBreaker: attrs["isBreaker"] === "1" || attrs["isBreaker"] === "true" || locName.startsWith("CB"),
        });
        break;
      }
      case "SetDesktop": {
        const desktop: SetDesktop = {
          id,
          loc_name: locName,
          graphics: [],
        };
        const grfRegex = /<IntGrf\s+([^>]*)\/?>/gi;
        let grfMatch: RegExpExecArray | null;
        while ((grfMatch = grfRegex.exec(innerContent)) !== null) {
          const gAttrs = parseXmlAttributes(grfMatch[1] ?? "");
          if (gAttrs["pDataObj"]) {
            desktop.graphics.push({
              elementId: cleanRef(gAttrs["pDataObj"]),
              x: parseFloat(gAttrs["r_x"] ?? gAttrs["x"] ?? "0"),
              y: parseFloat(gAttrs["r_y"] ?? gAttrs["y"] ?? "0"),
              width: gAttrs["r_dx"] ? parseFloat(gAttrs["r_dx"]) : undefined,
              height: gAttrs["r_dy"] ? parseFloat(gAttrs["r_dy"]) : undefined,
              rotation: gAttrs["iRot"] ? parseFloat(gAttrs["iRot"]) : undefined,
            });
          }
        }
        model.diagrams.set(id, desktop);
        break;
      }
    }
  }

  return model;
}

/** Parses PowerFactory ASCII .pfd format. */
export function parsePowerFactoryAscii(text: string, model: PowerFactoryModel): void {
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("!") || trimmed.startsWith("//")) continue;

    const blockMatch = /^([A-Za-z0-9_]+)\s+"([^"]+)"\s*\{([^}]*)\}/.exec(trimmed);
    if (!blockMatch) continue;

    const [, className, locName, body] = blockMatch;
    if (!className || !locName || !body) continue;

    const attrs: Record<string, string> = { loc_name: locName };
    const attrRegex = /([A-Za-z0-9_]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s,;]+))/g;
    let aMatch: RegExpExecArray | null;
    while ((aMatch = attrRegex.exec(body)) !== null) {
      const k = aMatch[1];
      const v = aMatch[2] ?? aMatch[3] ?? aMatch[4];
      if (k && v !== undefined) {
        attrs[k] = v;
      }
    }

    const id = locName;
    if (className === "ElmTerm") {
      model.terminals.set(id, {
        id,
        loc_name: locName,
        uknom: parseFloat(attrs["uknom"] ?? "110.0"),
        fnom: parseFloat(attrs["fnom"] ?? "50.0"),
      });
    } else if (className === "ElmLne") {
      model.lines.set(id, {
        id,
        loc_name: locName,
        bus1Id: cleanRef(attrs["bus1"] ?? ""),
        bus2Id: cleanRef(attrs["bus2"] ?? ""),
        dline: parseFloat(attrs["dline"] ?? "1.0"),
        typId: cleanRef(attrs["typ_id"]),
        r1: attrs["r1"] ? parseFloat(attrs["r1"]) : undefined,
        x1: attrs["x1"] ? parseFloat(attrs["x1"]) : undefined,
        b1: attrs["b1"] ? parseFloat(attrs["b1"]) : undefined,
      });
    } else if (className === "TypLne") {
      model.lineTypes.set(id, {
        id,
        loc_name: locName,
        uline: parseFloat(attrs["uline"] ?? "110.0"),
        r1: parseFloat(attrs["r1"] ?? "0.1"),
        x1: parseFloat(attrs["x1"] ?? "0.4"),
        b1: parseFloat(attrs["b1"] ?? "3.0"),
      });
    } else if (className === "ElmTr2") {
      model.transformers2w.set(id, {
        id,
        loc_name: locName,
        bushvId: cleanRef(attrs["bushv"] ?? ""),
        buslvId: cleanRef(attrs["buslv"] ?? ""),
        typId: cleanRef(attrs["typ_id"]),
      });
    } else if (className === "TypTr2") {
      model.trafo2Types.set(id, {
        id,
        loc_name: locName,
        strn: parseFloat(attrs["strn"] ?? "40.0"),
        utrn_h: parseFloat(attrs["utrn_h"] ?? "110.0"),
        utrn_l: parseFloat(attrs["utrn_l"] ?? "20.0"),
        ukrr: parseFloat(attrs["ukrr"] ?? "10.0"),
        pkr: parseFloat(attrs["pkr"] ?? "150.0"),
      });
    } else if (className === "ElmSym") {
      model.generators.set(id, {
        id,
        loc_name: locName,
        bus1Id: cleanRef(attrs["bus1"] ?? ""),
        pgini: parseFloat(attrs["pgini"] ?? "50.0"),
        qgini: parseFloat(attrs["qgini"] ?? "0.0"),
        usetp: parseFloat(attrs["usetp"] ?? "1.0"),
      });
    } else if (className === "ElmLod") {
      model.loads.set(id, {
        id,
        loc_name: locName,
        bus1Id: cleanRef(attrs["bus1"] ?? ""),
        plini: parseFloat(attrs["plini"] ?? "20.0"),
        qlini: parseFloat(attrs["qlini"] ?? "5.0"),
      });
    } else if (className === "StaSwitch") {
      model.switches.set(id, {
        id,
        loc_name: locName,
        bus1Id: cleanRef(attrs["bus1"] ?? ""),
        bus2Id: cleanRef(attrs["bus2"] ?? ""),
        on_off: parseInt(attrs["on_off"] ?? "1", 10),
      });
    }
  }
}

/** Parses XML tag attributes: key="value" or key='value'. */
function parseXmlAttributes(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  const attrRegex = /([A-Za-z0-9_:]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(raw)) !== null) {
    const k = match[1];
    const v = match[2] ?? match[3];
    if (k && v !== undefined) {
      result[k] = v;
    }
  }
  return result;
}

/** Ingests child elements: <attrName>value</attrName> into attribute map. */
function parseChildTagsIntoAttributes(xmlContent: string, attrs: Record<string, string>): void {
  const tagRegex = /<([A-Za-z0-9_]+)>([^<]+)<\/\1>/g;
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(xmlContent)) !== null) {
    const k = match[1];
    const v = match[2]?.trim();
    if (k && v !== undefined && !attrs[k]) {
      attrs[k] = v;
    }
  }
}

/** Cleans object references (e.g. "ElmTerm\Bus1.ElmTerm" -> "Bus1"). */
function cleanRef(ref: string | undefined): string {
  if (!ref) return "";
  let clean = ref.trim();
  const lastSlash = Math.max(clean.lastIndexOf("\\"), clean.lastIndexOf("/"));
  if (lastSlash >= 0) {
    clean = clean.substring(lastSlash + 1);
  }
  const dotIndex = clean.indexOf(".");
  if (dotIndex > 0) {
    clean = clean.substring(0, dotIndex);
  }
  return clean;
}
