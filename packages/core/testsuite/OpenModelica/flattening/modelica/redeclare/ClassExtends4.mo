// name: ClassExtends4
// keywords: class, extends
// status: correct
//
// Tests that partial packages may be extended, and functions inside
// redeclared.
//

partial package A
  function usePart
    input Integer a;
    output Integer b;
  algorithm
    b := part(a);
  end usePart;

  replaceable partial function part
    input Integer a;
    output Integer b;
  end part;

  replaceable partial function part2
    input Integer a;
    output Integer b;
  end part2;
end A;

package B
  extends A;

  redeclare function extends part2
  algorithm
    b := a;
  end part2;

  redeclare function extends part
  algorithm
    b := part2(a);
  end part;

  Integer b = usePart(integer(time));
end B;

model ClassExtends4
  Integer b = B.usePart(integer(time));
end ClassExtends4;

// Result:
// Error processing file: ClassExtends4.mo
// [OpenModelica/flattening/modelica/redeclare/ClassExtends4.mo:41:3-41:37:writable] Error: Variable b in package B is not constant.
// [OpenModelica/flattening/modelica/redeclare/ClassExtends4.mo:45:3-45:39:writable] Error: Function B.usePart not found in scope ClassExtends4.
// Error: Error occurred while flattening model ClassExtends4
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
