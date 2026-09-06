// name:     Oscillator
// keywords: modelica library
// status:   correct
//
// MORE WORK ON THIS FILE HAS TO BE DONE!
//
// Drmodelica: 5.3 Oscillating Mass Connected to a Spring (p. 156)
//
partial model Compliant
"Compliant coupling of 2 translational 1D flanges"
  Modelica.Mechanics.Translational.Interfaces.Flange_a flange_a "Driving flange";
  Modelica.Mechanics.Translational.Interfaces.Flange_b flange_b "Driven flange";
  Modelica.SIunits.Distance s_rel "Relative distance between flange_a and flange_b";
  flow Modelica.SIunits.Force f "Force between flanges, positive in direction of N";
equation
  s_rel = flange_b.s - flange_a.s;
  0 = flange_b.f + flange_a.f;
  f = flange_b.f;
end Compliant;

model Spring
  "Linear 1D translational spring"
  extends Compliant;
  parameter Modelica.SIunits.Distance s_rel0 = 0 "Unstretched spring length";
  parameter Real c(unit = "N/m") = 1 "Spring constant";
equation
  f = c*(s_rel - s_rel0); //Spring equation
end Spring;

partial model Rigid
  "Rigid connection of two translational 1D flanges"
  Real s "Absolute position s of center of component(s = flange_a.s + L/2 = flange_b.s - L/2)";
  parameter Real L = 0 "Length L of component from left to right flange (L = flange_b.s - flange_a.s)";
  Modelica.Mechanics.Translational.Interfaces.Flange_a flange_a;
  Modelica.Mechanics.Translational.Interfaces.Flange_b flange_b;
equation
  flange_a.s = s - L/2;
  flange_b.s = s + L/2;
end Rigid; //From Modelica.Mechanics.Translational.Interfaces

model Mass
  "Hanging mass object"
  extends Rigid;
  parameter Real m = 1 "Mass of the hanging mass";
  constant Real g = 9.81 "Gravitational acceleration";
  Real v "Absolute velocity of component";
  Real a "Absolute acceleration of component";
equation
  v = der(s);
  a = der(v);
  flange_b.f = m*a - m*g;
end Mass;

model Fixed
  "Fixed flange at a housing"
  parameter Real s0 = 0 "Fixed offset position of housing";
  Modelica.Mechanics.Translational.Interfaces.Flange_b flange_b; //From Modelica.Mechanics.Translational
equation
  flange_b.s = s0;
end Fixed;

model Oscillator
  Mass     mass1(L = 1, s(start = -0.5));
  Spring   spring1(s_rel0 = 2, c = 10000);
  Fixed   fixed1(s0 = 1.0);
equation
  connect(spring1.flange_b, fixed1.flange_b);
  connect(mass1.flange_b, spring1.flange_a);
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end Oscillator;

// insert expected flat file here. Can be done by issuing the command
// ./omc XXX.mo >> XXX.mo and then comment the inserted class.
//
// Result:
// Error processing file: Oscillator.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/extends/Oscillator.mo:11:3-11:55:writable] Error: Class or type 'Modelica.Mechanics.Translational.Interfaces.Flange_a' not found in scope.
// [OpenModelica/flattening/modelica/extends/Oscillator.mo:12:3-12:55:writable] Error: Class or type 'Modelica.Mechanics.Translational.Interfaces.Flange_b' not found in scope.
// [OpenModelica/flattening/modelica/extends/Oscillator.mo:13:3-13:28:writable] Error: Class or type 'Modelica.SIunits.Distance' not found in scope.
// [OpenModelica/flattening/modelica/extends/Oscillator.mo:14:8-14:30:writable] Error: Class or type 'Modelica.SIunits.Force' not found in scope.
// [OpenModelica/flattening/modelica/extends/Oscillator.mo:16:11-16:21:writable] Error: Variable 'flange_b.s' not found in scope.
// [OpenModelica/flattening/modelica/extends/Oscillator.mo:16:24-16:34:writable] Error: Variable 'flange_a.s' not found in scope.
// [OpenModelica/flattening/modelica/extends/Oscillator.mo:17:7-17:17:writable] Error: Variable 'flange_b.f' not found in scope.
// [OpenModelica/flattening/modelica/extends/Oscillator.mo:17:20-17:30:writable] Error: Variable 'flange_a.f' not found in scope.
// [OpenModelica/flattening/modelica/extends/Oscillator.mo:18:7-18:17:writable] Error: Variable 'flange_b.f' not found in scope.
// [OpenModelica/flattening/modelica/extends/Oscillator.mo:24:13-24:38:writable] Error: Class or type 'Modelica.SIunits.Distance' not found in scope.
// [OpenModelica/flattening/modelica/extends/Oscillator.mo:27:3-27:25:writable] Error: Type mismatch in equation 'f = c*(s_rel - s_rel0)'.
// [OpenModelica/flattening/modelica/extends/Oscillator.mo:34:3-34:55:writable] Error: Class or type 'Modelica.Mechanics.Translational.Interfaces.Flange_a' not found in scope.
// [OpenModelica/flattening/modelica/extends/Oscillator.mo:35:3-35:55:writable] Error: Class or type 'Modelica.Mechanics.Translational.Interfaces.Flange_b' not found in scope.
// [OpenModelica/flattening/modelica/extends/Oscillator.mo:37:3-37:13:writable] Error: Variable 'flange_a.s' not found in scope.
// [OpenModelica/flattening/modelica/extends/Oscillator.mo:38:3-38:13:writable] Error: Variable 'flange_b.s' not found in scope.
// [OpenModelica/flattening/modelica/extends/Oscillator.mo:51:3-51:13:writable] Error: Variable 'flange_b.f' not found in scope.
// [OpenModelica/flattening/modelica/extends/Oscillator.mo:57:3-57:55:writable] Error: Class or type 'Modelica.Mechanics.Translational.Interfaces.Flange_b' not found in scope.
// [OpenModelica/flattening/modelica/extends/Oscillator.mo:59:3-59:13:writable] Error: Variable 'flange_b.s' not found in scope.
// Error: Error occurred while flattening model Oscillator
//
// Execution failed!
// endResult
