/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        felt: {
          900: '#0a1f17',
          800: '#0d2a1e',
          700: '#124030',
        },
        credit: '#f1c40f',
      },
      boxShadow: {
        glow: '0 0 0 2px rgba(241,196,15,0.9), 0 0 20px 2px rgba(241,196,15,0.45)',
      },
      keyframes: {
        turnPulse: {
          '0%, 100%': { boxShadow: '0 0 0 2px rgba(241,196,15,0.9), 0 0 14px 1px rgba(241,196,15,0.3)' },
          '50%': { boxShadow: '0 0 0 2px rgba(241,196,15,1), 0 0 26px 4px rgba(241,196,15,0.6)' },
        },
        shiftFlash: {
          '0%': { opacity: '0' },
          '20%': { opacity: '0.9' },
          '100%': { opacity: '0' },
        },
      },
      animation: {
        turnPulse: 'turnPulse 1.4s ease-in-out infinite',
        shiftFlash: 'shiftFlash 1s ease-out forwards',
      },
    },
  },
  plugins: [],
};
