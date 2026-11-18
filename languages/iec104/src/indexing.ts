// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DslIndexFileContext } from "@modelscript/dsl";
import { parseIec104 } from "./parser/iec104-parser.js";

export function canIndexIec104(uri: string): boolean {
  const lower = uri.toLowerCase();
  return lower.endsWith(".iec104") || lower.endsWith(".104");
}

export function indexIec104Document(ctx: DslIndexFileContext): void {
  const { uri, text } = ctx;
  const profile = parseIec104(text);
  ctx.setParsedModel(profile);

  const rootName = profile.stationName || uri.split("/").pop() || "IEC104Station";
  const rootId = ctx.addSymbol(
    rootName,
    "Package",
    null,
    0,
    text.length,
    { commonAddress: profile.commonAddress, pointCount: profile.points.length },
    { ruleName: "iec104_station", namePath: rootName },
  );

  for (const pt of profile.points) {
    ctx.addSymbol(
      pt.name,
      "Variable",
      rootId,
      0,
      0,
      { ioa: pt.ioa, typeId: pt.typeId, units: pt.units },
      { ruleName: "iec104_point", namePath: `${rootName}.${pt.name}` },
    );
  }
}
