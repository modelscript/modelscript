# Standard AMPL Multi-Product Planning Model
set PRODUCTS;
param Rate{PRODUCTS} >= 0;
param Profit{PRODUCTS} >= 0;
param AvailableHours >= 0;

var Make{p in PRODUCTS} >= 0;

maximize TotalProfit:
  sum{p in PRODUCTS} Profit[p] * Make[p];

subject to ProductionCapacity:
  sum{p in PRODUCTS} (1 / Rate[p]) * Make[p] <= AvailableHours;
