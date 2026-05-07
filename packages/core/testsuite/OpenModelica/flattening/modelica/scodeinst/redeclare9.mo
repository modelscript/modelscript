// name: redeclare9.mo
// keywords:
// status: correct
//

model A
  replaceable model M1
    Real x;
  end M1;

  replaceable model M2
    Real a;
  end M2;

  M1 m1_a;
  M2 m2_a;
end A;

model B
  extends A;

  redeclare model M1
    Real y;
  end M1;

  redeclare model M2 = M1;
end B;

// Result:
// Error processing file: redeclare9.mo
// Error: Failed to load package redeclare9 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class redeclare9.mo not found in scope <top>.
// Error: Error occurred while flattening model redeclare9.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
