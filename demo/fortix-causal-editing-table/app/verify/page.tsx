import type { Metadata } from "next";
import { VerifierWorkspace } from "./VerifierWorkspace";
export const metadata: Metadata = { title: "FortiX · Independent Verifier / Vérificateur indépendant" };
export default function VerifyPage() { return <VerifierWorkspace />; }
