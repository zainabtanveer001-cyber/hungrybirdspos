/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'ui-bg': 'var(--ui-bg)',
        'ui-panel': 'var(--ui-panel)',
        'ui-panel-raised': 'var(--ui-panel-raised)',
        'ui-border': 'var(--ui-border)',
        'ui-text': 'var(--ui-text)',
        'ui-muted': 'var(--ui-muted)',
        'ui-accent': 'var(--ui-accent)',
        'ui-accent-soft': 'var(--ui-accent-soft)',
        'ui-success': 'var(--ui-success)',
        'ui-warning': 'var(--ui-warning)',
        'ui-danger': 'var(--ui-danger)',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
