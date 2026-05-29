// name: NonexistentRedeclareModifier1
// keywords:
// status: incorrect
//

model M
end M;

model NonexistentRedeclareModifier1
  M m(redeclare Real x = 5);
end NonexistentRedeclareModifier1;

// Result:
// Error processing file: NonexistentRedeclareModifier1.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/scodeinst/NonexistentRedeclareModifier1.mo:10:7-10:27:writable] Error: Modified element x not found in class M.
//
// Execution failed!
// endResult
