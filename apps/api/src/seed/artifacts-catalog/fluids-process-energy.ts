// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SeedPostSpec } from "../types.js";

export const FLUIDS_PROCESS_ENERGY_POSTS: SeedPostSpec[] = [
  // 15. OLGA (.opi)
  {
    id: "seed-post-olga",
    language: "olga",
    viewType: "olga",
    title: "42 km Deepwater Subsea Tieback — Transient Severe Slugging & MEG Hydrate Inhibition",
    filename: "Deepwater_Subsea_Tieback_42km.opi",
    authorUsername: "astrid_solberg",
    createdHoursAgo: 132,
    postContent:
      "Published our 42 km Norwegian Sea deepwater tieback transient multiphase deck (`.opi`). Models riser-base gas lift and active topside choke anti-slug control across a 340 m bathymetric riser ascent, plus continuous 35 wt% MEG injection for hydrate subcooling margin verification during a 12-hour unplanned cold restart.",
    code: `<?xml version="1.0" encoding="UTF-8"?>
<OlgaProject Title="Norwegian Sea 42km Subsea Tieback &amp; Riser Anti-Slug Control" Author="Astrid Solberg" TableFile="norne_condensate_meg.tab" StartTime="0" EndTime="14400" MinDt="0.005" MaxDt="2.0">
  <Integration StartTime="0" EndTime="14400" MinDt="0.005" MaxDt="2.0" />
  <Node Name="SUBSEA_MANIFOLD_A" Type="CLOSED" X="0" Y="0" Z="-340" />
  <Node Name="FPSO_SEPARATOR" Type="PRESSURE" Pressure="28.5bar" Temperature="32C" GasFraction="0.82" X="42000" Y="0" Z="25" />
  <Flowpath Name="TIEBACK_FLOWLINE_14IN" FromNode="SUBSEA_MANIFOLD_A" ToNode="FPSO_SEPARATOR" Roughness="0.000045">
    <Pipe Name="FLOWLINE_SEC1_WELLHEAD" Length="12000" Elevation="-15" Diameter="0.336" Roughness="0.000045" NSegments="24" />
    <Pipe Name="FLOWLINE_SEC2_VALLEY" Length="16500" Elevation="-38" Diameter="0.336" Roughness="0.000045" NSegments="33" />
    <Pipe Name="FLOWLINE_SEC3_SADDLE" Length="12800" Elevation="22" Diameter="0.336" Roughness="0.000045" NSegments="26" />
    <Pipe Name="SCR_CATENARY_RISER" Length="700" Elevation="365" Diameter="0.312" Roughness="0.000045" NSegments="28" />
    <Source Name="WELL_A1_FEED" Pipe="FLOWLINE_SEC1_WELLHEAD" Section="1" MassFlow="48.5" Temperature="78C" GasMassFraction="0.34" WaterCut="0.18" />
    <Source Name="MEG_INJECTION_PORT" Pipe="FLOWLINE_SEC1_WELLHEAD" Section="2" MassFlow="2.4" Temperature="12C" GasMassFraction="0.0" WaterCut="1.0" />
    <Source Name="RISER_BASE_GAS_LIFT" Pipe="SCR_CATENARY_RISER" Section="1" MassFlow="3.8" Temperature="45C" GasMassFraction="1.0" WaterCut="0.0" />
    <Valve Name="TOPSIDE_ANTI_SLUG_CHOKE" Pipe="SCR_CATENARY_RISER" Section="27" Diameter="0.22" Opening="0.62" Cd="0.84" />
    <Controller Name="RISER_BASE_PRESSURE_PI" Type="PI" ControlledVar="PRESSURE" ControlledPipe="SCR_CATENARY_RISER" ControlledSection="1" Setpoint="94.5bar" Kp="0.045" Ti="180.0" TargetValve="TOPSIDE_ANTI_SLUG_CHOKE" />
    <HeatTransfer AmbientTemp="4.2C" OuterHtc="420.0" HydrateCurveOffset="2.0" />
  </Flowpath>
</OlgaProject>
`,
    likedBy: ["omar", "nadia_almansoor", "priya_nair", "henrik_lindqvist", "mateo_silva", "vikram_patel"],
    repostedBy: ["nadia_almansoor", "priya_nair"],
    bookmarkedBy: ["omar", "nadia_almansoor", "mateo_silva"],
    comments: [
      {
        authorUsername: "nadia_almansoor",
        createdHoursAgo: 129,
        content:
          "The riser-base pressure PI controller on `TOPSIDE_ANTI_SLUG_CHOKE` stabilizes the terrain-induced hydrodynamic slugging at 62% choke opening without sacrificing more than 1.8 bar of wellhead drawdown.",
        likedBy: ["astrid_solberg", "omar"],
        replies: [
          {
            authorUsername: "astrid_solberg",
            createdHoursAgo: 127,
            content:
              "Exactly — combining 3.8 kg/s riser-base gas lift with the PI choke loop shifts the bifurcation point down to 22% turndown while keeping us 4.1 K clear of the structure-II hydrate curve.",
            likedBy: ["nadia_almansoor", "priya_nair"],
          },
        ],
      },
      {
        authorUsername: "priya_nair",
        createdHoursAgo: 124,
        content:
          "How does the Zuber-Findlay drift-flux slip correlation compare against the 3-fluid formulation in `FLOWLINE_SEC2_VALLEY` during liquid holdup surge?",
        likedBy: ["astrid_solberg"],
      },
    ],
  },

  // 16. LPS (.lps)
  {
    id: "seed-post-lps",
    language: "lps",
    viewType: "lps",
    title: "Trans-Continental 20% H2-Blended Natural Gas Transmission Network — PipelineStudio TGNET",
    filename: "EuroGrid_H2_Blend_Transmission.lps",
    authorUsername: "nadia_almansoor",
    createdHoursAgo: 126,
    postContent:
      "Uploaded our 380 km high-pressure gas transmission network (`.lps`) carrying a 20 mol% green hydrogen blend (`GERG-2008` / `AGA-8` equation of state). Tracks line-pack inventory swing, centrifugal compressor surge margins across two booster stations, and Joule-Thomson cooling across the city-gate pressure reduction station.",
    code: `<?xml version="1.0" encoding="UTF-8"?>
<PipelineStudio Title="EuroGrid 20% H2-Natural Gas Transmission Corridor" SimulationType="TRANSIENT" EquationOfState="GERG2008" DurationHours="24" TimeStepSeconds="60">
  <GasComposition Methane="0.745" Hydrogen="0.200" Ethane="0.032" Propane="0.008" Nitrogen="0.010" CarbonDioxide="0.005" />
  <Nodes>
    <Node Name="NORTH_SEA_TERMINAL" Type="SUPPLY" Pressure="84.0bar" Temperature="18.0C" Elevation="12" />
    <Node Name="BOOSTER_SUCTION_1" Type="JUNCTION" Pressure="66.2bar" Temperature="11.4C" Elevation="85" />
    <Node Name="BOOSTER_DISCH_1" Type="JUNCTION" Pressure="88.5bar" Temperature="38.2C" Elevation="85" />
    <Node Name="ELECTROLYZER_TIE_IN" Type="SUPPLY" Pressure="76.4bar" Temperature="24.0C" Elevation="110" FlowRate="42.0" />
    <Node Name="BOOSTER_SUCTION_2" Type="JUNCTION" Pressure="63.8bar" Temperature="12.8C" Elevation="145" />
    <Node Name="BOOSTER_DISCH_2" Type="JUNCTION" Pressure="85.0bar" Temperature="36.5C" Elevation="145" />
    <Node Name="CCGT_POWER_PLANT" Type="DELIVERY" Pressure="58.4bar" Temperature="10.2C" Elevation="95" FlowRate="165.0" />
    <Node Name="METRO_CITY_GATE" Type="DELIVERY" Pressure="52.0bar" Temperature="9.5C" Elevation="60" FlowRate="210.0" />
  </Nodes>
  <Pipes>
    <Pipe Name="TRUNK_SEG_1" FromNode="NORTH_SEA_TERMINAL" ToNode="BOOSTER_SUCTION_1" Length="115km" Diameter="1066mm" WallThickness="19.5mm" Roughness="0.012mm"MAOP="95.0bar" />
    <Pipe Name="TRUNK_SEG_2" FromNode="BOOSTER_DISCH_1" ToNode="ELECTROLYZER_TIE_IN" Length="78km" Diameter="1066mm" WallThickness="19.5mm" Roughness="0.012mm" MAOP="95.0bar" />
    <Pipe Name="TRUNK_SEG_3" FromNode="ELECTROLYZER_TIE_IN" ToNode="BOOSTER_SUCTION_2" Length="64km" Diameter="1066mm" WallThickness="19.5mm" Roughness="0.012mm" MAOP="95.0bar" />
    <Pipe Name="TRUNK_SEG_4" FromNode="BOOSTER_DISCH_2" ToNode="CCGT_POWER_PLANT" Length="72km" Diameter="914mm" WallThickness="17.5mm" Roughness="0.015mm" MAOP="90.0bar" />
    <Pipe Name="LATERAL_CITY_GATE" FromNode="CCGT_POWER_PLANT" ToNode="METRO_CITY_GATE" Length="51km" Diameter="762mm" WallThickness="15.9mm" Roughness="0.015mm" MAOP="85.0bar" />
  </Pipes>
  <Compressors>
    <Compressor Name="CS01_SOLAR_TITAN130" FromNode="BOOSTER_SUCTION_1" ToNode="BOOSTER_DISCH_1" ControlMode="DISCHARGE_PRESSURE" Setpoint="88.5bar" MaxPowerMW="16.5" AdiabaticEfficiency="0.83" SpeedRPM="8450" />
    <Compressor Name="CS02_SIEMENS_SGT400" FromNode="BOOSTER_SUCTION_2" ToNode="BOOSTER_DISCH_2" ControlMode="DISCHARGE_PRESSURE" Setpoint="85.0bar" MaxPowerMW="14.2" AdiabaticEfficiency="0.82" SpeedRPM="9100" />
  </Compressors>
</PipelineStudio>
`,
    likedBy: ["astrid_solberg", "priya_nair", "omar", "henrik_lindqvist", "mateo_silva"],
    repostedBy: ["astrid_solberg"],
    bookmarkedBy: ["astrid_solberg", "priya_nair"],
    comments: [
      {
        authorUsername: "astrid_solberg",
        createdHoursAgo: 122,
        content:
          "Because hydrogen has a lower molecular weight and higher sonic velocity, `CS01_SOLAR_TITAN130` needs +11% impeller tip speed to maintain the same 1.34 pressure ratio at 20 mol% H2.",
        likedBy: ["nadia_almansoor", "omar"],
        replies: [
          {
            authorUsername: "nadia_almansoor",
            createdHoursAgo: 120,
            content:
              "Spot on. And notice how the volumetric energy density drop reduces our effective line-pack energy buffer in `TRUNK_SEG_1`..`TRUNK_SEG_3` by 13.4% during the morning CCGT ramp.",
            likedBy: ["astrid_solberg"],
          },
        ],
      },
    ],
  },

  // 17. ASPEN (.inp)
  {
    id: "seed-post-aspen",
    language: "aspen",
    viewType: "aspen",
    title: "Post-Combustion 30 wt% MEA Amine CO2 Capture & Stripper Regeneration Plant — Aspen Plus",
    filename: "MEA_PostCombustion_CO2_Capture.inp",
    authorUsername: "priya_nair",
    createdHoursAgo: 120,
    postContent:
      "Full post-combustion $\\text{CO}_2$ capture flowsheet (`.inp`) using aqueous 30 wt% monoethanolamine (MEA) with Electrolyte-NRTL (`ELECNRTL`) thermodynamics. Achieves 91.4% $\\text{CO}_2$ capture recovery from a 450 MW CCGT flue gas slipstream with lean/rich cross-heat exchange and 3.42 GJ/t-$\\text{CO}_2$ reboiler duty.",
    code: `TITLE "Post-Combustion 30wt% MEA CO2 Capture & Thermal Stripper Plant"
IN-UNITS SI
DEF-STREAMS CONVEN ALL
PROPERTIES ELECNRTL

COMPONENTS
  H2O H2O /
  CO2 CO2 /
  MEA C2H7NO /
  N2 N2 /
  O2 O2

FLOWSHEET
  BLOCK DCC-COOL IN=FLUE-RAW OUT=FLUE-COOL COND-W
  BLOCK ABSORBER IN=FLUE-COOL LEAN-IN OUT=VENT-GAS RICH-OUT
  BLOCK RICH-PMP IN=RICH-OUT OUT=RICH-HP
  BLOCK LR-HEX IN=RICH-HP LEAN-HOT OUT=RICH-HOT LEAN-WARM
  BLOCK STRIPPER IN=RICH-HOT OUT=CO2-PROD LEAN-HOT
  BLOCK MAKEUP-MX IN=LEAN-WARM MEA-MKUP OUT=LEAN-IN

STREAM FLUE-RAW
  SUBSTREAM MIXED TEMP=385.15 PRES=105000.0
  MOLE-FLOW H2O 145.0 / CO2 88.5 / N2 1580.0 / O2 112.0 / MEA 0.0

STREAM LEAN-IN
  SUBSTREAM MIXED TEMP=313.15 PRES=115000.0
  MOLE-FLOW H2O 3420.0 / MEA 485.0 / CO2 118.0 / N2 0.0 / O2 0.0

STREAM MEA-MKUP
  SUBSTREAM MIXED TEMP=298.15 PRES=120000.0
  MOLE-FLOW H2O 12.5 / MEA 0.42 / CO2 0.0 / N2 0.0 / O2 0.0

BLOCK DCC-COOL FLASH2
  PARAM TEMP=311.15 PRES=103000.0

BLOCK ABSORBER RADFRAC
  PARAM NSTAGE=20 CONDENSER=NONE REBOILER=NONE

BLOCK RICH-PMP PUMP
  PARAM PRES=240000.0 EFF=0.78

BLOCK LR-HEX HEATX
  PARAM T-COLD=378.15 U=1150.0

BLOCK STRIPPER RADFRAC
  PARAM NSTAGE=16 CONDENSER=PARTIAL-V REBOILER=KETTLE RR=1.45

BLOCK MAKEUP-MX MIXER
  PARAM PRES=115000.0
`,
    likedBy: ["omar", "nadia_almansoor", "astrid_solberg", "hannah_becker", "mateo_silva"],
    repostedBy: ["nadia_almansoor", "hannah_becker"],
    bookmarkedBy: ["omar", "nadia_almansoor", "hannah_becker"],
    comments: [
      {
        authorUsername: "hannah_becker",
        createdHoursAgo: 117,
        content:
          "Getting the cold-side approach on `LR-HEX` up to 378.15 K (`105 °C`) makes a huge difference in sensible heat demand at the `STRIPPER` kettle reboiler. What is your rich loading in mol CO2 / mol MEA?",
        likedBy: ["priya_nair", "nadia_almansoor"],
        replies: [
          {
            authorUsername: "priya_nair",
            createdHoursAgo: 115,
            content:
              "Rich loading exits `ABSORBER` at 0.485 mol CO2 / mol MEA and regenerates down to 0.243 lean loading in `STRIPPER` at 1.95 bar operating pressure to stay below the 122 °C thermal degradation threshold.",
            likedBy: ["hannah_becker", "omar"],
          },
        ],
      },
    ],
  },

  // 18. RELAP5 (.i)
  {
    id: "seed-post-relap5",
    language: "relap5",
    viewType: "relap5",
    title: "PWR Primary Loop 2-Inch Cold-Leg Small-Break LOCA & Accumulator Injection — RELAP5-3D",
    filename: "PWR_SmallBreak_LOCA_PrimaryLoop.i",
    authorUsername: "priya_nair",
    createdHoursAgo: 114,
    postContent:
      "Uploaded our RELAP5-3D nuclear safety nodalization deck (`.i`) for a Westinghouse-type 4-loop PWR undergoing a 2-inch cold-leg Small-Break Loss-of-Coolant Accident (SBLOCA). Includes reactor core channels, U-tube steam generator primary/secondary heat structures, reactor scram trip logic, and passive nitrogen-pressurized ECCS accumulators.",
    code: `* =====================================================================
* PWR PRIMARY LOOP 2-INCH COLD-LEG SBLOCA NODALIZATION DECK (RELAP5-3D)
* =====================================================================
100 PWR_4Loop_ColdLeg_SBLOCA_Safety_Analysis
101 new transnt
201 600.0 1.0e-5 0.05 10 100

* --- REACTOR SCRAM & ECCS TRIPS (400-599) ---
401 press 110010000 lt 12.8e6 0.0 l
402 press 150010000 lt 4.24e6 0.0 l

* --- HYDRODYNAMIC VOLUMES (CCC0000: Name Type) ---
1000000 downcomer pipe
1000101 4.85 6.50 0.0 0.0 -90.0 0.72 0.00004 0.0 00000
1001201 003 15.51e6 565.15 0.0 0.0 0.0

1100000 lowerplenum snglvol
1100101 12.40 2.80 0.0 0.0 -90.0 1.85 0.00005 0.0 00000
1100200 003 15.55e6 565.35 0.0

1200000 activecore pipe
1200101 5.12 3.66 0.0 0.0 90.0 0.0118 0.000015 0.0 00000
1201201 003 15.48e6 582.65 0.0 0.0 0.0

1300000 upperplenum snglvol
1300101 14.20 3.10 0.0 0.0 90.0 2.10 0.00005 0.0 00000
1300200 003 15.42e6 598.15 0.0

1400000 hotleg pipe
1400101 0.428 7.20 0.0 0.0 0.0 0.736 0.00004 0.0 00000
1401201 003 15.40e6 598.15 0.0 0.0 0.0

1500000 sgutubes pipe
1500101 1.18 19.40 0.0 0.0 0.0 0.0197 0.00001 0.0 00000
1501201 003 15.32e6 579.85 0.0 0.0 0.0

1600000 coldleg pipe
1600101 0.382 6.80 0.0 0.0 0.0 0.698 0.00004 0.0 00000
1601201 003 15.52e6 565.15 0.0 0.0 0.0

1700000 pressurizer pipe
1700101 3.45 12.80 0.0 0.0 90.0 2.12 0.00003 0.0 00000
1701201 004 15.51e6 0.42 0.0 0.0 0.0

1800000 eccsaccum accum
1800101 6.20 6.40 0.0 0.0 -90.0 1.65 0.00004 0.0 00000
1800200 003 4.24e6 322.15 0.0

* --- HYDRODYNAMIC JUNCTIONS ---
2010000 dc_to_lp sngljun
2010101 100010000 110000000 4.65 0.15 0.15 00000
2010201 1 4680.0 0.0 0.0

2020000 lp_to_core sngljun
2020101 110010000 120000000 4.95 0.22 0.22 00000
2020201 1 4680.0 0.0 0.0

2030000 core_to_up sngljun
2030101 120010000 130000000 4.95 0.18 0.18 00000
2030201 1 4680.0 0.0 0.0

2040000 up_to_hl sngljun
2040101 130010000 140000000 0.428 0.08 0.08 00000
2040201 1 4680.0 0.0 0.0

2050000 hl_to_sg sngljun
2050101 140010000 150000000 0.428 0.12 0.12 00000
2050201 1 4680.0 0.0 0.0

2060000 sg_to_cl sngljun
2060101 150010000 160000000 0.382 0.14 0.14 00000
2060201 1 4680.0 0.0 0.0

2070000 cl_to_dc sngljun
2070101 160010000 100000000 0.382 0.10 0.10 00000
2070201 1 4680.0 0.0 0.0

2080000 pzr_surge sngljun
2080101 140010000 170000000 0.064 0.35 0.35 00000
2080201 1 0.0 0.0 0.0

2090000 accum_inj valve
2090101 180010000 160000000 0.058 0.25 0.25 00000
2090201 1 0.0 0.0 0.0

* --- POINT REACTOR KINETICS ---
3000000 point
3000001 3411.0e6 0.0065 1.85e-5
.
`,
    likedBy: ["omar", "vikram_patel", "elena_vance", "henrik_lindqvist", "astrid_solberg"],
    repostedBy: ["vikram_patel"],
    bookmarkedBy: ["omar", "vikram_patel", "elena_vance"],
    comments: [
      {
        authorUsername: "vikram_patel",
        createdHoursAgo: 111,
        content:
          "How early does loop seal clearing occur in `sg_to_cl` (`2060000`) before the cold-leg pressure drops below the 4.24 MPa `eccsaccum` check valve cracking threshold (`Trip 402`)?",
        likedBy: ["priya_nair", "omar"],
        replies: [
          {
            authorUsername: "priya_nair",
            createdHoursAgo: 109,
            content:
              "Loop seal clearing occurs at t = 184 s with a brief core mixture level depression to 0.42 m above the active fuel midplane, and `eccsaccum` borated water injection initiates at t = 238 s, capping peak cladding temperature at 842 K (well below the 1477 K 10 CFR 50.46 limit).",
            likedBy: ["vikram_patel", "omar"],
          },
        ],
      },
    ],
  },

  // 19. ECLIPSE (.data)
  {
    id: "seed-post-eclipse",
    language: "eclipse",
    viewType: "eclipse",
    title: "Norne Sector 3D Three-Phase Black-Oil & WAG CO2-EOR Reservoir Simulation Deck — ECLIPSE 100",
    filename: "Norne_Sector_3D_BlackOil_WAG.data",
    authorUsername: "nadia_almansoor",
    createdHoursAgo: 108,
    postContent:
      "Shared our 3D three-phase (`OIL` / `WATER` / `GAS` / `DISGAS`) reservoir simulation deck (`.data`) for a faulted North Sea sandstone sector under Water-Alternating-Gas (WAG) $\\text{CO}_2$ injection. Includes full `PROPS` relative permeability (`SWOF`, `SGOF`), live-oil `PVDO`/`PVDG` tables, hydrostatic `EQUIL` initialization, and 5-spot producer/injector `SCHEDULE` controls.",
    code: `-- =====================================================================
-- NORNE SECTOR 3D BLACK-OIL & WAG CO2-EOR RESERVOIR DECK (ECLIPSE 100)
-- =====================================================================
RUNSPEC

TITLE
Norne Sector 3D Black-Oil & Water-Alternating-Gas Reservoir Study

DIMENS
  10 10 5 /

OIL
WATER
GAS
DISGAS
METRIC

START
  1 'JAN' 2026 /

GRID

DX
  500*100.0 /
DY
  500*100.0 /
DZ
  100*8.0 100*10.0 100*12.0 100*9.0 100*11.0 /
TOPS
  100*2450.0 /
PORO
  100*0.24 100*0.27 100*0.22 100*0.19 100*0.25 /
PERMX
  100*420.0 100*680.0 100*310.0 100*145.0 100*520.0 /
PERMY
  100*420.0 100*680.0 100*310.0 100*145.0 100*520.0 /
PERMZ
  100*42.0 100*68.0 100*31.0 100*14.5 100*52.0 /

PROPS

DENSITY
  835.0 1025.0 0.86 /

PVTW
  275.0 1.028 4.5e-5 0.38 0.0 /

SWOF
  0.18 0.000 1.000 1.85
  0.35 0.065 0.520 0.72
  0.50 0.195 0.210 0.34
  0.65 0.410 0.048 0.12
  0.78 0.720 0.000 0.00 /

SGOF
  0.00 0.000 1.000 0.00
  0.15 0.038 0.580 0.14
  0.35 0.185 0.220 0.38
  0.55 0.460 0.042 0.76
  0.75 0.840 0.000 1.45 /

SOLUTION

EQUIL
  2480.0 276.5 2515.0 0.0 2460.0 0.0 1 1 0 /

SCHEDULE

WELSPECS
  'PROD-B1' 'G1' 2 2 2465.0 'OIL' /
  'PROD-B2' 'G1' 9 2 2465.0 'OIL' /
  'PROD-B3' 'G1' 5 5 2460.0 'OIL' /
  'PROD-B4' 'G1' 2 9 2468.0 'OIL' /
  'INJ-W1'  'G1' 9 9 2495.0 'WATER' /
  'INJ-G1'  'G1' 1 5 2455.0 'GAS' /
/

COMPDAT
  'PROD-B1' 2 2 1 3 'OPEN' 1* 1* 0.216 /
  'PROD-B2' 9 2 1 3 'OPEN' 1* 1* 0.216 /
  'PROD-B3' 5 5 1 4 'OPEN' 1* 1* 0.216 /
  'PROD-B4' 2 9 2 4 'OPEN' 1* 1* 0.216 /
  'INJ-W1'  9 9 3 5 'OPEN' 1* 1* 0.216 /
  'INJ-G1'  1 5 1 2 'OPEN' 1* 1* 0.216 /
/

WCONPROD
  'PROD-B1' 'OPEN' 'ORAT' 1850.0 4* 145.0 /
  'PROD-B2' 'OPEN' 'ORAT' 1620.0 4* 145.0 /
  'PROD-B3' 'OPEN' 'ORAT' 2100.0 4* 140.0 /
  'PROD-B4' 'OPEN' 'ORAT' 1480.0 4* 145.0 /
/

WCONINJE
  'INJ-W1' 'WATER' 'OPEN' 'RATE' 4200.0 1* 345.0 /
  'INJ-G1' 'GAS'   'OPEN' 'RATE' 380000.0 1* 330.0 /
/

TSTEP
  12*30.0 /

END
`,
    likedBy: ["astrid_solberg", "omar", "priya_nair", "mateo_silva"],
    repostedBy: ["astrid_solberg"],
    bookmarkedBy: ["astrid_solberg", "omar"],
    comments: [
      {
        authorUsername: "astrid_solberg",
        createdHoursAgo: 105,
        content:
          "Completing `INJ-G1` in layers 1–2 (`PERMX` 420–680 mD) and `INJ-W1` in layers 3–5 gives great vertical sweep efficiency, especially with the low $k_v/k_h = 0.1$ baffles retarding gravity override.",
        likedBy: ["nadia_almansoor", "omar"],
      },
    ],
  },

  // 20. EPANET (.inp)
  {
    id: "seed-post-epanet",
    language: "epanet",
    viewType: "epanet",
    title: "Metropolitan Dual-Pressure-Zone Water Distribution & Chlorine Decay Network — EPANET 2.2",
    filename: "Metro_DualZone_WaterDistribution.inp",
    authorUsername: "mateo_silva",
    createdHoursAgo: 102,
    postContent:
      "Published our metropolitan dual-pressure-zone municipal water distribution network (`.inp`). Models variable-speed booster pumps, a pressure-reducing valve (`PRV`) interconnecting the high-elevation reservoir zone with the downtown loop, extended-period diurnal demand multipliers, and first-order bulk/wall free-chlorine decay.",
    code: `[TITLE]
Metropolitan Dual-Pressure-Zone Municipal Water Distribution & Chlorine Decay Model

[JUNCTIONS]
;ID              Elev        Demand      Pattern
 J_INTAKE        15.0        0.0         PAT_RES
 J_NORTH_MAIN    62.0        42.5        PAT_RES
 J_HOSPITAL      74.0        28.0        PAT_HOSP
 J_INDUSTRIAL    48.0        85.0        PAT_IND
 J_DOWNTOWN_W    32.0        64.0        PAT_COM
 J_DOWNTOWN_E    29.0        58.0        PAT_COM
 J_SOUTH_LOOP    24.0        46.0        PAT_RES

[RESERVOIRS]
;ID              Head        Pattern
 R_RIVER_WTP     22.0

[TANKS]
;ID              Elevation   InitLevel   MinLevel    MaxLevel    Diameter    MinVol
 T_HIGH_ZONE     105.0       6.8         2.0         10.0        24.0        0.0

[PIPES]
;ID              Node1           Node2           Length      Diameter    Roughness   MinorLoss   Status
 P_TRANSMISSION  J_NORTH_MAIN    T_HIGH_ZONE     1850.0      600.0       130.0       0.5         Open
 P_NORTH_HOSP    J_NORTH_MAIN    J_HOSPITAL      1240.0      450.0       125.0       0.2         Open
 P_HOSP_IND      J_HOSPITAL      J_INDUSTRIAL    1620.0      400.0       125.0       0.3         Open
 P_IND_DTW       J_INDUSTRIAL    J_DOWNTOWN_W    1480.0      400.0       120.0       0.2         Open
 P_DT_LOOP       J_DOWNTOWN_W    J_DOWNTOWN_E    920.0       350.0       120.0       0.1         Open
 P_DTE_SOUTH     J_DOWNTOWN_E    J_SOUTH_LOOP    1350.0      300.0       120.0       0.2         Open
 P_SOUTH_WEST    J_SOUTH_LOOP    J_DOWNTOWN_W    1180.0      300.0       120.0       0.2         Open

[PUMPS]
;ID              Node1           Node2           Parameters
 PMP_WTP_MAIN    R_RIVER_WTP     J_INTAKE        HEAD CURVE_PMP1 SPEED 1.0
 PMP_BOOSTER_1   J_INTAKE        J_NORTH_MAIN    HEAD CURVE_PMP2 SPEED 1.0

[VALVES]
;ID              Node1           Node2           Diameter    Type    Setting     MinorLoss
 VLV_PRV_ZONE2   J_NORTH_MAIN    J_DOWNTOWN_E    350.0       PRV     45.0        0.2

[REACTIONS]
 GLOBAL BULK     -0.55
 GLOBAL WALL     -0.18
 LIMITING POTENTIAL 0.0

[TIMES]
 DURATION        24:00
 HYDRAULIC TIMESTEP 1:00
 QUALITY TIMESTEP 0:05

[OPTIONS]
 UNITS           LPS
 HEADLOSS        H-W
 QUALITY         Chlorine mg/L

[END]
`,
    likedBy: ["omar", "astrid_solberg", "nadia_almansoor", "priya_nair", "sarah_lin"],
    repostedBy: ["nadia_almansoor"],
    bookmarkedBy: ["omar", "astrid_solberg"],
    comments: [
      {
        authorUsername: "priya_nair",
        createdHoursAgo: 99,
        content:
          "How does the free-chlorine residual hold up at `J_SOUTH_LOOP` during the 03:00 low-demand nocturnal window when residence time in `T_HIGH_ZONE` peaks?",
        likedBy: ["mateo_silva", "omar"],
        replies: [
          {
            authorUsername: "mateo_silva",
            createdHoursAgo: 97,
            content:
              "With a 1.4 mg/L WTP dosing setpoint and `-0.55 /day` bulk decay, `J_SOUTH_LOOP` bottoms out at 0.38 mg/L at 05:15 — comfortably above the 0.20 mg/L regulatory minimum without triggering THM spikes near `J_NORTH_MAIN`.",
            likedBy: ["priya_nair", "omar"],
          },
        ],
      },
    ],
  },

  // 21. SWMM (.inp)
  {
    id: "seed-post-swmm",
    language: "swmm",
    viewType: "swmm",
    title: "Urban Watershed Detention Basin & 100-Year SCS Type-II Storm Dynamic Wave Routing — EPA SWMM 5",
    filename: "Urban_Watershed_100yr_Detention.inp",
    authorUsername: "mateo_silva",
    createdHoursAgo: 96,
    postContent:
      "Uploaded our 1D Saint-Venant dynamic-wave (`DYNWAVE`) urban stormwater model (`.inp`) for a 420-hectare mixed-use watershed under a 100-year 24-hour design storm. Verifies that the regional detention basin (`ST_REGIONAL_BASIN`) and compound outlet weir (`WR_EMERGENCY_SPILL`) shave peak river outfall discharge by 46% with zero street-level manhole surcharging.",
    code: `[TITLE]
Urban Watershed 100-Year Storm Dynamic Wave Routing & Regional Detention Basin

[OPTIONS]
FLOW_UNITS           CMS
INFILTRATION         HORTON
FLOW_ROUTING         DYNWAVE
START_DATE           06/15/2026
START_TIME           00:00:00
END_DATE             06/16/2026
END_TIME             00:00:00
ROUTING_STEP         00:00:15

[SUBCATCHMENTS]
;Name            RainGage         Outlet           Area     %Imperv  Width    %Slope   CurbLen
 S1_COMMERCIAL   RG_DESIGN_100YR  J1_NORTH_TRUNK   85.0     78.0     620.0    1.8      0
 S2_RESIDENTIAL  RG_DESIGN_100YR  J2_WEST_BRANCH   140.0    42.0     840.0    2.4      0
 S3_INDUSTRIAL   RG_DESIGN_100YR  J3_CENTRAL_MERGE 110.0    84.0     710.0    1.2      0
 S4_PARKLAND     RG_DESIGN_100YR  ST_DETENTION     85.0     14.0     590.0    3.1      0

[JUNCTIONS]
;Name            Elevation  MaxDepth   InitDepth  SurDepth   Aponded
 J1_NORTH_TRUNK  118.50     3.20       0.15       0.0        0.0
 J2_WEST_BRANCH  116.80     3.40       0.12       0.0        0.0
 J3_CENTRAL_MERGE 112.40    3.80       0.20       0.0        0.0
 J4_BASIN_OUT    105.20     3.00       0.10       0.0        0.0

[OUTFALLS]
;Name            Elevation  Type       StageData  Gated
 OF_RIVER_MAIN   101.50     FREE       NO

[STORAGE]
;Name            Elev.    MaxDepth   InitDepth  Shape      CurveName/Params
 ST_DETENTION    106.00   5.50       0.40       FUNCTIONAL 12500.0 0.85 4200.0

[CONDUITS]
;Name            FromNode         ToNode           Length     Roughness  InOffset   OutOffset  InitFlow
 C1_NORTH_CULV   J1_NORTH_TRUNK   J3_CENTRAL_MERGE 680.0      0.013      0.0        0.0        0.25
 C2_WEST_CULV    J2_WEST_BRANCH   J3_CENTRAL_MERGE 540.0      0.013      0.0        0.0        0.18
 C3_MAIN_INTERC  J3_CENTRAL_MERGE ST_DETENTION     820.0      0.014      0.0        0.0        0.43
 C4_OUTFALL_BOX  J4_BASIN_OUT     OF_RIVER_MAIN    410.0      0.013      0.0        0.0        0.43

[ORIFICES]
;Name            FromNode         ToNode           Type       Offset     Qcoeff     Gated
 OR_LOW_FLOW     ST_DETENTION     J4_BASIN_OUT     SIDE       0.0        0.62       NO

[WEIRS]
;Name            FromNode         ToNode           Type       CrestHt    Qcoeff     Gated
 WR_SPILLWAY     ST_DETENTION     J4_BASIN_OUT     TRANSVERSE 3.60       1.84       NO

[XSECTIONS]
;Link            Shape        Geom1      Geom2      Geom3      Geom4      Barrels
 C1_NORTH_CULV   CIRCULAR     1.80       0          0          0          1
 C2_WEST_CULV    CIRCULAR     1.65       0          0          0          1
 C3_MAIN_INTERC  RECT_CLOSED  2.40       2.40       0          0          2
 C4_OUTFALL_BOX  RECT_CLOSED  2.20       2.00       0          0          2
 OR_LOW_FLOW     CIRCULAR     0.90       0          0          0          1
 WR_SPILLWAY     RECT_OPEN    6.00       1.50       0          0          1
`,
    likedBy: ["omar", "astrid_solberg", "nadia_almansoor", "claire_dubois"],
    repostedBy: ["omar"],
    bookmarkedBy: ["omar", "nadia_almansoor"],
    comments: [
      {
        authorUsername: "astrid_solberg",
        createdHoursAgo: 93,
        content:
          "Twin 2.4 m × 2.4 m box culverts on `C3_MAIN_INTERC` keep the hydraulic grade line 0.65 m below rim elevation at `J3_CENTRAL_MERGE` even when `S1_COMMERCIAL` and `S3_INDUSTRIAL` hydrographs peak simultaneously.",
        likedBy: ["mateo_silva", "omar"],
      },
    ],
  },

  // 22. ENERGYPLUS (.idf)
  {
    id: "seed-post-energyplus",
    language: "energyplus",
    viewType: "energyplus",
    title: "Net-Zero R&D Cleanroom & Office Complex — Geothermal Heat Pump & DOAS HVAC (EnergyPlus IDF)",
    filename: "NetZero_Cleanroom_Geothermal_DOAS.idf",
    authorUsername: "mateo_silva",
    createdHoursAgo: 90,
    postContent:
      "Published our EnergyPlus v24.1 building energy & HVAC simulation deck (`.idf`) for a 4-zone net-zero R&D laboratory and cleanroom complex. Couples a borefield ground-source heat pump plant loop, enthalpy wheel Dedicated Outdoor Air System (`DOAS`), chilled beams, and 180 kWp rooftop bifacial PV array compliant with ASHRAE 90.1 Appendix G.",
    code: `! =====================================================================
! NET-ZERO R&D CLEANROOM & OFFICE COMPLEX — ENERGYPLUS 24.1 IDF DECK
! =====================================================================
Version,24.1;

Building,
  NetZero_Cleanroom_Research_Center,  !- Name
  0.0,                                !- North Axis {deg}
  City,                               !- Terrain
  0.04,                               !- Loads Convergence Tolerance Value {W}
  0.20,                               !- Temperature Convergence Tolerance Value {deltaC}
  FullInteriorAndExterior,            !- Solar Distribution
  25,                                 !- Maximum Number of Warmup Days
  6;                                  !- Minimum Number of Warmup Days

Timestep,6;

Zone,
  Zone_ISO6_Cleanroom,                !- Name
  0.0, 0.0, 0.0, 0.0, 1, 1,           !- Direction/Origin/Type/Multiplier
  4.2,                                !- Ceiling Height {m}
  2520.0,                             !- Volume {m3}
  600.0;                              !- Floor Area {m2}

Zone,
  Zone_South_OpenOffice,              !- Name
  0.0, 0.0, 20.0, 0.0, 1, 1,
  3.6,
  1800.0,
  500.0;

Zone,
  BuildingEnvelope_ZoneCoreLab,       !- Name
  0.0, 25.0, 0.0, 0.0, 1, 1,
  4.0,
  1600.0,
  400.0;

Zone,
  Zone_Server_DataHall,               !- Name
  0.0, 25.0, 20.0, 0.0, 1, 1,
  3.8,
  456.0,
  120.0;

Material,
  LowE_TripleGlaze_Argon,             !- Name
  Smooth,                             !- Roughness
  0.042,                              !- Thickness {m}
  0.034,                              !- Conductivity {W/m-K}
  1200.0,                             !- Density {kg/m3}
  840.0;                              !- Specific Heat {J/kg-K}
`,
    likedBy: ["omar", "claire_dubois", "sarah_lin", "priya_nair", "hannah_becker"],
    repostedBy: ["claire_dubois"],
    bookmarkedBy: ["omar", "claire_dubois"],
    comments: [
      {
        authorUsername: "claire_dubois",
        createdHoursAgo: 88,
        content:
          "Recovering condenser heat from `Zone_Server_DataHall` into the geothermal heat pump loop during winter cuts the borefield extraction imbalance from 38% down to 4% annually!",
        likedBy: ["mateo_silva", "omar"],
        replies: [
          {
            authorUsername: "mateo_silva",
            createdHoursAgo: 86,
            content:
              "Yes! Without data-hall heat recovery, the 32-borehole field would drift down by 3.1 °C over 15 years; with heat injection it stays thermally balanced at 12.4 °C mean fluid temperature and maintains an annualized COP of 4.85.",
            likedBy: ["claire_dubois", "omar"],
          },
        ],
      },
    ],
  },
];
