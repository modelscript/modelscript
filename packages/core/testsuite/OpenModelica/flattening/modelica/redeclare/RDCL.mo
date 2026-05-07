// name:     RDCL.mo [BUG: #2346]
// keywords: redeclare check
// status:   correct

package B
  connector Flange_b
    Real phi;
    flow Real tau;
  end  Flange_b;

  partial model Base
   parameter Real pD;
   Flange_b f_b;
  end Base;

  model BaseImpl
    parameter Real pD;
    Real y;
    Flange_b f_b;
  end BaseImpl;

  model WA
    parameter Real diam = 1;
    replaceable Base cm(pD = diam);
    Real x = cm.f_b.phi;
  end WA;
end B;

model RDCL
  B.WA w(redeclare B.BaseImpl cm);
end RDCL;


// Result:
// Error processing file: RDCL.mo
// [OpenModelica/flattening/modelica/redeclare/ClassExtends3.mo:42:3-42:37:writable] Error: Variable b in package B is not constant.
// [OpenModelica/flattening/modelica/redeclare/ClassExtends3.mo:46:3-46:39:writable] Error: Function B.usePart not found in scope ClassExtends3.
// Error: Error occurred while flattening model RDCL.mo [BUG: #2346]
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
