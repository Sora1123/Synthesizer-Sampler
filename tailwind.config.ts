import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Dark scientific lab palette
        base: {
          900: "#0a0c10",
          800: "#0f1218",
          700: "#151a22",
          600: "#1d232e",
          500: "#2a323f",
          400: "#3a4453",
        },
        ink: {
          DEFAULT: "#e6edf3",
          muted: "#9aa7b4",
          faint: "#5d6b7a",
        },
        // Reference vs synthesis visual treatments
        reference: "#4cc9f0",
        synth: "#f6a13a",
        accent: "#7cf5b0",
        danger: "#ff6b6b",
        grid: "#232a35",
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
