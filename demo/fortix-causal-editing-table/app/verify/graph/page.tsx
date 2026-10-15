import type { Metadata } from "next";
import { GraphInspectionClient } from "./GraphInspectionClient";

export const metadata: Metadata = { title: "FortiX · Causal Graph / Graphe causal" };
export default function GraphPage() { return <GraphInspectionClient />; }
