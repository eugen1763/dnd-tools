/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Fraunces Variable"', 'Fraunces', 'Georgia', 'serif'],
        sans: ['"Geist Sans"', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Warm walnut/espresso room tones for backgrounds & surfaces.
        ink: {
          950: '#120c07',
          900: '#1c140d',
          800: '#271c12',
          700: '#34261a',
          600: '#443322',
        },
        parchment: {
          DEFAULT: '#f1e4cd',
          dim: '#d6c4a3',
          faint: '#b49f7e',
        },
        brass: {
          DEFAULT: '#e2a951',
          light: '#f6cd86',
          dark: '#a9772f',
        },
        ember: '#c75b43', // warm terracotta red (negatives / danger)
        oxblood: '#7d2b27',
        credit: '#f4c54a',
      },
      boxShadow: {
        glow: '0 0 0 2px rgba(226,169,81,0.9), 0 0 22px 3px rgba(226,169,81,0.4)',
        lamp: '0 30px 80px -20px rgba(0,0,0,0.7)',
      },
      keyframes: {
        turnPulse: {
          '0%, 100%': { boxShadow: '0 0 0 2px rgba(226,169,81,0.85), 0 0 14px 1px rgba(226,169,81,0.3)' },
          '50%': { boxShadow: '0 0 0 2px rgba(246,205,134,1), 0 0 28px 5px rgba(226,169,81,0.6)' },
        },
        shiftFlash: {
          '0%': { opacity: '0' },
          '20%': { opacity: '0.85' },
          '100%': { opacity: '0' },
        },
      },
      animation: {
        turnPulse: 'turnPulse 1.5s ease-in-out infinite',
        shiftFlash: 'shiftFlash 1s ease-out forwards',
      },
    },
  },
  plugins: [],
};
