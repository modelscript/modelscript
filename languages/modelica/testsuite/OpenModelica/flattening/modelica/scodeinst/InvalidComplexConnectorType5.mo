// name: InvalidComplexConnectorType5
// keywords:
// status: incorrect
//

model InvalidComplexConnectorType5
  connector C
    Real x;
    flow Real y;
    CC c;
  end C;

  connector CC
    flow Real x;
    Real y;
  end CC;

  connector C2
    Real x;
    flow Real y;
    CC2 c;
  end C2;

  connector CC2
    Real x;
    flow Real y;
  end CC2;

  C c1;
  C2 c2;
equation
  connect(c1, c2);
end InvalidComplexConnectorType5;

// Result:
// Error processing file: InvalidComplexConnectorType5.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/scodeinst/InvalidComplexConnectorType5.mo:32:3-32:18:writable] Error: The connectors in connect(c1, c2) are not type compatible.
//
// Execution failed!
// endResult
