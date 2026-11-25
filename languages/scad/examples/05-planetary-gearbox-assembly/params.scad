// Shared planetary gearbox design parameters (mm)
gear_module = 1.5;
sun_teeth = 16;
planet_teeth = 12;
ring_teeth = 40;
planet_count = 3;
gear_width = 12.0;
carrier_orbit_r = gear_module * (sun_teeth + planet_teeth) / 2.0;
housing_outer_r = gear_module * ring_teeth / 2.0 + 10.0;
