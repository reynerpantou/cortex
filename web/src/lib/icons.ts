import type { Scope, Source, Status } from "./types";

// A small emoji per value gives every tag a second, color-independent way to
// tell categories and values apart at a glance — and makes the UI feel less
// like a bare admin panel.
export const scopeIcon: Record<Scope, string> = {
  id: "\u{1F1EE}\u{1F1E9}", // 🇮🇩
  row: "\u{1F30D}", // 🌍
};

export const sourceIcon: Record<Source, string> = {
  personal: "\u{1F64B}", // 🙋
  other: "\u{1F4AC}", // 💬
  ai: "\u{1F916}", // 🤖
};

export const statusIcon: Record<Status, string> = {
  backlog: "\u{1F4CB}", // 📋
  researching: "\u{1F50D}", // 🔍
  in_review: "\u{1F440}", // 👀
  building: "\u{1F528}", // 🔨
  shipped: "\u{1F680}", // 🚀
  archived: "\u{1F5C3}\u{FE0F}", // 🗃️
};
