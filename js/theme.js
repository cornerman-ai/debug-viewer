// Light/dark theme toggle. Default is "system" (no [data-theme] attribute —
// css/style.css's prefers-color-scheme query decides). Clicking the button
// cycles System -> Light -> Dark -> System; the explicit choice (or its
// absence) is remembered in localStorage. The very first paint is handled
// by an inline <script> in index.html's <head>, not here, so a saved
// choice doesn't flash the system theme before this module runs.

const STORAGE_KEY = "cornerman-theme";
const root = document.documentElement;
const toggle = document.getElementById("theme-toggle");

function explicitTheme() {
  const t = root.dataset.theme;
  return t === "light" || t === "dark" ? t : null;
}

function systemPrefersDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function effectiveTheme() {
  return explicitTheme() || (systemPrefersDark() ? "dark" : "light");
}

function render() {
  if (!toggle) return;
  const explicit = explicitTheme();
  const eff = effectiveTheme();
  const icon = eff === "dark" ? "\u{1F319}" : "\u{2600}\u{FE0F}"; // moon / sun
  const label = explicit ? (explicit === "dark" ? "Dark" : "Light") : "System";
  toggle.textContent = `${icon} ${label}`;
  toggle.title = `Theme: ${label} (click to change) — following your OS unless set explicitly`;
}

function setTheme(theme) {
  if (theme) {
    root.dataset.theme = theme;
    try { localStorage.setItem(STORAGE_KEY, theme); } catch (e) {}
  } else {
    delete root.dataset.theme;
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
  }
  render();
}

if (toggle) {
  toggle.addEventListener("click", () => {
    const explicit = explicitTheme();
    if (!explicit) setTheme("light");
    else if (explicit === "light") setTheme("dark");
    else setTheme(null);
  });
  // Keep the label accurate if the OS theme changes while on "System".
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (!explicitTheme()) render();
  });
  render();
}
