// name:     Modification16 [bug #1238]
// keywords: modification
// status:   correct
//


model Modification16

  model Inertia
    parameter Real J;
    Real phi;
    Real w;
  equation
    phi = 1;
    w = 1;
  end Inertia;

  Inertia inertia1(w.start = 1, w.stateSelect=StateSelect.always, J=1, phi.start=0, phi.stateSelect=StateSelect.always);
end Modification16;

// Result:
// Error processing file: Modification16.mo
// [OpenModelica/flattening/modelica/modification/DuplicateMod4.mo:11:29-11:34:writable] Notification: From here:
// [OpenModelica/flattening/modelica/modification/DuplicateMod4.mo:11:7-11:27:writable] Error: Duplicate modification of element x on component a.
// Error: Class DuplicateMod4.mo not found in scope <top>.
// Error: Error occurred while flattening model Modification16 [bug #1238]
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
