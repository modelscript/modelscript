library package ASME_BPVC_VIII_1 {
  calc def AllowableStress {
    @LookupTable { table = "SA516_Gr70_AllowableStress"; }
    in materialSpec : String;
    in designTempF : Real;
    return : Real;
  }

  calc def UG27MinThickness {
    in P : Real;
    in R : Real;
    in S : Real;
    in E : Real;
    return : Real = (P * R) / (S * E - 0.6 * P);
  }

  calc def UG32EllipsoidalMinThickness {
    in P : Real;
    in D : Real;
    in K : Real;
    in S : Real;
    in E : Real;
    return : Real = (P * D * K) / (2.0 * S * E - 0.2 * P);
  }

  @StandardClause {
    standard = "ASME BPVC VIII-1";
    edition = "2023";
    clauseId = "UG-27(c)(1)";
    severity = "error";
  }
  requirement def UG27_ShellThickness {
    subject vessel : CylindricalVessel;
    assume constraint { vessel.P > 0.0 }
    require constraint {
      vessel.t_wall >= UG27MinThickness(
        vessel.P,
        vessel.R,
        AllowableStress(vessel.materialSpec, vessel.designTempF),
        vessel.E
      )
    }
  }

  @StandardClause {
    standard = "ASME BPVC VIII-1";
    edition = "2023";
    clauseId = "UG-32(d)";
    severity = "error";
  }
  requirement def UG32_EllipsoidalHead {
    subject vessel : CylindricalVessel;
    assume constraint { vessel.P > 0.0 }
    require constraint {
      vessel.t_head >= UG32EllipsoidalMinThickness(
        vessel.P,
        vessel.D,
        1.0,
        AllowableStress(vessel.materialSpec, vessel.designTempF),
        vessel.E
      )
    }
  }

  @StandardClause {
    standard = "ASME BPVC VIII-1";
    edition = "2023";
    clauseId = "UG-99(b)";
    severity = "error";
  }
  requirement def UG99_HydrostaticTest {
    subject vessel : CylindricalVessel;
    assume constraint { vessel.MAWP > 0.0 }
    require constraint {
      vessel.P_hydro >= 1.3 * vessel.MAWP
    }
  }

  @StandardClause {
    standard = "ASME BPVC VIII-1";
    edition = "2023";
    clauseId = "UG-125(a)";
    severity = "error";
  }
  requirement def UG125_ReliefSetPressure {
    subject vessel : CylindricalVessel;
    assume constraint { vessel.MAWP > 0.0 }
    require constraint {
      vessel.P_set <= vessel.MAWP
    }
  }
}
