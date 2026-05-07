// name: lookup2.mo
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
  A.b.C c;
end M;

// Result:
// Error processing file: lookup2.mo
// Error: Failed to load package lookup2 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class lookup2.mo not found in scope <top>.
// Error: Error occurred while flattening model lookup2.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
