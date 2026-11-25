plant IWA_Benchmark_BSM1 {
  model: ASM1;

  influent {
    flow: 18446.0 m3/day;
    S_S: 69.5;
    S_I: 30.0;
    X_I: 51.2;
    X_S: 202.32;
    X_BH: 28.17;
    S_NH: 31.56;
    S_NO: 0.0;
    S_ND: 6.95;
    X_ND: 10.59;
    S_ALK: 7.0;
  }

  recycle {
    internal_ratio: 3.0;
    sludge_ratio: 1.0;
    waste_flow: 385.0 m3/day;
  }

  bioreactor ANOXIC_1 {
    type: Anoxic;
    volume: 1000.0 m3;
    kla: 0.0;
  }

  bioreactor ANOXIC_2 {
    type: Anoxic;
    volume: 1000.0 m3;
    kla: 0.0;
  }

  bioreactor AEROBIC_3 {
    type: Aerobic;
    volume: 1333.0 m3;
    kla: 240.0;
    do_target: 2.0;
  }

  bioreactor AEROBIC_4 {
    type: Aerobic;
    volume: 1333.0 m3;
    kla: 240.0;
    do_target: 2.0;
  }

  bioreactor AEROBIC_5 {
    type: Aerobic;
    volume: 1333.0 m3;
    kla: 84.0;
    do_target: 2.0;
  }

  clarifier SECONDARY_CLARIFIER {
    area: 1500.0 m2;
    depth: 4.0 m;
    layers: 10;
    feed_layer: 5;
  }
}
