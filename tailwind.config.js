/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: { ink: "#171717", cream: "#f7f3ed", copper: "#c27b45" },
      fontFamily: { display: ["Georgia", "serif"] },
    },
  },
  plugins: [],
};
