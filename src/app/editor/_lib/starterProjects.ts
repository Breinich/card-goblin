/**
 * Typed, metadata-only starter registry. The owner-authored project payloads
 * live in template_projects/ and are referenced only by literal dynamic
 * imports in the generated sibling module. Importing this registry therefore
 * does not parse or eagerly bundle any non-Blank starter content.
 */

import type { ParsedProjectFile } from "./projectFileFormat";
import { generatedStarterProjects } from "../_generated/starterProjects.generated";

export type StarterProjectId = "blank" | "poker-deck" | "tcg" | "party-game";
export type OwnerAuthoredStarterProjectId = Exclude<StarterProjectId, "blank">;

interface StarterProjectMetadata {
  readonly id: StarterProjectId;
  readonly label: string;
  readonly suggestedName: string;
  readonly sourceFile: string | null;
}

export interface AvailableStarterProject extends StarterProjectMetadata {
  readonly available: true;
  load(): Promise<ParsedProjectFile>;
}

export interface UnavailableStarterProject extends StarterProjectMetadata {
  readonly available: false;
  readonly load: null;
}

export type StarterProjectDescriptor = AvailableStarterProject | UnavailableStarterProject;

export type GeneratedStarterProject = StarterProjectDescriptor & {
  readonly id: OwnerAuthoredStarterProjectId;
  readonly sourceFile: string;
};

const blankStarter: AvailableStarterProject = Object.freeze({
  id: "blank",
  label: "Blank",
  suggestedName: "Untitled Project",
  sourceFile: null,
  available: true,
  // A new object graph on every call: callers can hand this seed directly to
  // the editor store without sharing mutable project state.
  load: async () => ({ seed: { code: "", sheets: {} }, assets: [] }),
});

/** Stable chooser order, independent of filesystem enumeration order. */
export const STARTER_PROJECTS: readonly StarterProjectDescriptor[] = Object.freeze([
  blankStarter,
  ...generatedStarterProjects.map((starter) => Object.freeze(starter)),
]);

export function getStarterProject(id: StarterProjectId): StarterProjectDescriptor {
  // Exhaustive fixed registry: every StarterProjectId is represented exactly
  // once, asserted by focused tests and generator output.
  return STARTER_PROJECTS.find((starter) => starter.id === id)!;
}
