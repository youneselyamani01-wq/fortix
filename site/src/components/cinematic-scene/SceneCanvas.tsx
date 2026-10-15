import { Suspense, useEffect } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { PerspectiveCamera } from "three";
import { EvidenceRig } from "./EvidenceRig";
import { SCENE_RENDERER_CONTRACT } from "./rendererContract";
import { sampleStoryboard } from "../../scenes/storyboard";
import { useTheme } from "../../hooks/useTheme";

interface SceneCanvasProps {
  /** 0..1 across the seven-state storyboard. */
  progress: number;
  reducedMotion: boolean;
  className?: string;
  ariaHidden?: boolean;
  fitNarrowViewport?: boolean;
}

/**
 * Lazy-mounted 3D companion. `frameloop="demand"` means nothing renders
 * continuously — `EvidenceRig` wakes the loop when the sampled target
 * changes and lets it go idle again once the damped values converge, so an
 * idle scene costs nothing on the GPU. Under reduced motion, damping is
 * skipped (`instant`) so each scroll position resolves to its settled
 * composition immediately rather than easing into it.
 */
export function SceneCanvas({ progress, reducedMotion, className, ariaHidden = true, fitNarrowViewport = false }: SceneCanvasProps) {
  const target = sampleStoryboard(progress);
  const { theme } = useTheme();

  return (
    <div className={className} aria-hidden={ariaHidden}>
      <Canvas
        frameloop="demand"
        dpr={[1, 1.75]}
        gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}
        camera={{ fov: 42, near: 0.1, far: 50 }}
        onCreated={({ gl }) => {
          gl.outputColorSpace = SCENE_RENDERER_CONTRACT.outputColorSpace;
          gl.toneMapping = SCENE_RENDERER_CONTRACT.toneMapping;
          gl.toneMappingExposure = SCENE_RENDERER_CONTRACT.toneMappingExposure;
        }}
      >
        {fitNarrowViewport && <NarrowViewportCamera />}
        <Suspense fallback={null}>
          <EvidenceRig target={target} instant={reducedMotion} theme={theme} />
        </Suspense>
      </Canvas>
    </div>
  );
}

/** Preserve the storyboard's positions while fitting its lateral separation
 * into a portrait canvas. Desktop-wide and decorative scenes are unchanged. */
function NarrowViewportCamera() {
  const { camera, size, invalidate } = useThree();
  useEffect(() => {
    if (!(camera instanceof PerspectiveCamera)) return;
    const mobile = window.matchMedia("(max-width: 900px)");
    const fit = () => {
      // R3F exposes a mutable Three.js camera, not React state.
      // eslint-disable-next-line react-hooks/immutability
      camera.zoom = mobile.matches ? Math.min(1, size.width / Math.max(1, size.height) / 1.2) : 1;
      camera.updateProjectionMatrix();
      invalidate();
    };
    fit();
    mobile.addEventListener("change", fit);
    return () => mobile.removeEventListener("change", fit);
  }, [camera, size.width, size.height, invalidate]);
  return null;
}


