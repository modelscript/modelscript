// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Polyglot telemetry projections for `@modelscript/arinc429`:
 *  - `arinc429ToCsv`: Decoded trace frames as RFC 4180 CSV
 *  - `arinc429ToJsbsimTelemetry`: JSBSim FDM property-tree telemetry export
 */

import { decodeFlightState } from "../solver/index.js";
import type { Arinc429Document } from "../types.js";

/**
 * Projects decoded ARINC 429 trace frames to CSV.
 */
export function arinc429ToCsv(doc: Arinc429Document): string {
  const flight = decodeFlightState(doc);
  const lines: string[] = [
    "timestamp_s,raw_hex,label_octal,name,sdi,encoding,ssm,ssm_meaning,parity_valid,engineering_value,units",
  ];

  for (const { timestampSec, word } of flight.decodedFrames) {
    lines.push(
      [
        timestampSec.toFixed(6),
        word.rawHex,
        word.labelOctal,
        word.labelName,
        String(word.sdi),
        word.encoding,
        String(word.ssm),
        word.ssmMeaning,
        word.parityValid ? "true" : "false",
        word.engineeringValue.toFixed(6),
        word.units,
      ].join(","),
    );
  }

  return lines.join("\n") + "\n";
}

/**
 * Projects decoded ARINC 429 flight state into JSBSim FDM telemetry XML/property format.
 */
export function arinc429ToJsbsimTelemetry(doc: Arinc429Document): string {
  const f = decodeFlightState(doc);
  const lines: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<jsbsim_telemetry source="arinc429" bus="${doc.busName}" rate="${doc.rate}">`,
    `  <property name="position/h-sl-ft">${f.altitudeFt.toFixed(4)}</property>`,
    `  <property name="position/h-agl-ft">${f.radioAltFt.toFixed(4)}</property>`,
    `  <property name="position/lat-gc-deg">${f.latitudeDeg.toFixed(6)}</property>`,
    `  <property name="position/long-gc-deg">${f.longitudeDeg.toFixed(6)}</property>`,
    `  <property name="velocities/vc-kts">${f.airspeedKt.toFixed(4)}</property>`,
    `  <property name="velocities/mach">${f.mach.toFixed(6)}</property>`,
    `  <property name="atmosphere/T-total-C">${f.totalAirTempC.toFixed(3)}</property>`,
    `  <property name="attitude/theta-deg">${f.pitchDeg.toFixed(4)}</property>`,
    `  <property name="attitude/phi-deg">${f.rollDeg.toFixed(4)}</property>`,
    `  <property name="attitude/psi-true-deg">${f.headingDeg.toFixed(4)}</property>`,
    `</jsbsim_telemetry>`,
  ];
  return lines.join("\n") + "\n";
}
