// name: InvalidComplexConnectorType4
// keywords:
// status: incorrect
//

model InvalidComplexConnectorType4
  connector C
    flow parameter Real x;
    Real y;
    flow Real f;
  end C;

  C c1, c2;
equation
  connect(c1, c2);
end InvalidComplexConnectorType4;

// Result:
// Error processing file: InvalidComplexConnectorType4.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/scodeinst/InvalidComplexConnectorType4.mo:8:5-8:26:writable] Error: Parameter c1.x has neither value nor start value, and is fixed during initialization (fixed=true).
//
// Execution failed!
// endResult
