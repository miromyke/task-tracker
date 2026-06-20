import animate from "tailwindcss-animate";

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    container: { center: true, padding: "1rem", screens: { "2xl": "1100px" } },
    extend: {
      fontFamily: {
        sans: ['Helvetica', 'Arial', '"Helvetica Neue"', "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [animate],
};
