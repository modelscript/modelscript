// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractEmtNetlist } from "../src/netlist/emt-netlist.js";
import { parsePscx } from "../src/parser/pscx-parser.js";

const project = (body: string): string =>
  `<project name="ml" version="5.0.2"><definitions>
   <Definition classid="UserCmpDefn" name="Main" id="1"><schematic classid="UserCanvas">${body}</schematic></Definition>
   </definitions></project>`;

const user = (id: number, defn: string, x: number, y: number, params: string, ports: string): string =>
  `<User classid="UserCmp" name="master:${defn}" defn="master:${defn}" id="${id}" x="${x}" y="${y}" w="40" h="40" orient="0">
     <paramlist><param name="Name" value="${defn}_${id}" />${params}</paramlist>${ports}
   </User>`;

const meterXml = project(
  user(
    10,
    "multimeter",
    100,
    100,
    `<param name="MeasV" value="0" /><param name="MeasP" value="1" />`,
    `<port name="N1" pos="-18,0" kind="electrical" dim="3" /><port name="N2" pos="18,0" kind="electrical" dim="3" />
     <port name="P" pos="0,-18" kind="signal" dim="1" /><port name="Q" pos="0,18" kind="signal" dim="1" />`,
  ),
);

const logicXml = project(
  [0, 1, 4]
    .map((t, i) =>
      user(
        20 + i,
        "logic_mult",
        100 * i,
        0,
        `<param name="Type" value="${t}" /><param name="Num_in" value="2" />`,
        `<port name="Y" pos="18,0" kind="signal" dim="1" />`,
      ),
    )
    .join(""),
);

const tapXml = project(
  `<Wire classid="WireOrthogonal" id="31" x="50" y="100" w="110" h="10" orient="0">
     <vertex x="0" y="0" /><vertex x="100" y="0" />
   </Wire>` + user(32, "voltmetergnd", 100, 100, "", `<port name="N" pos="0,18" kind="electrical" dim="1" />`),
);

describe("multimeter lowering", () => {
  const net = extractEmtNetlist(parsePscx(meterXml));

  it("lowers to an ideal series branch", () => {
    assert.equal(net.branches.length, 1);
    assert.equal(net.branches[0]!.resistanceOhm, 1e-4);
  });

  it("emits a current sensor per phase and one aggregate", () => {
    const ids = (net.controlBlocks ?? []).filter((b) => b.kind === "sensor_i").map((b) => b.id);
    assert.equal(ids.length, 4);
    assert.ok(ids.some((i) => i.endsWith("_phaseA")) && ids.some((i) => i.endsWith("_phaseC")));
  });

  it("records an assumption that P/Q are not computed", () => {
    assert.ok(net.assumptions?.some((a) => a.includes("multimeter") && a.includes("not computed")));
  });
});

describe("logic_mult lowering", () => {
  const net = extractEmtNetlist(parsePscx(logicXml));
  const blocks = (net.controlBlocks ?? []).filter((b) => b.kind === "logic");

  it("emits one logic block per instance with its Type", () => {
    assert.equal(blocks.length, 3);
    assert.deepEqual(blocks.map((b) => b.params["Type"]).sort(), [0, 1, 4]);
  });

  it("emits a per-instance assumption diagnostic naming the gate", () => {
    const a = net.assumptions ?? [];
    for (const g of ["AND", "OR", "XOR"])
      assert.ok(
        a.some((m) => m.includes("logic_mult") && m.includes(g)),
        g,
      );
  });
});

describe("voltmetergnd tap-on-wire", () => {
  it("attaches an unconnected terminal to a wire passing through its origin", () => {
    const proj = parsePscx(tapXml);
    const cmp = proj.rootModule.components.find((c) => c.definitionName.endsWith("voltmetergnd"))!;
    const ids = cmp.ports.filter((p) => p.kind === "electrical").map((p) => p.id);
    assert.ok(ids.length > 0);
    assert.ok(proj.rootModule.wires.some((w) => w.connectedPortIds.some((p) => ids.includes(p))));
  });
});

describe("fixed_load lowering", () => {
  const xml = project(
    user(
      40,
      "fixed_load",
      100,
      100,
      `<param name="PO" value="10 [MW]" /><param name="QO" value="5 [MVAR]" /><param name="VBO" value="0.48 [kV]" /><param name="FR" value="60 [Hz]" />`,
      `<port name="N" pos="0,-18" kind="electrical" dim="3" />`,
    ),
  );
  const net = extractEmtNetlist(parsePscx(xml));

  it("lowers to parallel R and L to ground sized from PO/QO/VBO/FR", () => {
    const r = net.branches.find((b) => b.id.endsWith("_R"))!;
    const l = net.branches.find((b) => b.id.endsWith("_L"))!;
    assert.equal(r.toBus, "GND");
    assert.ok(Math.abs(r.resistanceOhm - 480 ** 2 / 10e6) < 1e-12);
    assert.ok(Math.abs(l.inductanceH - 480 ** 2 / 5e6 / (2 * Math.PI * 60)) < 1e-12);
  });

  it("records that voltage/frequency dependence is ignored", () => {
    assert.ok(net.assumptions?.some((a) => a.includes("fixed_load") && a.includes("ignored")));
  });
});

