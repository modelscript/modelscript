// name:     ModifyFunction1
// keywords: modification function
// status:   correct
//
// Tests modification of functions by introducing a default binding for an input
// parameter.
//

function quadraticFlow
  input Real V_flow;
  output Real head;
  input Real V_flow_nominal;
end quadraticFlow;

model Inverse
  function flowCharacteristic = quadraticFlow(V_flow_nominal = V_flow_op);
  parameter Real V_flow_op = 1;
  Real head;
equation
  head = flowCharacteristic(1);
end Inverse;

// Result:
// Error processing file: ModifyFunction1.mo
// Error: Failed to load package ModifyFunction1 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class ModifyFunction1 not found in scope <top>.
// Error: Error occurred while flattening model ModifyFunction1
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
