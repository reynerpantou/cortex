import type { ReactNode } from "react";
import type { Scope, Source, Status } from "./types";

// Windows renders flag emoji (regional-indicator character pairs) as bare
// two-letter country codes instead of a colored flag — that's Segoe UI
// Emoji's behavior by design, not something fixable with CSS. A small inline
// SVG renders identically on every platform instead of depending on the
// system emoji font.
function IndonesiaFlag() {
  return (
    <svg
      width="14"
      height="10"
      viewBox="0 0 3 2"
      aria-hidden="true"
      style={{ verticalAlign: "-1px", borderRadius: 1, flex: "0 0 auto" }}
    >
      <rect width="3" height="1" fill="#e0393e" />
      <rect width="3" height="1" y="1" fill="#f5f5f5" />
    </svg>
  );
}

// A small emoji (or, where emoji rendering isn't reliable, a custom SVG) per
// value gives every tag a second, color-independent way to tell categories
// and values apart at a glance.
export const scopeIcon: Record<Scope, ReactNode> = {
  unknown: "\u{2753}", // ❓
  id: <IndonesiaFlag />,
  row: "\u{1F30D}", // 🌍
};

export const sourceIcon: Record<Source, ReactNode> = {
  unknown: "\u{2753}", // ❓
  personal: "\u{1F64B}", // 🙋
  other: "\u{1F4AC}", // 💬
  ai: "\u{1F916}", // 🤖
};

export const statusIcon: Record<Status, ReactNode> = {
  backlog: "\u{1F4CB}", // 📋
  researching: "\u{1F50D}", // 🔍
  in_review: "\u{1F440}", // 👀
  building: "\u{1F528}", // 🔨
  shipped: "\u{1F680}", // 🚀
  archived: "\u{1F5C3}\u{FE0F}", // 🗃️
};
