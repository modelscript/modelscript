// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/iec104 — Parser for IEC 60870-5-104 Station Profiles (JSON / WASM CST config).
 */

import { getOrLoadLanguageWasmParser } from "@modelscript/dsl";
import { createWasmParserSync, type SyntaxNode } from "@modelscript/iec104/wasm-parser";
import type { Iec104InformationObject, Iec104StationProfile, Iec104TypeId } from "../types.js";

function getIec104WasmParser(): ReturnType<typeof createWasmParserSync>["parser"] {
  return getOrLoadLanguageWasmParser("iec104", import.meta.url, createWasmParserSync);
}

const VALID_TYPE_IDS = new Set<string>([
  "M_SP_NA_1",
  "M_SP_TB_1",
  "M_DP_NA_1",
  "M_DP_TB_1",
  "M_ME_NC_1",
  "M_ME_TF_1",
  "M_IT_NA_1",
  "C_SC_NA_1",
  "C_DC_NA_1",
  "C_SE_NC_1",
]);

interface CstRowToken {
  type: string;
  text: string;
  row: number;
}

function collectCstTokensByRow(rootNode: SyntaxNode): Map<number, CstRowToken[]> {
  const byRow = new Map<number, CstRowToken[]>();
  const stack: SyntaxNode[] = [rootNode];

  while (stack.length > 0) {
    const node = stack.pop()!;
    const t = node.type;
    if (t === "DeckIdentifier" || t === "DeckNumber" || t === "DeckString" || t === "DeckPunct") {
      const row = node.startPosition.row;
      let list = byRow.get(row);
      if (!list) {
        list = [];
        byRow.set(row, list);
      }
      list.push({ type: t, text: node.text, row });
      continue;
    }

    const kids = node.children;
    for (let i = kids.length - 1; i >= 0; i--) {
      stack.push(kids[i]!);
    }
  }

  return byRow;
}

function unquoteToken(raw: string): string {
  if (raw.length >= 2 && ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'")))) {
    return raw.slice(1, -1);
  }
  return raw;
}

function stripCommentTokens(rowTokens: CstRowToken[]): CstRowToken[] {
  const out: CstRowToken[] = [];
  for (const tok of rowTokens) {
    if (tok.type === "DeckPunct" && (tok.text.startsWith("#") || tok.text.startsWith("//"))) {
      break;
    }
    out.push(tok);
  }
  return out;
}

/**
 * Extracts `key = value` pairs from a slice of CST tokens on a single row.
 * Handles card-deck maximal-munch punctuation tokens such as `=-` or `=+` in `deadband=-1`.
 */
function parseKeyValuePairs(rowTokens: CstRowToken[], startIndex: number): Map<string, string> {
  const kvs = new Map<string, string>();
  let i = startIndex;
  while (i < rowTokens.length) {
    const keyTok = rowTokens[i]!;
    const eqTok = rowTokens[i + 1];
    const valTok = rowTokens[i + 2];
    if (eqTok && eqTok.type === "DeckPunct" && eqTok.text.startsWith("=") && valTok) {
      const signPrefix = eqTok.text.length > 1 ? eqTok.text.slice(1) : "";
      kvs.set(keyTok.text, signPrefix + unquoteToken(valTok.text));
      i += 3;
      continue;
    }
    i++;
  }
  return kvs;
}

/**
 * Parse an IEC 60870-5-104 station profile from JSON or WASM CST key-value text.
 */
