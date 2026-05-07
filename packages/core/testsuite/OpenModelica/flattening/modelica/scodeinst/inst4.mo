// name: inst4.mo
// keywords:
// status: incorrect
//
//


type B
  Real x;
end B;

class MyReal
  extends Real;
  extends B;
end MyReal;

model A
  MyReal r;
end A;

// Result:
// Error processing file: inst4.mo
// Error: Failed to load package inst4 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class inst4.mo not found in scope <top>.
// Error: Error occurred while flattening model inst4.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
