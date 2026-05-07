// name: ClassExtends3
// keywords: class, extends
// status: correct
//
// Tests that partial packages may be extended, and functions inside
// redeclared. Constants inherited will use the full functions to calculate
// their values.
//

partial package A
  function usePart
    input Integer a;
    output Integer b;
  algorithm
    b := part2(part(a));
  end usePart;

  replaceable partial function part
    input Integer a;
    output Integer b;
  end part;

  replaceable partial function part2
    input Integer a;
    output Integer b;
  end part2;

  constant Integer X = usePart(1);
  constant Integer Y = part(1);
end A;

package B
  extends A;
  redeclare function extends part
  algorithm
    b := a;
  end part;
  redeclare function extends part2
  algorithm
    b := a;
  end part2;
  Integer b = usePart(integer(time));
end B;

model ClassExtends3
  Integer b = B.usePart(integer(time));
end ClassExtends3;

// Result:
// Error processing file: ClassExtends3.mo
// [OpenModelica/flattening/modelica/redeclare/ClassExtends3.mo:42:3-42:37:writable] Error: Variable b in package B is not constant.
// [OpenModelica/flattening/modelica/redeclare/ClassExtends3.mo:46:3-46:39:writable] Error: Function B.usePart not found in scope ClassExtends3.
// Error: Error occurred while flattening model ClassExtends3
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
