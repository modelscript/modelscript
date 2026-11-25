// Modular Planetary Gearbox Top-Level Assembly
include <params.scad>
use <involute_gear.scad>
use <housing.scad>

// Sun gear at center
parametric_gear(m = gear_module, z = sun_teeth, width = gear_width, bore_r = 4.0);

// Three orbiting planet gears
for (p = [0 : planet_count - 1]) {
  rotate([0, 0, p * 360 / planet_count])
    translate([carrier_orbit_r, 0, 0])
      parametric_gear(m = gear_module, z = planet_teeth, width = gear_width, bore_r = 3.0);
}

// Outer ring housing
translate([0, 0, -2])
  gearbox_housing(outer_r = housing_outer_r, inner_r = gear_module * ring_teeth / 2.0 + 1.0, height = gear_width + 4.0);
