import { useId } from "react";
import { evidenceObjectColors as colors, evidenceObjectCopy, evidenceObjectGeometry as geometry } from "./evidenceObjectModel";
import "./evidence-object.css";

export type EvidenceObjectData = Readonly<{
  bundleId?: string | null; digest?: string | null; finalReceiptId?: string | null;
  memberCount?: number | null; nanoReceiptCount?: number | null; byteLength?: number | null;
}>;
export function EvidenceObject({ locale, variant = "full", data, illustrative = false, empty = false, className = "" }: {
  locale: "en" | "fr"; variant?: "full" | "compact"; data?: EvidenceObjectData;
  illustrative?: boolean; empty?: boolean; className?: string;
}) {
  const materialId = `peb-${useId().replace(/:/g, "")}`;
  const finish = (name: string) => `url(#${materialId}-${name})`;
  const c = evidenceObjectCopy(locale);
  const shortId = data?.bundleId ? `${data.bundleId.slice(0, 18)}…${data.bundleId.slice(-12)}` : illustrative ? "PEB / FortiX" : c.unknown;
  return <div className={`evidence-object evidence-object--${variant} ${className}`} data-empty={empty} data-bundle-id={data?.bundleId ?? undefined}>
    <svg viewBox="0 0 580 425" role="img" aria-label={empty ? c.awaiting : illustrative ? c.illustration : `PEB · ${data?.bundleId ?? c.unknown}`}>
      <defs>
        <linearGradient id={`${materialId}-edge`} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#d2ddd9" /><stop offset=".24" stopColor="#81918f" />
          <stop offset=".48" stopColor="#252a30" /><stop offset=".73" stopColor="#9b9992" /><stop offset="1" stopColor="#535b61" />
        </linearGradient>
        <linearGradient id={`${materialId}-shell`} x1=".18" y1="0" x2=".88" y2="1">
          <stop stopColor="#777c81" /><stop offset=".055" stopColor="#454951" />
          <stop offset=".28" stopColor={colors.frame} /><stop offset=".64" stopColor="#171b23" /><stop offset="1" stopColor="#45444b" />
        </linearGradient>
        <linearGradient id={`${materialId}-face`} x1=".12" y1="0" x2=".82" y2="1">
          <stop stopColor="#4e5861" /><stop offset=".27" stopColor="#343944" />
          <stop offset=".65" stopColor="#232632" /><stop offset="1" stopColor="#302c3b" />
        </linearGradient>
        <linearGradient id={`${materialId}-rim`} x1="0" y1="0" x2=".72" y2="1">
          <stop stopColor="#e2e8df" stopOpacity=".82" /><stop offset=".34" stopColor="#b3c4c3" stopOpacity=".45" />
          <stop offset=".54" stopColor="#171b20" stopOpacity=".8" /><stop offset="1" stopColor="#afa7a1" stopOpacity=".6" />
        </linearGradient>
        <linearGradient id={`${materialId}-glass`} x1="0" y1="0" x2=".9" y2="1">
          <stop stopColor="#151c25" /><stop offset=".55" stopColor="#1d2530" /><stop offset="1" stopColor="#272836" />
        </linearGradient>
        <linearGradient id={`${materialId}-row`} x1="0" y1="0" x2=".8" y2="1">
          <stop stopColor="#56616d" stopOpacity=".52" /><stop offset="1" stopColor="#353b4b" stopOpacity=".15" />
        </linearGradient>
        <radialGradient id={`${materialId}-reflection`} cx=".18" cy="0" r=".85">
          <stop stopColor="#e6f2e9" stopOpacity=".2" /><stop offset=".56" stopColor="#94c0c2" stopOpacity=".03" /><stop offset="1" stopColor="#b4c8d8" stopOpacity="0" />
        </radialGradient>
        <filter id={`${materialId}-grain`} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency=".72" numOctaves="3" seed="17" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" /><feComposite in2="SourceGraphic" operator="in" />
        </filter>
        <clipPath id={`${materialId}-clip`}><path d={geometry.inset} /></clipPath>
      </defs>
      <path className="evidence-object__depth" d={geometry.rear} fill={finish("edge")} stroke="#6f797d" strokeWidth=".7" />
      <path d="M518 86L534 100V348L518 332Z" fill="#202630" opacity=".64" />
      <path d="M78 372H478L518 332L534 348L490 389H90Z" fill={finish("edge")} />
      <path d={geometry.frame} fill={finish("shell")} stroke={finish("rim")} strokeWidth="1.1" />
      <path d={geometry.inset} fill={finish("face")} stroke={finish("rim")} strokeWidth="1.1" />
      <g clipPath={finish("clip")} aria-hidden="true">
        <path d={geometry.inset} fill={finish("reflection")} />
        {variant === "full" && <path d={geometry.inset} fill="#fff" filter={finish("grain")} opacity=".038" />}
        <path d="M60 64H470" stroke="#d8eae6" strokeOpacity=".3" strokeWidth="2" />
      </g>
      <path d="M42 102H64M496 298H518M111 349V372" stroke={colors.rail} strokeOpacity=".8" strokeWidth="2" />
      <path d="M78 42L87 64M474 42L464 64M518 332L496 321M78 372L88 349" stroke={finish("rim")} strokeWidth=".8" />
      <text x="93" y="109" fill={colors.ink} fontSize="34" fontWeight="650">PEB</text>
      <text x="184" y="92" fill={colors.muted} fontSize="10" letterSpacing="1.6">FORTIX</text>
      <text x="184" y="111" fill={colors.ink} fontSize="12" letterSpacing=".7">{c.title}</text>
      <path d={geometry.inner} fill={finish("glass")} stroke="#69717c" strokeOpacity=".65" />
      <path d="M96 134H463M96 134V305" stroke="#080f19" strokeOpacity=".8" strokeWidth="2" />
      {empty ? <g fill={colors.muted}>
        <path d="M122 162V148H142M418 148H438V168M438 270V290H418M142 290H122V270" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <text x="280" y="226" textAnchor="middle" fontSize="17">{c.awaiting}</text>
      </g> : <g>
        {[c.receipt, c.records, c.context].map((label, index) => <g key={label}>
          <path d={`M112 ${148 + index * 48}H447V${183 + index * 48}H112Z`} fill={finish("row")} stroke={colors.rowRule} strokeOpacity=".28" strokeWidth=".65" />
          <path d={`M112 ${148 + index * 48}H117V${183 + index * 48}H112Z`} fill={index === 0 ? colors.rail : colors.technicalRail} />
          <text x="129" y={171 + index * 48} fontSize="12" fill={colors.ink}>{label}</text>
          <text x="427" y={171 + index * 48} textAnchor="end" fontSize="11" fill={colors.muted}>
            {illustrative ? "—" : index === 0 ? (data?.finalReceiptId ? "01" : "—") : index === 1 ? (data?.memberCount ?? "—") : "—"}
          </text>
        </g>)}
      </g>}
      <text x="94" y="326" fill={colors.muted} fontSize="8" letterSpacing="1.2">{c.identity}</text>
      <text x="94" y="341" fill={colors.ink} fontSize="9" className="evidence-object__machine">{empty ? "—" : shortId}</text>
      <path d="M528 137H540M528 151H540M528 165H540M528 179H540M528 193H540M528 207H540M528 221H540M528 235H540M528 249H540M528 263H540M528 277H540M528 291H540" stroke="#c4cec9" strokeOpacity=".32" strokeWidth="1" />
    </svg>
    {variant === "full" && illustrative && <p className="evidence-object__caption">{c.illustration}</p>}
  </div>;
}
