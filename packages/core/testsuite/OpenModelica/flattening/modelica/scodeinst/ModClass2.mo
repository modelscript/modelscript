// name: ModClass2
// keywords:
// status: correct
//

package A
  replaceable model B
    Real x;
  end B;

  model C
    B b;
  end C;
end A;

model ModClass1
  model D
    Real x = 1.0;
  end D;

  package A2 = A(redeclare model B = D);
  A.C c1;
  A2.C c2;
  A2.C c3;
end ModClass1;

// Result:
// Error processing file: ModClass2.mo
// Error: Failed to load package ModClass2 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class ModClass2 not found in scope <top>.
// Error: Error occurred while flattening model ModClass2
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
