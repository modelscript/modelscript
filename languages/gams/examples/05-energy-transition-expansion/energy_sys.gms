$title Multi-Region Energy Transition Capacity Expansion Model
$include regions.inc
$include demand.inc

Sets
  r    regions       / north, south /
  tech technologies  / solar, wind, nuclear, gas / ;

Parameters
  capCost(tech)  annualized investment cost in kUSD per MW yr
    / solar    75
      wind     95
      nuclear 320
      gas      85 /
  opCost(tech)   variable O and M plus fuel cost USD per MWh
    / solar     0
      wind      0
      nuclear  10
      gas      45 /
  emRate(tech)   CO2 emissions intensity in tCO2 per MWh
    / solar    0.0
      wind     0.0
      nuclear  0.0
      gas      0.40 /
  demand(r)      regional annual energy demand in GWh
    / north 42000
      south 56000 / ;

Table cf(r,tech)  annual capacity factor
           solar  wind  nuclear  gas
  north    0.16   0.38   0.90   0.85
  south    0.26   0.28   0.90   0.85 ;

Scalar
  hrs      hours per year / 8760 /
  co2Cap   system CO2 emissions budget in MtCO2 / 12.0 / ;

Variables
  cap(r,tech)  installed capacity in MW
  gen(r,tech)  annual generation in GWh
  totalCost    total annualized system cost in MUSD ;
Positive Variables cap, gen ;

Equations
  obj            total annualized investment and dispatch cost
  demBal(r)      regional demand satisfaction
  capLim(r,tech) capacity factor generation limit
  co2Lim         system-wide decarbonization cap ;

obj..            totalCost =e= sum((r,tech), capCost(tech)*cap(r,tech)/1000 + opCost(tech)*gen(r,tech)/1000) ;
demBal(r)..      sum(tech, gen(r,tech)) =g= demand(r) ;
capLim(r,tech).. gen(r,tech) =l= cf(r,tech)*hrs*cap(r,tech)/1000 ;
co2Lim..         sum((r,tech), emRate(tech)*gen(r,tech)/1000) =l= co2Cap ;

Model expansion / all / ;
Solve expansion using lp minimizing totalCost ;
Display cap.l, gen.l, totalCost.l ;
