// name: const3.mo
// keywords:
// status: correct
//


package P
  package P1
    constant Integer i = 2;
  end P1;

  model A
    Real x[P1.i];
    Real y[P.P1.i];
  end A;
end P;

model B
  P.A a;
end B;

// Result:
// Error processing file: const3.mo
// Error: Failed to load package const3 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class const3.mo not found in scope <top>.
// Error: Error occurred while flattening model const3.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
