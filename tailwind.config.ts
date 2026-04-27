import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-poppins)", "sans-serif"],
      },
      colors: {
        primary: {
          DEFAULT: "#5E18EA",
          foreground: "#FFFFFF",
        },
        background: "#141414",
        foreground: "#FFFFFF",
        card: "#1A1A1A",
        muted: "#2A2A2A",
        "muted-foreground": "#A3A3A3",
      },
    },
  },
  plugins: [],
};

export default config;
