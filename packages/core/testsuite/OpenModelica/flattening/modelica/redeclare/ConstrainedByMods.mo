// name:     ConstrainedByMods.mo
// keywords: constrainedby modifier handling
// status:   correct
//
// check that modifiers from constrainedby clause are properly propagated on redeclare
//

model Resistor
  parameter Real R = 1;
  parameter Real U = 2;
end Resistor;

model ThermoResistor
  parameter Real R = 3;
  parameter Real U = 4;
  parameter Real T0 = 5;
end ThermoResistor;

model Circuit
  replaceable model NonlinearResistor = Resistor(R = 100);
end Circuit;

model Circuit2
  // As a result of the modification on the base type, the default value of R is 100
  extends Circuit(redeclare replaceable model NonlinearResistor = ThermoResistor(T0=300));
end Circuit2;

model Circuit3
  // The T0 modification is not applied because it did not appear in the original declaration
  extends Circuit2(redeclare replaceable model NonlinearResistor = Resistor(U=10));
  NonlinearResistor r;
end Circuit3;


// Result:
// Error processing file: ConstrainedByMods.mo
// Error: Failed to load package ConstrainedByMods (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class ConstrainedByMods.mo not found in scope <top>.
// Error: Error occurred while flattening model ConstrainedByMods.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
