// name: BackSampleTest
// keywords: synchronous features
// status: correct

model BackSampleTest
  output Real x;
  output Boolean y[2];
  Boolean z[2];
equation
  x = backSample(1.0, 2, 4);
  y = backSample(z, 3);
end BackSampleTest;

// Result:
// class BackSampleTest
//   output Real x;
//   output Boolean y[1];
//   output Boolean y[2];
//   Boolean z[1];
//   Boolean z[2];
// equation
//   x = backSample(1.0, 2, 4);
//   y = backSample(z, 3, 1);
// end BackSampleTest;
// [/var/lib/jenkins/ws/LINUX_BUILDS/tmp.build/openmodelica-1.26.3~1-g7583224/OMCompiler/Compiler/NFFrontEnd/NFCeval.mo:2102:9-2103:55:writable] Error: Internal error NFCeval.evalBuiltinCall: unimplemented case for backSample
// endResult
