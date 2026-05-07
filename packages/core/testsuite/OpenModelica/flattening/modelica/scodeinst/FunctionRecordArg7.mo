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
end FunctionRecordArg7;

// Result:
// function flowParametersInternal "Automatically generated record constructor for flowParametersInternal"
//   input Integer n;
//   input Real[n] V_flow;
//   output flowParametersInternal res;
// end flowParametersInternal;
//
// function power
//   input flowParametersInternal pressure;
//   output Real[11] power;
// algorithm
//   power := array(pressure.V_flow[pressure.n] * /*Real*/(i) for i in 0:10);
// end power;
//
// class FunctionRecordArg7
//   final parameter Integer pCur1.n = 3;
//   parameter Real pCur1.V_flow[1] = 1.0;
//   parameter Real pCur1.V_flow[2] = 1.0;
//   parameter Real pCur1.V_flow[3] = 1.0;
//   parameter Real[11] powEu_internal = power(pCur1);
// end FunctionRecordArg7;
// endResult
