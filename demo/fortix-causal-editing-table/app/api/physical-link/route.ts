import { SENTINEL_UNREACHABLE, isLinkSentinelReport, isPhysicalReportForTarget } from "../../ethernetLink.ts";
import { PHYSICAL_ADAPTER_TARGETS, normalizedInterfaceGuid, physicalAdapterReportUrl } from "../../physicalAdapterBinding.ts";

export const dynamic = "force-dynamic";
const SENTINEL_URL = "http://127.0.0.1:4319/link";
const HEADERS = { "content-type": "application/json", "cache-control": "no-store" };
const unavailable = (status: number) => Response.json(SENTINEL_UNREACHABLE, { status, headers: HEADERS });

/** Relay only this host's configured physical observation. It neither observes
 * the visiting phone nor changes the sentinel timestamp, identity or truth. */
export async function GET(request: Request): Promise<Response> {
  const query = new URL(request.url).searchParams;
  const kind = query.get("adapter");
  if ((kind !== "ethernet" && kind !== "wifi")
    || query.getAll("adapter").length !== 1 || query.getAll("guid").length !== 1
    || [...query.keys()].some(key => key !== "adapter" && key !== "guid")) return unavailable(400);
  const target = PHYSICAL_ADAPTER_TARGETS[kind];
  if (normalizedInterfaceGuid(query.get("guid")) !== target.interfaceGuid) return unavailable(400);
  if (request.signal.aborted) return unavailable(503);
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 1_200);
  try {
    const response = await fetch(physicalAdapterReportUrl(SENTINEL_URL, target), {
      // Workerd supports manual, not error; the response.ok guard rejects
      // all redirects without following an unconfigured destination.
      cache: "no-store", redirect: "manual", signal: controller.signal,
    });
    if (!response.ok) return unavailable(503);
    const bytes = await response.arrayBuffer();
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!isLinkSentinelReport(value) || !isPhysicalReportForTarget(value, target)) return unavailable(503);
    return new Response(bytes, { status: 200, headers: HEADERS });
  } catch {
    return unavailable(503);
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", abort);
  }
}
