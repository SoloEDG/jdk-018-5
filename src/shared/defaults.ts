import type { StudioDocument, TraceState } from "./document";
export function createTrace(): TraceState {
  return {
    guides: [],
    junctions: [],
    rejected: [],
    settings: {
      enabled: false,
      policy: "structure",
      glyphSet: "box",
      budgetPercent: 22,
      autoThreshold: 0.34,
      ink: false,
      showAuto: true,
      showGuides: true,
      snap: true,
      allowDiag: false,
      allowCross: false,
      weld: true,
    },
    selectedCell: null,
    selectedGuide: null,
    focusConstraint: null,
    nextId: 1,
    tool: "guide",
  };
}
export function createDocument(): StudioDocument {
  return {
    asset: null,
    crop: { x: 0, y: 0, width: 1, height: 1 },
    settings: {
      columns: 100,
      charset: "standard",
      custom: " .:-=+*#%@",
      contrast: 1,
      gamma: 1,
      invert: false,
      color: true,
      background: "#101216",
    },
    trace: createTrace(),
    grid: null,
    revision: 0,
  };
}
