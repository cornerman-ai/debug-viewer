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

import { OverviewRule } from "./overview.js";
import { GuardDropRule } from "./guard_drop.js";
import { GuardHeightRule } from "./guard_height.js";
import { ArmExtensionRule } from "./arm_extension.js";
import { HandReturnPathRule } from "./hand_return_path.js";
import { HeadOffCenterLensRule } from "./head_offcenter_lens.js";
import { HitHeightRule } from "./hit_height.js";
import { BladednessRule } from "./bladedness_lens.js";
import { BladednessFramesRule } from "./bladedness_frames_lens.js";
import { BladednessPairsRule } from "./bladedness_pairs_lens.js";
import { BladednessCoachRule } from "./bladedness_coach_lens.js";
import { BlazePoseInspectorRule } from "./blazepose_inspector.js";
import { ElbowTuckRule } from "./elbow_tuck_lens.js";
import { StepPunchSyncRule } from "./step_punch_sync.js";
import { StepDetectorRule } from "./step_detector.js";
import { HipRotationReviewRule } from "./hip_rotation_review.js";
import { HipRotationModelRule } from "./hip_rotation_model.js";
import { AngleChangeRule } from "./angle_change.js";
import { ShoulderGateRule } from "./shoulder_gate_lens.js";
import { PunchClassifierRule } from "./punch_classifier.js";
import { OnDeviceLensRule } from "./ondevice_lens.js";
import { PoseCoverageLensRule } from "./pose_coverage_lens.js";
import { SkeletonCompareRule } from "./skeleton_compare_lens.js";
import { StanceWidthLensRule } from "./stance_width_lens.js";
import { AudioImpactLensRule } from "./audio_impact_lens.js";
import { ImpactSpotterLensRule } from "./impact_spotter_lens.js";
import { PunchPredictionsRule } from "./punch_predictions.js";
import { RollDuckLensRule } from "./roll_duck_lens.js";

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
  SkeletonCompareRule,
  StanceWidthLensRule,
  StepPunchSyncRule,
  StepDetectorRule,
];
