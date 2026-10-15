import type { Dictionary } from "../../../site/src/i18n/dictionary";

export function TransversalityReveal({
  copy,
}: {
  copy: Dictionary["d006c2"]["transversality"];
}) {
  return (
    <aside className="transversality-reveal" aria-labelledby="transversality-title">
      <p>{copy.kicker}</p>
      <h3 id="transversality-title">{copy.title}</h3>
      <strong>{copy.question}</strong>
      <ul aria-label={copy.title}>
        {copy.domains.map((domain) => <li key={domain}>{domain}</li>)}
      </ul>
    </aside>
  );
}
