import React from "react";

export default function HadarsLogo({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <circle
        cx="20"
        cy="20"
        r="10"
        fill="#050505"
        stroke="#ffcf94"
        strokeWidth="1.6"
      />
      <circle cx="20" cy="20" r="12" stroke="#efac68" strokeOpacity=".2" />
      <ellipse
        cx="20"
        cy="20"
        rx="18"
        ry="5"
        stroke="#efac68"
        strokeWidth="1.5"
        transform="rotate(-22 20 20)"
      />
    </svg>
  );
}
