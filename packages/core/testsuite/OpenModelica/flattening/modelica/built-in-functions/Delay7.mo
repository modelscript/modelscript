// name:     Delay7
// keywords: builtin
// status:   incorrect
//
// Test flattening of the builtin function delay.
// Should issue a warning as b is not a parameter or constant.
// Modelica.Electrical.Analog.Lines.TLine* uses delay(x, var)
//

model Delay
  Real x, y;
  Real a = 1.0, b=2.0;
equation
  x = sin(time);
  y = delay(x, a, b);
end Delay;
// Result:
// Error processing file: Delay7.mo
// Error: Failed to load package Delay7 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class Delay7 not found in scope <top>.
// Error: Error occurred while flattening model Delay7
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
