\ Minimum-Cost Clinical Diet Optimization with Bounded Servings
Minimize
  cost: 0.40 oats + 2.20 salmon + 0.60 milk + 0.50 lentils
Subject To
  calories_min: 300 oats + 250 salmon + 150 milk + 230 lentils >= 1900
  protein_min:   10 oats +  28 salmon +   8 milk +  18 lentils >= 75
  calcium_min:   40 oats +  20 salmon + 300 milk +  40 lentils >= 700
  sodium_max:     5 oats + 120 salmon + 100 milk +  10 lentils <= 1200
Bounds
  1 <= oats <= 4
  0 <= salmon <= 3
  1 <= milk <= 5
  0 <= lentils <= 4
End
