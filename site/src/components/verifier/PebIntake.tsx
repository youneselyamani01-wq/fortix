import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n/context";
import { VERIFIER_URL } from "../../content/links";
import { acceptablePebFile, openPebVerifier, type HandoffStatus } from "../../verification/pebHandoff";
import { FortixIcon } from "../icons/FortixIcon";
import { pebIntakeCopy } from "./pebIntakeCopy";
import "./peb-intake.css";

export function PebIntake() {
  const { locale } = useI18n();
  const c = pebIntakeCopy[locale];
  const input = useRef<HTMLInputElement>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [over, setOver] = useState(false);
  const [status, setStatus] = useState<HandoffStatus | "empty" | "invalid">("empty");
  useEffect(() => () => cleanup.current?.(), []);
  const submit = (files: FileList | readonly File[] | null) => {
    cleanup.current?.();
    const selected = files?.length === 1 ? files[0] : null;
    if (!acceptablePebFile(selected)) { setFile(null); setStatus("invalid"); return; }
    setFile(selected);
    cleanup.current = openPebVerifier(selected, VERIFIER_URL, locale, (next) => { setStatus(next); if (next === "received") setFile(null); });
  };
  return <section className="peb-intake section" id="peb-intake" aria-labelledby="peb-intake-title">
    <div className="container peb-intake__layout">
      <div className="peb-intake__intro"><p className="section-kicker">{c.kicker}</p><h2 id="peb-intake-title">{c.title}</h2><p>{c.description}</p>
        <a className="peb-intake__destination" href={VERIFIER_URL} target="_blank" rel="noopener noreferrer">{c.destination} <FortixIcon name="external" size={16} /></a>
      </div>
      <div className="peb-intake__entry">
        <div className="peb-intake__drop" data-over={over} onDragOver={(event) => { event.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(event) => { event.preventDefault(); setOver(false); submit(event.dataTransfer.files); }}>
          <span className="peb-intake__label" aria-hidden="true">PEB / 01</span><h3>{c.drop}</h3>
          <button className="button button--primary" type="button" onClick={() => input.current?.click()}>{c.select} <FortixIcon name="external" size={16} /></button>
          <input ref={input} className="peb-intake__file" type="file" aria-label={c.select} tabIndex={-1} accept=".json,.txt,application/json,text/plain" onChange={(event) => { submit(event.target.files); event.target.value = ""; }} />
          <p className="peb-intake__note">{c.note}</p>
        </div>
        <p className="peb-intake__status" role="status">{c[status]}{file ? ` · ${file.name}` : ""}</p>
        {file && (status === "blocked" || status === "failed") && <button className="button button--ghost" type="button" onClick={() => submit([file])}>{c.retry} <FortixIcon name="external" size={16} /></button>}
      </div>
    </div>
  </section>;
}
