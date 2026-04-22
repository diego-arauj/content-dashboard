import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-dm-sans)", "sans-serif"]
      },
      colors: {
        background: "#FFFFFF",
        foreground: "#111111",
        muted: "#F5F5F5",
        border: "#E5E5E5",
        accent: "#1F1F1F"
      },
      borderRadius: {
        lg: "0.75rem",
        md: "0.5rem",
        sm: "0.375rem"
      },
      boxShadow: {
        subtle: "0 1px 2px rgba(17, 17, 17, 0.06)"
      }
    }
  },
  plugins: []
};

export default config;
