// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintPscx } from "../src/lints/index.js";
import { parsePscx } from "../src/parser/pscx-parser.js";

const project = (body: string): string =>
  `<project name="t" version="5.0.0"><param name="time_step" value="20.0"/><definitions>
   <Definition classid="UserCmpDefn" name="Main" id="1"><schematic classid="UserCanvas">${body}</schematic></Definition>
 </definitions></project>`;

const block = (id: number, defn: string, name: string, inputs: string): string =>
  `<User classid="UserCmp" name="master:${defn}" defn="master:${defn}" id="${id}" x="${id * 100}" y="0" w="40" h="20" orient="0">
     <paramlist><param name="Name" value="${name}"/><param name="inputs" value="${inputs}"/></paramlist>
   </User>`;

const lint = (xml: string, code: string) => lintPscx(parsePscx(xml)).filter((d) => d.code === code);

describe("M6012 csmf-algebraic-loop", () => {
  it("flags a gain -> sum -> gain feedback cycle with no state and lists the blocks", () => {
    const xml = project(block(1, "unity", "G1", "S1") + block(2, "sumjct", "S1", "G2") + block(3, "unity", "G2", "G1"));
    const diags = lint(xml, "M6012");
    assert.equal(diags.length, 1);
    for (const n of ["G1", "S1", "G2"]) assert.ok(diags[0]!.message.includes(`'${n}'`), diags[0]!.message);
  });

  it("flags a self loop", () => {
    const diags = lint(project(block(1, "unity", "G1", "G1")), "M6012");
    assert.equal(diags.length, 1);
  });

  it("is cleared by a stateful integral block inside the loop", () => {
    const xml = project(
      block(1, "unity", "G1", "S1") + block(2, "sumjct", "S1", "I1") + block(3, "integral", "I1", "G1"),
    );
    assert.equal(lint(xml, "M6012").length, 0);
  });

  it("does not flag an acyclic chain", () => {
    const xml = project(block(1, "unity", "G1", "") + block(2, "sumjct", "S1", "G1") + block(3, "unity", "G2", "S1"));
    assert.equal(lint(xml, "M6012").length, 0);
  });
});

describe("M6013 parallel-ideal-sources", () => {
  const source = (id: number, name: string, extra = ""): string =>
    `<User classid="UserCmp" defn="source_3p" id="${id}" x="100" y="200" orient="0">
       <param name="Name" value="${name}"/><param name="V" value="16.5"/>${extra}
       <port name="out" pos="[20, 0]"/>
     </User>`;
  // Port connectivity is geometric: a wire must touch the source port and the bus origin.
  const bus = `<Bus name="Bus1" id="B1" x="120" y="200" length="60" vbase="16.5"/>
    <Wire><vertex x="120" y="200"/><vertex x="160" y="200"/></Wire>`;

  const zeroR = `<param name="R" value="0"/>`;

  it("flags two explicit zero-impedance sources on the same bus as an error", () => {
    const xml = project(bus + source(1, "SrcA", zeroR) + source(2, "SrcB", zeroR));
    const diags = lint(xml, "M6013");
    assert.equal(diags.length, 1);
    assert.equal(diags[0]!.severity, "error");
    assert.ok(diags[0]!.message.includes("'SrcA'") && diags[0]!.message.includes("'SrcB'"));
    assert.equal(lint(xml, "M6014").length, 0);
  });

  it("warns (M6014) rather than errors when the impedance is merely unspecified", () => {
    const xml = project(bus + source(1, "SrcA") + source(2, "SrcB"));
    assert.equal(lint(xml, "M6013").length, 0);
    const diags = lint(xml, "M6014");
    assert.equal(diags.length, 1);
    assert.equal(diags[0]!.severity, "warning");
  });

  it("is cleared when one source has a non-zero series resistance", () => {
    const withR = `<param name="R" value="1.5"/>`;
    const xml = project(bus + source(1, "SrcA", zeroR) + source(2, "SrcB", withR));
    assert.equal(lint(xml, "M6013").length, 0);
    assert.equal(lint(xml, "M6014").length, 0);
  });

  it("is cleared when the sources are on different buses", () => {
    const other = `<Bus name="Bus2" id="B2" x="520" y="200" length="60" vbase="16.5"/>
      <Wire><vertex x="520" y="200"/><vertex x="560" y="200"/></Wire>`;
    const second = source(2, "SrcB").replace('x="100"', 'x="500"');
    assert.equal(lint(project(bus + other + source(1, "SrcA") + second), "M6013").length, 0);
  });
});

