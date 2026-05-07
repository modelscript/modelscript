// name:     IgnoreReplaceable
// keywords: 
// status:   correct
//
// Tests the --ignoreReplaceable flag.
//

model A
  Real x;

  model B
    Real y;
  end B;

  B b;
end A;

model IgnoreReplaceable
  model C
    Real y;
    Real z;
  end C;

  type MyReal = Real(start = 1.0);

  A a(redeclare MyReal x, redeclare model B = C);
end IgnoreReplaceable;

// Result:
// Error processing file: IgnoreReplaceable.mo
// [OpenModelica/flattening/modelica/redeclare/IgnoreReplaceable.mo:26:7-26:25:writable] Error: Redeclaration with a new type requires 'x' to be replaceable.
// Error: Error occurred while flattening model IgnoreReplaceable
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
