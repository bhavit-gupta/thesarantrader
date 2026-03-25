/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/views/**/*.ejs","./src/public/**/*.js"],
  theme: {
    extend: {
      colors: {
        'brand-navy': '#0F172A',
        'brand-gold': '#D4AF37',
        'brand-accent': '#EAB308',
      }
    },
  },
  plugins: [],
}

