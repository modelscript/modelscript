// name:     Ticket4365
// status:   correct

package Ticket4365
  model Top
    inner Real a;    
    Sub1 s1;
    
  initial algorithm
      a := 0;      
    
  algorithm
    when time > 1 then
      a := 1;
    end when;
  end Top;

  
  model Sub1
    outer Real a;    
  algorithm
    when time > 2 then
      a := 2;
    end when;
  end Sub1;

end Ticket4365;

// Result:
// class Ticket4365.Sub1
//   Real a;
// algorithm
//   when time > 2.0 then
//     a := 2.0;
//   end when;
// end Ticket4365.Sub1;
// [flattening/modelica/algorithms-functions/Ticket4365.mo:20:5-20:18:writable] Warning: No corresponding 'inner' declaration found for component .Real a declared as 'outer'.
//   The existing 'inner' components are:
//     There are no 'inner' components defined in the model in any of the parent scopes of 'outer' component's scope: Ticket4365.Sub1.
//   Check if you have not misspelled the 'outer' component name.
//   Please declare an 'inner' component with the same name in the top scope.
//   Continuing flattening by only considering the 'outer' component declaration.
// endResult
