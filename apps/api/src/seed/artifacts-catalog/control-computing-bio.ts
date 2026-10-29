// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SeedPostSpec } from "../types.js";

export const CONTROL_COMPUTING_BIO_POSTS: SeedPostSpec[] = [
  // 39. SIMULINK (.mdl)
  {
    id: "seed-post-simulink",
    language: "simulink",
    viewType: "simulink",
    title: "CAT-IIIb Triple-Redundant Autoland Flare & Crosswind Decrab Flight Control Law — Simulink MDL",
    filename: "CAT3b_Autoland_Flare_Decrab.mdl",
    authorUsername: "alex_rivera",
    createdHoursAgo: 14,
    postContent:
      "Published our Simulink control block diagram (`.mdl`) for a CS-25 / FAR-25 CAT-IIIb automatic landing flare and crosswind decrab control law. Combines dual-radio-altimeter vertical sink-rate blending ($h_{\\text{flare}} = 50\\text{ ft}$), pitch-attitude inner-loop lead-lag compensation, elevator servo actuator dynamics, and rudder decrab aligner.",
    code: `Model {
  Name "CAT3b_Autoland_Flare_And_Decrab_Control"
  System {
    Name "CAT3b_Autoland_Flare_And_Decrab_Control"

    Block {
      BlockType Inport
      Name "RadarAlt_Ft"
      SID "1"
      Ports "[0, 1]"
    }
    Block {
      BlockType Constant
      Name "TargetSinkRate_Fps"
      SID "2"
      Value "-2.2"
      Ports "[0, 1]"
    }
    Block {
      BlockType Gain
      Name "FlareExponentialLaw_Kh"
      SID "3"
      Gain "-0.125"
      Ports "[1, 1]"
    }
    Block {
      BlockType Sum
      Name "SinkRateError_Sum"
      SID "4"
      Inputs "+-"
      Ports "[2, 1]"
    }
    Block {
      BlockType TransferFcn
      Name "PitchCommand_LeadLag"
      SID "5"
      Numerator "[1.85 0.92]"
      Denominator "[0.12 1.0]"
      Ports "[1, 1]"
    }
    Block {
      BlockType TransferFcn
      Name "Elevator_ElectroHydro_Servo"
      SID "6"
      Numerator "[28.0]"
      Denominator "[1.0 28.0]"
      Ports "[1, 1]"
    }
    Block {
      BlockType Integrator
      Name "VerticalTouchdown_Trajectory"
      SID "7"
      InitialCondition "50.0"
      Ports "[1, 1]"
    }
    Block {
      BlockType Outport
      Name "ElevatorCmd_Deg"
      SID "8"
      Ports "[1, 0]"
    }
    Block {
      BlockType Outport
      Name "TouchdownSink_Out"
      SID "9"
      Ports "[1, 0]"
    }

    Line {
      SrcBlock "RadarAlt_Ft"
      SrcPort 1
      DstBlock "FlareExponentialLaw_Kh"
      DstPort 1
    }
    Line {
      SrcBlock "TargetSinkRate_Fps"
      SrcPort 1
      DstBlock "SinkRateError_Sum"
      DstPort 1
    }
    Line {
      SrcBlock "FlareExponentialLaw_Kh"
      SrcPort 1
      DstBlock "SinkRateError_Sum"
      DstPort 2
    }
    Line {
      SrcBlock "SinkRateError_Sum"
      SrcPort 1
      DstBlock "PitchCommand_LeadLag"
      DstPort 1
    }
    Line {
      SrcBlock "PitchCommand_LeadLag"
      SrcPort 1
      DstBlock "Elevator_ElectroHydro_Servo"
      DstPort 1
    }
    Line {
      SrcBlock "Elevator_ElectroHydro_Servo"
      SrcPort 1
      DstBlock "ElevatorCmd_Deg"
      DstPort 1
    }
    Line {
      SrcBlock "Elevator_ElectroHydro_Servo"
      SrcPort 1
      DstBlock "VerticalTouchdown_Trajectory"
      DstPort 1
    }
    Line {
      SrcBlock "VerticalTouchdown_Trajectory"
      SrcPort 1
      DstBlock "TouchdownSink_Out"
      DstPort 1
    }
  }
}
`,
    likedBy: ["omar", "claire_dubois", "sofia_rossi", "elena_vance", "kenji_takahashi"],
    repostedBy: ["claire_dubois", "sofia_rossi"],
    bookmarkedBy: ["omar", "claire_dubois"],
    comments: [
      {
        authorUsername: "sofia_rossi",
        createdHoursAgo: 12,
        content:
          "How does the touchdowns dispersion look across the 1,000-run Monte Carlo wind-shear ensemble required by AC 120-28D?",
        likedBy: ["alex_rivera", "claire_dubois"],
        replies: [
          {
            authorUsername: "alex_rivera",
            createdHoursAgo: 11,
            content:
              "2-sigma longitudinal touchdown dispersion stays within $\\pm 215\\text{ ft}$ of the 1,000-ft aiming point with mean touchdown sink rate at $-2.18\\text{ ft/s}$ and zero tailstrike occurrences at 35 kt crosswind.",
            likedBy: ["sofia_rossi", "claire_dubois", "omar"],
          },
        ],
      },
    ],
  },

  // 40. PLCOPEN (.plcopen)
  {
    id: "seed-post-plcopen",
    language: "plcopen",
    viewType: "plcopen",
    title: "High-Speed Robotic Battery Module Laser-Welding Cell & Safety Interlock — IEC 61131-3 PLCopen XML",
    filename: "BatteryModule_LaserWeld_SafetyController.plcopen",
    authorUsername: "alex_rivera",
    createdHoursAgo: 10,
    postContent:
      "Uploaded our IEC 61131-3 PLCopen TC6 XML industrial automation program (`.plcopen`) for an 800V automotive battery module busbar fiber-laser welding cell. Implements deterministic 1 ms Structured Text (`ST`) seam-tracking state machines, shielding gas flow supervision, and SIL-3 Dual-Channel Emergency Stop (`E-Stop`) light-curtain interlocks.",
    code: `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://www.plcopen.org/xml/tc6_0201">
  <fileHeader companyName="ModelScript Industrial Automation" productName="IEC 61131-3 Compiler" productVersion="2026.1" creationDateTime="2026-03-19T12:00:00Z" />
  <contentHeader name="BatteryModule_LaserWeld_SIL3_CellController" modificationDateTime="2026-03-19T12:00:00Z">
    <coordinateInfo>
      <fbd><scaling x="1" y="1" /></fbd>
      <ld><scaling x="1" y="1" /></ld>
      <sfc><scaling x="1" y="1" /></sfc>
    </coordinateInfo>
  </contentHeader>

  <types>
    <dataTypes />
    <pous>
      <pou name="PRG_LaserBusbarWeldCell" pouType="program">
        <interface>
          <inputVars>
            <variable name="bLightCurtainChA"><type><BOOL /></type></variable>
            <variable name="bLightCurtainChB"><type><BOOL /></type></variable>
            <variable name="bEStopResetPulse"><type><BOOL /></type></variable>
            <variable name="rArgonFlowLpm"><type><REAL /></type></variable>
            <variable name="rCellTempDegC"><type><REAL /></type></variable>
            <variable name="bPartClamped"><type><BOOL /></type></variable>
          </inputVars>
          <outputVars>
            <variable name="bSafetyRelayEnable"><type><BOOL /></type></variable>
            <variable name="bLaserEmissionGate"><type><BOOL /></type></variable>
            <variable name="rLaserPowerCmdWatts"><type><REAL /></type></variable>
            <variable name="iWeldStateCode"><type><INT /></type></variable>
          </outputVars>
        </interface>
        <body>
          <ST>
            <xhtml xmlns="http://www.w3.org/1999/xhtml">
(* SIL-3 Dual-Channel Safety Interlock &amp; Process Permissives *)
bSafetyRelayEnable := bLightCurtainChA AND bLightCurtainChB AND (rCellTempDegC &lt; 55.0);

IF NOT bSafetyRelayEnable THEN
  bLaserEmissionGate  := FALSE;
  rLaserPowerCmdWatts := 0.0;
  iWeldStateCode      := -1;
ELSIF bPartClamped AND (rArgonFlowLpm &gt;= 18.5) THEN
  bLaserEmissionGate  := TRUE;
  rLaserPowerCmdWatts := 3650.0;
  iWeldStateCode      := 20;
ELSE
  bLaserEmissionGate  := FALSE;
  rLaserPowerCmdWatts := 0.0;
  iWeldStateCode      := 10;
END_IF;
            </xhtml>
          </ST>
        </body>
      </pou>
    </pous>
  </types>
</project>
`,
    likedBy: ["omar", "claire_dubois", "kenji_takahashi", "marcus_chen", "lukas_weber"],
    repostedBy: ["kenji_takahashi"],
    bookmarkedBy: ["omar", "claire_dubois"],
    comments: [
      {
        authorUsername: "claire_dubois",
        createdHoursAgo: 8,
        content:
          "Verified the Structured Text POU with `@modelscript/plcopen` formal model checking: `bLaserEmissionGate` is provably unreachable whenever `bLightCurtainChA != bLightCurtainChB` or `rArgonFlowLpm < 18.5`.",
        likedBy: ["alex_rivera", "omar"],
      },
    ],
  },

  // 41. C (.c)
  {
    id: "seed-post-c",
    language: "c",
    viewType: "c",
    title: "MISRA-C:2023 Fixed-Horizon PMSM Field-Oriented Control (FOC) & Space-Vector PWM ISR Kernel",
    filename: "PMSM_FOC_SVPWM_Kernel.c",
    authorUsername: "alex_rivera",
    createdHoursAgo: 7,
    postContent:
      "Shared our zero-heap, deterministic MISRA-C:2023 embedded firmware kernel (`.c`) executing 40 kHz Clarke/Park transformations, decoupled $i_d/i_q$ PI current regulators with back-calculation anti-windup, maximum-torque-per-ampere (`MTPA`) trajectory generation, and 7-segment symmetric Space-Vector PWM (`SVPWM`) duty synthesis.",
    code: `// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * @file PMSM_FOC_SVPWM_Kernel.c
 * @brief Deterministic 40 kHz PMSM Field-Oriented Control & SVPWM ISR Kernel (MISRA-C:2023).
 */

#include <stdint.h>
#include <math.h>

typedef struct {
  float kp_d;
  float ki_d;
  float kp_q;
  float ki_q;
  float ld_henries;
  float lq_henries;
  float psi_m_weber;
  float dt_sec;
  float v_dc_bus;
  float int_d;
  float int_q;
} FocControllerState;

typedef struct {
  float duty_u;
  float duty_v;
  float duty_w;
  uint8_t sector;
} SvpwmDutyOutput;

void ClarkeParkTransform(
    float i_a,
    float i_b,
    float theta_elec_rad,
    float *out_id,
    float *out_iq) {
  const float inv_sqrt3 = 0.57735026919f;
  const float i_alpha = i_a;
  const float i_beta  = (i_a + (2.0f * i_b)) * inv_sqrt3;
  const float cos_t   = cosf(theta_elec_rad);
  const float sin_t   = sinf(theta_elec_rad);

  *out_id = ( i_alpha * cos_t) + (i_beta * sin_t);
  *out_iq = (-i_alpha * sin_t) + (i_beta * cos_t);
}

SvpwmDutyOutput ExecuteFocIsrStep(
    FocControllerState *state,
    float id_ref,
    float iq_ref,
    float i_a,
    float i_b,
    float theta_elec_rad,
    float omega_elec_rads) {
  float id_meas = 0.0f;
  float iq_meas = 0.0f;
  ClarkeParkTransform(i_a, i_b, theta_elec_rad, &id_meas, &iq_meas);

  const float err_d = id_ref - id_meas;
  const float err_q = iq_ref - iq_meas;

  state->int_d += state->ki_d * err_d * state->dt_sec;
  state->int_q += state->ki_q * err_q * state->dt_sec;

  // Cross-coupling EMF feedforward decoupling
  const float v_d = (state->kp_d * err_d) + state->int_d
                  - (omega_elec_rads * state->lq_henries * iq_meas);
  const float v_q = (state->kp_q * err_q) + state->int_q
                  + (omega_elec_rads * ((state->ld_henries * id_meas) + state->psi_m_weber));

  // Inverse Park transform (d,q -> alpha,beta)
  const float cos_t = cosf(theta_elec_rad);
  const float sin_t = sinf(theta_elec_rad);
  const float v_alpha = (v_d * cos_t) - (v_q * sin_t);
  const float v_beta  = (v_d * sin_t) + (v_q * cos_t);

  // Inverse Clarke & Min-Max Zero-Sequence Third-Harmonic Injection SVPWM
  const float sqrt3_half = 0.86602540378f;
  const float v_u = v_alpha;
  const float v_v = (-0.5f * v_alpha) + (sqrt3_half * v_beta);
  const float v_w = (-0.5f * v_alpha) - (sqrt3_half * v_beta);

  const float v_max = fmaxf(v_u, fmaxf(v_v, v_w));
  const float v_min = fminf(v_u, fminf(v_v, v_w));
  const float v_offset = -0.5f * (v_max + v_min);
  const float inv_vdc = 1.0f / fmaxf(state->v_dc_bus, 10.0f);

  SvpwmDutyOutput out;
  out.duty_u = 0.5f + ((v_u + v_offset) * inv_vdc);
  out.duty_v = 0.5f + ((v_v + v_offset) * inv_vdc);
  out.duty_w = 0.5f + ((v_w + v_offset) * inv_vdc);
  out.sector = (v_beta >= 0.0f) ? 1U : 4U;
  return out;
}
`,
    likedBy: ["omar", "marcus_chen", "claire_dubois", "sarah_lin", "elena_vance"],
    repostedBy: ["marcus_chen"],
    bookmarkedBy: ["omar", "marcus_chen", "claire_dubois"],
    comments: [
      {
        authorUsername: "marcus_chen",
        createdHoursAgo: 5,
        content:
          "Min-max zero-sequence injection (`v_offset = -0.5f * (v_max + v_min)`) extends the linear modulation range by $15.47\\%$ ($2/\\sqrt{3}$) without a single `atan2f` or sector lookup table branch in the 25 µs ISR!",
        likedBy: ["alex_rivera", "claire_dubois", "omar"],
      },
    ],
  },

  // 42. FORTRAN (.f90)
  {
    id: "seed-post-fortran",
    language: "fortran",
    viewType: "fortran",
    title: "High-Order HLLC Riemann Solver & TVD MUSCL Reconstruction Kernel — Modern Fortran 2018",
    filename: "Compressible_HLLC_Riemann_Solver.f90",
    authorUsername: "alex_rivera",
    createdHoursAgo: 4,
    postContent:
      "Published our SIMD-vectorizable Modern Fortran 2018 (`pure subroutine`) fluid dynamics kernel (`.f90`) implementing Toro's 3-wave HLLC approximate Riemann solver with van Leer MUSCL slope limiting for 1D/3D compressible Euler and reactive detonation shock-tube simulations.",
    code: `! =====================================================================
! MODERN FORTRAN 2018 HLLC RIEMANN SOLVER & MUSCL RECONSTRUCTION (.F90)
! =====================================================================

module mod_compressible_hllc_riemann
  use, intrinsic :: iso_fortran_env, only: dp => real64
  implicit none
  private
  public :: hllc_flux_1d, van_leer_limiter

  real(dp), parameter :: GAMMA_GAS = 1.4_dp

contains

  pure elemental function van_leer_limiter(r_ratio) result(phi)
    real(dp), intent(in) :: r_ratio
    real(dp) :: phi
    if (r_ratio <= 0.0_dp) then
      phi = 0.0_dp
    else
      phi = (r_ratio + abs(r_ratio)) / (1.0_dp + abs(r_ratio))
    end if
  end function van_leer_limiter

  pure subroutine hllc_flux_1d( &
      rho_l, u_l, p_l, &
      rho_r, u_r, p_r, &
      flux_mass, flux_mom, flux_energy)
    real(dp), intent(in)  :: rho_l, u_l, p_l
    real(dp), intent(in)  :: rho_r, u_r, p_r
    real(dp), intent(out) :: flux_mass, flux_mom, flux_energy

    real(dp) :: a_l, a_r, e_l, e_r, h_l, h_r
    real(dp) :: sqrt_rho_l, sqrt_rho_r, u_roe, h_roe, a_roe
    real(dp) :: s_l, s_r, s_star, factor_l, factor_r

    a_l = sqrt(GAMMA_GAS * p_l / rho_l)
    a_r = sqrt(GAMMA_GAS * p_r / rho_r)

    e_l = (p_l / (GAMMA_GAS - 1.0_dp)) + (0.5_dp * rho_l * u_l * u_l)
    e_r = (p_r / (GAMMA_GAS - 1.0_dp)) + (0.5_dp * rho_r * u_r * u_r)
    h_l = (e_l + p_l) / rho_l
    h_r = (e_r + p_r) / rho_r

    ! Roe-averaged wave speed bounds (Davis-Einfeldt estimates)
    sqrt_rho_l = sqrt(rho_l)
    sqrt_rho_r = sqrt(rho_r)
    u_roe = ((sqrt_rho_l * u_l) + (sqrt_rho_r * u_r)) / (sqrt_rho_l + sqrt_rho_r)
    h_roe = ((sqrt_rho_l * h_l) + (sqrt_rho_r * h_r)) / (sqrt_rho_l + sqrt_rho_r)
    a_roe = sqrt(max((GAMMA_GAS - 1.0_dp) * (h_roe - (0.5_dp * u_roe * u_roe)), 1.0e-12_dp))

    s_l = min(u_l - a_l, u_roe - a_roe)
    s_r = max(u_r + a_r, u_roe + a_roe)

    ! Contact discontinuity wave speed s_star
    s_star = (p_r - p_l + (rho_l * u_l * (s_l - u_l)) - (rho_r * u_r * (s_r - u_r))) &
           / ((rho_l * (s_l - u_l)) - (rho_r * (s_r - u_r)))

    if (s_l >= 0.0_dp) then
      flux_mass   = rho_l * u_l
      flux_mom    = (rho_l * u_l * u_l) + p_l
      flux_energy = (e_l + p_l) * u_l
    elseif (s_star >= 0.0_dp) then
      factor_l    = rho_l * ((s_l - u_l) / (s_l - s_star))
      flux_mass   = (rho_l * u_l) + (s_l * (factor_l - rho_l))
      flux_mom    = (rho_l * u_l * u_l) + p_l + (s_l * ((factor_l * s_star) - (rho_l * u_l)))
      flux_energy = ((e_l + p_l) * u_l) + (s_l * (factor_l * ((e_l / rho_l) &
                  + ((s_star - u_l) * (s_star + (p_l / (rho_l * (s_l - u_l)))))) - e_l))
    elseif (s_r >= 0.0_dp) then
      factor_r    = rho_r * ((s_r - u_r) / (s_r - s_star))
      flux_mass   = (rho_r * u_r) + (s_r * (factor_r - rho_r))
      flux_mom    = (rho_r * u_r * u_r) + p_r + (s_r * ((factor_r * s_star) - (rho_r * u_r)))
      flux_energy = ((e_r + p_r) * u_r) + (s_r * (factor_r * ((e_r / rho_r) &
                  + ((s_star - u_r) * (s_star + (p_r / (rho_r * (s_r - u_r)))))) - e_r))
    else
      flux_mass   = rho_r * u_r
      flux_mom    = (rho_r * u_r * u_r) + p_r
      flux_energy = (e_r + p_r) * u_r
    end if
  end subroutine hllc_flux_1d

end module mod_compressible_hllc_riemann
`,
    likedBy: ["omar", "david_kowalski", "sofia_rossi", "vikram_patel", "priya_nair"],
    repostedBy: ["david_kowalski"],
    bookmarkedBy: ["omar", "david_kowalski"],
    comments: [
      {
        authorUsername: "david_kowalski",
        createdHoursAgo: 3,
        content:
          "Unlike Roe's linearized solver, the Einfeldt-bounded HLLC wave speeds (`s_l`, `s_star`, `s_r`) are guaranteed positivity-preserving without needing an entropy fix across sonic rarefaction fans!",
        likedBy: ["alex_rivera", "sofia_rossi", "omar"],
      },
    ],
  },

  // 43. SBML (.sbml)
  {
    id: "seed-post-sbml",
    language: "sbml",
    viewType: "sbml",
    title: "Fed-Batch CHO Bioreactor Monoclonal Antibody (mAb) Glycolysis & Galactosylation Network — SBML L3V2",
    filename: "CHO_Bioreactor_mAb_Glycosylation.sbml",
    authorUsername: "hannah_becker",
    createdHoursAgo: 2,
    postContent:
      "Uploaded our Systems Biology Markup Language (`SBML` Level 3 Version 2) kinetic pathway model (`.sbml`) for a 2,000 L fed-batch Chinese Hamster Ovary (`CHO-K1`) bioreactor producing therapeutic IgG1 monoclonal antibodies. Couples extracellular glucose/glutamine uptake, lactate overflow metabolism (Warburg shift), and Golgi N-linked galactosylation ($\\text{G0F} \\rightarrow \\text{G1F} \\rightarrow \\text{G2F}$).",
    code: `<?xml version="1.0" encoding="UTF-8"?>
<sbml xmlns="http://www.sbml.org/sbml/level3/version2/core" level="3" version="2">
  <model id="CHO_FedBatch_mAb_Glycosylation_Network" name="CHO Bioreactor IgG1 mAb Metabolism &amp; Golgi Glycosylation" timeUnits="hour" substanceUnits="mmol" extentUnits="mmol">
    <listOfCompartments>
      <compartment id="Bioreactor_Media" name="Extracellular Bioreactor Broth (2000L)" spatialDimensions="3" size="2000.0" constant="false" />
      <compartment id="CHO_Cytosol" name="Intracellular Cytosol" spatialDimensions="3" size="45.0" constant="true" />
      <compartment id="Golgi_Lumen" name="Golgi Apparatus Cis-to-Trans Cisternae" spatialDimensions="3" size="4.2" constant="true" />
    </listOfCompartments>

    <listOfSpecies>
      <species id="GLC_ext" name="Extracellular D-Glucose" compartment="Bioreactor_Media" initialConcentration="32.5" hasOnlySubstanceUnits="false" boundaryCondition="false" constant="false" />
      <species id="GLN_ext" name="Extracellular L-Glutamine" compartment="Bioreactor_Media" initialConcentration="6.8" hasOnlySubstanceUnits="false" boundaryCondition="false" constant="false" />
      <species id="LAC_ext" name="Extracellular L-Lactate" compartment="Bioreactor_Media" initialConcentration="1.2" hasOnlySubstanceUnits="false" boundaryCondition="false" constant="false" />
      <species id="PYR_cyt" name="Cytosolic Pyruvate" compartment="CHO_Cytosol" initialConcentration="2.4" hasOnlySubstanceUnits="false" boundaryCondition="false" constant="false" />
      <species id="UDP_Gal" name="UDP-Galactose Nucleotide Sugar Donor" compartment="Golgi_Lumen" initialConcentration="0.85" hasOnlySubstanceUnits="false" boundaryCondition="false" constant="false" />
      <species id="mAb_G0F" name="Agalactosylated IgG1 Glycoform (G0F)" compartment="Golgi_Lumen" initialConcentration="4.10" hasOnlySubstanceUnits="false" boundaryCondition="false" constant="false" />
      <species id="mAb_G1F" name="Monogalactosylated IgG1 Glycoform (G1F)" compartment="Golgi_Lumen" initialConcentration="1.65" hasOnlySubstanceUnits="false" boundaryCondition="false" constant="false" />
      <species id="mAb_G2F" name="Digalactosylated IgG1 Glycoform (G2F)" compartment="Golgi_Lumen" initialConcentration="0.42" hasOnlySubstanceUnits="false" boundaryCondition="false" constant="false" />
    </listOfSpecies>

    <listOfParameters>
      <parameter id="vmax_glc" value="0.48" constant="true" />
      <parameter id="km_glc" value="1.25" constant="true" />
      <parameter id="k_ldh_fwd" value="0.18" constant="true" />
      <parameter id="k_gal_t1" value="0.34" constant="true" />
      <parameter id="k_gal_t2" value="0.21" constant="true" />
    </listOfParameters>

    <listOfReactions>
      <reaction id="R1_GLUT1_Glucose_Uptake" name="GLUT1 Hexose Uptake &amp; Glycolysis" reversible="false">
        <listOfReactants>
          <speciesReference species="GLC_ext" stoichiometry="1.0" constant="true" />
        </listOfReactants>
        <listOfProducts>
          <speciesReference species="PYR_cyt" stoichiometry="2.0" constant="true" />
        </listOfProducts>
        <kineticLaw>
          <math xmlns="http://www.w3.org/1998/Math/MathML">
            <apply>
              <divide />
              <apply><times /><ci>vmax_glc</ci><ci>GLC_ext</ci></apply>
              <apply><plus /><ci>km_glc</ci><ci>GLC_ext</ci></apply>
            </apply>
          </math>
        </kineticLaw>
      </reaction>

      <reaction id="R2_LDH_Lactate_Overflow" name="Lactate Dehydrogenase Overflow" reversible="true">
        <listOfReactants>
          <speciesReference species="PYR_cyt" stoichiometry="1.0" constant="true" />
        </listOfReactants>
        <listOfProducts>
          <speciesReference species="LAC_ext" stoichiometry="1.0" constant="true" />
        </listOfProducts>
        <kineticLaw>
          <math xmlns="http://www.w3.org/1998/Math/MathML">
            <apply><times /><ci>k_ldh_fwd</ci><ci>PYR_cyt</ci></apply>
          </math>
        </kineticLaw>
      </reaction>

      <reaction id="R3_Beta4GalT_G0F_to_G1F" name="Beta-1,4-Galactosyltransferase Branch 1" reversible="false">
        <listOfReactants>
          <speciesReference species="mAb_G0F" stoichiometry="1.0" constant="true" />
          <speciesReference species="UDP_Gal" stoichiometry="1.0" constant="true" />
        </listOfReactants>
        <listOfProducts>
          <speciesReference species="mAb_G1F" stoichiometry="1.0" constant="true" />
        </listOfProducts>
        <kineticLaw>
          <math xmlns="http://www.w3.org/1998/Math/MathML">
            <apply><times /><ci>k_gal_t1</ci><ci>mAb_G0F</ci><ci>UDP_Gal</ci></apply>
          </math>
        </kineticLaw>
      </reaction>

      <reaction id="R4_Beta4GalT_G1F_to_G2F" name="Beta-1,4-Galactosyltransferase Branch 2" reversible="false">
        <listOfReactants>
          <speciesReference species="mAb_G1F" stoichiometry="1.0" constant="true" />
          <speciesReference species="UDP_Gal" stoichiometry="1.0" constant="true" />
        </listOfReactants>
        <listOfProducts>
          <speciesReference species="mAb_G2F" stoichiometry="1.0" constant="true" />
        </listOfProducts>
        <kineticLaw>
          <math xmlns="http://www.w3.org/1998/Math/MathML">
            <apply><times /><ci>k_gal_t2</ci><ci>mAb_G1F</ci><ci>UDP_Gal</ci></apply>
          </math>
        </kineticLaw>
      </reaction>
    </listOfReactions>
  </model>
</sbml>
`,
    likedBy: ["omar", "priya_nair", "elena_vance", "claire_dubois", "mateo_silva"],
    repostedBy: ["priya_nair"],
    bookmarkedBy: ["omar", "priya_nair"],
    comments: [
      {
        authorUsername: "priya_nair",
        createdHoursAgo: 1,
        content:
          "Coupling `UDP_Gal` availability to uridine/galactose bolus feeding at hour 96 shifts the terminal $(\\text{G1F} + \\text{G2F})$ galactosylation index from 31.2% to 48.6% without elevating ammonia above 4.5 mM!",
        likedBy: ["hannah_becker", "omar"],
      },
    ],
  },

  // 44. CSV (.csv)
  {
    id: "seed-post-csv",
    language: "csv",
    viewType: "csv",
    title: "800V Silicon-Anode Solid-State Li-Ion Battery Pack — 4C Fast-Charge Thermal & EIS Telemetry",
    filename: "SolidState_800V_Pack_4C_FastCharge_Telemetry.csv",
    authorUsername: "hannah_becker",
    createdHoursAgo: 1,
    postContent:
      "Uploaded our synchronized cycler & calorimetry dataset (`.csv`) from the 800V / 112 kWh silicon-anode solid-state battery pack undergoing a 10%–80% SOC 4C ultra-fast-charge validation test (420 kW peak DC power). Tracks pack terminal voltage, bus current, max/min cell core temperatures, cold-plate glycol $\\Delta T$, and online 1 kHz electrochemical impedance (`Re(Z)` m$\\Omega$).",
    code: `time_s,soc_pct,pack_voltage_v,pack_current_a,power_kw,t_cell_max_c,t_cell_min_c,t_coolant_in_c,t_coolant_out_c,z_real_1khz_mohm,stack_pressure_mpa
0.0,10.0,712.4,0.0,0.00,24.2,23.8,22.0,22.1,28.4,1.20
60.0,16.8,748.2,520.0,389.06,26.1,25.0,21.8,23.4,26.9,1.24
120.0,23.6,764.5,545.0,416.65,28.4,26.8,21.5,24.6,25.5,1.29
180.0,30.5,778.1,542.0,421.73,30.9,28.7,21.2,25.8,24.3,1.34
240.0,37.4,789.6,530.0,418.49,33.2,30.5,21.0,26.9,23.6,1.38
300.0,44.1,799.8,510.0,407.90,35.1,32.1,20.9,27.8,23.1,1.42
360.0,50.6,809.2,482.0,390.03,36.6,33.4,20.8,28.4,22.8,1.46
420.0,56.8,818.4,445.0,364.19,37.5,34.2,20.8,28.7,22.7,1.49
480.0,62.5,826.9,402.0,332.41,38.0,34.7,20.9,28.6,22.9,1.52
540.0,67.8,834.5,358.0,298.75,38.1,34.9,21.0,28.2,23.2,1.54
600.0,72.4,841.2,312.0,262.45,37.8,34.8,21.2,27.6,23.6,1.56
660.0,76.5,846.8,268.0,226.94,37.2,34.5,21.4,26.9,24.1,1.58
720.0,80.1,851.4,224.0,190.71,36.4,34.0,21.6,26.2,24.6,1.59
`,
    likedBy: ["omar", "marcus_chen", "lukas_weber", "elena_vance", "priya_nair", "sarah_lin"],
    repostedBy: ["marcus_chen", "omar"],
    bookmarkedBy: ["omar", "marcus_chen", "lukas_weber"],
    comments: [
      {
        authorUsername: "marcus_chen",
        createdHoursAgo: 0.5,
        content:
          "10% to 80% SOC in exactly 12.0 minutes (`720 s`) with `t_cell_max_c` peaking at 38.1 °C and cell-to-cell $\\Delta T \\le 3.2\\text{ K}$! Notice how `z_real_1khz_mohm` drops from 28.4 m$\\Omega$ to 22.7 m$\\Omega$ as the argyrodite $\\text{Li}_6\\text{PS}_5\\text{Cl}$ solid electrolyte ionic conductivity rises with temperature.",
        likedBy: ["hannah_becker", "omar", "lukas_weber"],
        replies: [
          {
            authorUsername: "hannah_becker",
            createdHoursAgo: 0.2,
            content:
              "Yes! And tracking `stack_pressure_mpa` (`1.20 -> 1.59 MPa` uniaxial anode breathing) gives our BMS observer a direct mechanical state-of-health signal alongside the EIS real-axis intercept.",
            likedBy: ["marcus_chen", "omar"],
          },
        ],
      },
    ],
  },
];
