* ====================================================================
* Companion Reactor Protection System & Safety Injection Trip Logic
* ====================================================================
100 RPS Trip and HPSI Actuation Logic Module
101 new transnt
201 180.0 1.0e-5 0.01 100 1000
* Variable Trips: Low Pressurizer Pressure, High Pressure, Low-Low SI
2060001 p-100010000 lt 1.31e7 l
2060002 p-100010000 gt 1.64e7 l
2060003 p-100010000 lt 1.24e7 l
* Logical Trips: Reactor Scram (1 or 2) and HPSI Actuation (3)
2060004 1 or 2 l
. end
