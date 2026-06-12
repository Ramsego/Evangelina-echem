/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      colors: {
        forest: {
          950: "rgb(var(--f950) / <alpha-value>)",
          900: "rgb(var(--f900) / <alpha-value>)",
          850: "rgb(var(--f850) / <alpha-value>)",
          800: "rgb(var(--f800) / <alpha-value>)",
          750: "rgb(var(--f750) / <alpha-value>)",
          700: "rgb(var(--f700) / <alpha-value>)",
          600: "rgb(var(--f600) / <alpha-value>)",
          500: "rgb(var(--f500) / <alpha-value>)",
          400: "rgb(var(--f400) / <alpha-value>)",
          300: "rgb(var(--f300) / <alpha-value>)",
          200: "rgb(var(--f200) / <alpha-value>)",
          100: "rgb(var(--f100) / <alpha-value>)",
        },
        panel: {
          bg:     "var(--panel-bg)",
          bgalt:  "var(--panel-bgalt)",
          text:   "var(--panel-text)",
          muted:  "var(--panel-muted)",
          border: "var(--panel-border)",
          header: "var(--panel-header)",
          hl:     "var(--panel-hl)",
          hlbdr:  "var(--panel-hlbdr)",
        },
        sidebar: {
          text:   "var(--sidebar-text)",
          muted:  "var(--sidebar-muted)",
          border: "var(--sidebar-border)",
        },
      },
    },
  },
  plugins: [],
};
