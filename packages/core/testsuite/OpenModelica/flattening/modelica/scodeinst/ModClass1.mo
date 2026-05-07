// name: ModClass1.mo
// keywords:
// status: correct
//

model A
  replaceable model B
    Real x;
  end B;

  B b;
end A;

model ModClass1
  model D
    Real x = 1.0;
  end D;

  A a1(redeclare model B = D);
  A a2;
end ModClass1;

// Result:
// Error processing file: ModClass1.mo
// Error: Class ModClass1.mo not found in scope <top>.
// Error: Error occurred while flattening model ModClass1.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
