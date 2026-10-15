import * as THREE from "three";

/** Explicit renderer/material choices that keep structural accents vivid. */
export const SCENE_RENDERER_CONTRACT = Object.freeze({
  outputColorSpace: THREE.SRGBColorSpace,
  toneMapping: THREE.NoToneMapping,
  toneMappingExposure: 1,
  structuralToneMapped: false,
});
