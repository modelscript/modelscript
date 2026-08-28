// name: enum6.mo
// keywords:
// status: correct
//

model M
  model P
    replaceable type E = enumeration(one, two, three);
    constant Real e[E];
  end P;

  type E = enumeration(a, b, c);

  P p(redeclare type E = E);
  Real e[P.E];
end M;

// Result:
// Error processing file: enum6.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/scodeinst/enum6.mo:14:17-14:27:writable] Notification: From here:
// [OpenModelica/flattening/modelica/scodeinst/enum6.mo:8:17-8:54:writable] Error: Redeclaration of enumeration 'E' is not a subtype of the redeclared element.
//
// Execution failed!
// endResult
