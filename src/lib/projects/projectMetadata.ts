/** Shared, environment-neutral project identity metadata (DESIGN ◆53). */

export const PROJECT_NAME_MAX_CODE_POINTS = 80;

export interface ProjectNameResult {
  ok: boolean;
  name: string;
  error: string | null;
}

export const PROJECT_NAME_REQUIRED = "Enter a project name.";
export const PROJECT_NAME_TOO_LONG = `Project names can be at most ${PROJECT_NAME_MAX_CODE_POINTS} characters.`;
export const PROJECT_NAME_CONTROL_CHARACTERS =
  "Project names can't contain control characters.";

/**
 * Names are Unicode display data, never storage keys. Normalize once at every
 * UI/API/file boundary so local metadata and cloud manifests compare exactly.
 */
export function normalizeProjectName(input: string): ProjectNameResult {
  const name = input.normalize("NFC").trim();
  if (name.length === 0) return { ok: false, name, error: PROJECT_NAME_REQUIRED };
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(name)) {
    return { ok: false, name, error: PROJECT_NAME_CONTROL_CHARACTERS };
  }
  if ([...name].length > PROJECT_NAME_MAX_CODE_POINTS) {
    return { ok: false, name, error: PROJECT_NAME_TOO_LONG };
  }
  return { ok: true, name, error: null };
}
