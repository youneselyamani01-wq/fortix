import "./scene-fallback.css";

interface SceneFallbackProps {
  steps: string[];
  note: string;
}

/**
 * No-WebGL / no-3D path: the same seven storyboard states as a static,
 * always-visible, numbered sequence. No canvas, no animation dependency —
 * every label the 3D scene would otherwise carry is plain DOM text.
 */
export function SceneFallback({ steps, note }: SceneFallbackProps) {
  return (
    <div className="scene-fallback" role="img" aria-label={note}>
      <ol className="scene-fallback__list">
        {steps.map((step, index) => (
          <li className="scene-fallback__item" key={step}>
            <span className="scene-fallback__index">{String(index + 1).padStart(2, "0")}</span>
            <span className="scene-fallback__label">{step}</span>
          </li>
        ))}
      </ol>
      <p className="scene-fallback__note">{note}</p>
    </div>
  );
}
