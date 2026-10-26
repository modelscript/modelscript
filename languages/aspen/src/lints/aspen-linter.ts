// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/aspen — Pre-Flight Process Flowsheet Linter (Codes M8101–M8115).
 */

import { AspenErrorCode } from "../errors.js";
import type { AspenDeck, SourceLocation } from "../types.js";

export interface AspenDiagnostic {
  code: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  loc: SourceLocation;
}

export function lintAspen(deck: AspenDeck): AspenDiagnostic[] {
  const diagnostics: AspenDiagnostic[] = [];

  // Track producing streams and consuming streams
  const producedStreams = new Set<string>();
  const flowsheetBlocks = new Set<string>();

  for (const entry of deck.flowsheet) {
    flowsheetBlocks.add(entry.blockId);
    for (const outStream of entry.outlets) {
      producedStreams.add(outStream);
    }
  }

  // 1. Check duplicate block declarations in FLOWSHEET
  const seenFlowsheetBlocks = new Set<string>();
  for (const entry of deck.flowsheet) {
    if (seenFlowsheetBlocks.has(entry.blockId)) {
      diagnostics.push({
        code: AspenErrorCode.DUPLICATE_BLOCK_ID.code,
        rule: AspenErrorCode.DUPLICATE_BLOCK_ID.rule,
        severity: AspenErrorCode.DUPLICATE_BLOCK_ID.severity,
        message: AspenErrorCode.DUPLICATE_BLOCK_ID.message(entry.blockId),
        loc: entry.loc,
      });
    }
    seenFlowsheetBlocks.add(entry.blockId);
  }

  // 2. M8101: Unconnected stream port check
  for (const entry of deck.flowsheet) {
    for (const inStream of entry.inlets) {
      const isProducedByBlock = producedStreams.has(inStream);
      const isExternalFeed = deck.streams.has(inStream);
      if (!isProducedByBlock && !isExternalFeed) {
        diagnostics.push({
          code: AspenErrorCode.UNCONNECTED_STREAM_PORT.code,
          rule: AspenErrorCode.UNCONNECTED_STREAM_PORT.rule,
          severity: AspenErrorCode.UNCONNECTED_STREAM_PORT.severity,
          message: AspenErrorCode.UNCONNECTED_STREAM_PORT.message(inStream, entry.blockId),
          loc: entry.loc,
        });
      }
    }
  }

  // 3. M8102: Tear stream / cycle detection in flowsheet
  // Build directed graph of blocks
  const blockOutlets = new Map<string, string[]>();
  const streamProducers = new Map<string, string>();
  for (const entry of deck.flowsheet) {
    blockOutlets.set(entry.blockId, entry.outlets);
    for (const out of entry.outlets) {
      streamProducers.set(out, entry.blockId);
    }
  }

  const adj = new Map<string, string[]>();
  for (const entry of deck.flowsheet) {
    const neighbors: string[] = [];
    for (const inStream of entry.inlets) {
      const producer = streamProducers.get(inStream);
      if (producer && producer !== entry.blockId) {
        neighbors.push(producer);
      }
    }
    adj.set(entry.blockId, neighbors);
  }

  // Detect simple cycles without explicit TEAR parameter
  const visited = new Set<string>();
  const recStack = new Set<string>();

  function checkCycle(node: string): boolean {
    visited.add(node);
    recStack.add(node);

    const neighbors = adj.get(node) ?? [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        if (checkCycle(neighbor)) return true;
      } else if (recStack.has(neighbor)) {
        const blk = deck.blocks.get(neighbor);
        const hasTear = blk?.params["TEAR"] != null;
        if (!hasTear) {
          diagnostics.push({
            code: AspenErrorCode.TEAR_STREAM_UNCONVERGED.code,
            rule: AspenErrorCode.TEAR_STREAM_UNCONVERGED.rule,
            severity: AspenErrorCode.TEAR_STREAM_UNCONVERGED.severity,
            message: AspenErrorCode.TEAR_STREAM_UNCONVERGED.message(neighbor),
            loc: blk?.loc ??
              deck.loc ?? { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1, startOffset: 0, endOffset: 0 },
          });
          return true;
        }
      }
    }

    recStack.delete(node);
    return false;
  }

  for (const blk of deck.flowsheet.map((f) => f.blockId)) {
    if (!visited.has(blk)) {
      checkCycle(blk);
    }
  }

  // 4. Stream diagnostics: M8104, M8108, M8112, M8113
  for (const [sId, stream] of deck.streams) {
    // Temperature check (Celsius < -273.15 or Kelvin < 0)
    if (stream.temperature != null) {
      const isKelvin = deck.units === "SI";
      const minTemp = isKelvin ? 0.0 : -273.15;
      if (stream.temperature < minTemp) {
        diagnostics.push({
          code: AspenErrorCode.STREAM_TEMPERATURE_NEGATIVE.code,
          rule: AspenErrorCode.STREAM_TEMPERATURE_NEGATIVE.rule,
          severity: AspenErrorCode.STREAM_TEMPERATURE_NEGATIVE.severity,
          message: AspenErrorCode.STREAM_TEMPERATURE_NEGATIVE.message(sId, stream.temperature),
          loc: stream.loc,
        });
      }
    }

    // Pressure check
    if (stream.pressure != null && stream.pressure <= 0) {
      diagnostics.push({
        code: AspenErrorCode.STREAM_PRESSURE_NEGATIVE.code,
        rule: AspenErrorCode.STREAM_PRESSURE_NEGATIVE.rule,
        severity: AspenErrorCode.STREAM_PRESSURE_NEGATIVE.severity,
        message: AspenErrorCode.STREAM_PRESSURE_NEGATIVE.message(sId, stream.pressure),
        loc: stream.loc,
      });
    }

    // Mole fractions check
    if (stream.moleFractions.size > 0) {
      let sum = 0.0;
      for (const [cId, frac] of stream.moleFractions) {
        if (frac < 0.0) {
          diagnostics.push({
            code: AspenErrorCode.NEGATIVE_COMPONENT_FRACTION.code,
            rule: AspenErrorCode.NEGATIVE_COMPONENT_FRACTION.rule,
            severity: AspenErrorCode.NEGATIVE_COMPONENT_FRACTION.severity,
            message: AspenErrorCode.NEGATIVE_COMPONENT_FRACTION.message(sId, cId, frac),
            loc: stream.loc,
          });
        }
        sum += frac;
      }

      if (Math.abs(sum - 1.0) > 0.01) {
        diagnostics.push({
          code: AspenErrorCode.FRACTIONS_SUM_INVALID.code,
          rule: AspenErrorCode.FRACTIONS_SUM_INVALID.rule,
          severity: AspenErrorCode.FRACTIONS_SUM_INVALID.severity,
          message: AspenErrorCode.FRACTIONS_SUM_INVALID.message(sId, sum),
          loc: stream.loc,
        });
      }
    }
  }

  // 5. Block diagnostics: M8105, M8109, M8110, M8111, M8114, M8115
  for (const [bId, block] of deck.blocks) {
    // Check if block is present in FLOWSHEET
    if (!flowsheetBlocks.has(bId)) {
      diagnostics.push({
        code: AspenErrorCode.MISSING_FLOWSHEET_ENTRY.code,
        rule: AspenErrorCode.MISSING_FLOWSHEET_ENTRY.rule,
        severity: AspenErrorCode.MISSING_FLOWSHEET_ENTRY.severity,
        message: AspenErrorCode.MISSING_FLOWSHEET_ENTRY.message(bId),
        loc: block.loc,
      });
    }

    if (block.type === "RADFRAC") {
      const nStages = block.nStages ?? 10;
      if (nStages < 2) {
        diagnostics.push({
          code: AspenErrorCode.RADFRAC_STAGES_TOO_FEW.code,
          rule: AspenErrorCode.RADFRAC_STAGES_TOO_FEW.rule,
          severity: AspenErrorCode.RADFRAC_STAGES_TOO_FEW.severity,
          message: AspenErrorCode.RADFRAC_STAGES_TOO_FEW.message(bId, nStages),
          loc: block.loc,
        });
      }

      // Check feed stages
      if (block.feedStages) {
        for (const feed of block.feedStages) {
          if (feed.stage < 1 || feed.stage > nStages) {
            diagnostics.push({
              code: AspenErrorCode.FEED_STAGE_OUT_OF_RANGE.code,
              rule: AspenErrorCode.FEED_STAGE_OUT_OF_RANGE.rule,
              severity: AspenErrorCode.FEED_STAGE_OUT_OF_RANGE.severity,
              message: AspenErrorCode.FEED_STAGE_OUT_OF_RANGE.message(bId, feed.stage, nStages),
              loc: block.loc,
            });
          }
        }
      }

      // Check product stages
      if (block.products) {
        for (const prod of block.products) {
          if (prod.stage < 1 || prod.stage > nStages) {
            diagnostics.push({
              code: AspenErrorCode.PRODUCT_STAGE_OUT_OF_RANGE.code,
              rule: AspenErrorCode.PRODUCT_STAGE_OUT_OF_RANGE.rule,
              severity: AspenErrorCode.PRODUCT_STAGE_OUT_OF_RANGE.severity,
              message: AspenErrorCode.PRODUCT_STAGE_OUT_OF_RANGE.message(bId, prod.stage, nStages),
              loc: block.loc,
            });
          }
        }
      }

      // Check reflux ratio
      if (block.colSpecs && block.colSpecs["RR"] != null) {
        const rr = block.colSpecs["RR"];
        if (rr < 0.0) {
          diagnostics.push({
            code: AspenErrorCode.REFLUX_RATIO_NEGATIVE.code,
            rule: AspenErrorCode.REFLUX_RATIO_NEGATIVE.rule,
            severity: AspenErrorCode.REFLUX_RATIO_NEGATIVE.severity,
            message: AspenErrorCode.REFLUX_RATIO_NEGATIVE.message(bId, rr),
            loc: block.loc,
          });
        }
      }

      // Check reboiler heat deficit
      if (block.params["DUTY"] != null) {
        const duty = Number(block.params["DUTY"]);
        if (duty <= 0.0) {
          diagnostics.push({
            code: AspenErrorCode.COLUMN_REBOILER_HEAT_DEFICIT.code,
            rule: AspenErrorCode.COLUMN_REBOILER_HEAT_DEFICIT.rule,
            severity: AspenErrorCode.COLUMN_REBOILER_HEAT_DEFICIT.severity,
            message: AspenErrorCode.COLUMN_REBOILER_HEAT_DEFICIT.message(bId),
            loc: block.loc,
          });
        }
      }
    }
  }

  return diagnostics;
}