describe("breaker1 status binding", () => {
  const brk = (name: string): string =>
    project(
      user(
        50,
        "tbreakn",
        100,
        0,
        `<param name="NUMS" value="1" /><param name="INIT" value="1" /><param name="TO1" value="0.1" />`,
        "",
      ) +
        user(51, "datalabel", 64, 0, `<param name="Name" value="BRK" />`, "") +
        user(
          52,
          "breaker1",
          300,
          300,
          `<param name="NAME" value="${name}" /><param name="RON" value="0.005 [ohm]" /><param name="ROFF" value="1.E6 [ohm]" />`,
          "",
        ),
    );

  it("attaches a status actuator and the corpus RON/ROFF when NAME matches a driven label", () => {
    const net = extractEmtNetlist(parsePscx(brk("BRK")));
    const sw = net.branches.find((b) => b.kind === "switch")!;
    assert.equal(sw.rClosedOhm, 0.005);
    assert.equal(sw.rOpenOhm, 1e6);
    const blk = (net.controlBlocks ?? []).find((b) => b.actuator?.type === "breaker_status");
    assert.ok(blk, "actuator block missing");
    assert.equal(blk!.actuator!.targetId, sw.id);
    assert.ok(blk!.inputs[0]!.includes("tbreakn"));
  });

  it("holds the breaker closed and records an assumption when NAME is not driven", () => {
    const net = extractEmtNetlist(parsePscx(brk("OTHER")));
    assert.ok(!(net.controlBlocks ?? []).some((b) => b.actuator));
    assert.ok(net.assumptions?.some((a) => a.includes("breaker1") && a.includes("not driven")));
  });
});

const srcXml = (id: number, vm: string, ac: string): string =>
  project(
    user(
      id,
      "source_1",
      100,
      100,
      `<param name="Vm" value="${vm}" /><param name="AC" value="${ac}" /><param name="f" value="60" />`,
      `<port name="N" pos="0,0" kind="electrical" dim="1" />`,
    ),
  );

describe("source_1 DC mode and Vm", () => {
  it("AC=0 flags a DC source and records an assumption", () => {
    const net = extractEmtNetlist(parsePscx(srcXml(50, "132.79 [kV]", "0")));
    assert.equal(net.sources?.[0]?.dc, true);
    assert.ok(net.assumptions?.some((a) => a.includes("constant DC")));
  });

  it("AC=1 is not DC", () => {
    const net = extractEmtNetlist(parsePscx(srcXml(51, "132.79 [kV]", "1")));
    assert.ok(!net.sources?.[0]?.dc);
  });

  it("Vm with a [kV] unit becomes 132.79 kV", () => {
    const net = extractEmtNetlist(parsePscx(srcXml(52, "132.79 [kV]", "0")));
    assert.ok(Math.abs(net.sources![0]!.vPeakKv - 132.79) < 1e-9);
  });

  it("unitless Vm is taken as kV and the assumption is recorded", () => {
    const net = extractEmtNetlist(parsePscx(srcXml(53, "179.63", "0")));
    assert.ok(Math.abs(net.sources![0]!.vPeakKv - 179.63) < 1e-9);
    assert.ok(net.assumptions?.some((a) => a.includes("unit assumed kV")));
  });
});

describe("peswitch diode polarity", () => {
  const sw = (id: number, l: string, type: number): string =>
    project(
      user(
        id,
        "peswitch",
        100,
        100,
        `<param name="L" value="${l}" /><param name="Type" value="${type}" /><param name="RON" value="0.001 [ohm]" /><param name="ROFF" value="1.0E6 [ohm]" />`,
        `<port name="N1" pos="0,0" kind="electrical" dim="1" /><port name="N2" pos="0,-36" kind="electrical" dim="1" />`,
      ),
    );

  it("L=D, Type=0 is a diode with anode N2 (from) and cathode N1 (to)", () => {
    const net = extractEmtNetlist(parsePscx(sw(60, "D", 0)));
    const b = net.branches[0]!;
    assert.equal(b.diode, true);
    assert.ok(/_B(_\d+)?$/.test(b.fromBus), b.fromBus);
    assert.ok(/_A(_\d+)?$/.test(b.toBus), b.toBus);
    assert.equal(b.rClosedOhm, 0.001);
    assert.equal(b.rOpenOhm, 1e6);
    assert.ok(net.assumptions?.some((a) => a.includes("polarity inverted")));
  });

  it("Type=3 (gate-controlled) is not a diode and is held closed", () => {
    const net = extractEmtNetlist(parsePscx(sw(61, "Q", 3)));
    assert.ok(!net.branches[0]!.diode);
    assert.ok(net.assumptions?.some((a) => a.includes("gate-controlled")));
  });
});
