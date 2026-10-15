/** Sidecar process identity only: this does not attest a physical link. */
export const SENTINEL_SERVICE = "fortix-physical-link-sentinel";
export const SENTINEL_PROTOCOL = 2;
export const SENTINEL_TARGET = "Intel(R) Ethernet Controller I226-LM";
export const SENTINEL_BINDING = "EXPLICIT_PHYSICAL_GUID_PER_REQUEST";
export const SENTINEL_PORT = 4319;
export const SENTINEL_ORIGIN = `http://127.0.0.1:${SENTINEL_PORT}`;

export function sentinelHealth(pid) {
  return { service: SENTINEL_SERVICE, protocol: SENTINEL_PROTOCOL, target: SENTINEL_TARGET, binding: SENTINEL_BINDING, pid };
}

export function isCompatibleSentinelHealth(value) {
  return value !== null && typeof value === "object"
    && value.service === SENTINEL_SERVICE && value.protocol === SENTINEL_PROTOCOL
    && value.target === SENTINEL_TARGET && value.binding === SENTINEL_BINDING && Number.isInteger(value.pid) && value.pid > 0;
}
