// name: lookup3.mo
// keywords:
// status: incorrect
//

model A
  model B
    model C
      model D
        Real x;
      end D;

      D d;
    end C;
  end B;

  B b;
end A;

model M
  A a;
  Real x = a.B.C;
end M;

// Result:
// Error processing file: lookup3.mo
// Error: Failed to load package lookup3 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class lookup3.mo not found in scope <top>.
// Error: Error occurred while flattening model lookup3.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
