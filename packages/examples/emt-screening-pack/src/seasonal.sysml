package EmtSeasonalPowerFlowComparison {
  part def BulkGridPsse {
    attribute solver = "psse";
    attribute source = "data/poi_case.raw";
    attribute dyrSource = "data/poi_case.dyr";
  }

  part def InverterIslandPscad {
    attribute solver = "pscad";
    attribute source = "data/ibr_interconnection.pscx";
  }

  variation part def SeasonalOperatingScenarios {
    variant part SummerPeak {
      attribute season = "SummerPeak";
      attribute rawFile = "data/poi_case.raw";
      attribute dyrFile = "data/poi_case.dyr";
      attribute ambientTempC = 40;
      attribute windSpeedMs = 0.61;
    }

    variant part WinterPeak {
      attribute season = "WinterPeak";
      attribute rawFile = "data/poi_case.raw";
      attribute dyrFile = "data/poi_case.dyr";
      attribute ambientTempC = 0;
      attribute windSpeedMs = 1.8;
    }
  }

  requirement def SummerThermalAndVoltageEnvelope {
    assume constraint { season == "SummerPeak" }
    require constraint { minVmPu >= 0.90 and convergedPowerFlow == true and dlrRatingFactor >= 0.70 }
  }

  requirement def WinterThermalAndVoltageEnvelope {
    assume constraint { season == "WinterPeak" }
    require constraint { minVmPu >= 0.95 and convergedPowerFlow == true and dlrRatingFactor >= 1.15 }
  }
}
