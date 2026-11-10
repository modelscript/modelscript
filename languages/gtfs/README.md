<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# `@modelscript/gtfs`

General Transit Feed Specification (GTFS / GTFS-RT), public transit route kinematics, electric bus (e-Bus) traction power simulation, and grid depot charging integration package for ModelScript.

## Features

- **GTFS Static & Realtime Parsing:** Parses standard schedule tables (`stops`, `routes`, `trips`, `stop_times`, `shapes`) and GTFS-RT event payloads.
- **Vehicle Kinematic & Traction Solver:** Evaluates second-by-second traction force ($F_{\text{tract}} = m a + m g \sin \theta + F_{\text{rr}} + F_{\text{aero}}$), HVAC auxiliary consumption ($P_{\text{aux}}$), regenerative braking recovery, and battery State-of-Charge (SOC) profiles.
- **Depot Charging & Grid Integration:** Synthesizes aggregated charging load profiles across fleet operations, coupling directly with `@modelscript/opendss` (feeder capacity) and `@modelscript/ocpp` (managed smart charging).
- **Direct DAE Lowering:** Lowers continuous vehicle speed, battery state of charge, and electrical depot power balance equations into `@modelscript/runtime`'s `DAEBuilder` linear arena.
- **Pre-flight Linting:** Validates chronological stop arrival times, non-negative trip distance, peak speed limits ($v \le 120\,\text{km/h}$), passenger comfort acceleration limits ($a \le 2.5\,\text{m/s}^2$), and battery critical depletion ($\text{SOC} < 10\%$).

## File Support

| Extension | Description | Role |
| :--- | :--- | :--- |
| `.gtfs`, `.gtfs.txt` | GTFS Multi-table / Consolidated Feed | Transit agencies, routes, stops, schedules, and trips |
| `.gtfs-rt`, `.pb` | GTFS Realtime Protocol Buffer / Feed | Real-time vehicle positions and trip updates |

## Quick Example

```gtfs
# STOPS
stop_id,stop_name,stop_lat,stop_lon
STOP_1,Central Station,37.7749,-122.4194
STOP_2,Civic Center,37.7793,-122.4175
STOP_3,Mission District,37.7599,-122.4148

# ROUTES
route_id,route_short_name,route_long_name,route_type
ROUTE_14,14,Mission Electric Rapid,3

# TRIPS
route_id,service_id,trip_id,shape_id
ROUTE_14,WEEKDAY,TRIP_101,SHAPE_14

# STOP_TIMES
trip_id,arrival_time,departure_time,stop_id,stop_sequence,shape_dist_traveled
TRIP_101,08:00:00,08:00:30,STOP_1,1,0.0
TRIP_101,08:06:00,08:06:30,STOP_2,2,1200.0
TRIP_101,08:18:00,08:18:30,STOP_3,3,3800.0
```
