import type { Config } from 'tailwindcss';

export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0b0f14',
        panel: '#0f1722',
        text: '#e6eef6',
        muted: '#8aa0b6',
        line: 'rgba(38,60,84,.55)',
        accent: '#6ee7ff',
        green: '#2ee59d',
        red: '#ff4d6d',
        amber: '#f7c94b'
      },
      boxShadow: {
        soft: '0 18px 60px rgba(0,0,0,.55)',
        card: '0 10px 30px rgba(0,0,0,.35)'
      }
    }
  },
  plugins: [],
} satisfies Config;

