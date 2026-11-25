* Four-Alloy Furnace Blending Minimum-Cost LP
NAME          ALLOYBLD
OBJSENSE
  MIN
ROWS
 N  COST
 E  BATCH
 G  CHROMIUM
 L  CARBON
COLUMNS
    SCRAP1    COST      120.0        BATCH     1.0
    SCRAP1    CHROMIUM  0.18         CARBON    0.04
    SCRAP2    COST      155.0        BATCH     1.0
    SCRAP2    CHROMIUM  0.24         CARBON    0.02
    SCRAP3    COST      95.0         BATCH     1.0
    SCRAP3    CHROMIUM  0.10         CARBON    0.05
    PURECR    COST      380.0        BATCH     1.0
    PURECR    CHROMIUM  0.90         CARBON    0.005
RHS
    RHS1      BATCH     100.0        CHROMIUM  20.0
    RHS1      CARBON    3.0
BOUNDS
 LO BND1      SCRAP1    10.0
 UP BND1      SCRAP1    60.0
 UP BND1      SCRAP2    50.0
 UP BND1      SCRAP3    45.0
 UP BND1      PURECR    25.0
ENDATA
