// name: ConnectEnumArray
// keywords: connect enum array
// status: correct
//
// Tests that enumeration indices are preserved when connecting arrays with
// enumerations as dimensions.
//

type MyEnum = enumeration (e1, e2, e3, e4, e5);

block MyBlock
  input Real [MyEnum,5] in1;
  flow input Real [5,MyEnum] in2;
  output Real [5,MyEnum] out1;
  flow output Real [MyEnum,5] out2;
end MyBlock;

block MyLayout
  MyBlock b1, b2;
equation
  connect (b2.in1, b1.out1);
  connect (b2.in2, b1.out2);
end MyLayout;

block Test = MyLayout 

// Result:
// Error processing file: ConnectEnumArray.mo
// [OpenModelica/flattening/modelica/connectors/ConnectEnumArray.mo:282:0-282:0:writable] Error: Missing token: SEMICOLON
// Error: Failed to load package ConnectEnumArray (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class ConnectEnumArray not found in scope <top>.
// Error: Error occurred while flattening model ConnectEnumArray
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
