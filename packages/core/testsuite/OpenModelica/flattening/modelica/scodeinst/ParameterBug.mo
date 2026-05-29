within ;
package ParameterBug
  model A
    parameter Real Vdc = 1;
    extends B(redeclare D c, offset = Vdc);
  equation

  end A;

  model B
    parameter Real offset = 0;
    replaceable C c(final offset = offset);
  end B;

  model C
    parameter Real offset = 0;
    Real x;
  equation
    x = offset;
  end C;

  model D
    extends C;
    Real y = x;
  equation

  end D;
end ParameterBug;

// Result:
// Error processing file: ParameterBug.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/scodeinst/ParameterBug.mo:2:1-28:17:writable] Error: Cannot instantiate ParameterBug due to class specialization package.
//
// Execution failed!
// endResult
