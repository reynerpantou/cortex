import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../lib/auth";
import {
  categoryLabel,
  financeApi,
  loadNotes,
  matchNotes,
  type FinanceMeta,
  type NoteList,
  type NoteSuggestion,
} from "../../lib/finance";

interface Props {
  meta: FinanceMeta;
  value: string;
  // What to look up, when that's not the whole field (quick entry matches
  // only the entry being typed, without its amount). Defaults to value.
  query?: string;
  onChange: (v: string) => void;
  onPick: (s: NoteSuggestion) => void;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
}

// A note field that suggests notes used before, so "Mie Gomak" is picked
// rather than re-typed (and misspelled). The account's note list is loaded
// once and filtered locally; only when it was too big to send whole does a
// query also go to the server for the long tail.
export default function NoteInput({ meta, value, query, onChange, onPick, placeholder, className, ariaLabel, disabled }: Props) {
  const lookup = query ?? value;
  const { t } = useTranslation();
  const { user } = useAuth();
  const listId = useId();
  const [list, setList] = useState<NoteList | null>(null);
  const [remote, setRemote] = useState<NoteSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const typedRef = useRef(false);

  const ensureList = () => {
    if (!list && user) void loadNotes(user.id).then(setList).catch(() => undefined);
  };

  useEffect(() => {
    if (!list?.truncated || lookup.trim().length < 2 || !open) {
      setRemote([]);
      return;
    }
    let cancelled = false;
    const id = setTimeout(() => {
      financeApi
        .notes(lookup)
        .then((r) => !cancelled && setRemote(r.notes))
        .catch(() => undefined);
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [lookup, list, open]);

  const local = list ? matchNotes(list.notes, lookup) : [];
  const seen = new Set(local.map((n) => n.note.toLowerCase()));
  const suggestions = [...local, ...remote.filter((n) => !seen.has(n.note.toLowerCase()))].slice(0, 6);
  const show = open && typedRef.current && suggestions.length > 0;

  const pick = (s: NoteSuggestion) => {
    onPick(s);
    setOpen(false);
    setActive(-1);
    typedRef.current = false;
  };

  return (
    <div className="note-input">
      <input
        className={`input ${className ?? ""}`}
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        disabled={disabled}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={show}
        aria-controls={listId}
        aria-activedescendant={show && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        onFocus={() => {
          ensureList();
          setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        onChange={(e) => {
          typedRef.current = true;
          ensureList();
          setOpen(true);
          setActive(-1);
          onChange(e.target.value);
        }}
        onKeyDown={(e) => {
          if (!show) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => (a + 1) % suggestions.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => (a <= 0 ? suggestions.length - 1 : a - 1));
          } else if (e.key === "Enter" && active >= 0) {
            e.preventDefault();
            pick(suggestions[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {show && (
        <ul className="note-suggestions" id={listId} role="listbox">
          {suggestions.map((s, i) => {
            const cat = categoryLabel(meta, s.category_id);
            return (
              <li
                key={s.note}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={`note-suggestion ${i === active ? "is-active" : ""}`}
                // mousedown, not click: fires before the input's blur closes the list
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(s);
                }}
                onMouseEnter={() => setActive(i)}
              >
                <span className="note-suggestion-text">{s.note}</span>
                <span className="note-suggestion-meta">
                  {cat && <span>{`${cat.icon} ${cat.parent ? `${cat.parent} › ` : ""}${cat.name}`}</span>}
                  <span className="note-suggestion-count">{t("finance.notes.used", { count: s.use_count })}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
