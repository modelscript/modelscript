// name: OperatorFunction2
// keywords: operator
// status: correct
//
// tests the shorthand operator function keyword, extension should be illegal
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

record MyRec
  extends Rec; //ILLEGAL
  Real k;
end MyRec;

model OperatorIllegal
  MyRec mr;
equation
  MyRec.r = 2.0;
  MyRec.k = 1.0;
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end OperatorIllegal;

// Result:
// Error processing file: OperatorFunction2.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Error: Variable MyRec.r in package MyRec is not constant.
// [OpenModelica/flattening/modelica/operators/OperatorFunction2.mo:27:3-27:16:writable] Error: Variable MyRec.r not found in scope OperatorIllegal.
// Error: Error occurred while flattening model OperatorIllegal
//
// Execution failed!
// endResult
