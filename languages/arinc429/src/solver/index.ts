// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ARINC 429 engineering-unit flight-state decoder and bus utilization / timing margin analyzer.
 */

import { lookupStandardArinc429Label } from "../catalog/arinc429-std-schemas.js";
import { decodeArinc429Word } from "../parser/codec.js";
import type {
  Arinc429BusUtilization,
  Arinc429Document,
  Arinc429FlightState,
  Arinc429LabelDef,
  DecodedArinc429Word,
} from "../types.js";

/** ARINC 429 low-speed bus bit rate: 12.5 kbps. */
export const ARINC429_LOW_SPEED_BPS = 12_500;

/** ARINC 429 high-speed bus bit rate: 100 kbps. */
export const ARINC429_HIGH_SPEED_BPS = 100_000;

/** ARINC 429 word slot width: 32 data bits + 4 NULL inter-word gap bits = 36 bit-times. */
export const ARINC429_BITS_PER_WORD_WITH_GAP = 36;

/**
 * Resolves the best matching `Arinc429LabelDef` from the document for a given octal label & SDI.
 */
export function findLabelDef(doc: Arinc429Document, labelOctal: string, sdi?: number): Arinc429LabelDef | undefined {
  const padded = labelOctal.padStart(3, "0");
  if (sdi !== undefined) {
    const exact = doc.labels.find((l) => l.labelOctal === padded && l.sdi === sdi);
    if (exact) return exact;
  }
  return doc.labels.find((l) => l.labelOctal === padded);
}

/**
 * Decodes all frames in an ARINC 429 document into engineering units and extracts
 * the latest commercial avionics flight-state snapshot.
 */
export function decodeFlightState(doc: Arinc429Document): Arinc429FlightState {
  const state: Arinc429FlightState = {
    altitudeFt: 0,
    airspeedKt: 0,
    mach: 0,
    totalAirTempC: 15,
    pitchDeg: 0,
    rollDeg: 0,
    headingDeg: 0,
    latitudeDeg: 0,
    longitudeDeg: 0,
    radioAltFt: 0,
    decodedFrames: [],
  };

  for (const frame of doc.frames) {
    const preliminary = decodeArinc429Word(frame.rawWord);
    const labelDef = findLabelDef(doc, preliminary.labelOctal, preliminary.sdi);
    const decoded: DecodedArinc429Word = labelDef ? decodeArinc429Word(frame.rawWord, labelDef) : preliminary;

    state.decodedFrames.push({
      timestampSec: frame.timestampSec,
      word: decoded,
    });

    // Update flight state for valid normal-operation words
    const isFault = decoded.ssmMeaning === "FAILURE_WARNING" || decoded.ssmMeaning === "NO_COMPUTED_DATA";
    if (isFault) continue;

    switch (decoded.labelOctal) {
      case "203":
        state.altitudeFt = decoded.engineeringValue;
        break;
      case "205":
        state.mach = decoded.engineeringValue;
        break;
      case "206":
        state.airspeedKt = decoded.engineeringValue;
        break;
      case "211":
        state.totalAirTempC = decoded.engineeringValue;
        break;
      case "310":
        state.latitudeDeg = decoded.engineeringValue;
        break;
      case "311":
        state.longitudeDeg = decoded.engineeringValue;
        break;
      case "314":
        state.headingDeg = ((decoded.engineeringValue % 360) + 360) % 360;
        break;
      case "324":
        state.pitchDeg = decoded.engineeringValue;
        break;
      case "325":
        state.rollDeg = decoded.engineeringValue;
        break;
      case "164":
        state.radioAltFt = decoded.engineeringValue;
        break;
      default:
        break;
    }
  }

  return state;
}

/**
 * Computes exact ARINC 429 bus bandwidth utilization and timing margin.
 *
 * Per ARINC 429, each 32-bit word is followed by a minimum 4-bit NULL inter-word gap
 * (36 bit-times per word). At 12.5 kbps (LOW), max throughput is 12500 / 36 = 347.222 words/s;
 * at 100 kbps (HIGH), max throughput is 100000 / 36 = 2777.778 words/s.
 */
export function analyzeBusUtilization(doc: Arinc429Document): Arinc429BusUtilization {
  const bitRateBps = doc.rate === "HIGH" ? ARINC429_HIGH_SPEED_BPS : ARINC429_LOW_SPEED_BPS;
  const bitsPerWordWithGap = ARINC429_BITS_PER_WORD_WITH_GAP;
  const wordDurationSec = bitsPerWordWithGap / bitRateBps;
  const maxWordsPerSec = bitRateBps / bitsPerWordWithGap;

  let scheduledWordsPerSec = 0;
  const perLabel: Arinc429BusUtilization["perLabel"] = [];

  for (const label of doc.labels) {
    const std = lookupStandardArinc429Label(label.labelOctal);
    const rateHz = label.rateHz ?? std?.defaultRateHz ?? 1;
    scheduledWordsPerSec += rateHz;
    const bandwidthBps = rateHz * bitsPerWordWithGap;
    const utilPct = (bandwidthBps / bitRateBps) * 100;
    perLabel.push({
      labelOctal: label.labelOctal,
      name: label.name,
      rateHz,
      bandwidthBps,
      utilizationPct: utilPct,
    });
  }

  const utilizationPct = ((scheduledWordsPerSec * bitsPerWordWithGap) / bitRateBps) * 100;
  const timingMarginPct = 100 - utilizationPct;
  const slackTimeSecPerSec = 1 - scheduledWordsPerSec * wordDurationSec;

  return {
    busName: doc.busName,
    rate: doc.rate,
    bitRateBps,
    bitsPerWordWithGap,
    wordDurationSec,
    maxWordsPerSec,
    scheduledWordsPerSec,
    utilizationPct,
    timingMarginPct,
    slackTimeSecPerSec,
    overloaded: utilizationPct > 100,
    perLabel,
  };
}
