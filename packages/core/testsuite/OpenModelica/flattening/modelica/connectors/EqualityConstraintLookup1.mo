// name:     EqualityConstraintLookup1
// keywords: connect equalityConstraint lookup #2163
// status:   correct
// cflags:   -i=P.M
//
// Checks that the equalityConstraint function of a connector can be found when
// the instantiated model is inside an encapsulated package.
//

package Modelica
  connector Pin
    Real v;
    flow Real i;
    Reference reference;
  end Pin;

  record Reference
    Real gamma;

    function equalityConstraint
      input Reference reference1;
      input Reference reference2;
      output Real residue[0];
    end equalityConstraint;
  end Reference;
end Modelica;

encapsulated package P
  import Modelica;

  model M
    Modelica.Pin pin1, pin2;
  equation
    connect(pin1, pin2);
  end M;
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end P;

// Result:
// class P
// end P;
// endResult
