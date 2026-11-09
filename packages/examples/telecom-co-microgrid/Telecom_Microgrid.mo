// SPDX-License-Identifier: AGPL-3.0-or-later

within;

model TelecomCentralOfficeMicrogrid
  "Telecom Central Office -48V DC Microgrid with ATS, Diesel Generator, Rectifiers, and Batteries"

  // Parameters
  parameter Real V_ac_nominal = 480.0 "Nominal 3-phase AC voltage (V)";
  parameter Real V_dc_nominal = -48.0 "Nominal DC busbar voltage (V)";
  parameter Real P_telecom_load = 15000.0 "Critical telecom equipment load (W)";
  parameter Real battery_capacity_Ah = 2000.0 "Dual string battery capacity (Ah)";
  parameter Real t_grid_loss = 2.0 "Time of utility grid loss (s)";
  parameter Real t_gen_start = 12.0 "Time diesel generator reaches stable frequency & ATS closes (s)";

  // Variables
  Real v_grid "Utility grid RMS voltage (V)";
  Real v_gen "Diesel generator RMS voltage (V)";
  Real v_dc_bus "Central Office -48V DC busbar voltage (V)";
  Real i_rectifier "Rectifier output current to DC bus (A)";
  Real i_battery "Battery string current (A, positive = discharging)";
  Real i_load "Telecom load current (A)";
  Real soc "Battery state of charge (0..1)";
  Boolean grid_available "Utility grid power healthy";
  Boolean ats_generator_connected "ATS transferred to diesel generator";

initial equation
  v_dc_bus = -54.0;
  soc = 1.0;

equation
  // Utility Grid Health
  grid_available = time < t_grid_loss;
  v_grid = if grid_available then V_ac_nominal else 0.0;

  // Diesel Generator & ATS
  ats_generator_connected = time >= t_gen_start;
  v_gen = if ats_generator_connected then V_ac_nominal else 0.0;

  // Rectifier bay: converts AC (grid or gen) to -54.0V float / -48V nominal
  i_rectifier = if (grid_available or ats_generator_connected) then
                  -(P_telecom_load / 54.0)
                else
                  0.0;

  // Telecom constant power load
  i_load = P_telecom_load / abs(v_dc_bus);

  // DC Busbar Kirchhoff's Current Law: battery takes over instantly (0 ms delay)
  i_battery = i_load - abs(i_rectifier);

  // Battery terminal voltage model
  v_dc_bus = if (grid_available or ats_generator_connected) then
               -54.0
             else
               -(48.0 - 0.005 * i_battery - 4.0 * (1.0 - soc));

  // Battery State of Charge ODE
  der(soc) = -i_battery / (battery_capacity_Ah * 3600.0);

end TelecomCentralOfficeMicrogrid;
