// name: SubscriptedExp2
// status: incorrect
//
//

model SubscriptedExp2
  Real y = (1, 2, 3)[2];
end SubscriptedExp2;

// Result:
// Error processing file: SubscriptedExp2.mo
// [OpenModelica/flattening/modelica/scodeinst/SubscriptedExp2.mo:7:12-7:23:writable] Error: Tuple expression can not be subscripted.
// Error: Failed to load package SubscriptedExp2 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class SubscriptedExp2 not found in scope <top>.
// Error: Error occurred while flattening model SubscriptedExp2
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
