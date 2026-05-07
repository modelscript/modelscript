// name:     ModifiersProblem
// keywords: deep, modifiers
// status:   correct
//
// This tests deep modifiers problem that appeared (and was fixed):
//  Error: Variable s: In modifier (s), class or component s, not found in the built-in class Real
//  Error: Variable s: In modifier (start = 0.1), class or component start, not found in the built-in class Real

model Prismatic
  Real s;
 protected
  Real length = s;
end Prismatic;

model ModifierProblem
  Prismatic p1(s(start=0.1));
end ModifierProblem;

// Result:
// Error processing file: ModifierProblem.mo
// Error: Failed to load package ModifiersProblem (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class ModifiersProblem not found in scope <top>.
// Error: Error occurred while flattening model ModifiersProblem
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
