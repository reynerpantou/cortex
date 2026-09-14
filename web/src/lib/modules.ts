export interface ModuleDef {
  key: string;
  path: string;
  navKey: string;
  descriptionKey: string;
}

// Every module Cortex offers from the Home hub and the top nav. Add an entry
// here (plus its route in App.tsx and description string in the locales) to
// introduce a new module — Layout and Home don't need to change.
export const modules: ModuleDef[] = [
  {
    key: "radar",
    path: "/radar",
    navKey: "nav.radar",
    descriptionKey: "modules.radar.description",
  },
];
