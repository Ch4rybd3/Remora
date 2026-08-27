/**
 * Tailwind reads every colour from a CSS variable, never from a literal.
 * That indirection is what makes the four themes possible: switching one
 * `data-theme` attribute on <html> re-points every utility at once.
 *
 * Colours are stored as raw RGB channels in tokens.css so the alpha modifiers
 * keep working — `bg-panel/40`, `border-hairline/50` resolve exactly as they
 * did against literal colours.
 *
 * Definitions and the reasoning behind each role: src/styles/tokens.css.
 *
 * @type {import('tailwindcss').Config}
 */
const rgb = (name) => `rgb(var(${name}) / <alpha-value>)`

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // ── Surfaces. Two real levels; overlay is for floating layers only.
        canvas:  rgb('--surface-canvas'),
        panel:   rgb('--surface-panel'),
        overlay: rgb('--surface-overlay'),
        hover:   rgb('--surface-hover'),

        // ── Foreground
        fg: {
          DEFAULT:   rgb('--text-primary'),
          secondary: rgb('--text-secondary'),
          muted:     rgb('--text-muted'),
          inverse:   rgb('--text-inverse'),
        },

        // ── The single accent. Interaction only.
        accent: {
          DEFAULT:  rgb('--accent'),
          hover:    rgb('--accent-hover'),
          contrast: rgb('--accent-contrast'),
        },

        // ── Hairlines define panels; there is no card fill and no shadow.
        hairline: rgb('--border-hairline'),
        strong:   rgb('--border-strong'),
        focus:    rgb('--border-focus'),

        // ── Semantic. Read as data, never used decoratively.
        severity: {
          critical: rgb('--severity-critical'),
          high:     rgb('--severity-high'),
          medium:   rgb('--severity-medium'),
          low:      rgb('--severity-low'),
          info:     rgb('--severity-info'),
        },
        status: {
          open:          rgb('--status-open'),
          'in-progress': rgb('--status-in-progress'),
          closed:        rgb('--status-closed'),
          archived:      rgb('--status-archived'),
        },

        // ── Categorical encoding: IOC types, MITRE tactics, protocols.
        // Kinds, not ranks — which is why these are not the accent.
        data: {
          1: rgb('--data-1'),
          2: rgb('--data-2'),
          3: rgb('--data-3'),
          4: rgb('--data-4'),
          5: rgb('--data-5'),
          6: rgb('--data-6'),
        },
      },

      // Four sizes. See tokens.css for why, and for the one exception.
      fontSize: {
        label: ['var(--text-label)', { lineHeight: 'var(--leading-label)' }],
        ui:    ['var(--text-ui)',    { lineHeight: 'var(--leading-ui)' }],
        prose: ['var(--text-prose)', { lineHeight: 'var(--leading-prose)' }],
        title: ['var(--text-title)', { lineHeight: 'var(--leading-title)' }],
        brand: ['var(--text-brand)', { lineHeight: '1.2' }],
      },

      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },

      // One radius, on controls. Panels are square.
      borderRadius: {
        control: 'var(--radius-control)',
        pill:    'var(--radius-pill)',
      },

      boxShadow: {
        overlay: 'var(--shadow-overlay)',
      },

      // Applied by the .label component class, not baked into the size — so
      // the scale stays exactly four steps and dense 11px text that is not a
      // label does not inherit caps tracking.
      letterSpacing: {
        label: 'var(--tracking-label)',
      },
    },
  },
  plugins: [],
}
