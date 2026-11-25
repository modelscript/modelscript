\ Multi-Commodity Supply Chain Design MILP
Minimize
  total_cost: 500 y1 + 620 y2 + 45 t1 + 50 t2
              + 4 x11 + 7 x12 + 6 x21 + 3 x22
Subject To
  demand_r1:   x11 + x21 = 60
  demand_r2:   x12 + x22 = 80
  cap_plant1:  x11 + x12 - 110 y1 <= 0
  cap_plant2:  x21 + x22 - 130 y2 <= 0
  trucks_p1:   x11 + x12 - 25 t1 <= 0
  trucks_p2:   x21 + x22 - 25 t2 <= 0
Bounds
  0 <= x11 <= 110
  0 <= x12 <= 110
  0 <= x21 <= 130
  0 <= x22 <= 130
  0 <= t1 <= 10
  0 <= t2 <= 10
Generals
  t1 t2
Binaries
  y1 y2
End
