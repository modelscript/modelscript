// name: lookup4.mo
// keywords:
// status: incorrect
//

model A
  model B
    model C
      model D
        Real x;
      end D;

      constant D d;
    end C;
  end B;

  constant B b;
end A;

model M
  A a;
  Real x = a.b.C.d.x;
end M;

// Result:
// Error processing file: lookup4.mo
// Error: Failed to load package lookup4 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class lookup4.mo not found in scope <top>.
// Error: Error occurred while flattening model lookup4.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
