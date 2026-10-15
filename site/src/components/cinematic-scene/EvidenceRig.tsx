import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Theme } from "../../hooks/useTheme";
import { damp, isSettled } from "../../lib/math";
import { SCENE_PALETTE } from "./scenePalette";
import { SCENE_RENDERER_CONTRACT } from "./rendererContract";
import {
  EVIDENCE_NODE_KEYS,
  orbitPosition,
  sealedPosition,
  type SampledStoryboard,
} from "../../scenes/storyboard";

const NODE_COUNT = EVIDENCE_NODE_KEYS.length;
const DAMP_LAMBDA = 5.2;

interface EvidenceRigProps {
  target: SampledStoryboard;
  /** True once the caller (SceneCanvas) has decided damping should be skipped. */
  instant: boolean;
  theme: Theme;
}

/**
 * Scene contents: a camera rig, nine instanced "evidence" nodes that
 * interpolate between an orbiting formation and a sealed grid, an
 * originating-system shell that fades out on separation. The canonical PEB
 * illustration is composited by ProofJourney. All motion is a damped
 * interpolation toward the sampled storyboard target — see
 * `src/scenes/storyboard.ts` for the seven keyframes this reads.
 */
export function EvidenceRig({ target, instant, theme }: EvidenceRigProps) {
  const { camera, invalidate } = useThree();
  const palette = SCENE_PALETTE[theme];
  const lookAtCurrent = useRef(new THREE.Vector3(...target.cameraLookAt));
  const lookAtTarget = useRef(new THREE.Vector3());

  const nodesRef = useRef<THREE.InstancedMesh>(null);
  const nodesMaterialRef = useRef<THREE.MeshStandardMaterial>(null);
  const shellRef = useRef<THREE.Mesh>(null);
  const shellMaterialRef = useRef<THREE.MeshBasicMaterial>(null);

  const current = useRef({
    camPos: new THREE.Vector3(...target.cameraPosition),
    nodesSpread: target.nodesSpread,
    nodesOpacity: target.nodesOpacity,
    originShellOpacity: target.originShellOpacity,
  });

  const dummy = useMemo(() => new THREE.Object3D(), []);
  const orbitPositions = useMemo(
    () => EVIDENCE_NODE_KEYS.map((_, i) => orbitPosition(i, NODE_COUNT, 2.5)),
    [],
  );
  const sealedPositions = useMemo(() => EVIDENCE_NODE_KEYS.map((_, i) => sealedPosition(i)), []);
  // Whenever the sampled target changes (driven by scroll), wake the
  // demand-mode render loop; useFrame below keeps it awake only until the
  // damped values converge, then lets it go idle again.
  useEffect(() => {
    invalidate();
  }, [target, palette, invalidate]);

  useFrame((_, delta) => {
    if (document.hidden) {
      return;
    }

    const c = current.current;
    const lambda = instant ? 60 : DAMP_LAMBDA;
    const dt = instant ? 1 : delta;

    c.camPos.x = damp(c.camPos.x, target.cameraPosition[0], lambda, dt);
    c.camPos.y = damp(c.camPos.y, target.cameraPosition[1], lambda, dt);
    c.camPos.z = damp(c.camPos.z, target.cameraPosition[2], lambda, dt);
    camera.position.copy(c.camPos);

    lookAtTarget.current.set(...target.cameraLookAt);
    lookAtCurrent.current.x = damp(lookAtCurrent.current.x, lookAtTarget.current.x, lambda, dt);
    lookAtCurrent.current.y = damp(lookAtCurrent.current.y, lookAtTarget.current.y, lambda, dt);
    lookAtCurrent.current.z = damp(lookAtCurrent.current.z, lookAtTarget.current.z, lambda, dt);
    camera.lookAt(lookAtCurrent.current);

    c.nodesSpread = damp(c.nodesSpread, target.nodesSpread, lambda, dt);
    c.nodesOpacity = damp(c.nodesOpacity, target.nodesOpacity, lambda, dt);
    c.originShellOpacity = damp(c.originShellOpacity, target.originShellOpacity, lambda, dt);

    if (nodesRef.current) {
      for (let i = 0; i < NODE_COUNT; i += 1) {
        const orbit = orbitPositions[i]!;
        const sealed = sealedPositions[i]!;
        dummy.position.set(
          sealed[0] + (orbit[0] - sealed[0]) * c.nodesSpread,
          sealed[1] + (orbit[1] - sealed[1]) * c.nodesSpread,
          sealed[2] + (orbit[2] - sealed[2]) * c.nodesSpread,
        );
        const scale = 0.09 + c.nodesSpread * 0.05;
        dummy.scale.setScalar(scale);
        dummy.updateMatrix();
        nodesRef.current.setMatrixAt(i, dummy.matrix);
      }
      nodesRef.current.instanceMatrix.needsUpdate = true;
    }
    if (nodesMaterialRef.current) {
      nodesMaterialRef.current.opacity = c.nodesOpacity;
    }

    if (shellRef.current) {
      shellRef.current.rotation.y += (instant ? 0 : delta * 0.04);
    }
    if (shellMaterialRef.current) {
      shellMaterialRef.current.opacity = c.originShellOpacity;
    }

    const settled =
      isSettled(c.camPos.x, target.cameraPosition[0]) &&
      isSettled(c.camPos.z, target.cameraPosition[2]) &&
      isSettled(c.nodesSpread, target.nodesSpread);

    if (!settled) {
      invalidate();
    }
  });

  return (
    <>
      <ambientLight intensity={0.35} />
      <pointLight position={[2, 2, 4]} intensity={40} color={palette.accent} />
      <pointLight position={[-3, -1, -2]} intensity={12} color={palette.secondaryLight} />

      {/* The single point of light representing the originating action. */}
      <mesh>
        <sphereGeometry args={[0.14, 24, 24]} />
        <meshStandardMaterial color={palette.origin} emissive={palette.accent} emissiveIntensity={1.4} />
      </mesh>

      {/* Originating-system shell — fades out once separation begins. */}
      <mesh ref={shellRef}>
        <icosahedronGeometry args={[2.9, 1]} />
        <meshBasicMaterial ref={shellMaterialRef} color={palette.shell} wireframe transparent opacity={0} toneMapped={SCENE_RENDERER_CONTRACT.structuralToneMapped} />
      </mesh>

      {/* Nine evidence nodes: identity, action, decision, policy, approval,
          timestamp, key, runtime, artifact. */}
      <instancedMesh ref={nodesRef} args={[undefined, undefined, NODE_COUNT]}>
        <octahedronGeometry args={[1, 0]} />
        <meshStandardMaterial
          ref={nodesMaterialRef}
          color={palette.node}
          emissive={palette.accent}
          emissiveIntensity={0.5}
          transparent
          opacity={0}
        />
      </instancedMesh>

      {/* The PEB is rendered only by PebArtwork in ProofJourney. Keeping a
          second mesh here would expose the retired angular case while fading
          between context and sealing, or if the canonical image failed. */}
    </>
  );
}
