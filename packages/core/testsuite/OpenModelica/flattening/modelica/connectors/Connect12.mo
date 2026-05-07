// name: Connect12
// keywords: array, connector, extending basictype
// status: correct
//
// This test is for connectors extending a basictype.
// New in Modelica v2.2.
//


connector RealSignal
  replaceable type SignalType = Real;
 extends SignalType;
end RealSignal;

connector RealInput = input RealSignal;
connector RealOutput = output RealSignal;
connector RealInput2 = input RealSignal(redeclare type SignalType = Real[2]);
connector RealOutput2 = output RealSignal(redeclare type SignalType = Real[2]);

model test
  RealInput x;
  RealOutput x2;
  RealInput2 v={1.,2.4};
  RealOutput2 v2;
  Real y;
  Real w[2];

equation
      x-y=0;
   connect(x,x2);
   connect(v,v2);
end test;

// Result:
// Error processing file: Connect12.mo
// Error: Failed to load package Connect12 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class Connect12 not found in scope <top>.
// Error: Error occurred while flattening model Connect12
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
