/** Shared validation only; no credentials or database access. */
export const MAX_PROJECT_NAME = 80

export function validProjectName(value: string): string | null {
  const name = value.trim()
  const hasControl = Array.from(name).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  return name.length > 0 && name.length <= MAX_PROJECT_NAME && !hasControl ? name : null
}
