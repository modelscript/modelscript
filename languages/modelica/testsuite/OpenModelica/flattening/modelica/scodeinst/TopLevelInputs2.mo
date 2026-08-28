// name: TopLevelInputs2
// keywords:
// status: correct
//
// Top-level inputs with bindings should not be counted as top-level inputs
// without bindings if their binding is moved to an equation section.
//

model TopLevelInputs2
  input Real x[:] = {1, 2, 3};
end TopLevelInputs2;

// Result:
// class TopLevelInputs2
//   Real x[1];
//   Real x[2];
//   Real x[3];
// equation
//   x = {1.0, 2.0, 3.0};
// end TopLevelInputs2;
// endResult
