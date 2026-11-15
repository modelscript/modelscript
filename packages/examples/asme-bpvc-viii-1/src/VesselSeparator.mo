model VesselSeparator "Three-Phase Separator Vessel Sized Under ASME BPVC VIII-1"
  import ASME_BPVC_VIII_1.*;

  parameter Real P = 2.5 "Internal design pressure [MPa]";
  parameter Real MAWP = 2.6 "Maximum allowable working pressure [MPa]";
  parameter Real R = 800.0 "Inside shell radius [mm]";
  parameter Real D = 1600.0 "Inside shell diameter [mm]";
  parameter Real E = 0.85 "Weld joint efficiency [-]";
  parameter Real designTempF = 500.0 "Design metal temperature [degF]";
  parameter String materialSpec = "SA-516-70";

  parameter Real t_wall = 18.5 "Nominal cylindrical shell thickness [mm]";
  parameter Real t_head = 18.5 "Nominal 2:1 ellipsoidal head thickness [mm]";
  parameter Real P_hydro = 3.5 "Shop hydrostatic test pressure [MPa]";
  parameter Real P_set = 2.55 "Primary PRV set pressure [MPa]";

  Real hoopStress "Circumferential membrane stress [MPa]";
  Real pressureTransient(start = 2.1) "Operating surge pressure [MPa]";

equation
  hoopStress = (P * (R + 0.6 * t_wall)) / (t_wall * E);
  der(pressureTransient) = 0.4 * (P - pressureTransient);

  annotation (
    twin = "ASME_BPVC_VIII_1::UG27_ShellThickness",
    ComplianceProfile = "ASME-BPVC-VIII-1"
  );
end VesselSeparator;
