// name: RedeclareClass1.mo
// keywords:
// status: correct
//

model A
  replaceable model B
    Real x;
  end B;

  B b;
end A;

model RedeclareClass1
  model C
    Real x = 1.0;
  end C;

  A a(redeclare model B = C);
end RedeclareClass1;


// Result:
// Error processing file: RedeclareClass1.mo
// Error: Class RedeclareClass1.mo not found in scope <top>.
// Error: Error occurred while flattening model RedeclareClass1.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
