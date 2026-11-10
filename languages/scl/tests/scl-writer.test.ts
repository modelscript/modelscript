// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSclXml } from "../src/parser/scl-parser.js";
import { writeSclXml } from "../src/parser/scl-writer.js";
import type { SclDocument } from "../src/types.js";

describe("IEC 61850 SCL Writer & XML Roundtrip", () => {
  const initialDoc: SclDocument = {
    header: {
      id: "SCL_TEST_WRITER",
      version: "2007",
      revision: "B",
      toolId: "ModelScript",
    },
    substation: {
      name: "SUB_EAST",
      desc: "East 400kV Substation",
      voltageLevels: [
        {
          name: "400kV",
          nominalVoltageKv: 400.0,
          bays: [
            {
              name: "BAY_01",
              conductingEquipment: [
                {
                  name: "CBR_01",
                  type: "CBR",
                  terminals: [
                    { name: "T1", connectivityNode: "CN_1" },
                    { name: "T2", connectivityNode: "CN_2" },
                  ],
                },
              ],
              connectivityNodes: [
                { name: "CN_1", pathName: "SUB_EAST/400kV/BAY_01/CN_1" },
                { name: "CN_2", pathName: "SUB_EAST/400kV/BAY_01/CN_2" },
              ],
            },
          ],
        },
      ],
    },
    communication: [
      {
        name: "STATION_BUS",
        connectedAps: [
          {
            iedName: "IED_PROT1",
            apName: "S1",
            gseAddresses: new Map([
              [
                "GC_TRIP",
                {
                  mac: "01-0C-CD-01-00-05",
                  appId: "0005",
                  vlanId: "200",
                  vlanPriority: 4,
                },
              ],
            ]),
          },
        ],
      },
    ],
    ieds: new Map([
      [
        "IED_PROT1",
        {
          name: "IED_PROT1",
          accessPoints: new Map([
            [
              "S1",
              {
                name: "S1",
                server: {
                  logicalDevices: new Map([
                    [
                      "LD0",
                      {
                        inst: "LD0",
                        logicalNodes: new Map([
                          [
                            "LLN0",
                            {
                              lnClass: "LLN0",
                              inst: "",
                              lnType: "LLN0_Default",
                              dataSets: new Map([
                                [
                                  "DS_TRIP",
                                  {
                                    name: "DS_TRIP",
                                    fcdaList: [
                                      {
                                        ldInst: "LD0",
                                        lnClass: "PTRC",
                                        lnInst: "1",
                                        doName: "Op",
                                        daName: "general",
                                        fc: "ST",
                                      },
                                    ],
                                  },
                                ],
                              ]),
                              gseControls: new Map([
                                [
                                  "GC_TRIP",
                                  {
                                    name: "GC_TRIP",
                                    appID: "TRIP_01",
                                    datSet: "DS_TRIP",
                                    confRev: 1,
                                    minTimeMs: 2.0,
                                    maxTimeMs: 1000.0,
                                  },
                                ],
                              ]),
                              smvControls: new Map(),
                              inputs: [],
                            },
                          ],
                        ]),
                      },
                    ],
                  ]),
                },
              },
            ],
          ]),
        },
      ],
    ]),
  };

  it("should serialize SclDocument into valid IEC 61850 XML", () => {
    const xml = writeSclXml(initialDoc);
    assert.ok(xml.includes("<SCL"));
    assert.ok(xml.includes("SUB_EAST"));
    assert.ok(xml.includes("400kV"));
    assert.ok(xml.includes("CBR_01"));
    assert.ok(xml.includes("IED_PROT1"));
    assert.ok(xml.includes("DS_TRIP"));
    assert.ok(xml.includes("GC_TRIP"));
  });

  it("should parse back serialized XML without losing equipment or IED definitions", () => {
    const xml = writeSclXml(initialDoc);
    const parsed = parseSclXml(xml);

    assert.equal(parsed.header.id, "SCL_TEST_WRITER");
    assert.equal(parsed.substation?.name, "SUB_EAST");
    assert.equal(parsed.substation?.voltageLevels[0]?.nominalVoltageKv, 400.0);
    assert.equal(parsed.substation?.voltageLevels[0]?.bays[0]?.conductingEquipment[0]?.name, "CBR_01");

    assert.equal(parsed.ieds.size, 1);
    const ied = parsed.ieds.get("IED_PROT1")!;
    assert.ok(ied);
    const ap = ied.accessPoints.get("S1");
    assert.ok(ap?.server);
    const ld = ap.server.logicalDevices.get("LD0");
    assert.ok(ld);
    const lln0 = ld.logicalNodes.get("LLN0")!;
    assert.ok(lln0);
    assert.ok(lln0.dataSets.has("DS_TRIP"));
    assert.ok(lln0.gseControls.has("GC_TRIP"));
  });
});
