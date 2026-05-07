// name: Operators.mo
// keywords: operators
// status: correct
//
// Tests the different operators in the Modelica language
// Simple mathematical operations are tested in Expressions.mo
//

model OtherModel
  parameter Integer i1 = 12;
  parameter Integer i2 = 8;
end OtherModel;

function f
  input Integer inInt;
  output Integer outInt;
algorithm
  outInt := inInt + 1138;
end f;

model Operators
  constant Integer unusedArray1[3] = {1,2,3};
  constant Integer unusedArray2[1, 3] = [2,3,4];
  constant Integer unusedMatrix[2, 2] = [3,4;5,6];
  constant Integer unusedArray3[7,1] = [1:2:14];
  constant Boolean b = true;
  constant String s = "te" + "st";
  Integer iarr[2];
  OtherModel om;
  Integer i1;
  Integer i2;
  Integer i3;
equation
  iarr[1] = 2;
  iarr[2] = 3;
  om.i1 = iarr[1];
  om.i2 = iarr[2];
  i1 = 4711;
  i2 = f(i1);
  i3 = if b then 36 else 37;
end Operators;

// Result:
// Error processing file: Operators.mo
// Error: Class Operators.mo not found in scope <top>.
// Error: Error occurred while flattening model Operators.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
