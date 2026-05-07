// name:     CardinalityArray
// keywords: cardinality #2585
// status:   correct
//
// Tests the cardinality operator when arrays are involved.
//

connector C
  Real e;
  flow Real f;
end C;

model A
  C c;
end A;

model CardinalityArray
  A a1[2], a2[2];
  Integer c = cardinality(a1[1].c);
equation
  connect(a1.c, a2.c);
end CardinalityArray;

// Result:
// Error processing file: CardinalityArray.mo
// [OpenModelica/flattening/modelica/operators/CardinalityArray.mo:19:3-19:35:writable] Error: cardinality may only be used in the condition of an if-statement/equation or an assert.
// Error: Error occurred while flattening model CardinalityArray
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
