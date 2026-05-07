// name:     MissingModifiersPackages.mo [BUG: #3095]
// keywords: class modification handling
// status:   correct
//

package Types
  type SpecificEnergy = Real(final quantity = "SpecificEnergy", final unit = "J/kg");
  type SpecificEnthalpy1 = SpecificEnergy;
  type SpecificEnthalpy = SpecificEnthalpy1(min = -1.0e10, max = 1.e10, nominal = 1.e6);
end Types;

package A
 extends Types;
 model M
  parameter SpecificEnthalpy h = 1;
 end M;
end A;

package B
 extends A(SpecificEnthalpy(start = 1.0e5, nominal = 5.0e5));
end B;

package C = B;

model MissingModifiersPackages
 A.M m1;
 B.M m2;
 C.M m3;
end MissingModifiersPackages;

// Result:
// class Modification11
//   Real a.b1.x = 1.0;
//   Real a.b2.x = 17.0;
// end Modification11;
// [OpenModelica/flattening/modelica/modification/Modification11.mo:7:3-7:15:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/modification/Modification11.mo:11:3-11:7:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/modification/Modification11.mo:12:3-12:7:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/modification/Modification11.mo:16:3-16:20:writable] Warning: Components are deprecated in class.
// endResult
