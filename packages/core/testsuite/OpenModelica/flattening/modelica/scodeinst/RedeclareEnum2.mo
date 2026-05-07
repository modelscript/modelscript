// name: RedeclareEnum2
// keywords:
// status: incorrect
//

model A
  replaceable type E = enumeration(a);
  E e;
end A;

model RedeclareEnum2
  extends A(redeclare type E = enumeration(a, b, c));
end RedeclareEnum2;


// Result:
// Error processing file: RedeclareEnum2.mo
// [OpenModelica/flattening/modelica/scodeinst/RedeclareEnum2.mo:12:23-12:52:writable] Notification: From here:
// [OpenModelica/flattening/modelica/scodeinst/RedeclareEnum2.mo:7:15-7:38:writable] Error: Redeclaration of enumeration 'E' is not a subtype of the redeclared element (use enumeration(:) for a generic replaceable enumeration).
// Error: Error occurred while flattening model RedeclareEnum2
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
