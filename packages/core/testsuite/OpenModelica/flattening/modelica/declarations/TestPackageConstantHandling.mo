// name:     TestPackageConstantHandling.mo
// keywords: declaration, import
// status:   correct
//
// test that the imported constant can be used
//

package TestPackage
  type MyType = Real;

  package Water
  import TestPackage.Water.ConstantPropertyLiquidWater.simpleWaterConstants;
  package ConstantPropertyLiquidWater
    constant MyType simpleWaterConstants = blah;
    constant MyType blah = 1.0;
  end ConstantPropertyLiquidWater;
  end Water;
end TestPackage;

model TestPackageConstantHandling
  constant TestPackage.MyType x = TestPackage.Water.simpleWaterConstants;
end TestPackageConstantHandling;


// Result:
// Error processing file: TestPackageConstantHandling.mo
// [OpenModelica/flattening/modelica/declarations/TestPackageConstantHandling.mo:22:3-22:73:writable] Error: Found imported name 'simpleWaterConstants' while looking up composite name 'TestPackage.Water.simpleWaterConstants'.
// Error: Class TestPackageConstantHandling.mo not found in scope <top>.
// Error: Error occurred while flattening model TestPackageConstantHandling.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
