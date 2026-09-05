"""Discrete-step geometry guards (pure functions; no map, no robot).

Every case below reproduces a failure seen in the Scene 1 replay rehearsal
(docs/hackathon-runbook.md, "Pitfalls found in rehearsal"):
  * a legal step that parks the robot against a footprint boxes it in for the next leg;
  * a long straight pulse with a tolerated heading error clips a wall;
  * a residual smaller than one physical step needs a footprint-free heading, not a stop.
"""
import math
import unittest
from moontology_bridge.air_runtime import (
    LANE_CLEARANCE, ROBOT_FOOTPRINT_RADIUS, _discrete_step_toward, _driveable, _footprint_traversable,
    _point_polygon_clearance, _point_traversable, _segment_polygon_clearance, _step_is_clear)

# H01 (digging-bot) footprint from the committed scene atlas, planar (x,z).
H01=[(-6.22,.08),(-5.58,.08),(-5.58,.72),(-6.22,.72)]
GROUND=[(-30,-30),(30,-30),(30,30),(-30,30)]
WALKABLE=[{'id':'ground','kind':'terrain','validActions':['walk'],'polygon':GROUND}]
# Scene 1 habitat front as published by the map (sceneLayouts SCENE_1): the slanted NO_ENTRY north shell
# with the doorway cut into it, over the exterior apron.
APRON=[(-17,-23),(15,-23),(15,10),(-17,10)]
SHELL=[(-17,-25),(1.8,-25),(1.8,-21),(.6,-18.2),(-.1,-17),(-2.5,-15.8),(-8,-14.1),(-12,-15.5),(-17,-20)]
DOOR=[(-1.55,-18.95),(-.15,-18.95),(-.15,-16.2),(-1.55,-16.2)]
HABITAT=[{'id':'Exterior-Apron','kind':'terrain','validActions':['walk'],'polygon':APRON},
         {'id':'Building-North','kind':'building','validActions':[],'polygon':SHELL},
         {'id':'Doorway-2A','kind':'doorway','validActions':['approach','enter_world_2'],'polygon':DOOR}]


def observation(obstacles=(H01,), regions=WALKABLE):
    return {'layout':{'obstacles':[{'id':f'o{i}','polygon':list(p)} for i,p in enumerate(obstacles)],'regions':list(regions)}}


