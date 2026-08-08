// Each rule module exports a small object that the viewer mounts when the user
// selects it from the dropdown. The contract:
//
//   id            string — slug shown in the URL hash (future) and select value
//   label         string — human label in the dropdown
//   mount(host, state)        — build the rule's side-panel DOM into `host`
//   update(state)             — called on every frame change to refresh DOM
//   draw(ctx, state)          — called on every redraw to paint extras on canvas
//   skeletonStyle(state)      — optional, returns style overrides for drawSkeleton
//
// To add a new rule: drop a file in rules/, import + push it here.

import { OverviewRule } from "./inspect/overview.js";
import { GuardDropRule } from "./rules/guard_drop.js";
import { GuardHeightRule } from "./research/guard_height.js";
import { ArmExtensionRule } from "./rules/arm_extension.js";
import { HandReturnPathRule } from "./rules/hand_return_path.js";
import { HeadOffCenterLensRule } from "./research/head_offcenter.js";
import { HitHeightRule } from "./rules/hit_height.js";
import { BladednessRule } from "./research/bladedness.js";
import { BladednessFramesRule } from "./research/bladedness_frames.js";
import { BladednessPairsRule } from "./research/bladedness_pairs.js";
import { BladednessCoachRule } from "./research/bladedness_coach.js";
import { BlazePoseInspectorRule } from "./inspect/blazepose_inspector.js";
import { ElbowTuckRule } from "./research/elbow_tuck.js";
import { StepPunchSyncRule } from "./rules/step_punch_sync.js";
import { StepDetectorRule } from "./rules/step_detector.js";
import { HipRotationReviewRule } from "./rules/hip_rotation_review.js";
import { HipRotationModelRule } from "./models/hip_rotation.js";
import { AngleChangeRule } from "./rules/pivot_rate.js";
import { ShoulderGateRule } from "./research/shoulder_gate.js";
import { SideSetRule } from "./research/side_set.js";
import { PunchClassifierRule } from "./models/punch_classifier.js";
import { OnDeviceLensRule } from "./inspect/ondevice.js";
import { PoseCoverageLensRule } from "./inspect/pose_coverage.js";
import { SkeletonCompareRule } from "./inspect/skeleton_compare.js";
import { StanceWidthLensRule } from "./rules/stance_width.js";
import { AudioImpactLensRule } from "./models/audio_impact.js";
import { ImpactSpotterLensRule } from "./models/impact_spotter.js";
import { PunchPredictionsRule } from "./models/punch_predictions.js";
import { RollDuckLensRule } from "./research/roll_duck.js";

// Overview stays first as the default; the rest are alphabetical by label.
export const RULES = [
  OverviewRule,
  AngleChangeRule,
  ArmExtensionRule,
  AudioImpactLensRule,
  BladednessRule,
  BladednessFramesRule,
  BladednessPairsRule,
  BladednessCoachRule,
  BlazePoseInspectorRule,
  ElbowTuckRule,
  GuardDropRule,
  GuardHeightRule,
  HandReturnPathRule,
  HeadOffCenterLensRule,
  HipRotationModelRule,
  HipRotationReviewRule,
  HitHeightRule,
  ImpactSpotterLensRule,
  OnDeviceLensRule,
  PoseCoverageLensRule,
  PunchClassifierRule,
  PunchPredictionsRule,
  RollDuckLensRule,
  ShoulderGateRule,
  SideSetRule,
  SkeletonCompareRule,
  StanceWidthLensRule,
  StepPunchSyncRule,
  StepDetectorRule,
];
