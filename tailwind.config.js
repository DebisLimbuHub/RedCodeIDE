/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // RedCode IDE dark theme palette
        surface: {
          950: "#0a0a0f",
          900: "#0f0f17",
          800: "#16161f",
          700: "#1e1e2a",
          600: "#252535",
        },
        accent: {
          red: "#e53e3e",
          orange: "#ed8936",
          cyan: "#00b5d8",
          green: "#38a169",
        },
      },
      fontFamily: {
        mono: ["JetBrains Mono", "Fira Code", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};
