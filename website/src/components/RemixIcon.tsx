import React from "react";

type IconName =
  | "menu-line"
  | "close-line"
  | "github-line"
  | "arrow-down-s-line"
  | "file-copy-line"
  | "check-line"
  | "refresh-line"
  | "information-line"
  | "subtract-line"
  | "add-line"
  | "global-line"
  | "database-2-line"
  | "time-line";
export default function RemixIcon({
  name,
  className = "",
}: {
  name: IconName;
  className?: string;
}) {
  return (
    <svg
      className={`docs-icon ${className}`}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <use href={`#ri-${name}`} />
    </svg>
  );
}
