plant A2O_EBPR_ASM2d {
  model: ASM2d;

  influent {
    flow: 24000.0 m3/day;
    S_F: 38.0;
    S_A: 24.0;
    S_I: 30.0;
    X_I: 48.0;
    X_S: 190.0;
    X_H: 30.0;
    S_NH4: 34.0;
    S_PO4: 8.5;
    S_NO3: 0.0;
    S_ALK: 7.2;
  }

  recycle {
    internal_ratio: 3.2;
    sludge_ratio: 1.0;
    waste_flow: 480.0 m3/day;
  }

  bioreactor ANAEROBIC_PAO {
    type: Anaerobic;
    volume: 1200.0 m3;
    kla: 0.0;
  }

  bioreactor ANOXIC_DENIT {
    type: Anoxic;
    volume: 1800.0 m3;
    kla: 0.0;
  }

  bioreactor AEROBIC_UPTAKE_1 {
    type: Aerobic;
    volume: 2200.0 m3;
    kla: 250.0;
    do_target: 2.2;
  }

  bioreactor AEROBIC_UPTAKE_2 {
    type: Aerobic;
    volume: 2200.0 m3;
    kla: 160.0;
    do_target: 2.0;
  }

  clarifier FINAL_SETTLER {
    area: 1950.0 m2;
    depth: 4.2 m;
    layers: 10;
    feed_layer: 5;
  }
}
