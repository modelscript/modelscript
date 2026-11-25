\ 24-Hour Factory Shift Scheduling Integer Program
Minimize
  headcount: 180 s1 + 195 s2 + 210 s3 + 225 s4
Subject To
  block_00_06: s4 + s1 >= 8
  block_06_12: s1 + s2 >= 14
  block_12_18: s2 + s3 >= 16
  block_18_24: s3 + s4 >= 10
Bounds
  0 <= s1 <= 20
  0 <= s2 <= 20
  0 <= s3 <= 20
  0 <= s4 <= 20
Generals
  s1 s2 s3 s4
End
