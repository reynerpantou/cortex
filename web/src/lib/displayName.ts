import type { User } from "./types";

// The sign-in username is a fixed identifier; what's actually shown in the
// UI is a per-language display name, picked by the active locale, falling
// back to the username when that language's name was never set.
export function displayName(user: User, lang: string): string {
  const byLang: Record<string, string> = {
    en: user.display_name_en,
    id: user.display_name_id,
    zh: user.display_name_zh,
  };
  return byLang[lang]?.trim() || user.username;
}
