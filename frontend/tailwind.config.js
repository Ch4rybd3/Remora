/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: '#0B121F',
          secondary: '#0f1a2e',
          card: '#111927',
          hover: '#162035',
        },
        accent: {
          green: '#2DD4BF',
          greenDim: '#22B5A2',
          muted: '#A3B3BC',
        },
        severity: {
          critical: '#FF3E3E',
          high: '#FF8C00',
          medium: '#FFD700',
          low: '#00BFFF',
          informational: '#A3B3BC',
        },
        status: {
          open: '#2DD4BF',
          in_progress: '#FFD700',
          closed: '#A3B3BC',
          archived: '#6b7280',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