export function parseIec104(source: string): Iec104StationProfile {
  const trimmed = source.trim();
  if (trimmed.startsWith("{")) {
    const raw = JSON.parse(trimmed) as Partial<Iec104StationProfile>;
    return {
      id: raw.id ?? "iec104_station",
      stationName: raw.stationName ?? "IEC104_RTU",
      commonAddress: raw.commonAddress ?? 1,
      originatorAddress: raw.originatorAddress ?? 0,
      apci: {
        port: raw.apci?.port ?? 2404,
        k: raw.apci?.k ?? 12,
        w: raw.apci?.w ?? 8,
        t0: raw.apci?.t0 ?? 30,
        t1: raw.apci?.t1 ?? 15,
        t2: raw.apci?.t2 ?? 10,
        t3: raw.apci?.t3 ?? 20,
      },
      points: (raw.points ?? []).map((p) => ({
        ioa: Number(p.ioa),
        name: String(p.name ?? `IOA_${p.ioa}`),
        typeId: (VALID_TYPE_IDS.has(p.typeId) ? p.typeId : "M_ME_NC_1") as Iec104TypeId,
        units: p.units,
        scale: p.scale,
        offset: p.offset,
        deadband: p.deadband,
        initialValue: p.initialValue,
      })),
    };
  }

  // Parse .iec104 text via compiled WASM CST (cardDeckRules):
  // station <name> ca=<num> oa=<num> port=2404 k=12 w=8
  // point <ioa> <typeId> <name> [units=kV] [scale=1.0] [deadband=0.1]
  let stationName = "IEC104_RTU";
  let commonAddress = 1;
  let originatorAddress = 0;
  let port = 2404;
  let k = 12;
  let w = 8;
  let t0 = 30;
  let t1 = 15;
  let t2 = 10;
  let t3 = 20;
  const points: Iec104InformationObject[] = [];

  const parser = getIec104WasmParser();
  const tree = parser.parse(source);
  if (!tree?.rootNode) {
    return {
      id: stationName,
      stationName,
      commonAddress,
      originatorAddress,
      apci: { port, k, w, t0, t1, t2, t3 },
      points,
    };
  }

  const byRow = collectCstTokensByRow(tree.rootNode);
  const sortedRows = Array.from(byRow.keys()).sort((a, b) => a - b);

  for (const row of sortedRows) {
    const tokens = stripCommentTokens(byRow.get(row)!);
    if (tokens.length === 0) continue;
    const cmd = tokens[0]!.text.toLowerCase();

    if (cmd === "station") {
      if (tokens[1]) {
        stationName = unquoteToken(tokens[1].text);
      }
      const kvs = parseKeyValuePairs(tokens, 2);
      for (const [kvKey, kvVal] of kvs) {
        const n = Number(kvVal);
        if (!Number.isFinite(n)) continue;
        if (kvKey === "ca") commonAddress = n;
        else if (kvKey === "oa") originatorAddress = n;
        else if (kvKey === "port") port = n;
        else if (kvKey === "k") k = n;
        else if (kvKey === "w") w = n;
        else if (kvKey === "t0") t0 = n;
        else if (kvKey === "t1") t1 = n;
        else if (kvKey === "t2") t2 = n;
        else if (kvKey === "t3") t3 = n;
      }
    } else if (cmd === "point" && tokens.length >= 4) {
      const ioa = Number(tokens[1]!.text);
      const rawType = unquoteToken(tokens[2]!.text);
      const typeId = (VALID_TYPE_IDS.has(rawType) ? rawType : "M_ME_NC_1") as Iec104TypeId;
      const name = unquoteToken(tokens[3]!.text);
      let units: string | undefined;
      let scale: number | undefined;
      let offset: number | undefined;
      let deadband: number | undefined;
      let initialValue: number | undefined;

      const kvs = parseKeyValuePairs(tokens, 4);
      for (const [kvKey, kvVal] of kvs) {
        if (kvKey === "units") units = kvVal;
        else if (kvKey === "scale") scale = Number(kvVal);
        else if (kvKey === "offset") offset = Number(kvVal);
        else if (kvKey === "deadband") deadband = Number(kvVal);
        else if (kvKey === "init") initialValue = Number(kvVal);
      }
      points.push({ ioa, name, typeId, units, scale, offset, deadband, initialValue });
    }
  }

  return {
    id: stationName,
    stationName,
    commonAddress,
    originatorAddress,
    apci: { port, k, w, t0, t1, t2, t3 },
    points,
  };
}
