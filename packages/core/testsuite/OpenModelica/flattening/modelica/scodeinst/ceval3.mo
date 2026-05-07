// name: ceval3.mo
// status: correct

model A
  Real x(start=2.0, fixed=init_x);
  parameter Boolean init_x = p1 or p2;
  parameter Boolean p1 = false;
  parameter Boolean p2 = true;
equation
  der(x) = -1;
end A;

// Result:
// Error processing file: ceval3.mo
// Error: Failed to load package ceval3 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class ceval3.mo not found in scope <top>.
// Error: Error occurred while flattening model ceval3.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
