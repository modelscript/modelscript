// SPDX-License-Identifier: AGPL-3.0-or-later

package Physiological
  "Physiological and cardiovascular modeling library with dynamic spatial feedback"

  connector FluidPort "Hydraulic / vascular port"
    Real p "Pressure [Pa]";
    flow Real m_flow "Mass flow rate [kg/s]";
  end FluidPort;

  connector ClearancePort "Geometric spatial clearance bus"
    Real distance "Instantaneous minimum wall clearance [m]";
    Real contactWarning "Imminent suction / collision risk flag [0=safe, 1=warning, 2=contact]";
  end ClearancePort;

  model DeformableVentricle "Left ventricle with elastance dynamics and dynamic spatial clearance"
    FluidPort inflow "Mitral valve inflow";
    FluidPort outflow "Aortic valve / cannula outflow";
    ClearancePort clearance "Spatial clearance bus from 3D CAD/ROM";

    parameter Real V0 = 0.000030 "Unstressed chamber volume [m3]";
    parameter Real E_max = 300000.0 "End-systolic elastance [Pa/m3]";
    parameter Real E_min = 10000.0 "End-diastolic elastance [Pa/m3]";
    parameter Real rho = 1050.0 "Blood density [kg/m3]";
    parameter Real d_critical = 0.0015 "Critical clearance threshold [m] (1.5mm)";
    parameter Real R_nominal = 100000.0 "Nominal outflow vascular resistance [Pa.s/kg]";

    Real V(start=0.00012) "Chamber volume [m3]";
    Real P "Chamber pressure [Pa]";
    Real elastance "Time-varying elastance [Pa/m3]";
    Real R_choke "Non-linear geometric choke resistance [Pa.s/kg]";
  equation
    der(V) = (inflow.m_flow - outflow.m_flow) / rho;
    
    // Normalized cardiac elastance activation
    elastance = E_min + (E_max - E_min) * (0.5 + 0.5 * sin(6.283185307 * time));
    P = elastance * (V - V0);

    // Dynamic suction choke: resistance jumps as clearance d approaches critical distance
    R_choke = R_nominal * (1.0 + 1.0 / (0.0001 + (clearance.distance / d_critical) ^ 3));

    // Hydraulic pressure drops
    inflow.p - P = -inflow.m_flow * R_nominal;
    P - outflow.p = outflow.m_flow * R_choke;

    // Contact warning states
    clearance.contactWarning = if clearance.distance < d_critical then 2.0 else (if clearance.distance < 2.0 * d_critical then 1.0 else 0.0);
  end DeformableVentricle;

  model CannulaInterface "Inflow cannula with spatial proximity calculation"
    FluidPort inflow;
    FluidPort outflow;
    ClearancePort clearance;

    parameter Real R_cannula = 50000.0 "Internal hydraulic cannula resistance";
    parameter Real cannulaTipPositionX = 0.015 "Cannula tip insertion position [m]";
    parameter Real cavityBaseRadius = 0.025 "Chamber reference radius [m]";
    input Real cavityVolume "Current chamber volume [m3]";

    Real currentRadius "Current cavity radius [m]";
  equation
    // Simplified radial cavity scaling: r(t) = r0 * (V / V0)^(1/3)
    currentRadius = cavityBaseRadius * (cavityVolume / 0.00012) ^ (0.3333333333333333);
    clearance.distance = currentRadius - cannulaTipPositionX;

    inflow.p - outflow.p = inflow.m_flow * R_cannula;
    inflow.m_flow + outflow.m_flow = 0.0;
  end CannulaInterface;

  model LvadPump "Continuous-flow rotary blood pump (LVAD)"
    FluidPort inflow;
    FluidPort outflow;
    input Real speedRpm "Target impeller speed [RPM]";
    output Real flowRateLpm "Flow rate [L/min]";
    output Real motorCurrent "Estimated motor current [A]";

    parameter Real rho = 1050.0 "Blood density [kg/m3]";
    Real deltaP "Pressure head [Pa]";
    Real Q "Volumetric flow rate [m3/s]";
  equation
    deltaP = outflow.p - inflow.p;
    Q = outflow.m_flow / rho;
    flowRateLpm = Q * 60000.0;

    // H-Q curve: deltaP = a * omega^2 - b * Q
    deltaP = 0.0001 * speedRpm ^ 2 - 2000000.0 * Q;
    inflow.m_flow + outflow.m_flow = 0.0;

    // Motor current proportional to torque
    motorCurrent = 0.5 + 0.0001 * speedRpm + 1000.0 * Q;
  end LvadPump;

  model LvadController "Autonomous anti-suction speed controller"
    input Real flowRateLpm "Measured pump flow rate [L/min]";
    input Real motorCurrent "Measured motor current [A]";
    input Real warningLevel "Clearance warning level [0, 1, 2]";
    output Real targetRpm "Commanded impeller speed [RPM]";

    parameter Real nominalRpm = 5000.0 "Nominal operating speed [RPM]";
    parameter Real recoveryRpm = 3000.0 "Safe back-off speed during suction [RPM]";
    Real filteredWarning;
  equation
    der(filteredWarning) = (warningLevel - filteredWarning) / 0.05;
    targetRpm = if filteredWarning > 0.5 then recoveryRpm else nominalRpm;
  end LvadController;

  model CoupledLvadSuction "Closed-loop system with deformable ventricle and anti-suction LVAD"
    DeformableVentricle ventricle;
    CannulaInterface cannula;
    LvadPump pump;
    LvadController controller;

    Real arterialPressure "Systemic arterial pressure [Pa]";
  equation
    ventricle.inflow.p = 1000.0; // Left atrial pressure ~7.5 mmHg (1000 Pa)
    connect(ventricle.outflow, cannula.inflow);
    connect(cannula.outflow, pump.inflow);
    cannula.cavityVolume = ventricle.V;
    connect(ventricle.clearance, cannula.clearance);

    // LVAD feeds systemic arterial load
    arterialPressure = 12000.0; // ~90 mmHg (12 kPa)
    pump.outflow.p = arterialPressure;

    // Closed-loop controller feedback
    controller.flowRateLpm = pump.flowRateLpm;
    controller.motorCurrent = pump.motorCurrent;
    controller.warningLevel = ventricle.clearance.contactWarning;
    pump.speedRpm = controller.targetRpm;
  end CoupledLvadSuction;

end Physiological;
