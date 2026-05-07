// name: OperatorFunction1
// keywords: operator
// status: correct
//
// tests the shorthand operator function keyword
//

operator record Rec
  Real r;
  operator function '+'
    input Rec r1;
    input Rec r2;
    output Rec res;
  algorithm
    res := Rec(r = r1.r + r2.r);
  end '+';
end Rec;

model OperatorIllegal
  Rec r1,r2,r3;
equation
  r1.r = 1.0;
  r2.r = 2.0;
  r3 = r1 + r2;
end OperatorIllegal;

// Result:
// Error processing file: OperatorFunction1.mo
// Error: Failed to load package OperatorFunction1 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class OperatorFunction1 not found in scope <top>.
// Error: Error occurred while flattening model OperatorFunction1
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
