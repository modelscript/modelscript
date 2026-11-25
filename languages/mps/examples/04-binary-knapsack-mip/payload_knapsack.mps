* Spacecraft Payload Selection 0-1 Binary Knapsack MIP
NAME          KNAPSACK
OBJSENSE
  MAX
ROWS
 N  VALUE
 L  MASS_KG
 L  POWER_W
COLUMNS
    MARK0001  'MARKER'               'INTORG'
    CAM_HD    VALUE     45.0         MASS_KG   4.5
    CAM_HD    POWER_W   18.0
    SPECTRO   VALUE     62.0         MASS_KG   6.0
    SPECTRO   POWER_W   24.0
    MAGNETO   VALUE     28.0         MASS_KG   2.0
    MAGNETO   POWER_W   8.0
    SAR_RAD   VALUE     85.0         MASS_KG   9.5
    SAR_RAD   POWER_W   42.0
    LASERCOM  VALUE     54.0         MASS_KG   5.0
    LASERCOM  POWER_W   28.0
    MARK0002  'MARKER'               'INTEND'
RHS
    RHS1      MASS_KG   16.0         POWER_W   70.0
BOUNDS
 BV BND1      CAM_HD
 BV BND1      SPECTRO
 BV BND1      MAGNETO
 BV BND1      SAR_RAD
 BV BND1      LASERCOM
ENDATA
