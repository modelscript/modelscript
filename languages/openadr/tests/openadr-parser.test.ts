// SPDX-License-Identifier: AGPL-3.0-or-later

import { UnifiedWorkspace } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAllOpenAdrEvents, getOpenAdrDeck, openadrLanguage, parseOpenAdr } from "../src/index.js";

const SAMPLE_DECLARATIVE = `
program "Summer_Peak_Flex" {
  event "DR_EV_01" {
    status: "active"
    signalType: "setpoint"
    targetVenId: "VEN-FLEET-DEPOT-1"

    interval {
      start: "2026-07-15T14:00:00Z"
      durationSeconds: 7200
      payload: 100.0
    }

    interval {
      start: "2026-07-15T16:00:00Z"
      durationSeconds: 3600
      payload: 50.0
    }
  }
}
`;

const SAMPLE_XML = `
<oadrPayload xmlns="http://openadr.org/oadr-2.0b/2012/07">
  <oadrDistributeEvent>
    <oadrEvent>
      <eiEvent>
        <eventDescriptor>
          <eventID>EVENT-PEAK-SHAVE-99</eventID>
          <eventStatus>active</eventStatus>
        </eventDescriptor>
        <eiTarget>
          <venID>VEN-CHILLER-PLANT-4</venID>
        </eiTarget>
        <eiEventSignals>
          <eiEventSignal>
            <signalType>setpoint</signalType>
            <intervals>
              <interval>
                <dtstart><date-time>2026-08-01T15:00:00Z</date-time></dtstart>
                <duration><duration>PT3600S</duration></duration>
                <signalPayload><payloadFloat>75.0</payloadFloat></signalPayload>
              </interval>
            </intervals>
          </eiEventSignal>
        </eiEventSignals>
      </eiEvent>
    </oadrEvent>
  </oadrDistributeEvent>
</oadrPayload>
`;

describe("OpenADR Parser", () => {
  it("parses declarative demand response program with multiple intervals", () => {
    const deck = parseOpenAdr(SAMPLE_DECLARATIVE);
    assert.strictEqual(deck.programs.length, 1);
    const prog = deck.programs[0]!;
    assert.strictEqual(prog.id, "Summer_Peak_Flex");
    assert.strictEqual(prog.events.length, 1);

    const evt = prog.events[0]!;
    assert.strictEqual(evt.id, "DR_EV_01");
    assert.strictEqual(evt.status, "active");
    assert.strictEqual(evt.signalType, "setpoint");
    assert.strictEqual(evt.targetVenId, "VEN-FLEET-DEPOT-1");
    assert.strictEqual(evt.intervals.length, 2);

    assert.strictEqual(evt.intervals[0]?.durationSeconds, 7200);
    assert.strictEqual(evt.intervals[0]?.payload, 100.0);
    assert.strictEqual(evt.intervals[1]?.durationSeconds, 3600);
    assert.strictEqual(evt.intervals[1]?.payload, 50.0);
  });

  it("parses OpenADR 2.0b XML payload into structured event", () => {
    const deck = parseOpenAdr(SAMPLE_XML);
    assert.strictEqual(deck.events.length, 1);
    const evt = deck.events[0]!;
    assert.strictEqual(evt.id, "EVENT-PEAK-SHAVE-99");
    assert.strictEqual(evt.status, "active");
    assert.strictEqual(evt.signalType, "setpoint");
    assert.strictEqual(evt.targetVenId, "VEN-CHILLER-PLANT-4");
    assert.strictEqual(evt.intervals.length, 1);
    assert.strictEqual(evt.intervals[0]?.durationSeconds, 3600);
    assert.strictEqual(evt.intervals[0]?.payload, 75.0);
  });

  it("indexes OpenADR documents in UnifiedWorkspace", () => {
    const ws = new UnifiedWorkspace(openadrLanguage);
    ws.setDocument("file:///flex.oadr", SAMPLE_DECLARATIVE);
    ws.setDocument("file:///shave.oadr.xml", SAMPLE_XML);

    const idx = ws.getIndex();
    assert.ok(idx.byName.has("Summer_Peak_Flex"));
    assert.ok(idx.byName.has("DR_EV_01"));
    assert.ok(idx.byName.has("EVENT-PEAK-SHAVE-99"));
    assert.strictEqual(getOpenAdrDeck(ws, "file:///flex.oadr")?.programs.length, 1);
    assert.strictEqual(getAllOpenAdrEvents(ws).events.length, 2);
  });
});
