// name:     Extends3
// keywords: extends basictype operators
// status:   correct
//
// Testing extending basic type and matrix multiplication operators (MC bug #643)

connector RealSignal
  replaceable type SignalType = Real;
  extends SignalType;
end RealSignal;

connector RealInput = input RealSignal;
connector RealOutput = output RealSignal;

block SS
  RealInput u[nin];
  RealOutput y[nout];
  parameter Integer nin=1;
  parameter Integer nout=2;
  parameter Real B[2,1] = {{1},{2}};
equation
  y = B*u;
end SS;



// Result:
// Error processing file: Extends3.mo
// Error: Failed to load package Extends3 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class Extends3 not found in scope <top>.
// Error: Error occurred while flattening model Extends3
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
