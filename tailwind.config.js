/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        mincho: ['"Noto Serif JP"', '"Hiragino Mincho ProN"', '"Yu Mincho"', '"MS PMincho"', 'serif'],
        gothic: ['"Noto Sans JP"', '"Hiragino Kaku Gothic ProN"', '"Yu Gothic"', '"Meiryo"', 'sans-serif'],
      },
      colors: {
        sepia: {
          50: '#faf8f5',
          100: '#f4ede4',
          200: '#e8dbcb',
          300: '#d7c0a9',
          800: '#5c4838',
          900: '#3a2d23',
        },
        paper: {
          light: '#fdfbf7',
          dark: '#18181b',
        }
      }
    },
  },
  plugins: [],
}
