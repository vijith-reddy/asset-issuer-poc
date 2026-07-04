export function renderPrompt(activeProfileName?: string): string {
  return `${activeProfileName ?? "poc"}> `;
}
