import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LanguageProvider } from "../src/i18n/LanguageProvider";
import { PebIntake } from "../src/components/verifier/PebIntake";
import { pebIntakeCopy } from "../src/components/verifier/pebIntakeCopy";

function show() { return render(<LanguageProvider><PebIntake /></LanguageProvider>); }
afterEach(() => { vi.restoreAllMocks(); });
describe("Site PEB entry", () => {
  it("opens a distinct verifier upon selection and offers an explicit retry when a popup is blocked", async () => {
    const user = userEvent.setup(); const open = vi.spyOn(window, "open").mockReturnValue(null); show();
    await user.upload(screen.getByLabelText(pebIntakeCopy.en.select), new File(['{"peb":1}'], "review.json", { type: "application/json" }));
    expect(open).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("/verify#peb-intake="), "_blank");
    expect(screen.getByRole("status")).toHaveTextContent(pebIntakeCopy.en.blocked);
    await user.click(screen.getByRole("button", { name: new RegExp(pebIntakeCopy.en.retry) }));
    expect(open).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: /^Analyze$/ })).not.toBeInTheDocument();
  });
  it("opens on drop and rejects multiple files without claiming receipt", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null); show();
    const drop = screen.getByText(pebIntakeCopy.en.drop).parentElement!;
    const file = new File(["received content"], "received.txt");
    fireEvent.drop(drop, { dataTransfer: { files: [file] } }); expect(open).toHaveBeenCalledTimes(1);
    fireEvent.drop(drop, { dataTransfer: { files: [file, file] } }); expect(open).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent(pebIntakeCopy.en.invalid);
  });
  it("keeps EN/FR instructions aligned and direct navigation opener-free", () => {
    expect(Object.keys(pebIntakeCopy.fr).sort()).toEqual(Object.keys(pebIntakeCopy.en).sort());
    window.localStorage.setItem("fortix-site-language", "fr"); show();
    expect(screen.getByText(pebIntakeCopy.fr.description)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: new RegExp(pebIntakeCopy.fr.destination) });
    expect(link).toHaveAttribute("target", "_blank"); expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});
