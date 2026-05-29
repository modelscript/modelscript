// name: InvalidComplexConnectorType3
// keywords:
// status: incorrect
//

model InvalidComplexConnectorType3
  connector C
    Real y;
    flow Real f;
  end C;

  parameter C c1;
  parameter C c2;
equation
  connect(c1, c2);
end InvalidComplexConnectorType3;

// Result:
// Error processing file: InvalidComplexConnectorType3.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/scodeinst/InvalidComplexConnectorType3.mo:12:3-12:17:writable] Error: Invalid variability parameter on connector 'c1'.
//
// Execution failed!
// endResult
