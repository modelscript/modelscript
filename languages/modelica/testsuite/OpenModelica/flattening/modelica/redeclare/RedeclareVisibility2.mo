// name:     RedeclareVisibility2
// keywords: redeclare, modification, constant
// status:   incorrect
//
// Checks that it's not allowed to modify a protected element with a replacement.
//

model M
  protected replaceable Real x;
end M;

model RedeclareVisibility2
  M m(replaceable Real x = 2.0);
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end RedeclareVisibility2;

// Result:
// class RedeclareVisibility2
//   Real m.x = 2.0;
// end RedeclareVisibility2;
// endResult
