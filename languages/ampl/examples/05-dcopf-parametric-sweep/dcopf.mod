# Security-Constrained DC Optimal Power Flow (DC-OPF)
set BUS;
set GEN;
set LINE;

param load_mw {BUS} >= 0;
param load_scale >= 0 default 1.0;

param gen_at {GEN, BUS} >= 0 default 0;
param pmin {GEN} >= 0;
param pmax {GEN} >= 0;
param c_lin {GEN} >= 0;

param line_inc {LINE, BUS} default 0;
param susceptance {LINE} > 0;
param fmax {LINE} > 0;

var Pg {g in GEN} >= pmin[g], <= pmax[g];
var theta {BUS} >= -1.5, <= 1.5;
var Flow {l in LINE} >= -fmax[l], <= fmax[l];

minimize Dispatch_Cost:
  sum {g in GEN} c_lin[g] * Pg[g];

subject to Line_Flow {l in LINE}:
  Flow[l] = susceptance[l] * sum {b in BUS} line_inc[l, b] * theta[b];

subject to Nodal_Balance {b in BUS}:
  sum {g in GEN} gen_at[g, b] * Pg[g]
  - sum {l in LINE} line_inc[l, b] * Flow[l]
  = load_scale * load_mw[b];
