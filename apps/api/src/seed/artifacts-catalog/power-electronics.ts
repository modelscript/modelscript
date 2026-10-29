// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SeedPostSpec } from "../types.js";

export const POWER_ELECTRONICS_POSTS: SeedPostSpec[] = [
  // 8. pscad
  {
    languageId: "pscad",
    author: "marcus_chen",
    title: "BESS_250MW_GridForming_IEEE2800 — PSCAD EMT Fault Ride-Through Study",
    filename: "BESS_250MW_GridForming_IEEE2800.pscx",
    viewType: "pscad",
    hoursAgo: 3,
    postContent:
      "Completed the PSCAD EMT verification (`BESS_250MW_GridForming_IEEE2800.pscx`) for our 250 MW / 1 GWh Grid-Forming Battery Energy Storage System interconnecting at 230 kV (SCR = 1.85). Tested symmetrical 3LG and asymmetrical 1LG bolted faults at the POI per IEEE 2800-2022 Clause 7.2: negative-sequence reactive current injection reaches 90% response in 11.4 ms with zero PLL loss-of-synchronism. #pscad #ieee2800 #emt #gridforming #ibr #powergrids",
    code: `<project name="BESS_250MW_GridForming_IEEE2800" version="5.0.2">
  <settings time_step="10.0" finish_time="2.0" sample_step="50.0"/>
  <definitions>
    <definition name="Main" version="5.0">
      <schematic>
        <User id="u1" name="master:source_3" x="126" y="180">
          <param name="Name" value="Grid230kV_Thevenin"/>
          <param name="Vm" value="230.0 [kV]"/>
          <param name="F0" value="60.0 [Hz]"/>
        </User>
        <User id="u2" name="master:tline" x="252" y="180">
          <param name="Name" value="TieLine_230kV_42km"/>
          <param name="Length" value="42.0 [km]"/>
        </User>
        <User id="u3" name="master:tpflt" x="360" y="216">
          <param name="Name" value="POI_Bolted_Fault"/>
          <param name="TF" value="0.50 [s]"/>
          <param name="DF" value="0.15 [s]"/>
        </User>
        <User id="u4" name="master:breaker3" x="432" y="180">
          <param name="Name" value="POI_230kV_Breaker"/>
        </User>
        <User id="u5" name="master:xfmr-3p2w" x="558" y="180">
          <param name="Name" value="GSU_230_34p5kV_280MVA"/>
          <param name="Tmva" value="280.0 [MVA]"/>
          <param name="Xl" value="0.105 [pu]"/>
        </User>
        <User id="u6" name="master:rlc" x="684" y="180">
          <param name="Name" value="LCL_Harmonic_Filter"/>
          <param name="L" value="0.45 [mH]"/>
          <param name="C" value="185.0 [uF]"/>
        </User>
        <User id="u7" name="master:inverter_fmu" x="810" y="180">
          <param name="Name" value="GFM_BESS_250MW_VSC"/>
          <param name="H_virt" value="4.5 [s]"/>
          <param name="D_droop" value="20.0 [pu]"/>
        </User>
        <Wire id="w1" x="162" y="180" x2="216" y2="180"/>
        <Wire id="w2" x="288" y="180" x2="414" y2="180"/>
        <Wire id="w3" x="360" y="180" x2="360" y2="198"/>
        <Wire id="w4" x="450" y="180" x2="504" y2="180"/>
        <Wire id="w5" x="594" y="180" x2="666" y2="180"/>
        <Wire id="w6" x="702" y="180" x2="790" y2="180"/>
      </schematic>
    </definition>
  </definitions>
</project>`,
    extraViewConfig: {
      projectTitle: "BESS_250MW_GridForming_IEEE2800",
      definitionName: "Main",
      timeStepUs: 10,
      ieee2800Compliant: true,
      standalone: true,
      netlist: {
        buses: [
          { id: "BUS_POI_230", name: "POI_230kV", kv: 230 },
          { id: "BUS_MV_34P5", name: "Collector_34p5kV", kv: 34.5 },
          { id: "BUS_INV_1P5", name: "VSC_Terminal_1p5kV", kv: 1.5 },
        ],
        components: [
          { id: "u1", definition: "master:source_3", name: "Grid230kV_Thevenin" },
          { id: "u2", definition: "master:tline", name: "TieLine_230kV_42km" },
          { id: "u3", definition: "master:tpflt", name: "POI_Bolted_Fault" },
          { id: "u5", definition: "master:xfmr-3p2w", name: "GSU_230_34p5kV_280MVA" },
          { id: "u6", definition: "master:rlc", name: "LCL_Harmonic_Filter" },
          { id: "u7", definition: "master:inverter_fmu", name: "GFM_BESS_250MW_VSC" },
        ],
        transformers: [{ id: "GSU_230_34p5kV_280MVA", mva: 280 }],
        branches: [{ from: "Grid230kV_Thevenin", to: "POI_230kV", lengthKm: 42 }],
        generators: [{ id: "GFM_BESS_250MW_VSC", mw: 250 }],
      },
    },
    comments: [
      {
        author: "sarah_lin",
        content:
          "Did you check the passivity of the LCL filter + virtual admittance inner loop above 850 Hz? At SCR = 1.85, series line capacitance can sometimes excite sub-synchronous or harmonic resonance.",
        replies: [
          {
            author: "marcus_chen",
            content:
              "Great catch Sarah—we ran a frequency-scan impedance sweep from 5 Hz to 2.5 kHz and added active RC virtual damping across the 185 µF filter capacitor, keeping real(Y(jω)) strictly positive.",
          },
        ],
      },
      {
        author: "astrid_solberg",
        content:
          "We are using this exact virtual synchronous machine (H = 4.5s) parametrization for the onshore collector station of our floating offshore wind array!",
      },
    ],
    likedBy: ["omar", "sarah_lin", "astrid_solberg", "elena_vance", "alex_rivera", "nadia_almansoor", "bob"],
    repostedBy: ["omar", "astrid_solberg"],
    bookmarkedBy: ["omar", "sarah_lin", "astrid_solberg"],
  },

  // 9. psse
  {
    languageId: "psse",
    author: "marcus_chen",
    title: "WECC_230kV_RenewableHub_6Bus — PSS®E v35 Power Flow & N-1 Contingency Case",
    filename: "WECC_230kV_RenewableHub_6Bus.raw",
    viewType: "psse",
    hoursAgo: 11,
    postContent:
      "Uploaded the PSS®E v35 power flow case (`WECC_230kV_RenewableHub_6Bus.raw`) for our 230/500 kV renewable collector hub with 850 MW of offshore wind + solar IBR generation and synchronous condenser voltage support. Converges in 4 Newton-Raphson iterations with 1.42% transmission loss and passes all N-1 single-circuit 500 kV corridor contingencies. #psse #powerflow #transmission #grid #n1contingency",
    code: `0, 100.00, 33, 0, 1, 60.00     / PSS(R)E-33.5 WECC 230/500kV RENEWABLE COLLECTOR HUB
WECC 500/230KV RENEWABLE HUB - HIGH IBR DISPATCH CASE
850 MW WIND+SOLAR + 150 MVAR SYNCHRONOUS CONDENSER
     1,'SLACK_500KV ', 500.0000,3,   1,   1,   1,1.03500,   0.0000,1.10000,0.90000,1.05000,0.95000
     2,'NORTH_230KV ', 230.0000,2,   1,   1,   1,1.02200,   4.8500,1.10000,0.90000,1.05000,0.95000
     3,'WIND_HUB_230', 230.0000,2,   1,   1,   1,1.02800,   7.4200,1.10000,0.90000,1.05000,0.95000
     4,'SOLAR_230KV ', 230.0000,2,   1,   1,   1,1.01800,   5.9000,1.10000,0.90000,1.05000,0.95000
     5,'METRO_LOAD_1', 230.0000,1,   1,   1,   1,0.99400,  -3.6500,1.10000,0.90000,1.05000,0.95000
     6,'IND_PARK_230', 230.0000,1,   1,   1,   1,0.98900,  -4.9200,1.10000,0.90000,1.05000,0.95000
0 / END OF BUS DATA, BEGIN LOAD DATA
     5,'1 ',1,   1,   1,   420.000,   115.000,     0.000,     0.000,     0.000,     0.000,   1,1,0
     6,'1 ',1,   1,   1,   385.000,    95.000,     0.000,     0.000,     0.000,     0.000,   1,1,0
0 / END OF LOAD DATA, BEGIN FIXED SHUNT DATA
     5,'1 ',1,     0.000,    65.000
0 / END OF FIXED SHUNT DATA, BEGIN GENERATOR DATA
     1,'G1',   125.400,    48.200,   300.000,  -150.000,1.03500,     0,   500.000, 0.00000E+0, 1.85000E-1, 0.00000E+0, 0.00000E+0,1.00000,1,  100.0,   600.000,    50.000,   1,1.0000
     2,'SC',     0.000,    62.500,   150.000,   -75.000,1.02200,     0,   160.000, 0.00000E+0, 1.40000E-1, 0.00000E+0, 0.00000E+0,1.00000,1,  100.0,     0.000,     0.000,   1,1.0000
     3,'W1',   450.000,    55.000,   180.000,  -140.000,1.02800,     0,   500.000, 0.00000E+0, 2.10000E-1, 0.00000E+0, 0.00000E+0,1.00000,1,  100.0,   500.000,     0.000,   1,1.0000
     4,'S1',   245.000,    32.000,   120.000,  -100.000,1.01800,     0,   280.000, 0.00000E+0, 2.20000E-1, 0.00000E+0, 0.00000E+0,1.00000,1,  100.0,   260.000,     0.000,   1,1.0000
0 / END OF GENERATOR DATA, BEGIN BRANCH DATA
     2,     3,'1 ', 0.002800, 0.029500, 0.084000,   450.00,   500.00,   550.00, 0.00000, 0.00000, 0.00000, 0.00000,1,1,   38.00,   1,1.0000
     2,     5,'1 ', 0.004200, 0.044000, 0.112000,   450.00,   500.00,   550.00, 0.00000, 0.00000, 0.00000, 0.00000,1,1,   54.00,   1,1.0000
     3,     4,'1 ', 0.003100, 0.032000, 0.088000,   450.00,   500.00,   550.00, 0.00000, 0.00000, 0.00000, 0.00000,1,1,   41.00,   1,1.0000
     3,     6,'1 ', 0.004900, 0.051000, 0.128000,   450.00,   500.00,   550.00, 0.00000, 0.00000, 0.00000, 0.00000,1,1,   62.00,   1,1.0000
     4,     6,'1 ', 0.003600, 0.038500, 0.095000,   450.00,   500.00,   550.00, 0.00000, 0.00000, 0.00000, 0.00000,1,1,   46.00,   1,1.0000
     5,     6,'1 ', 0.002200, 0.023000, 0.064000,   450.00,   500.00,   550.00, 0.00000, 0.00000, 0.00000, 0.00000,1,1,   28.00,   1,1.0000
0 / END OF BRANCH DATA, BEGIN TRANSFORMER DATA
     1,     2,     0,'1 ',1,1,1, 0.000000E+0, 0.000000E+0,2,'500_230_AUT1',1,   1,1.0000
 0.001200, 0.068000,   600.00
1.00000, 500.000,   0.000,   600.00,   650.00,   720.00, 0,      0, 1.10000, 0.90000, 1.05000, 0.95000,  33, 0, 0.00000, 0.00000
1.00000, 230.000
0 / END OF TRANSFORMER DATA
Q`,
    extraViewConfig: {
      standalone: true,
    },
    comments: [
      {
        author: "omar",
        content:
          "Exporting this `.raw` case directly into PSCAD and Modelica from the one-line diagram viewer makes hybrid RMS-to-EMT co-simulation studies effortless.",
      },
    ],
    likedBy: ["omar", "astrid_solberg", "sarah_lin", "nadia_almansoor", "bob"],
  },

  // 10. opendss
  {
    languageId: "opendss",
    author: "marcus_chen",
    title: "IEEE13_HighPV_EV_Feeder — OpenDSS Unbalanced 12.47 kV Distribution Circuit",
    filename: "IEEE13_HighPV_EV_Feeder.dss",
    viewType: "opendss",
    hoursAgo: 14,
    postContent:
      "Shared our EPRI OpenDSS deck (`IEEE13_HighPV_EV_Feeder.dss`) modeling a 12.47 kV unbalanced distribution feeder with 145% daytime rooftop PV backfeed, IEEE 1547-2018 Category B Volt-VAr smart inverters, and a 1.5 MW DC fast-charging plaza. Keeps ANSI C84.1 Range A voltages within [0.972, 1.038] pu across all 3 phases. #opendss #distributiongrid #der #ieee1547 #smartgrid",
    code: `! EPRI OpenDSS — 12.47 kV Unbalanced Feeder with High PV & EV Fast-Charging
Clear
New Circuit.IEEE13_HighPV_EV BasekV=115.0 pu=1.02 phases=3 bus1=SourceBus MVAsc3=2100 MVAsc1=1850

New Transformer.SubXFMR Phases=3 Windings=2 XHL=8.5
~ wdg=1 bus=SourceBus conn=Delta kV=115.0 kVA=10000
~ wdg=2 bus=Bus650 conn=Wye kV=12.47 kVA=10000

New LineCode.336_ACSR nphases=3 r1=0.1902 x1=0.3956 r0=0.5860 x0=1.2140 units=km

New Line.L650_632 Phases=3 Bus1=Bus650.1.2.3 Bus2=Bus632.1.2.3 LineCode=336_ACSR Length=1.85 units=km
New Line.L632_671 Phases=3 Bus1=Bus632.1.2.3 Bus2=Bus671.1.2.3 LineCode=336_ACSR Length=2.10 units=km
New Line.L671_680 Phases=3 Bus1=Bus671.1.2.3 Bus2=Bus680.1.2.3 LineCode=336_ACSR Length=1.40 units=km
New Line.L671_634 Phases=3 Bus1=Bus671.1.2.3 Bus2=Bus634.1.2.3 LineCode=336_ACSR Length=0.95 units=km

New Load.Industrial_671 Bus1=Bus671.1.2.3 Phases=3 Conn=Wye Model=1 kV=12.47 kW=1450 kvar=480
New Load.EV_Plaza_634 Bus1=Bus634.1.2.3 Phases=3 Conn=Wye Model=1 kV=12.47 kW=1500 kvar=180
New Load.Commercial_632 Bus1=Bus632.1.2.3 Phases=3 Conn=Wye Model=1 kV=12.47 kW=820 kvar=290

New PVSystem.SolarFarm_680 phases=3 bus1=Bus680 kV=12.47 kVA=3200 Pmpp=2950 irradiance=0.98
New Storage.FeederBESS_671 phases=3 bus1=Bus671 kV=12.47 kWrated=1200 kWhrated=4800 %stored=78
New Capacitor.CapBank_671 Bus1=Bus671 phases=3 kVAR=600 kV=12.47

Set VoltageBases=[115.0, 12.47]
CalcVoltageBases
Solve`,
    extraViewConfig: {
      dialect: "opendss",
      standalone: true,
    },
    comments: [
      {
        author: "mateo_silva",
        content:
          "We paired this exact feeder topology with our municipal water pumping station schedule in EPANET to shift 850 kW of pump load into the peak solar window.",
      },
    ],
    likedBy: ["omar", "mateo_silva", "sarah_lin", "astrid_solberg", "alex_rivera"],
  },

  // 11. spice
  {
    languageId: "spice",
    author: "sarah_lin",
    title: "FoldedCascodeOpAmp_65nm — Low-Noise CMOS Differential Operational Amplifier",
    filename: "FoldedCascodeOpAmp_65nm.cir",
    viewType: "spice",
    hoursAgo: 6,
    postContent:
      "Posted the transistor-level SPICE netlist (`FoldedCascodeOpAmp_65nm.cir`) for our 1.8V 65nm CMOS folded-cascode operational amplifier with Miller RC nulling compensation. Achieves 84.6 dB DC open-loop gain, 162 MHz unity-gain bandwidth (GBW), and 68.4° phase margin driving a 5 pF capacitive load. #spice #cmos #analogic #opamp #microelectronics",
    code: `* 1.8V 65nm CMOS Folded-Cascode Operational Amplifier with Miller Nulling
VDD vdd 0 DC 1.8
VSS vss 0 DC 0.0
VINP inp 0 DC 0.9 AC 0.5 SIN(0.9 0.05 1MEG)
VINN inn 0 DC 0.9 AC -0.5

* Input PMOS Differential Pair & Tail Current Source
M1 n_fold_a inp n_tail vdd PMOS_65 W=48u L=180n
M2 n_fold_b inn n_tail vdd PMOS_65 W=48u L=180n
M0 n_tail vbias_p vdd vdd PMOS_65 W=64u L=360n

* Folded-Cascode NMOS & PMOS Current Mirrors
M3 n_fold_a vdd vss vss NMOS_65 W=32u L=240n
M4 n_fold_b vdd vss vss NMOS_65 W=32u L=240n
M5 n_cas_a vcas_n n_fold_a vss NMOS_65 W=32u L=180n
M6 vout_stage1 vcas_n n_fold_b vss NMOS_65 W=32u L=180n

* Second-Stage Common-Source Gain & Miller RC Compensation
M7 vout vout_stage1 vss vss NMOS_65 W=96u L=180n
R_null vout_stage1 n_miller 1.85k
C_comp n_miller vout 1.65p
R_load vout 0 25k
C_load vout 0 5.0p

.MODEL NMOS_65 NMOS (LEVEL=1 VTO=0.42 KP=310u LAMBDA=0.035)
.MODEL PMOS_65 PMOS (LEVEL=1 VTO=-0.40 KP=115u LAMBDA=0.042)
.OP
.AC DEC 20 10 1G
.TRAN 5n 2u
.END`,
    extraViewConfig: {
      dialect: "spice",
      standalone: true,
    },
    comments: [
      {
        author: "alex_rivera",
        content:
          "The 1.85 kΩ nulling resistor `R_null` pushes the right-half-plane zero cleanly into the left-half-plane to cancel the non-dominant output pole—textbook 68.4° phase margin!",
      },
    ],
    likedBy: ["omar", "marcus_chen", "alex_rivera", "elena_vance", "kenji_takahashi"],
    bookmarkedBy: ["omar", "alex_rivera"],
  },

  // 12. verilog-a
  {
    languageId: "verilog-a",
    author: "sarah_lin",
    title: "GaN_HEMT_ASM_Thermal — IEEE 1857 Verilog-A Compact Power Transistor Model",
    filename: "GaN_HEMT_ASM_Thermal.va",
    viewType: "verilog-a",
    hoursAgo: 17,
    postContent:
      "Released our IEEE 1857 Verilog-A compact model (`GaN_HEMT_ASM_Thermal.va`) for 650V Enhancement-Mode GaN-on-Si HEMT power switches. Formulates continuous surface-potential channel current, nonlinear Ward-Dutton gate-drain Miller charge `ddt(Qgd)`, dynamic $R_{\\text{DS(on)}}$ current collapse trapping, and electro-thermal self-heating branch (`tj`). #veriloga #gan #powerelectronics #semiconductor #compactmodeling",
    code: `// IEEE 1857 Verilog-A Compact Model: 650V E-Mode GaN HEMT with Self-Heating
\`include "disciplines.vams"
\`include "constants.vams"

module GaN_HEMT_ASM_Thermal(drain, gate, source, tj);
  inout drain, gate, source, tj;
  electrical drain, gate, source;
  thermal tj;

  parameter real Vth0 = 1.65 from (0.5:3.5);       // Threshold voltage at 300K (V)
  parameter real Kp_sat = 24.8 from (1.0:100.0);   // Transconductance factor (A/V^2)
  parameter real Lambda_clm = 0.018 from (0.0:0.2);// Channel length modulation (1/V)
  parameter real Cgs0 = 420.0e-12;                 // Gate-source capacitance (F)
  parameter real Cgd0 = 85.0e-12;                  // Zero-bias Miller capacitance (F)
  parameter real Rth_jc = 0.48;                    // Junction-to-case thermal resistance (K/W)
  parameter real Cth_j = 3.2e-4;                   // Junction thermal capacitance (J/K)

  real Vgs, Vds, Vgd, Ids, Qgd, Qgs, P_diss, T_rise;

  analog begin
    Vgs = V(gate, source);
    Vds = V(drain, source);
    Vgd = V(gate, drain);
    T_rise = Temp(tj);

    if (Vgs > Vth0) begin
      Ids = Kp_sat * pow(Vgs - Vth0, 1.5) * tanh(1.8 * Vds) * (1.0 + Lambda_clm * Vds) * (1.0 - 0.0022 * T_rise);
    end else begin
      Ids = 1.0e-9 * Vds;
    end

    Qgs = Cgs0 * Vgs;
    Qgd = Cgd0 * Vgd / sqrt(1.0 + abs(Vgd) / 12.0);
    P_diss = abs(Ids * Vds);

    I(drain, source) <+ Ids;
    I(gate, source)  <+ ddt(Qgs);
    I(gate, drain)   <+ ddt(Qgd);
    Pwr(tj)          <+ -P_diss + (T_rise / Rth_jc) + Cth_j * ddt(T_rise);
  end
endmodule`,
    extraViewConfig: {
      dialect: "verilog-a",
      standalone: true,
    },
    comments: [
      {
        author: "lukas_weber",
        content:
          "Coupling the `tj` thermal node from this Verilog-A HEMT model into our 800V traction inverter cold-plate Modelica model gave us sub-kelvin junction temperature accuracy during WLTP drive cycles.",
      },
    ],
    likedBy: ["omar", "lukas_weber", "marcus_chen", "elena_vance", "alex_rivera"],
  },

  // 13. touchstone
  {
    languageId: "touchstone",
    author: "sarah_lin",
    title: "BandpassFilter_28GHz_5G — Touchstone 2-Port mmWave S-Parameter Network",
    filename: "BandpassFilter_28GHz_5G.s2p",
    viewType: "touchstone",
    hoursAgo: 20,
    postContent:
      "Uploaded the measured + EM-verified Touchstone S-parameter network (`BandpassFilter_28GHz_5G.s2p`) for our 28 GHz 5G FR2 Substrate-Integrated Waveguide (SIW) 4th-order Chebyshev bandpass filter. Return loss $|S_{11}| < -18.5\\text{ dB}$ and insertion loss $|S_{21}| = -0.62\\text{ dB}$ across the 27.5–28.35 GHz band, with strict singular-value passivity ($\\sigma_{\\max}(S) \\le 0.998$) across all frequency points. #touchstone #rf #5g #mmwave #sparameters #signalintegrity",
    code: `! 28 GHz 5G NR FR2 Substrate-Integrated Waveguide (SIW) Bandpass Filter
! 2-Port S-Parameters (Magnitude / Angle in Degrees), Z0 = 50 Ohm
# GHZ S MA R 50
! Freq(GHz)   |S11|   Ang(S11)    |S21|   Ang(S21)    |S12|   Ang(S12)    |S22|   Ang(S22)
26.0000      0.9250   -142.40    0.0420    -64.10    0.0420    -64.10    0.9250   -142.40
26.5000      0.8410   -158.20    0.1650    -88.50    0.1650    -88.50    0.8410   -158.20
27.0000      0.5120   -174.60    0.6480   -121.30    0.6480   -121.30    0.5120   -174.60
27.5000      0.1120    148.20    0.9280   -159.40    0.9280   -159.40    0.1120    148.20
27.7500      0.0840     92.10    0.9350    162.80    0.9350    162.80    0.0840     92.10
28.0000      0.0680     14.50    0.9410    124.20    0.9410    124.20    0.0680     14.50
28.2500      0.0950    -68.40    0.9320     85.60    0.9320     85.60    0.0950    -68.40
28.5000      0.1380   -134.90    0.9160     46.10    0.9160     46.10    0.1380   -134.90
29.0000      0.6180    176.20    0.5420      4.80    0.5420      4.80    0.6180    176.20
29.5000      0.8840    159.40    0.1180    -28.90    0.1180    -28.90    0.8840    159.40
30.0000      0.9460    144.10    0.0310    -52.40    0.0310    -52.40    0.9460    144.10`,
    extraViewConfig: {
      dialect: "touchstone",
      standalone: true,
    },
    comments: [
      {
        author: "omar",
        content:
          "Vector-fitting this `.s2p` directly into a state-space rational macromodel for time-domain transient co-simulation in ModelScript runs in < 4 ms with zero passivity violations!",
      },
    ],
    likedBy: ["omar", "marcus_chen", "alex_rivera", "sofia_rossi", "david_kowalski"],
  },

  // 14. ibis
  {
    languageId: "ibis",
    author: "sarah_lin",
    title: "DDR5_6400_DQ_Transceiver — ANSI/EIA-656-B High-Speed I/O Buffer Model",
    filename: "DDR5_6400_DQ_Transceiver.ibs",
    viewType: "ibis",
    hoursAgo: 23,
    postContent:
      "Shared the IBIS behavioral I/O buffer model (`DDR5_6400_DQ_Transceiver.ibs`) for our DDR5-6400 DQ/DQS 1.1V PODL (Pseudo Open-Drain Logic) transceiver with 40 Ω calibrated on-die termination (ODT) and flip-chip BGA package RLC parasitics. Verified V-I pullup/pulldown monotonicity and V-T rising/falling edge crossover symmetry. #ibis #ddr5 #signalintegrity #serdes #highspeedpcb",
    code: `|=============================================================================
| ANSI/EIA-656-B IBIS Behavioral Model — DDR5-6400 1.1V PODL DQ/DQS Transceiver
|=============================================================================
[IBIS Ver]      3.2
[File Name]     ddr5_6400_dq.ibs
[File Rev]      1.4
[Date]          2026-10-28
[Source]        ModelScript High-Speed Signal Integrity Group

[Component]     DDR5_6400_SDRAM_x8
[Manufacturer]  ModelScript Silicon Labs
[Package]
| variable      typ             min             max
R_pkg           42.0m           34.0m           52.0m
L_pkg           0.68nH          0.52nH          0.86nH
C_pkg           0.38pF          0.31pF          0.46pF

[Pin]   signal_name     model_name              R_pin   L_pin   C_pin
A1      DQ0             DDR5_PODL_40_IO         40.0m   0.64nH  0.36pF
A2      DQ1             DDR5_PODL_40_IO         41.0m   0.66nH  0.37pF
B1      DQS_P           DDR5_PODL_40_IO         38.0m   0.61nH  0.35pF
B2      DQS_N           DDR5_PODL_40_IO         38.0m   0.61nH  0.35pF
C1      VDDQ            POWER                   NA      NA      NA
C2      VSS             GND                     NA      NA      NA

[Model]         DDR5_PODL_40_IO
Model_type      I/O
Polarity        Non-Inverting
Enable          Active-High
Vinl = 0.38V
Vinh = 0.72V
Vmeas = 0.55V
C_comp          0.62pF          0.54pF          0.72pF
[Voltage Range] 1.10V           1.045V          1.155V

[Pulldown]
| Voltage       I(typ)          I(min)          I(max)
  0.00V         0.00mA          0.00mA          0.00mA
  0.25V         6.15mA          5.40mA          6.95mA
  0.55V         13.60mA         12.10mA         15.20mA
  0.85V         20.40mA         18.20mA         22.80mA
  1.10V         25.80mA         23.00mA         28.90mA

[Pullup]
| Voltage       I(typ)          I(min)          I(max)
  0.00V         0.00mA          0.00mA          0.00mA
  0.25V        -6.20mA         -5.45mA         -7.00mA
  0.55V        -13.75mA        -12.20mA        -15.35mA
  0.85V        -20.90mA        -18.60mA        -23.40mA
  1.10V        -27.20mA        -24.20mA        -30.50mA

[Ramp]
dV/dt_r         0.66V/0.075ns   0.62V/0.092ns   0.70V/0.061ns
dV/dt_f         0.66V/0.072ns   0.62V/0.088ns   0.70V/0.058ns
[End]`,
    extraViewConfig: {
      dialect: "ibis",
      standalone: true,
    },
    comments: [
      {
        author: "kenji_takahashi",
        content:
          "Used this `DDR5_6400_SDRAM_x8` IBIS model to validate the memory bus eye diagram on our autonomous driving SoC carrier board—eye height stayed above 195 mV at 6.4 Gbps.",
      },
    ],
    likedBy: ["omar", "kenji_takahashi", "alex_rivera", "marcus_chen"],
  },
];
