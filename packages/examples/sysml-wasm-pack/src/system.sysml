package SysmlWasmPack {
  verification def StepResponseCheck {
    attribute model = "src/plant.mo";
    attribute target = 1.0;
    attribute tau = 0.2;
    attribute implementation = "./assembly/analyzer.ts#analyzeStep";
    require constraint { overshoot <= 0.25 and settlingError <= 0.05 }
  }

  verification def SpectrumCheck {
    attribute fundamentalHz = 50;
    attribute sampleRateHz = 1600;
    require constraint { freqErrorHz <= 1.0 }
  }
}
