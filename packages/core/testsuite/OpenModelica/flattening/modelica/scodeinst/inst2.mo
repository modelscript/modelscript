// name: inst2.mo
// keywords:
// status: correct
//


model A
  replaceable model B
    Real x;
  end B;

  B b;
end A;

model C
  extends A;

  redeclare model B
    Real y;
  end B;
end C;

// Result:
// Error processing file: inst2.mo
// Error: Failed to load package inst2 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class inst2.mo not found in scope <top>.
// Error: Error occurred while flattening model inst2.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
