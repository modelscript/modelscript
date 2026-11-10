// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ModflowModel, DiscretizationData, NpfData, WellData, RiverData, ChdData } from "../types.js";

/**
 * Parses a MODFLOW 6 or classic simulation file/deck.
 */
export function parseModflow(content: string, modelName = "MODFLOW_Aquifer"): ModflowModel {
  const lines = content.split(/\r?\n/);

  let nlay = 1;
  let nrow = 1;
  let ncol = 1;
  let delr: number[] = [100.0];
  let delc: number[] = [100.0];
  let top = 100.0;
  let botm: number[] = [0.0];

  let k = 10.0;
  let k33 = 1.0;
  let ss = 1.0e-5;
  let sy = 0.15;
  let icelltype: number | undefined = undefined;

  const wells: WellData[] = [];
  const rivers: RiverData[] = [];
  const chds: ChdData[] = [];

  let currentBlock: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]!;
    // Strip comments (#, !, //)
    const lineWithoutComment = rawLine.replace(/(#|!|\/\/).*$/, "").trim();
    if (!lineWithoutComment) continue;

    const tokens = lineWithoutComment.split(/\s+/);
    const upper0 = tokens[0]!.toUpperCase();

    if (upper0 === "BEGIN") {
      currentBlock = tokens[1]?.toUpperCase() ?? "UNKNOWN";
      continue;
    } else if (upper0 === "END") {
      currentBlock = null;
      continue;
    }

    // Process tokens depending on block or free keywords
    const block = currentBlock ?? "";

    if (block.includes("DIS") || upper0 === "DIS" || upper0 === "DIS6") {
      handleDisLine(tokens);
    } else if (block.includes("NPF") || upper0 === "NPF" || upper0 === "NPF6") {
      handleNpfLine(tokens);
    } else if (block.includes("WEL") || upper0 === "WEL" || upper0 === "WELL") {
      handleWelLine(tokens, i + 1);
    } else if (block.includes("RIV") || upper0 === "RIV" || upper0 === "RIVER") {
      handleRivLine(tokens, i + 1);
    } else if (block.includes("CHD") || upper0 === "CHD") {
      handleChdLine(tokens, i + 1);
    } else {
      // Free-format global statements
      if (upper0 === "NLAY" && tokens[1]) {
        nlay = parseInt(tokens[1], 10);
      } else if (upper0 === "NROW" && tokens[1]) {
        nrow = parseInt(tokens[1], 10);
      } else if (upper0 === "NCOL" && tokens[1]) {
        ncol = parseInt(tokens[1], 10);
      } else if (upper0 === "DELR" && tokens[1]) {
        const val = parseFloat(tokens[tokens[1].toUpperCase() === "CONSTANT" ? 2 : 1]!);
        if (!isNaN(val)) delr = [val];
      } else if (upper0 === "DELC" && tokens[1]) {
        const val = parseFloat(tokens[tokens[1].toUpperCase() === "CONSTANT" ? 2 : 1]!);
        if (!isNaN(val)) delc = [val];
      } else if (upper0 === "TOP" && tokens[1]) {
        const val = parseFloat(tokens[tokens[1].toUpperCase() === "CONSTANT" ? 2 : 1]!);
        if (!isNaN(val)) top = val;
      } else if (upper0 === "BOTM") {
        const nums = tokens.slice(1).map(Number).filter((n) => !isNaN(n));
        if (nums.length > 0) botm = nums;
      } else if (upper0 === "K" && tokens[1]) {
        const val = parseFloat(tokens[tokens[1].toUpperCase() === "CONSTANT" ? 2 : 1]!);
        if (!isNaN(val)) k = val;
      } else if (upper0 === "K33" && tokens[1]) {
        const val = parseFloat(tokens[tokens[1].toUpperCase() === "CONSTANT" ? 2 : 1]!);
        if (!isNaN(val)) k33 = val;
      } else if (upper0 === "SS" && tokens[1]) {
        const val = parseFloat(tokens[tokens[1].toUpperCase() === "CONSTANT" ? 2 : 1]!);
        if (!isNaN(val)) ss = val;
      } else if (upper0 === "SY" && tokens[1]) {
        const val = parseFloat(tokens[tokens[1].toUpperCase() === "CONSTANT" ? 2 : 1]!);
        if (!isNaN(val)) sy = val;
      }
    }
  }

  function handleDisLine(tokens: string[]) {
    const key = tokens[0]!.toUpperCase();
    if (key === "NLAY" && tokens[1]) {
      nlay = parseInt(tokens[1], 10);
    } else if (key === "NROW" && tokens[1]) {
      nrow = parseInt(tokens[1], 10);
    } else if (key === "NCOL" && tokens[1]) {
      ncol = parseInt(tokens[1], 10);
    } else if (key === "DELR" && tokens[1]) {
      const idx = tokens[1].toUpperCase() === "CONSTANT" ? 2 : 1;
      const val = parseFloat(tokens[idx]!);
      if (!isNaN(val)) delr = [val];
    } else if (key === "DELC" && tokens[1]) {
      const idx = tokens[1].toUpperCase() === "CONSTANT" ? 2 : 1;
      const val = parseFloat(tokens[idx]!);
      if (!isNaN(val)) delc = [val];
    } else if (key === "TOP" && tokens[1]) {
      const idx = tokens[1].toUpperCase() === "CONSTANT" ? 2 : 1;
      const val = parseFloat(tokens[idx]!);
      if (!isNaN(val)) top = val;
    } else if (key === "BOTM") {
      const nums = tokens.slice(1).map(Number).filter((n) => !isNaN(n));
      if (nums.length > 0) botm = nums;
    }
  }

  function handleNpfLine(tokens: string[]) {
    const key = tokens[0]!.toUpperCase();
    if (key === "K" && tokens[1]) {
      const idx = tokens[1].toUpperCase() === "CONSTANT" ? 2 : 1;
      const val = parseFloat(tokens[idx]!);
      if (!isNaN(val)) k = val;
    } else if (key === "K33" && tokens[1]) {
      const idx = tokens[1].toUpperCase() === "CONSTANT" ? 2 : 1;
      const val = parseFloat(tokens[idx]!);
      if (!isNaN(val)) k33 = val;
    } else if (key === "SS" && tokens[1]) {
      const idx = tokens[1].toUpperCase() === "CONSTANT" ? 2 : 1;
      const val = parseFloat(tokens[idx]!);
      if (!isNaN(val)) ss = val;
    } else if (key === "SY" && tokens[1]) {
      const idx = tokens[1].toUpperCase() === "CONSTANT" ? 2 : 1;
      const val = parseFloat(tokens[idx]!);
      if (!isNaN(val)) sy = val;
    } else if (key === "ICELLTYPE" && tokens[1]) {
      const val = parseInt(tokens[1], 10);
      if (!isNaN(val)) icelltype = val;
    }
  }

  function handleWelLine(tokens: string[], lineNum: number) {
    // Expect: [layer, row, col, q, (optional name)]
    // Or if first token is "WELL", skip it
    let offset = 0;
    if (tokens[0]!.toUpperCase() === "WELL" || tokens[0]!.toUpperCase() === "WEL") {
      offset = 1;
    }
    if (tokens.length >= offset + 4) {
      const l = parseInt(tokens[offset]!, 10);
      const r = parseInt(tokens[offset + 1]!, 10);
      const c = parseInt(tokens[offset + 2]!, 10);
      const q = parseFloat(tokens[offset + 3]!);
      const name = tokens[offset + 4] ?? undefined;
      if (!isNaN(l) && !isNaN(r) && !isNaN(c) && !isNaN(q)) {
        wells.push({
          cell: { layer: l, row: r, col: c },
          q,
          name,
          line: lineNum,
        });
      }
    }
  }

  function handleRivLine(tokens: string[], lineNum: number) {
    // Expect: [layer, row, col, stage, cond, rbot]
    let offset = 0;
    if (tokens[0]!.toUpperCase() === "RIV" || tokens[0]!.toUpperCase() === "RIVER") {
      offset = 1;
    }
    if (tokens.length >= offset + 6) {
      const l = parseInt(tokens[offset]!, 10);
      const r = parseInt(tokens[offset + 1]!, 10);
      const c = parseInt(tokens[offset + 2]!, 10);
      const stage = parseFloat(tokens[offset + 3]!);
      const cond = parseFloat(tokens[offset + 4]!);
      const rbot = parseFloat(tokens[offset + 5]!);
      if (!isNaN(l) && !isNaN(r) && !isNaN(c) && !isNaN(stage) && !isNaN(cond) && !isNaN(rbot)) {
        rivers.push({
          cell: { layer: l, row: r, col: c },
          stage,
          cond,
          rbot,
          line: lineNum,
        });
      }
    }
  }

  function handleChdLine(tokens: string[], lineNum: number) {
    // Expect: [layer, row, col, head]
    let offset = 0;
    if (tokens[0]!.toUpperCase() === "CHD") {
      offset = 1;
    }
    if (tokens.length >= offset + 4) {
      const l = parseInt(tokens[offset]!, 10);
      const r = parseInt(tokens[offset + 1]!, 10);
      const c = parseInt(tokens[offset + 2]!, 10);
      const head = parseFloat(tokens[offset + 3]!);
      if (!isNaN(l) && !isNaN(r) && !isNaN(c) && !isNaN(head)) {
        chds.push({
          cell: { layer: l, row: r, col: c },
          head,
          line: lineNum,
        });
      }
    }
  }

  // Ensure botm length matches nlay
  if (botm.length < nlay) {
    const layerThickness = (top - botm[botm.length - 1]!) / nlay || 10.0;
    while (botm.length < nlay) {
      const prev = botm[botm.length - 1] ?? top;
      botm.push(prev - layerThickness);
    }
  }

  const dis: DiscretizationData = {
    nlay,
    nrow,
    ncol,
    delr,
    delc,
    top,
    botm,
  };

  const npf: NpfData = {
    k,
    k33,
    ss,
    sy,
    icelltype,
  };

  return {
    name: modelName,
    dis,
    npf,
    wells,
    rivers,
    chds,
  };
}
