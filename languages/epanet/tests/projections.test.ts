// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { parseInp } from "../src/parser/index.js";
import { epanetToModelica } from "../src/projections/index.js";

const SIMPLE_INP = `
[TITLE]
MunicipalWaterModel

[RESERVOIRS]
 R1  150.0

[JUNCTIONS]
 J1  50.0  30.0

[PIPES]
 P1  R1  J1  800  250  110  0  OPEN
`;

describe("EPANET Projections to Modelica.Fluid", () => {
  it("projects EPANET hydraulic networks to Modelica.Fluid models", () => {
    const net = parseInp(SIMPLE_INP);
    const mo = epanetToModelica(net);

    assert(mo.includes("model MunicipalWaterModel"));
    assert(mo.includes("Boundary_pT res_R1"));
    assert(mo.includes("MassFlowSource_T sink_J1"));
    assert(mo.includes("StaticPipe pipe_P1"));
    assert(mo.includes("connect(res_R1.ports[1], pipe_P1.port_a);"));
    assert(mo.includes("connect(pipe_P1.port_b, sink_J1.ports[1]);"));
    assert(mo.includes("end MunicipalWaterModel;"));
  });

  it("connects incident pipes at zero-demand intermediate junctions", () => {
    const inp = `
[RESERVOIRS]
 R1  150.0
[JUNCTIONS]
 J_MID  50.0  0.0
 J_END  40.0  20.0
[PIPES]
 P1  R1     J_MID  500  200  110  0  OPEN
 P2  J_MID  J_END  500  200  110  0  OPEN
`;
    const net = parseInp(inp);
    const mo = epanetToModelica(net);
    assert(mo.includes("connect(pipe_P1.port_b, pipe_P2.port_a);"));
  });
});
