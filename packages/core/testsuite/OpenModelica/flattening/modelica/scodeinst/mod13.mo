// name: mod13.mo
// keywords:
// status: correct
//

model D
  extends C;
  Real y = x;
end D;

model C
  parameter Real offset = 0;
  Real x;
equation
  x = offset;
end C;

model B
  parameter Real offset = 0;
  replaceable C c(final offset = offset);
end B;

model A
  parameter Real Vdc = 1;
  extends B(redeclare D c, offset = Vdc);
end A;

// Result:
// Error processing file: mod13.mo
// Error: Failed to load package mod13 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class mod13.mo not found in scope <top>.
// Error: Error occurred while flattening model mod13.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
