export type ThemeChoice = 'light' | 'dark' | 'system';
const KEY = 'cc:theme';

export function getThemeChoice(): ThemeChoice {
  try { return (localStorage.getItem(KEY) as ThemeChoice) || 'system'; } catch { return 'system'; }
}

export function applyTheme(choice: ThemeChoice = getThemeChoice()) {
  const dark = choice === 'dark' || (choice === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

export function setThemeChoice(choice: ThemeChoice) {
  try { localStorage.setItem(KEY, choice); } catch { /* storage unavailable */ }
  applyTheme(choice);
}

export function watchSystemTheme() {
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (getThemeChoice() === 'system') applyTheme('system'); });
}
