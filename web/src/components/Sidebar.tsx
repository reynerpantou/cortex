import { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { modules } from "../lib/modules";
import { api } from "../lib/api";
import type { NavGroup, NavPlacement } from "../lib/types";
import UserMenu from "./UserMenu";

interface NavItemDef {
  key: string;
  icon: string;
  labelKey: string;
  path: string;
  end?: boolean;
}

const KNOWN_ITEMS: NavItemDef[] = [
  { key: "home", icon: "\u{1F3E0}", labelKey: "nav.home", path: "/", end: true },
  ...modules.map((m) => ({ key: m.key, icon: m.icon, labelKey: m.navKey, path: m.path })),
];

interface DraftGroup {
  id: string; // "g<realId>" for saved groups, "new-<n>" for ones created in this editing session
  name: string;
}

interface Draft {
  groups: DraftGroup[];
  topItems: string[];
  groupItems: Record<string, string[]>;
}

function buildDraft(groups: NavGroup[], placements: NavPlacement[]): Draft {
  const draftGroups: DraftGroup[] = groups
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((g) => ({ id: `g${g.id}`, name: g.name }));
  const groupIdByReal = new Map(groups.map((g) => [g.id, `g${g.id}`]));

  const groupItemsRaw: Record<string, { pos: number; key: string }[]> = {};
  for (const g of draftGroups) groupItemsRaw[g.id] = [];

  const topRaw: { pos: number; key: string }[] = [];
  const seen = new Set<string>();
  for (const p of placements) {
    seen.add(p.item_key);
    if (p.group_id != null) {
      const gid = groupIdByReal.get(p.group_id);
      if (gid) groupItemsRaw[gid].push({ pos: p.position, key: p.item_key });
    } else {
      topRaw.push({ pos: p.position, key: p.item_key });
    }
  }
  // A known item never placed (new module, or first run) lands at the end of Overview.
  for (const item of KNOWN_ITEMS) {
    if (!seen.has(item.key)) topRaw.push({ pos: Number.MAX_SAFE_INTEGER, key: item.key });
  }

  const groupItems: Record<string, string[]> = {};
  for (const [gid, arr] of Object.entries(groupItemsRaw)) {
    groupItems[gid] = arr.sort((a, b) => a.pos - b.pos).map((x) => x.key);
  }

  return {
    groups: draftGroups,
    topItems: topRaw.sort((a, b) => a.pos - b.pos).map((x) => x.key),
    groupItems,
  };
}

function buildSaveRequest(draft: Draft) {
  const groups = draft.groups.map((g, i) => ({ tempId: g.id, name: g.name, position: i }));
  const placements: { item_key: string; group: string | null; position: number }[] = [];
  draft.topItems.forEach((key, i) => placements.push({ item_key: key, group: null, position: i }));
  for (const [gid, keys] of Object.entries(draft.groupItems)) {
    keys.forEach((key, i) => placements.push({ item_key: key, group: gid, position: i }));
  }
  return { groups, placements };
}

export default function Sidebar({ collapsed }: { collapsed: boolean }) {
  const { t } = useTranslation();

  const [draft, setDraft] = useState<Draft>({ groups: [], topItems: KNOWN_ITEMS.map((i) => i.key), groupItems: {} });
  const committedRef = useRef<Draft>(draft);

  const [editing, setEditing] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState<{ kind: "item" | "group"; key: string } | null>(null);

  useEffect(() => {
    api
      .getNav()
      .then((res) => {
        const d = buildDraft(res.groups, res.placements);
        setDraft(d);
        committedRef.current = d;
      })
      .catch(() => {
        // no saved layout yet (or request failed) — the default draft (all items under Overview) already applies
      });
  }, []);

  const linkFor = (key: string) => {
    const item = KNOWN_ITEMS.find((i) => i.key === key);
    if (!item) return null;
    return (
      <NavLink
        key={key}
        to={item.path}
        end={item.end}
        className={({ isActive }) => `sidebar-link ${isActive ? "is-active" : ""}`}
      >
        <span className="sidebar-link-icon" aria-hidden="true">{item.icon}</span>
        {!collapsed && <span>{t(item.labelKey)}</span>}
      </NavLink>
    );
  };

  const moveItem = (key: string, toList: string, toIndex: number) => {
    setDraft((prev) => {
      const topItems = prev.topItems.filter((k) => k !== key);
      const groupItems: Record<string, string[]> = {};
      for (const [gid, keys] of Object.entries(prev.groupItems)) groupItems[gid] = keys.filter((k) => k !== key);

      if (toList === "top") {
        topItems.splice(toIndex, 0, key);
      } else {
        groupItems[toList] = [...(groupItems[toList] ?? [])];
        groupItems[toList].splice(toIndex, 0, key);
      }
      return { ...prev, topItems, groupItems };
    });
  };

  const moveGroup = (id: string, toIndex: number) => {
    setDraft((prev) => {
      const groups = prev.groups.filter((g) => g.id !== id);
      const moved = prev.groups.find((g) => g.id === id);
      if (!moved) return prev;
      groups.splice(toIndex, 0, moved);
      return { ...prev, groups };
    });
  };

  const addGroup = () => {
    const id = `new-${Date.now()}`;
    setDraft((prev) => ({
      ...prev,
      groups: [...prev.groups, { id, name: "" }],
      groupItems: { ...prev.groupItems, [id]: [] },
    }));
    setEditingGroupId(id);
  };

  const deleteGroup = (id: string) => {
    setDraft((prev) => {
      const groups = prev.groups.filter((g) => g.id !== id);
      const topItems = [...prev.topItems, ...(prev.groupItems[id] ?? [])];
      const groupItems = { ...prev.groupItems };
      delete groupItems[id];
      return { groups, topItems, groupItems };
    });
  };

  const commitGroupName = (id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) {
      deleteGroup(id);
    } else {
      setDraft((prev) => ({ ...prev, groups: prev.groups.map((g) => (g.id === id ? { ...g, name: trimmed } : g)) }));
    }
    setEditingGroupId(null);
  };

  const cancelOrganize = () => {
    setDraft(committedRef.current);
    setEditingGroupId(null);
    setEditing(false);
  };

  const saveOrganize = async () => {
    setSaving(true);
    try {
      const res = await api.updateNav(buildSaveRequest(draft));
      const d = buildDraft(res.groups, res.placements);
      setDraft(d);
      committedRef.current = d;
      setEditingGroupId(null);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const editableItem = (itemKey: string, listId: string, index: number) => {
    const item = KNOWN_ITEMS.find((i) => i.key === itemKey);
    if (!item) return null;
    return (
      <div
        key={itemKey}
        className="sidebar-edit-item"
        draggable
        onDragStart={(e) => {
          // dragstart bubbles: without stopping it here, an item nested inside a
          // group's own draggable container also triggers the group's onDragStart
          // right after, overwriting this to a group-drag — which is exactly why
          // items got stuck unable to leave their group.
          e.stopPropagation();
          setDragging({ kind: "item", key: itemKey });
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.stopPropagation();
          if (dragging?.kind === "item") moveItem(dragging.key, listId, index);
          setDragging(null);
        }}
      >
        <span className="drag-handle" aria-hidden="true">{"⋮⋮"}</span>
        <span className="sidebar-link-icon" aria-hidden="true">{item.icon}</span>
        <span>{t(item.labelKey)}</span>
      </div>
    );
  };

  return (
    <aside className={`sidebar ${collapsed ? "is-collapsed" : ""}`}>
      <div className="sidebar-brand">
        <span className="brand-mark" aria-hidden="true" />
        {!collapsed && (
          <span className="sidebar-brand-text">
            <span className="brand-name">{t("app.name")}</span>
            <span className="sidebar-brand-tagline">{t("app.tagline")}</span>
          </span>
        )}
      </div>

      {!editing ? (
        <nav className="sidebar-nav">
          {!collapsed && (
            <div className="sidebar-nav-header">
              <span className="sidebar-group-label">{t("nav.overview")}</span>
              <button
                type="button"
                className="sidebar-organize-btn"
                aria-label={t("nav.organize")}
                title={t("nav.organize")}
                onClick={() => setEditing(true)}
              >
                {"✎"}
              </button>
            </div>
          )}
          {draft.topItems.map((key) => linkFor(key))}
          {draft.groups.map((g) => (
            <div key={g.id} className="sidebar-nav-group">
              {!collapsed && <div className="sidebar-group-label">{g.name}</div>}
              {(draft.groupItems[g.id] ?? []).map((key) => linkFor(key))}
            </div>
          ))}
        </nav>
      ) : (
        <div className="sidebar-nav sidebar-editor">
          <div className="sidebar-organize-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={cancelOrganize}>{t("form.cancel")}</button>
            <button type="button" className="btn btn-primary btn-sm" disabled={saving} onClick={() => void saveOrganize()}>
              {saving ? t("common.loading") : t("nav.done")}
            </button>
          </div>
          <div
            className="sidebar-edit-section"
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragging?.kind === "item") moveItem(dragging.key, "top", draft.topItems.length);
              setDragging(null);
            }}
          >
            <div className="sidebar-group-label">{t("nav.overview")}</div>
            {draft.topItems.map((key, i) => editableItem(key, "top", i))}
          </div>

          {draft.groups.map((g, gi) => (
            <div
              key={g.id}
              className="sidebar-edit-group"
              draggable={editingGroupId !== g.id}
              onDragStart={(e) => {
                e.stopPropagation();
                setDragging({ kind: "group", key: g.id });
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.stopPropagation();
                if (dragging?.kind === "group") moveGroup(dragging.key, gi);
                else if (dragging?.kind === "item") moveItem(dragging.key, g.id, (draft.groupItems[g.id] ?? []).length);
                setDragging(null);
              }}
            >
              <div className="sidebar-edit-group-header">
                <span className="drag-handle" aria-hidden="true">{"⋮⋮"}</span>
                {editingGroupId === g.id ? (
                  <input
                    className="input sidebar-group-name-input"
                    autoFocus
                    defaultValue={g.name}
                    placeholder={t("nav.groupNamePlaceholder")}
                    onBlur={(e) => commitGroupName(g.id, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    }}
                  />
                ) : (
                  <span className="sidebar-group-name" onClick={() => setEditingGroupId(g.id)}>
                    {g.name}
                  </span>
                )}
                <button
                  type="button"
                  className="sidebar-group-delete"
                  aria-label={t("nav.deleteGroup")}
                  onClick={() => deleteGroup(g.id)}
                >
                  {"×"}
                </button>
              </div>
              {(draft.groupItems[g.id] ?? []).map((key, i) => editableItem(key, g.id, i))}
            </div>
          ))}

          <button type="button" className="btn btn-ghost btn-sm sidebar-add-group" onClick={addGroup}>
            {"+ " + t("nav.newGroup")}
          </button>
        </div>
      )}

      <div className="sidebar-footer">
        <UserMenu collapsed={collapsed} />
      </div>
    </aside>
  );
}
