* Two-Product Manufacturing Mix LP (Maximize 40 X1 + 30 X2)
NAME          PRODMIX
OBJSENSE
  MAX
ROWS
 N  PROFIT
 L  MACHINE
 L  ASSEMBLY
COLUMNS
    X1        PROFIT    40.0         MACHINE   2.0
    X1        ASSEMBLY  1.0
    X2        PROFIT    30.0         MACHINE   1.0
    X2        ASSEMBLY  1.0
RHS
    RHS1      MACHINE   100.0        ASSEMBLY  80.0
BOUNDS
 UP BND1      X1        45.0
 UP BND1      X2        70.0
ENDATA
