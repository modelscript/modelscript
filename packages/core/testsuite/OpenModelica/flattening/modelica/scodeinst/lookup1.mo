// name: lookup1.mo
// keywords:
// status: incorrect
//

model A
  model B
    model C
      Real x;
    end C;
  end B;

  B b;
end A;

model M
  A a;
  a.B b;
end M;

// Result:
// Error processing file: lookup1.mo
// Error: Failed to load package lookup1 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class lookup1.mo not found in scope <top>.
// Error: Error occurred while flattening model lookup1.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
