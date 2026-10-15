import type { AdapterRecord, LinkSentinelReport } from "./ethernetLink.ts";
import { ETHERNET_ADAPTER_IDENTITY, WIFI_ADAPTER_IDENTITY } from "./physicalAdapterPolicy.ts";

export type PhysicalAdapterKind = "ethernet" | "wifi";
export type PhysicalAdapterTarget = Readonly<{ kind: PhysicalAdapterKind; interfaceGuid: string; description: string }>;
/** The demonstration host's own adapter GUIDs come from its git-ignored local configuration
 * (NEXT_PUBLIC_FORTIX_ETHERNET_GUID / NEXT_PUBLIC_FORTIX_WIFI_GUID in .env.local, inlined by the
 * bundler). The committed fallbacks are placeholders that match no real adapter. */
const configuredInterfaceGuid = (read: () => string | undefined, placeholder: string): string => {
  let value: string | undefined;
  try { value = read(); } catch { value = undefined; } // a browser bundle built without the variable has no `process`
  return normalizedInterfaceGuid(value) ?? placeholder;
};
/** Explicit capture configuration for this demonstration host; never a route preference. */
export const PHYSICAL_ADAPTER_TARGETS: Readonly<Record<PhysicalAdapterKind, PhysicalAdapterTarget>> = Object.freeze({
  ethernet: Object.freeze({ kind: "ethernet", interfaceGuid: configuredInterfaceGuid(() => process.env.NEXT_PUBLIC_FORTIX_ETHERNET_GUID, "00000000-D006-4000-8000-000000000001"), description: ETHERNET_ADAPTER_IDENTITY }),
  wifi: Object.freeze({ kind: "wifi", interfaceGuid: configuredInterfaceGuid(() => process.env.NEXT_PUBLIC_FORTIX_WIFI_GUID, "00000000-D006-4000-8000-000000000002"), description: WIFI_ADAPTER_IDENTITY }),
});
/** Capture context only. It is never inserted into a receipt or used as hardware attestation. */
export type PhysicalAdapterBinding = PhysicalAdapterTarget & Readonly<{ runId: string; name: string; ifIndex: number }>;

export function normalizedInterfaceGuid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/^\{(.*)\}$/, "$1").toUpperCase();
  return /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/.test(normalized) ? normalized : null;
}

export function isPhysicalAdapterTarget(value: unknown): value is PhysicalAdapterTarget {
  if (value === null || typeof value !== "object") return false;
  const target = value as Partial<PhysicalAdapterTarget>;
  if (target.kind !== "ethernet" && target.kind !== "wifi") return false;
  const known = PHYSICAL_ADAPTER_TARGETS[target.kind];
  return target.description === known.description && normalizedInterfaceGuid(target.interfaceGuid) === known.interfaceGuid;
}

export function adapterMatchesPhysicalTarget(adapter: AdapterRecord, target: PhysicalAdapterTarget): boolean {
  const media = target.kind === "ethernet" ? "802.3" : "Native 802.11";
  return isPhysicalAdapterTarget(target)
    && normalizedInterfaceGuid(adapter.interfaceGuid) === target.interfaceGuid
    && adapter.description === target.description
    && !adapter.virtual && !/^vEthernet[\s(]/i.test(adapter.name)
    && adapter.mediaType === media && adapter.physicalMediaType === media
    && adapter.status.toLowerCase() !== "not present";
}

export function isPhysicalAdapterBinding(value: unknown, runId?: string): value is PhysicalAdapterBinding {
  if (!isPhysicalAdapterTarget(value)) return false;
  const binding = value as Partial<PhysicalAdapterBinding>;
  return typeof binding.runId === "string" && binding.runId.trim().length > 0
    && (runId === undefined || binding.runId === runId)
    && typeof binding.name === "string" && binding.name.trim().length > 0
    && Number.isInteger(binding.ifIndex) && binding.ifIndex! >= 0;
}

export function bindPhysicalAdapterForRun(runId: string, report: LinkSentinelReport, target: PhysicalAdapterTarget): PhysicalAdapterBinding | null {
  if (!runId.trim() || report.sentinel !== "OK" || report.adapter === null
    || (report.link !== "CONNECTED" && report.link !== "LOST")
    || !adapterMatchesPhysicalTarget(report.adapter, target)) return null;
  return Object.freeze({ ...target, runId, name: report.adapter.name, ifIndex: report.adapter.ifIndex });
}

export function reportMatchesPhysicalBinding(report: LinkSentinelReport, binding: PhysicalAdapterBinding): boolean {
  return isPhysicalAdapterBinding(binding) && report.sentinel === "OK" && report.adapter !== null
    && adapterMatchesPhysicalTarget(report.adapter, binding)
    && report.adapter.name === binding.name && report.adapter.ifIndex === binding.ifIndex;
}

export function physicalAdapterReportUrl(baseUrl: string, target: PhysicalAdapterTarget, urlBase?: string): string {
  if (!isPhysicalAdapterTarget(target)) throw new TypeError("unsupported physical adapter target");
  const relative = baseUrl.startsWith("/") && !baseUrl.startsWith("//");
  // A root-relative browser request stays on its current origin. The placeholder
  // is only a URL parser base and is never a network destination.
  const url = new URL(baseUrl, urlBase ?? (relative ? "http://physical-link.invalid" : undefined));
  url.searchParams.set("adapter", target.kind);
  url.searchParams.set("guid", target.interfaceGuid);
  return relative && urlBase === undefined ? `${url.pathname}${url.search}${url.hash}` : url.href;
}
