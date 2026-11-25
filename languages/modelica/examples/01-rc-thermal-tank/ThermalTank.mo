model ThermalTank "First-order lumped-capacitance heated liquid tank"
  parameter Real C(unit="J/K") = 41840.0 "Thermal capacitance of 10 kg water";
  parameter Real R(unit="K/W") = 0.08 "Thermal resistance to ambient";
  parameter Real T_amb(unit="K") = 293.15 "Ambient temperature (20 degC)";
  parameter Real Q_heater(unit="W") = 1200.0 "Electric immersion heater power";
  parameter Real T0(unit="K") = 293.15 "Initial tank temperature";

  Real T(unit="K", start=T0, fixed=true) "Bulk liquid temperature";
  Real Q_loss(unit="W") "Convective heat loss to environment";
  Real T_degC(unit="degC") "Tank temperature in Celsius";

equation
  Q_loss = (T - T_amb) / R;
  C * der(T) = Q_heater - Q_loss;
  T_degC = T - 273.15;

  annotation(
    experiment(StartTime=0, StopTime=6000, Tolerance=1e-6),
    Documentation(info="<html><p>First-order thermal tank model with steady-state temperature T_ss = T_amb + R*Q_heater.</p></html>")
  );
end ThermalTank;
