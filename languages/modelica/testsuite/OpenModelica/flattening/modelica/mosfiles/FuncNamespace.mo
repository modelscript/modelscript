function TestFunc
  input Real x;
  output Real y;
algorithm
  y := x * 3.0;
end TestFunc;

package TestPkg

  function TestFunc
    input Real x;
    output Real y;
  algorithm
    y := x ^ 3.0;
  end TestFunc;

  class TestClass

    function TestFunc
      input Real x;
      output Real y;
    algorithm
      y := 3.0 ^ x;
    end TestFunc;

  end TestClass;

end TestPkg;

function TestPkg_TestFunc
  input Real x;
  output Real y;
algorithm
  y := x + 1.0;
end TestPkg_TestFunc;

function TestPkg_TestClass_TestFunc
  input Real x;
  output Real y;
algorithm
  y := x + 2.0;
end TestPkg_TestClass_TestFunc;

// Result:
// Error processing file: FuncNamespace.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/mosfiles/FuncNamespace.mo:37:1-42:31:writable] Error: Cannot instantiate TestPkg_TestClass_TestFunc due to class specialization function.
//
// Execution failed!
// endResult
