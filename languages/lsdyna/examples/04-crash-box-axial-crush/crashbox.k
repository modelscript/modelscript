*KEYWORD
*TITLE
Automotive DP600 Steel Crash Box Axial Crush Simulation
$ Modular companion decks: mesh.k and steel_dp600.k
*INCLUDE
mesh.k
steel_dp600.k
*NODE
1, 0.00, 0.00, 0.00, 0, 0
2, 0.08, 0.00, 0.00, 0, 0
3, 0.08, 0.08, 0.00, 0, 0
4, 0.00, 0.08, 0.00, 0, 0
5, 0.00, 0.00, 0.15, 0, 0
6, 0.08, 0.00, 0.15, 0, 0
7, 0.08, 0.08, 0.15, 0, 0
8, 0.00, 0.08, 0.15, 0, 0
*ELEMENT_SHELL
1, 1, 1, 2, 6, 5
2, 1, 2, 3, 7, 6
3, 1, 3, 4, 8, 7
4, 1, 4, 1, 5, 8
*PART
DP600 Crash Box Tube
1, 1, 1, 0, 0, 0, 0, 0
*SECTION_SHELL
1, 2, 0.833, 5
0.002, 0.002, 0.002, 0.002
*MAT_PLASTIC_KINEMATIC
1, 7850.0, 2.1e11, 0.3, 3.8e8, 1.5e9, 0.0
*SET_NODE_LIST
1
5, 6, 7, 8
*INITIAL_VELOCITY
1, 0.0, 0.0, -15.6
*BOUNDARY_SPC_NODE
1, 0, 1, 1, 1, 1, 1, 1
2, 0, 1, 1, 1, 1, 1, 1
3, 0, 1, 1, 1, 1, 1, 1
4, 0, 1, 1, 1, 1, 1, 1
*CONTROL_TERMINATION
0.015, 0, 0.0, 0.0, 0.0
*CONTROL_TIMESTEP
0.0, 0.9, 0, 0.0, 0.0
*DATABASE_GLSTAT
0.0002
*END