describe("M6021-M6065 pre-flight checks & WASM XML completions/hover", () => {
  it("flags unresolved external library component definitions via M6021", async () => {
    const { lintPscadWorkspace } = await import("../src/lints/workspace.js");
    const libPslx = `<?xml version="1.0" encoding="UTF-8"?>
<project name="CustomLib" version="5.0.0" type="library">
  <definitions>
    <definition name="KnownBlock" type="module"><schematic/></definition>
  </definitions>
</project>`;
    const casePscx = project(`<User classid="UserCmp" defn="CustomLib:MissingBlock" id="99" x="100" y="100"/>`);
    const wsDiags = lintPscadWorkspace(
      new Map([
        ["file:///ws/CustomLib.pslx", libPslx],
        ["file:///ws/main.pscx", casePscx],
      ]),
      "file:///ws/main.pscx",
    );
    assert.ok(wsDiags.some((d) => d.code === "M6021" && d.message.includes("MissingBlock")));
  });

  it("flags near-miss open-circuit wire endpoints (M6022) and dangling wireless tags (M6024)", () => {
    const xmlNearMiss = project(`
      <Bus name="Bus1" id="B1" x="120" y="200" length="60" vbase="16.5"/>
      <Wire id="W_NEAR"><vertex x="0" y="200"/><vertex x="102" y="200"/></Wire>
      <User classid="UserCmp" name="master:datalabel" id="DL1" x="300" y="100"><param name="Name" value="OrphanSig"/></User>
      <User classid="UserCmp" name="master:export" id="EX1" x="350" y="100"><param name="Name" value="OutSig"/></User>
    `);
    assert.equal(lint(xmlNearMiss, "M6022").length, 1);
    assert.ok(lint(xmlNearMiss, "M6024").length >= 2);
  });

  it("flags system frequency mismatch (M6031), PWM Nyquist step (M6040), and control time-constant underflow (M6041)", () => {
    const xmlTiming = `<?xml version="1.0" encoding="UTF-8"?>
<project name="Timing" version="5.0.0" type="normal">
  <param name="time_step" value="50.0"/>
  <param name="f_base" value="60.0"/>
  <definitions><definition name="Main" type="module"><schematic>
    <Bus name="B1" id="B1" x="120" y="200" length="60" vbase="13.8"/>
    <Wire><vertex x="120" y="200"/><vertex x="160" y="200"/></Wire>
    <User classid="UserCmp" defn="master:source_3p" id="S1" x="100" y="200">
      <param name="Name" value="Src50"/><param name="V" value="13.8"/><param name="f" value="50.0"/>
      <port name="out" pos="[20, 0]"/>
    </User>
    <User classid="UserCmp" name="master:pwm" id="PWM1" x="200" y="300">
      <param name="Name" value="Carr10k"/><param name="Fc" value="10000"/>
    </User>
    <User classid="UserCmp" name="master:realpole" id="LAG1" x="300" y="300">
      <param name="T" value="0.00002"/>
    </User>
  </schematic></definition></definitions>
</project>`;
    assert.ok(lint(xmlTiming, "M6031").some((d) => d.message.includes("50 Hz")));
    assert.ok(lint(xmlTiming, "M6040").some((d) => d.message.includes("10000 Hz")));
    assert.ok(lint(xmlTiming, "M6041").length >= 1);
  });

  it("flags CSMF division by zero (M6061) and unbounded PI/integrator windup (M6062) via interval analysis", () => {
    const csmf = (id: number, defn: string, name: string, extra: string) =>
      `<User classid="UserCmp" name="master:${defn}" defn="master:${defn}" id="${id}" x="${id * 100}" y="100" w="40" h="20" orient="0"><paramlist><param name="Name" value="${name}"/>${extra}</paramlist></User>`;
    const xmlControl = project(
      csmf(1, "emtconst", "C_ONE", '<param name="value" value="5"/>') +
        csmf(2, "emtconst", "C_ZERO", '<param name="value" value="0"/>') +
        csmf(3, "div", "DIV1", '<param name="inputs" value="C_ONE,C_ZERO"/>') +
        csmf(4, "pi_ctlr", "PI_OPEN", '<param name="Kp" value="1.5"/><param name="Ti" value="0.05"/>'),
    );
    assert.ok(lint(xmlControl, "M6061").some((d) => d.componentId === "3" || d.message.includes("DIV1")));
    assert.ok(lint(xmlControl, "M6062").some((d) => d.componentId === "4" || d.message.includes("PI_OPEN")));
  });

  it("flags custom Fortran UDM hazards & STORF mismatch (M6065) and serves WASM XML CST completions/hover", async () => {
    const { getPscadCompletions, getPscadHover } = await import("../src/catalog/master-library-schemas.js");
    const xmlUdm = `<?xml version="1.0" encoding="UTF-8"?>
<project name="UdmTest" version="5.0.0" type="normal">
  <definitions>
    <definition name="BadUdm" type="module">
      <script>
        <segment name="Dsdyn"><![CDATA[
          X = 1.0 / 0.0
          STORF(NSTORF) = X
          NSTORF = NSTORF + 2
        ]]></segment>
        <segment name="Dsout"><![CDATA[
          Y = STORF(NSTORF)
          NSTORF = NSTORF + 1
        ]]></segment>
      </script>
      <schematic>
        <Bus name="MainBus" id="B1" x="100" y="100" length="60" vbase="230.0"/>
        <User classid="UserCmp" name="master:resistor" id="R1" x="180" y="100">
          <param name="R" value="1.5"/>
        </User>
      </schematic>
    </definition>
  </definitions>
</project>`;
    const m6065 = lint(xmlUdm, "M6065");
    assert.ok(m6065.length >= 2, `Expected M6065 div-by-zero and NSTORF mismatch, got ${m6065.length}`);

    const paramKeyOffset = xmlUdm.indexOf('name="R"') + 6;
    const comps = getPscadCompletions(xmlUdm, paramKeyOffset);
    assert.ok(comps.some((c) => c.label === "R"));

    const busOffset = xmlUdm.indexOf('name="MainBus"');
    const hover = getPscadHover(xmlUdm, busOffset);
    assert.ok(hover && hover.contents.includes("MainBus"));
  });

  it("flags overlapping wires (M6023), vector/phase port mismatches (M6025/M6026), param expr errors (M6029), duplicate pgb (M6030), zero-Z loops (M6044), dead limiters (M6060), and uninitialized/non-reentrant Fortran UDMs (M6066/M6067)", () => {
    const csmf = (id: number, defn: string, name: string, extra: string) =>
      `<User classid="UserCmp" name="master:${defn}" defn="master:${defn}" id="${id}" x="${id * 100}" y="100" w="40" h="20" orient="0"><paramlist><param name="Name" value="${name}"/>${extra}</paramlist></User>`;

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<project name="ExtraLints" version="5.0.0" type="normal">
  <param name="time_step" value="50.0"/>
  <definitions>
    <definition name="SharedCommonUdm" type="module">
      <script>
        <segment name="Dsdyn"><![CDATA[
          COMMON /MY_BLK/ SHARED_X
          Y = STORF(NSTORF) + 1.0
        ]]></segment>
      </script>
      <schematic/>
    </definition>
    <definition name="Main" type="module">
      <schematic>
        <Bus name="B1" id="B1" x="100" y="200" length="40" vbase="230"/>
        <Bus name="B2" id="B2" x="200" y="200" length="40" vbase="230"/>
        <!-- Overlapping collinear wires M6023 -->
        <Wire id="W_A"><vertex x="0" y="400"/><vertex x="100" y="400"/></Wire>
        <Wire id="W_B"><vertex x="50" y="400"/><vertex x="150" y="400"/></Wire>

        <!-- Vector & phase mismatch M6025/M6026 -->
        <User classid="UserCmp" defn="master:source_3p" id="S3P" x="80" y="200">
          <param name="Name" value="S3"/><param name="V" value="230"/><param name="R" value="10 / 0"/>
          <port name="out" kind="electrical" dim="3" pos="[20, 0]"/>
        </User>
        <User classid="UserCmp" defn="master:breaker1" id="BRK1" x="180" y="200">
          <param name="Name" value="B1P"/><param name="Init" value="0"/>
          <port name="a" kind="electrical" dim="1" pos="[0, 0]"/>
          <port name="b" kind="electrical" dim="1" pos="[20, 0]"/>
        </User>
        <Wire id="W_PH"><vertex x="100" y="200"/><vertex x="180" y="200"/></Wire>

        <User classid="UserCmp" defn="master:const" id="SIG3" x="100" y="500">
          <port name="out" kind="signal" dim="3" pos="[20, 0]"/>
        </User>
        <User classid="UserCmp" defn="master:gain" id="SIG1" x="200" y="500">
          <port name="in" kind="signal" dim="1" pos="[0, 0]"/>
        </User>
        <Wire id="W_VEC"><vertex x="120" y="500"/><vertex x="200" y="500"/></Wire>

        <!-- Parallel closed switches creating zero-impedance loop M6044 -->
        <Bus name="B_LP1" id="B_LP1" x="100" y="600" length="40" vbase="230"/>
        <Bus name="B_LP2" id="B_LP2" x="300" y="600" length="40" vbase="230"/>
        <User classid="UserCmp" defn="master:breaker3" id="SW1" x="200" y="600">
          <param name="Name" value="SW1"/><param name="Init" value="0"/>
          <port name="a" pos="[-40, 0]"/><port name="b" pos="[40, 0]"/>
        </User>
        <User classid="UserCmp" defn="master:breaker3" id="SW2" x="200" y="660">
          <param name="Name" value="SW2"/><param name="Init" value="0"/>
          <port name="a" pos="[-40, 0]"/><port name="b" pos="[40, 0]"/>
        </User>
        <Wire id="W_L1"><vertex x="100" y="600"/><vertex x="160" y="600"/></Wire>
        <Wire id="W_L2"><vertex x="240" y="600"/><vertex x="300" y="600"/></Wire>
        <Wire id="W_L3"><vertex x="100" y="600"/><vertex x="160" y="660"/></Wire>
        <Wire id="W_L4"><vertex x="240" y="660"/><vertex x="300" y="600"/></Wire>

        <!-- Duplicate pgb channel M6030 -->
        <User classid="UserCmp" defn="master:pgb" id="P1" x="400" y="100"><param name="Name" value="Ia_meas"/></User>
        <User classid="UserCmp" defn="master:pgb" id="P2" x="450" y="100"><param name="Name" value="Ia_meas"/></User>

        <!-- Dead limiter M6060 -->
        ${csmf(70, "emtconst", "C_IN", '<param name="value" value="1"/>')}
        ${csmf(71, "hardlimit", "LIM_WIDE", '<param name="inputs" value="C_IN"/><param name="min" value="-10"/><param name="max" value="10"/>')}

        <!-- Two instances of SharedCommonUdm M6067 -->
        <User classid="UserCmp" defn="SharedCommonUdm" id="U1" x="600" y="100"/>
        <User classid="UserCmp" defn="SharedCommonUdm" id="U2" x="650" y="100"/>
      </schematic>
    </definition>
  </definitions>
</project>`;

    const diags = lintPscx(parsePscx(xml));
    const codes = new Set(diags.map((d) => d.code));
    for (const expected of ["M6023", "M6025", "M6026", "M6029", "M6030", "M6044", "M6060", "M6066", "M6067"]) {
      assert.ok(codes.has(expected), `Expected ${expected}, got: ${Array.from(codes).join(", ")}`);
    }
  });

  it("flags submodule port mismatch (M6027), inductive cutset (M6043), nodal ill-conditioning (M6046), PLL weak-grid (M6064), and proves affine x-x cancellation", async () => {
    const { analyzeControlIntervals } = await import("../src/analysis/control-intervals.js");
    const affMap = analyzeControlIntervals([
      { id: "base", kind: "integral", inputs: [], params: { min: -5, max: 5 } },
      { id: "diff", kind: "sum", inputs: ["base", "base"], params: { s1: 1, s2: -1 } },
    ]);
    assert.equal(affMap.get("diff")?.lo, 0);
    assert.equal(affMap.get("diff")?.hi, 0);

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<project name="ExtraLints2" version="5.0.0" type="normal">
  <param name="time_step" value="50.0"/>
  <definitions>
    <definition name="MySub" type="module">
      <schematic>
        <User classid="UserCmp" defn="master:xnode" id="XN1" x="0" y="0"><param name="Name" value="InA"/></User>
      </schematic>
    </definition>
    <definition name="Main" type="module">
      <schematic>
        <Bus name="B1" id="B1" x="100" y="100" length="40" vbase="230"/>
        <User classid="UserCmp" defn="MySub" id="SUB_INST" x="150" y="150">
          <port name="BadPort" kind="electrical" dim="1" pos="[0,0]"/>
        </User>
        <User classid="UserCmp" defn="master:src_ccin_1" id="CS1" x="100" y="100">
          <param name="Name" value="CurrSrc"/>
          <port name="out" kind="electrical" dim="1" pos="[0,0]"/>
        </User>
        <Wire id="W_CS"><vertex x="100" y="100"/><vertex x="110" y="100"/></Wire>

        <User classid="UserCmp" defn="master:breaker3" id="BR_STIFF" x="300" y="100">
          <param name="Name" value="BrStiff"/><param name="RON" value="1e-6"/><param name="ROFF" value="1e8"/>
          <port name="a" pos="[0,0]"/><port name="b" pos="[40,0]"/>
        </User>

        <User classid="UserCmp" defn="master:source_3p" id="WEAK_SRC" x="500" y="100">
          <param name="Name" value="WeakGrid"/><param name="V" value="230"/><param name="L" value="0.90"/>
          <port name="out" pos="[20,0]"/>
        </User>
        <User classid="UserCmp" defn="master:inverter_fmu" id="IBR1" x="600" y="100">
          <param name="Name" value="IBR1"/><param name="MVA" value="200"/><param name="V" value="230"/>
          <port name="term" pos="[-20,0]"/>
        </User>
        <User classid="UserCmp" defn="master:pll" id="PLL1" x="650" y="150">
          <param name="Name" value="FastPLL"/><param name="Kp" value="120"/><param name="Ki" value="80000"/>
        </User>
      </schematic>
    </definition>
  </definitions>
</project>`;

    const codes = new Set(lintPscx(parsePscx(xml)).map((d) => d.code));
    for (const expected of ["M6027", "M6043", "M6046", "M6064"]) {
      assert.ok(codes.has(expected), `Expected ${expected}, got: ${Array.from(codes).join(", ")}`);
    }
  });
});
