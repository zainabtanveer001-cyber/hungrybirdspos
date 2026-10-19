/**
 * Tailwind CSS Configuration
 *
 * This config matches the professional SaaS design system we introduced:
 *   • Primary color: #2563EB (blue‑600)
 *   • Secondary color: #7C3AED (violet‑600)
 *   • Neutral palette: gray‑50/100/200/300/400/500/600/700/800/900
 *   • Status colors: emerald‑500, amber‑500, red‑500, sky‑500
 *   • Spacing scale: 4px increments (0,4,8,12,…,64)
 *   • Rounded corners: 8px (rounded-lg)
 */
module.exports = {
  content: ["./index.html", "./app.js", "./hungrybirdspos/**/*.js", "./hungrybirdspos/**/*.html"],
  theme: {
    extend: {
      colors: {
        primary: "#2563EB",
        secondary: "#7C3AED",
        success: "#10B981",
        warning: "#F59E0B",
        danger: "#EF4444",
        info: "#3B82F8",
      },
      spacing: {
        // 4px increments up to 64px
        0: "0px",
        1: "4px",
        2: "8px",
        3: "12px",
        4: "16px",
        5: "20px",
        6: "24px",
        7: "28px",
        8: "32px",
        9: "36px",
        10: "40px",
        11: "44px",
        12: "48px",
        13: "52px",
        14: "56px",
        15: "60px",
        16: "64px",
      },
      borderRadius: {
        DEFAULT: "8px",
        lg: "8px",
        xl: "8px",
      },
    },
  },
  plugins: [],
};
