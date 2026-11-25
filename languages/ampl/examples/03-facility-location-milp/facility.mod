# Capacitated Facility Location Mixed-Integer Linear Program
set FAC;
set CUST;

param fixed_cost {FAC} >= 0;
param capacity {FAC} >= 0;
param demand {CUST} >= 0;
param ship_cost {FAC, CUST} >= 0;

var Open {FAC} binary;
var Serve {FAC, CUST} >= 0;

minimize Total_Cost:
  sum {i in FAC} fixed_cost[i] * Open[i]
  + sum {i in FAC, j in CUST} ship_cost[i, j] * Serve[i, j];

subject to Meet_Demand {j in CUST}:
  sum {i in FAC} Serve[i, j] >= demand[j];

subject to Facility_Capacity {i in FAC}:
  (sum {j in CUST} Serve[i, j]) / capacity[i] <= Open[i];
