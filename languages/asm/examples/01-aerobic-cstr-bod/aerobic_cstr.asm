plant Single_Aerobic_CSTR {
  model: ASM1;

  influent {
    flow: 5000.0 m3/day;
    S_S: 65.0;
    S_I: 28.0;
    X_I: 45.0;
    X_S: 185.0;
    X_BH: 25.0;
    S_NH: 28.0;
    S_NO: 0.0;
    S_ND: 6.0;
    X_ND: 9.5;
    S_ALK: 6.8;
  }

  recycle {
    internal_ratio: 0.0;
    sludge_ratio: 0.75;
    waste_flow: 110.0 m3/day;
  }

  bioreactor AERATION_BASIN {
    type: Aerobic;
    volume: 1600.0 m3;
    kla: 180.0;
    do_target: 2.0;
  }

  clarifier FINAL_CLARIFIER {
    area: 450.0 m2;
    depth: 3.5 m;
    layers: 10;
    feed_layer: 5;
  }
}
