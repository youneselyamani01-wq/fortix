/** Explicit demo capture policy. These are declared adapter identities, not
 * cryptographic proof of hardware. Physical capture is separately GUID-bound. */
export const ETHERNET_ADAPTER_IDENTITY = "Intel(R) Ethernet Controller I226-LM";
export const WIFI_ADAPTER_IDENTITY = "Intel(R) Wi-Fi 7 BE200 320MHz";
export const ETHERNET_PHYSICAL_SENTINEL_SOURCE = "INTEL_I226_LM_PHYSICAL_SENTINEL";
export const WIFI_PHYSICAL_SENTINEL_SOURCE = "INTEL_BE200_PHYSICAL_SENTINEL";
export type PhysicalSentinelSource = typeof ETHERNET_PHYSICAL_SENTINEL_SOURCE | typeof WIFI_PHYSICAL_SENTINEL_SOURCE;

export function isSupportedPhysicalAdapterIdentity(value: unknown): value is string {
  return value === ETHERNET_ADAPTER_IDENTITY || value === WIFI_ADAPTER_IDENTITY;
}

export function isSupportedPhysicalAdapterSource(identity: unknown, source: unknown): boolean {
  return (identity === ETHERNET_ADAPTER_IDENTITY && source === ETHERNET_PHYSICAL_SENTINEL_SOURCE)
    || (identity === WIFI_ADAPTER_IDENTITY && source === WIFI_PHYSICAL_SENTINEL_SOURCE);
}
