// name:     Extends4
// keywords: extends basictype cat operator
// status:   correct
//
// Testing extending basic type and contatenation operators (MC bug #643)

connector RealSignal
 replaceable type SignalType = Real;
 extends SignalType;
end RealSignal;

connector RealInput= input RealSignal;
connector RealOutput = output RealSignal;

block Multiplex3 "Multiplexer block for three input connectors"
  parameter Integer n1=1 "dimension of input signal connector 1";
  parameter Integer n2=1 "dimension of input signal connector 2";
  parameter Integer n3=1 "dimension of input signal connector 3";
 RealInput u1[n1];
 RealInput u2[n2];
 RealInput u3[n3];

 RealOutput y[n1+n2+n3];

equation
  [y]=[u1;u2;u3];
end Multiplex3;

// Result:
// Error processing file: Extends4.mo
// [<interactive>:8:14-8:36:writable] Notification: From here:
// [<interactive>:9:2-9:20:writable] Error: Class 'SignalType' in 'extends SignalType' is replaceable, the base class name must be transitively non-replaceable.
// Error: Error occurred while flattening model Multiplex3
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
