*KEYWORD
*TITLE
Three-Point Bending of Composite Beam with Rigid Impactor
$ Multi-file assembly companion decks: beam_mesh.k, impactor.k, mat_comp.k
*INCLUDE
beam_mesh.k
impactor.k
mat_comp.k
*NODE
1, 0.00, 0.00, 0.00, 0, 0
2, 0.15, 0.00, 0.00, 0, 0
3, 0.30, 0.00, 0.00, 0, 0
4, 0.45, 0.00, 0.00, 0, 0
5, 0.60, 0.00, 0.00, 0, 0
10, 0.30, 0.02, 0.00, 0, 0
11, 0.30, 0.06, 0.00, 0, 0
*ELEMENT_BEAM
1, 1, 1, 2, 0
2, 1, 2, 3, 0
3, 1, 3, 4, 0
4, 1, 4, 5, 0
5, 2, 10, 11, 0
*PART
Composite Structural Beam
1, 1, 1, 0, 0, 0, 0, 0
Rigid Steel Impactor
2, 2, 2, 0, 0, 0, 0, 0
*SECTION_BEAM
1, 1, 1.0
0.03, 0.03, 0.015, 0.015
*SECTION_BEAM
2, 1, 1.0
0.04, 0.04, 0.04, 0.04
*MAT_PLASTIC_KINEMATIC
1, 1600.0, 6.8e10, 0.28, 4.2e8, 2.5e9, 0.0
*MAT_RIGID
2, 7850.0, 2.1e11, 0.3
*BOUNDARY_SPC_NODE
1, 0, 1, 1, 1, 0, 0, 0
5, 0, 0, 1, 1, 0, 0, 0
*DEFINE_CURVE
1, 0, 1.0, 1.0, 0.0, 0.0
0.0, 0.0
0.005, 1.0
0.015, 1.0
*LOAD_NODE_POINT
3, 2, 1, -18000.0
*SET_NODE_LIST
1
10, 11
*INITIAL_VELOCITY
1, 0.0, -5.0, 0.0
*CONTROL_TERMINATION
0.015, 0, 0.0, 0.0, 0.0
*CONTROL_TIMESTEP
0.0, 0.9, 0, 0.0, 0.0
*DATABASE_GLSTAT
0.00025
*END