class StepGeometry(unittest.TestCase):
    def test_polygon_clearances(self):
        self.assertEqual(_point_polygon_clearance((-5.9,.4),H01),0.)          # inside
        self.assertAlmostEqual(_point_polygon_clearance((-5.58,1.72),H01),1.,places=6)
        self.assertEqual(_segment_polygon_clearance((-7,.4),(-5,.4),H01),0.)  # crosses
        self.assertAlmostEqual(_segment_polygon_clearance((-7,1.22),(-5,1.22),H01),.5,places=6)

    def test_step_must_end_with_planner_lane_clearance(self):
        # Westward step along z=1.23 stays 0.51 from H01: legal for the map's 0.4 rule, but it ends
        # against the footprint and every later southward step would graze H01 (rehearsal box-in).
        start=(-2.67,1.23); heading=math.pi; step=3.
        obstacles=observation()['layout']['obstacles']
        self.assertTrue(_step_is_clear(start,heading,step,obstacles,WALKABLE,end_clearance=ROBOT_FOOTPRINT_RADIUS+.05))
        self.assertFalse(_step_is_clear(start,heading,step,obstacles,WALKABLE))  # default LANE_CLEARANCE
        self.assertGreater(LANE_CLEARANCE,ROBOT_FOOTPRINT_RADIUS)

    def test_step_path_respects_map_footprint_rule(self):
        obstacles=observation()['layout']['obstacles']
        # From 0.49 north (+Z) of H01, a step toward -Z (map yaw +pi/2) crosses the footprint: never clear.
        self.assertFalse(_step_is_clear((-5.9,1.21),math.pi/2,3.,obstacles,WALKABLE,end_clearance=0.))
        # The same start stepping east moves away from H01 and is clear under the map rule.
        self.assertTrue(_step_is_clear((-5.9,1.21),0.,3.,obstacles,WALKABLE,end_clearance=ROBOT_FOOTPRINT_RADIUS+.05))

    def test_step_must_stay_on_registered_traversable_layout(self):
        obstacles=observation()['layout']['obstacles']
        tiny=[{'id':'pad','kind':'terrain','validActions':['walk'],'polygon':[(-1,-1),(1,-1),(1,1),(-1,1)]}]
        self.assertFalse(_step_is_clear((0,0),0.,3.,obstacles,tiny))  # leaves the registered area: 'Unregistered map area'
        self.assertTrue(_step_is_clear((0,0),0.,3.,obstacles,[]))  # no layout published: nothing to mirror

    def test_region_precedence_mirrors_world_layout_sample(self):
        # Building shell denies; the doorway cut into it allows; open apron allows; off the apron denies.
        self.assertFalse(_point_traversable((-5,-18),HABITAT,[]))
        self.assertTrue(_point_traversable((-1,-18),HABITAT,[]))
        self.assertTrue(_point_traversable((0,0),HABITAT,[]))
        self.assertFalse(_point_traversable((-20,0),HABITAT,[]))
        # The 0.4 footprint disc catches a centre that is legal but whose rim touches the slanted shell
        # (shell edge at x=-5 is z≈-15.03).
        self.assertTrue(_footprint_traversable((-5,-14.5),HABITAT,[]))
        self.assertFalse(_footprint_traversable((-5,-14.8),HABITAT,[]))

    def test_long_pulse_toward_doorway_is_refused_when_it_clips_the_shell(self):
        # Rehearsal failure: from (-5.76,-8.86) heading 1.30 rad (mostly -Z, slightly +X) a 7.2-unit pulse ends
        # at (-3.84,-15.8) whose footprint reaches the shell => the map answered 'map_boundary: North habitat shell'.
        start=(-5.76,-8.86); heading=1.30
        self.assertFalse(_step_is_clear(start,heading,7.2,[],HABITAT,end_clearance=0.))
        # One MIN_PULSE step (3 units) along the same heading stays on the apron.
        self.assertTrue(_step_is_clear(start,heading,3.,[],HABITAT,end_clearance=0.))
        # A short step straight into the doorway cut is allowed: doorway beats building (disc must fit the cut).
        self.assertTrue(_point_traversable((-.85,-17.5),HABITAT,[]))
        self.assertTrue(_step_is_clear((-.85,-14.5),math.pi/2,1.5,[],HABITAT,end_clearance=0.))
        # Stepping into the shell beside the doorway is not.
        self.assertFalse(_step_is_clear((-4,-12.5),math.pi/2,3.,[],HABITAT,end_clearance=0.))

    def test_sub_step_search_detours_around_footprint_and_makes_progress(self):
        obs=observation(); pose={'x':-5.44,'z':1.21,'yaw':1.33}
        goal=(-5.08,.7); target=(-6.9,-4.5)  # H02 far south; the waypoint is right past H01's corner
        choice=_discrete_step_toward(obs,pose,goal,target,3.)
        self.assertIsNotNone(choice)
        self.assertNotEqual(choice['offset_deg'],0)  # straight at the waypoint grazes H01
        end=choice['end']
        self.assertLess(math.hypot(target[0]-end[0],target[1]-end[1]),math.hypot(target[0]-pose['x'],target[1]-pose['z']))
        self.assertGreaterEqual(_point_polygon_clearance(end,H01),LANE_CLEARANCE)

    def test_candidate_heading_is_checked_across_the_band_it_may_be_driven_at(self):
        # Rehearsal: candidate 0.46 rad was clear, but the robot drove at its tolerated yaw 0.66 rad and the
        # map answered 'Occupied by H01'. The forward pulse fires anywhere within +-tolerance of the candidate,
        # so the whole band must be clear - independent of the current yaw, or the choice flip-flops between
        # two candidates on alternate turn pulses (leg-4 rehearsal burned eight steps that way).
        obstacles=observation()['layout']['obstacles']; start=(-6.02,1.47)
        self.assertTrue(_step_is_clear(start,.46,3.,obstacles,WALKABLE,end_clearance=0.))
        self.assertFalse(_step_is_clear(start,.66,3.,obstacles,WALKABLE,end_clearance=0.))
        for yaw in (.66,.46,1.2):
            self.assertFalse(_driveable(start,.46,yaw,3.,obstacles,WALKABLE,heading_tolerance=.30,end_clearance=0.),yaw)
        # A candidate whose whole band [-0.2, 0.4] is clear is drivable from any yaw.
        for yaw in (.1,.35,1.2):
            self.assertTrue(_driveable(start,.1,yaw,3.,obstacles,WALKABLE,heading_tolerance=.30,end_clearance=0.),yaw)
        # No tolerance: only the candidate ray itself is checked.
        self.assertTrue(_driveable(start,.46,1.2,3.,obstacles,WALKABLE,heading_tolerance=0.,end_clearance=0.))
        pose={'x':start[0],'z':start[1],'yaw':.66}
        choice=_discrete_step_toward(observation(),pose,(-5.02,.97),(-4.9,-5.6),3.,heading_tolerance=.30)
        self.assertIsNotNone(choice)
        self.assertTrue(abs(choice['heading']-.66)>.30 or _step_is_clear(start,.66,3.,obstacles,WALKABLE))

    def test_sub_step_search_refuses_when_no_progress_is_possible(self):
        # Target directly behind a wall the robot is already touching: every clear heading moves away.
        wall=[(-1,-10),(0,-10),(0,10),(-1,10)]
        obs=observation(obstacles=(wall,)); pose={'x':.45,'z':0.,'yaw':math.pi}
        self.assertIsNone(_discrete_step_toward(obs,pose,(-.5,0.),(-3.,0.),3.))

    def test_path_node_progress_is_measured_toward_the_node_not_the_target(self):
        # Grid-searched routes bend away from the target to round an obstacle. Toward an intermediate
        # node the robot must be allowed to step further from the target as long as it nears the node.
        wall=[(-1,-10),(0,-10),(0,10),(-1,10)]
        obs=observation(obstacles=(wall,)); pose={'x':2.,'z':0.,'yaw':math.pi/2}
        node=(2.,12.); target=(-3.,0.)           # route corner north of the wall's end; target behind the wall
        self.assertIsNone(_discrete_step_toward(obs,pose,node,target,3.))
        choice=_discrete_step_toward(obs,pose,node,target,3.,progress_toward=node)
        self.assertIsNotNone(choice)
        self.assertLess(math.hypot(node[0]-choice['end'][0],node[1]-choice['end'][1]),12.)


if __name__=='__main__':unittest.main()
