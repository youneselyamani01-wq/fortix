/** Download the exact PEB bytes served by this site, without opening a JSON tab.
 * A source file is a demonstration fixture: downloading does not verify it.
 */
export const REFERENCE_PEB_URL = "/evidence/d006-reference-peb.json";
export const REFERENCE_PEB_FILENAME = "FortiX_D006_PEB_reference.json";
const EXPECTED_PROFILE = "fortix.demo.d006.peb.v1";
const MAX_PEB_BYTES = 20 * 1024 * 1024;

export async function downloadReferencePeb(): Promise<void> {
  const response = await fetch(REFERENCE_PEB_URL, { credentials: "same-origin", cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`PEB download unavailable (HTTP ${response.status}).`);
  }

  const blob = await response.blob();
  if (blob.size === 0 || blob.size > MAX_PEB_BYTES) {
    throw new Error("PEB download size is invalid.");
  }
  let parsed: unknown;
  try { parsed = JSON.parse(await blob.text()); }
  catch { throw new Error("The downloaded resource is not a JSON PEB."); }
  if (!parsed || typeof parsed !== "object" || (parsed as Record<string, unknown>).profile !== EXPECTED_PROFILE) {
    throw new Error("The downloaded resource is not the expected D-006 PEB.");
  }

  // Create a local download from the ORIGINAL response bytes. Do not
  // reserialize JSON, recompute signatures, or modify evidence in any way.
  const objectURL = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = objectURL;
    anchor.download = REFERENCE_PEB_FILENAME;
    anchor.rel = "noopener";
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    try { anchor.click(); }
    finally { anchor.remove(); }
  } finally {
    // Keep the Blob URL alive long enough for browsers to initiate saving.
    window.setTimeout(() => URL.revokeObjectURL(objectURL), 60_000);
  }
}
