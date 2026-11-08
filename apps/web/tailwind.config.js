/** @type {import('tailwindcss').Config} */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: v('bg'), surface: v('surface'), 'surface-2': v('surface-2'), line: v('line'),
        fg: v('fg'), muted: v('muted'), brand: v('brand'), 'brand-fg': v('brand-fg'), 'brand-soft': v('brand-soft'),
        accent: v('accent'), 'accent-soft': v('accent-soft'),
        ok: v('ok'), 'ok-soft': v('ok-soft'), warn: v('warn'), 'warn-soft': v('warn-soft'), bad: v('bad'), 'bad-soft': v('bad-soft'),
        info: v('info'), 'info-soft': v('info-soft'),
      },
      fontFamily: {
        display: ['Sora', 'Segoe UI', 'system-ui', 'sans-serif'],
        sans: ['"Source Sans 3"', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'Consolas', 'monospace'],
      },
      borderRadius: { DEFAULT: '8px' },
    },
  },
  plugins: [],
};
