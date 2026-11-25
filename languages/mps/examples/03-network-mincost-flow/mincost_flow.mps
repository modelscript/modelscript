* Minimum-Cost Network Flow (Source S -> Hubs A,B -> Sink T)
NAME          NETFLOW
OBJSENSE
  MIN
ROWS
 N  TOTCOST
 E  NODE_S
 E  NODE_A
 E  NODE_B
 E  NODE_T
COLUMNS
    ARC_SA    TOTCOST   4.0          NODE_S    1.0
    ARC_SA    NODE_A    -1.0
    ARC_SB    TOTCOST   6.0          NODE_S    1.0
    ARC_SB    NODE_B    -1.0
    ARC_AB    TOTCOST   2.0          NODE_A    1.0
    ARC_AB    NODE_B    -1.0
    ARC_AT    TOTCOST   7.0          NODE_A    1.0
    ARC_AT    NODE_T    -1.0
    ARC_BT    TOTCOST   3.0          NODE_B    1.0
    ARC_BT    NODE_T    -1.0
RHS
    RHS1      NODE_S    50.0         NODE_A    0.0
    RHS1      NODE_B    0.0          NODE_T    -50.0
BOUNDS
 UP BND1      ARC_SA    35.0
 UP BND1      ARC_SB    30.0
 UP BND1      ARC_AB    20.0
 UP BND1      ARC_AT    25.0
 UP BND1      ARC_BT    40.0
ENDATA
