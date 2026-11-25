# Hitchcock Transportation Network Linear Program
set ORIG;
set DEST;

param supply {ORIG} >= 0;
param demand {DEST} >= 0;
param cost {ORIG, DEST} >= 0;

var Ship {ORIG, DEST} >= 0;

minimize Total_Freight_Cost:
  sum {i in ORIG, j in DEST} cost[i, j] * Ship[i, j];

subject to Supply_Limit {i in ORIG}:
  sum {j in DEST} Ship[i, j] <= supply[i];

subject to Demand_Req {j in DEST}:
  sum {i in ORIG} Ship[i, j] >= demand[j];
