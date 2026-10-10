// name: RedeclareEnum4
// keywords:
// status: incorrect
//

model A
  replaceable type E = enumeration(:);
  E e;
end A;

model RedeclareEnum1
  extends A(redeclare type E = Real);
end RedeclareEnum1;


// Result:
// Error processing file: RedeclareEnum4.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/scodeinst/RedeclareEnum4.mo:12:23-12:36:writable] Notification: From here:
// [OpenModelica/flattening/modelica/scodeinst/RedeclareEnum4.mo:7:15-7:38:writable] Error: Redeclaration of enumeration 'E' is not a subtype of the redeclared element.
//
// Execution failed!
// endResult
