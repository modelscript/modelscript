// name:     Cardinality3
// keywords: cardinality #2062
// status:   correct
//
// Tests the cardinality operator.
//

connector BooleanInput = input Boolean;
connector BooleanOutput = output Boolean;

block And
  BooleanInput u1;
  BooleanInput u2;
  BooleanOutput y;
equation
  y = u1 and u2;
end And;

model Cardinality3
  BooleanInput u;
  And and1;
  parameter Integer c = cardinality(u);
  parameter Integer c1 = cardinality(and1.u1);
  parameter Integer c2 = cardinality(and1.u2);
equation
  connect(u, and1.u1);
  connect(u, and1.u2);
end Cardinality3;

// Result:
// Error processing file: Cardinality3.mo
// [OpenModelica/flattening/modelica/operators/Cardinality3.mo:22:3-22:39:writable] Error: cardinality may only be used in the condition of an if-statement/equation or an assert.
// Error: Error occurred while flattening model Cardinality3
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
