export const PerformanceModes = {
  DEV: 'DEV',
  DEMO: 'DEMO',
} as const;

export type PerformanceMode =
  (typeof PerformanceModes)[keyof typeof PerformanceModes];

export const ControlModes = {
  ROBOT: 'ROBOT',
  CAMERA: 'CAMERA',
  MAP_EDIT: 'MAP_EDIT',
} as const;

export type ControlMode =
  (typeof ControlModes)[keyof typeof ControlModes];

export const MOONTOLOGY_CONFIG = {
  performance: {
    mode: (import.meta.env.PROD
      ? PerformanceModes.DEMO
      : PerformanceModes.DEV) as PerformanceMode,
    devFPS: 30,
    demoFPS: 45,
    pauseWhenHidden: true,
    shadows: false,
  },
  loading: {
    worldSplatTimeoutMs: 8000,
    worldColliderTimeoutMs: 10000,
    assetTimeoutMs: 30000,
    go2TimeoutMs: 15000,
    loadAnimatedHumanoids:
      import.meta.env.VITE_LOAD_HEAVY_ANIMATED_FBX !== 'false',
  },
  controls: {
    defaultMode: ControlModes.ROBOT as ControlMode,
    cameraOffset: {
      x: 0,
      y: 1.4,
      z: -3,
    },
    lookTargetHeight: 0.35,
  },
  physicalScale: {
    cargoBoxHeight: 0.7,
    utilityRoverLength: 2.7,
    logisticsRoverLength: 3.4,
    cableRoverLength: 2.3,
    excavatorLength: 4.5,
  },
} as const;
