// name:     ColorPixel
// keywords: <insert keywords here>
// status:   correct
//
// Drmodelica: 7.1 Type Checking (p. 209)
//

type ColorPixel = Real[3];

class ColorPixelInst
  ColorPixel[10, 10] image = fill(10.0, 10.0, 10.0, 3.0);
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end ColorPixelInst;

// insert expected flat file here. Can be done by issuing the command
// ./omc XXX.mo >> XXX.mo and then comment the inserted class.
//
// class <XXX>
// Real x;
// end <XXX>;

// Result:
// Error processing file: ColorPixel.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Error: Internal error - Types.matchTypes failed for 10.0 from Real to Integer
// [OpenModelica/flattening/modelica/types/ColorPixel.mo:11:3-11:57:writable] Error: Internal error Static.elabBuiltinFill failed in component<NO COMPONENT> and scope: ColorPixelInst for expression: fill(10.0, 10.0, 10.0, 3.0)
// Error: Error occurred while flattening model ColorPixelInst
//
// Execution failed!
// endResult
