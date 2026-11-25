package UAVAirframe {
  attribute def Real;

  port def StructuralMount {
    attribute loadLimitN : Real;
  }

  part def WingAssembly {
    attribute wingspanM : Real = 3.2;
    attribute wingAreaM2 : Real = 0.96;
    attribute massKg : Real = 2.4;
    port rootMount : StructuralMount;
  }

  part def Fuselage {
    attribute lengthM : Real = 1.85;
    attribute massKg : Real = 3.1;
    port wingAttach : StructuralMount;
    port tailAttach : StructuralMount;
  }

  part def Tailplane {
    attribute massKg : Real = 0.85;
    port boomMount : StructuralMount;
  }

  part def FixedWingUAV {
    attribute maxTakeoffMassKg : Real = 12.0;
    part fuselage : Fuselage;
    part wing : WingAssembly;
    part tail : Tailplane;
    connection wingJoint connect fuselage.wingAttach to wing.rootMount;
    connection tailJoint connect fuselage.tailAttach to tail.boomMount;
  }
}
