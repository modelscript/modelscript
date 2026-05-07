// name: ClassExtends1.mo
// keywords:
// status: correct
//
// Tests that basic class extends works.
//

model A
  replaceable model B
    Real x = 1.0;
  end B;

  B b;
end A;

model ClassExtends1
  extends A;

  redeclare model extends B
    Real y = 2.0;
  end B;

  B b2;
end ClassExtends1;

// Result:
// Error processing file: ClassExtends1.mo
// Error: Class ClassExtends1.mo not found in scope <top>.
// Error: Error occurred while flattening model ClassExtends1.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
