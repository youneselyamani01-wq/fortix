import type { Theme } from "../../hooks/useTheme";

export type ScenePalette = Readonly<{
  shell: string;
  node: string;
  origin: string;
  accent: string;
  secondaryLight: string;
  slab: string;
  verdict: Readonly<Record<"VALID" | "INVALID" | "INDETERMINATE" | "REVOKED", string>>;
}>;

export const SCENE_PALETTE: Readonly<Record<Theme, ScenePalette>> = Object.freeze({
  dark: Object.freeze({
    shell: "#c7ff3d",
    node: "#e8e1d6",
    origin: "#f8f5ed",
    accent: "#aa91ff",
    secondaryLight: "#3e485c",
    slab: "#50d3dc",
    verdict: Object.freeze({
      VALID: "#4fd39a",
      INVALID: "#ff7a8f",
      INDETERMINATE: "#f2bd62",
      REVOKED: "#f2bd62",
    }),
  }),
  light: Object.freeze({
    shell: "#182441",
    node: "#4c566c",
    origin: "#171b24",
    accent: "#5c3cc4",
    secondaryLight: "#9eabc2",
    slab: "#007f93",
    verdict: Object.freeze({
      VALID: "#1f7a52",
      INVALID: "#b0273f",
      INDETERMINATE: "#8a5a10",
      REVOKED: "#8a5a10",
    }),
  }),
});
