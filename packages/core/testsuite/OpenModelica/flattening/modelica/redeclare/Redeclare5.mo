// name:     Redeclare5
// keywords: redeclare, bug #36
// status:   correct
//
model B
  parameter Real b=1.0;
  Real x;
end B;

model BB
  extends B;
equation
  der(x) = b;
end BB;

model C
  replaceable B d(b=5);
end C;

model D
  C c(redeclare BB d);
end D;


// Result:
// Error processing file: Redeclare5.mo
// Error: Failed to load package Redeclare5 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class Redeclare5 not found in scope <top>.
// Error: Error occurred while flattening model Redeclare5
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
