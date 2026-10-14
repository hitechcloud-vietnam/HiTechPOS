(function () {
  'use strict';
  const key = 'captain_appearance';
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  let choice = 'system';
  try { choice = localStorage.getItem(key) || 'system'; } catch (_) {}
  if (!['system', 'light', 'dark'].includes(choice)) choice = 'system';
  function paint() {
    const effective = choice === 'system' ? (media.matches ? 'dark' : 'light') : choice;
    document.documentElement.dataset.colorScheme = effective;
    document.documentElement.style.colorScheme = effective;
    const field = document.getElementById('me-appearance');
    if (field) field.value = choice;
    const toggle = document.getElementById('appearance-toggle');
    if (toggle) {
      const label = effective === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
      toggle.setAttribute('aria-label', window.I18N?.t(label) || label);
      toggle.title = window.I18N?.t(label) || label;
      toggle.querySelector('[data-theme-sun]').toggleAttribute('hidden', effective !== 'dark');
      toggle.querySelector('[data-theme-moon]').toggleAttribute('hidden', effective === 'dark');
    }
  }
  window.CaptainAppearance = {
    get: () => choice,
    set(value) {
      if (!['system', 'light', 'dark'].includes(value)) return;
      try { localStorage.setItem(key, value); } catch (_) { return; }
      choice = value;
      paint();
    }
  };
  paint();
  media.addEventListener('change', paint);
  window.addEventListener('storage', event => {
    if (event.key !== key && event.key !== null) return;
    choice = ['light','dark'].includes(event.newValue) ? event.newValue : 'system';
    paint();
  });
  document.addEventListener('DOMContentLoaded', () => {
    paint();
    document.getElementById('appearance-toggle')?.addEventListener('click', () => CaptainAppearance.set(document.documentElement.dataset.colorScheme === 'dark' ? 'light' : 'dark'));
    document.getElementById('me-appearance')?.addEventListener('change', event => CaptainAppearance.set(event.target.value));
  });
})();
