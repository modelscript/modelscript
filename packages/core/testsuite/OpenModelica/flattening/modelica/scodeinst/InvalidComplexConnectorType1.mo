// name: InvalidComplexConnectorType1
// keywords:
// status: incorrect
//

model InvalidComplexConnectorType1
  connector C
    parameter Real x;
    Real y;
    flow Real f;
  end C;

  connector C2
    Real x;
    parameter Real y;
    flow Real f;
  end C2;

  C c1;
  C2 c2;
equation
  connect(c1, c2);
end InvalidComplexConnectorType1;

// Result:
// Error processing file: InvalidComplexConnectorType1.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/scodeinst/InvalidComplexConnectorType1.mo:8:5-8:21:writable] Error: Parameter c1.x has neither value nor start value, and is fixed during initialization (fixed=true).
//
// Execution failed!
// endResult
