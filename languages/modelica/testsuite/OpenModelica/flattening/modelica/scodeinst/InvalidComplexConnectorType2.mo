// name: InvalidComplexConnectorType2
// keywords:
// status: incorrect
//

model InvalidComplexConnectorType2
  connector C
    Real y;
    parameter Real x;
    flow Real f;
  end C;

  connector C2
    parameter Real y;
    Real x;
    flow Real f;
  end C2;

  C c1;
  C2 c2;
equation
  connect(c1, c2);
end InvalidComplexConnectorType2;

// Result:
// Error processing file: InvalidComplexConnectorType2.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/scodeinst/InvalidComplexConnectorType2.mo:9:5-9:21:writable] Error: Parameter c1.x has neither value nor start value, and is fixed during initialization (fixed=true).
//
// Execution failed!
// endResult
