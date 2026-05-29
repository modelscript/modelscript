// name: FunctionRecordArg7
// keywords:
// status: correct
//

record flowParametersInternal
  parameter Integer n annotation(Evaluate = true);
  parameter Real V_flow[n];
end flowParametersInternal;

function power
  input flowParametersInternal pressure;
  output Real power[11];
algorithm
  power := {pressure.V_flow[end]*i for i in 0:10};
end power;

model FunctionRecordArg7
  parameter flowParametersInternal pCur1(n = 3, V_flow = ones(3));
  parameter Real powEu_internal[:] = power(pressure = pCur1);
  annotation(__OpenModelica_commandLineOptions="-d=evaluateAllParameters");
end FunctionRecordArg7;

// Result:
// Error processing file: FunctionRecordArg7.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [/var/lib/jenkins2/ws/LINUX_BUILDS/tmp.build/openmodelica-1.26.7~1-g2b913cc/OMCompiler/Compiler/NFFrontEnd/NFCeval.mo:1140:9-1140:67:writable] Error: Internal error NFCeval.evalBinaryMul failed to evaluate ‘({1.0, 1.0, 1.0})[pressure.n] * 0.0‘
//
// Execution failed!
// endResult
