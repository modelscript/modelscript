// name: OperatorComponents
// keywords: operator
// status: correct
//
// Tests operator overloading, operators can only contain function declarations
//

operator record Rec
  Real r;
  operator '+'
    function add
      input Rec r1;
      input Rec r2;
      output Rec res;
  protected
    Real factor = 3.0;
    algorithm
      res := Rec(r = r1.r + r2.r + factor);
    end add;
  end '+';
end Rec;

model OperatorComplex
  Rec r1,r2,r3;
equation
  r1 = Rec(r = 2.0);
  r2 = Rec(r = 3.0);
  r3 = r1 + r2;
end OperatorComplex;

// Result:
// Error processing file: OperatorComponents.mo
// Error: Failed to load package OperatorComponents (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class OperatorComponents not found in scope <top>.
// Error: Error occurred while flattening model OperatorComponents
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
