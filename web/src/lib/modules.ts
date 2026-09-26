export interface ModuleDef {
  key: string;
  path: string;
  navKey: string;
  descriptionKey: string;
  icon: string;
}

// Every module Cortex offers from the Home hub and the sidebar nav. Add an
// entry here (plus its route in App.tsx and description string in the
// locales) to introduce a new module — Layout, Sidebar, and Home don't need
// to change.
export const modules: ModuleDef[] = [
  {
    key: "radar",
    path: "/radar",
    navKey: "nav.radar",
    descriptionKey: "modules.radar.description",
    icon: "\u{1F4E1}", // 📡
  },
  {
    key: "finance",
    path: "/finance",
    navKey: "nav.finance",
    descriptionKey: "modules.finance.description",
    icon: "\u{1F4B0}", // 💰
  },
];
