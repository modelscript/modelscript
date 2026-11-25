* Capacitated Warehouse Facility Location MILP (2 Warehouses, 3 Customers)
NAME          FACLOC
OBJSENSE
  MIN
ROWS
 N  TOTCOST
 E  DEM_C1
 E  DEM_C2
 E  DEM_C3
 L  CAP_W1
 L  CAP_W2
COLUMNS
    X_W1C1    TOTCOST   4.0          DEM_C1    1.0
    X_W1C1    CAP_W1    1.0
    X_W1C2    TOTCOST   6.0          DEM_C2    1.0
    X_W1C2    CAP_W1    1.0
    X_W1C3    TOTCOST   9.0          DEM_C3    1.0
    X_W1C3    CAP_W1    1.0
    X_W2C1    TOTCOST   7.0          DEM_C1    1.0
    X_W2C1    CAP_W2    1.0
    X_W2C2    TOTCOST   3.5          DEM_C2    1.0
    X_W2C2    CAP_W2    1.0
    X_W2C3    TOTCOST   5.0          DEM_C3    1.0
    X_W2C3    CAP_W2    1.0
    MARK0001  'MARKER'               'INTORG'
    OPEN_W1   TOTCOST   250.0        CAP_W1    -120.0
    OPEN_W2   TOTCOST   310.0        CAP_W2    -140.0
    MARK0002  'MARKER'               'INTEND'
RHS
    RHS1      DEM_C1    40.0         DEM_C2    55.0
    RHS1      DEM_C3    35.0
BOUNDS
 BV BND1      OPEN_W1
 BV BND1      OPEN_W2
ENDATA
