// name:     RedeclareInClassModification.mo [BUG: #3247]
// keywords: redeclare in class modification
// status:   correct
//

model B
  model B2
  replaceable type P = Real;
  P p;
  end B2;
  B2 b2;
end B;

model RedeclareInClassModification
  extends B(B2(redeclare type P = Integer));
  B2.P p;
end RedeclareInClassModification;


// Result:
// Error processing file: RedeclareInClassModification.mo
// [OpenModelica/flattening/modelica/redeclare/ClassExtends4.mo:41:3-41:37:writable] Error: Variable b in package B is not constant.
// [OpenModelica/flattening/modelica/redeclare/ClassExtends4.mo:45:3-45:39:writable] Error: Function B.usePart not found in scope ClassExtends4.
// Error: Error occurred while flattening model RedeclareInClassModification.mo [BUG: #3247]
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
