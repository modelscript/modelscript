package EVThermalRequirements {
  attribute def Real;

  requirement def MaxCellTempRequirement {
    attribute maxAllowedTempC : Real = 55.0;
    attribute peakAmbientTempC : Real = 45.0;
  }

  requirement def CoolantFlowRequirement {
    attribute minFlowRateLpm : Real = 12.0;
    attribute maxPressureDropKPa : Real = 65.0;
  }
}
