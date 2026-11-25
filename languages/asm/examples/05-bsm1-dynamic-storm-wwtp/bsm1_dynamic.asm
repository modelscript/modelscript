plant Metro_WWTP_Dynamic_BSM1 {
  model: ASM1;

  influent {
    flow: 22500.0 m3/day;
    S_S: 68.0;
    S_I: 29.0;
    X_I: 52.0;
    X_S: 205.0;
    X_BH: 29.0;
    S_NH: 31.0;
    S_NO: 0.0;
    S_ND: 6.8;
    X_ND: 10.4;
    S_ALK: 7.0;
  }

  recycle {
    internal_ratio: 3.5;
    sludge_ratio: 1.0;
    waste_flow: 420.0 m3/day;
  }

  bioreactor ANOXIC_1 {
    type: Anoxic;
    volume: 1200.0 m3;
    kla: 0.0;
  }

  bioreactor ANOXIC_2 {
    type: Anoxic;
    volume: 1200.0 m3;
    kla: 0.0;
  }

  bioreactor AEROBIC_3 {
    type: Aerobic;
    volume: 1600.0 m3;
    kla: 260.0;
    do_target: 2.2;
  }

  bioreactor AEROBIC_4 {
    type: Aerobic;
    volume: 1600.0 m3;
    kla: 240.0;
    do_target: 2.0;
  }

  bioreactor AEROBIC_5 {
    type: Aerobic;
    volume: 1600.0 m3;
    kla: 110.0;
    do_target: 2.0;
  }

  clarifier NORTH_CLARIFIER {
    area: 1850.0 m2;
    depth: 4.2 m;
    layers: 10;
    feed_layer: 5;
  }
}
