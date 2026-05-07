// name: eq4.mo
// keywords:
// status: correct
//

package P
  constant Integer n = 3;
end P;

model A
  Real x;
  parameter Real y;
equation
  x = y * P.n;
  y = x;
end A;

model B
  A a1[3](y = {1, 2, 3});
  A a2[3](each y = 4);
end B;

// Result:
// Error processing file: eq4.mo
// Error: Failed to load package eq4 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class eq4.mo not found in scope <top>.
// Error: Error occurred while flattening model eq4.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
