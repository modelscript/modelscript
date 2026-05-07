// name: eq5.mo
// keywords:
// status: correct
//

model A
  constant Integer j;

  model B
    model C
      model M
        constant Integer i = j;
      end M;
    end C;
  end B;

  constant B.C.M m;
end A;

model B
  A a[3](j = {1, 2, 3});
  Real x[3], y[3];
equation
  x = a.m.i .* y;
end B;


// Result:
// Error processing file: eq5.mo
// Error: Failed to load package eq5 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class eq5.mo not found in scope <top>.
// Error: Error occurred while flattening model eq5.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
