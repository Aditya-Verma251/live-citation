/**
 * Interactive "Add Edge" flow as a pure state machine (no React, no Excalidraw).
 *
 *   idle ──start──▶ pick-source ──click node──▶ pick-target ──click other node──▶ pick-type
 *     ▲                                                                              │
 *     └───────────── cancel (Esc / button) · or the edge is created (step 4) ◀───────┘
 *
 * Step 4 (generating the edge) is not a state: once the user picks a relationship type, the app calls
 * graphOps.addEdge and dispatches `cancel` to return to `idle`. The canvas then re-renders from React state,
 * so the new arrow is generated, bound to both ellipses and locked by the adapter.
 */

export type EdgeFlowState =
  | { step: "idle" }
  | { step: "pick-source" }
  | { step: "pick-target"; sourceId: string; error?: string }
  | { step: "pick-type"; sourceId: string; targetId: string };

export type EdgeFlowAction =
  | { type: "start" }
  | { type: "pick-node"; nodeId: string }
  | { type: "back" }
  | { type: "cancel" };

export const EDGE_FLOW_IDLE: EdgeFlowState = { step: "idle" };

export const isEdgeFlowActive = (s: EdgeFlowState) => s.step !== "idle";

/** True while the canvas should treat node clicks as "pick this node" instead of "select this node". */
export const isPickingNode = (s: EdgeFlowState) => s.step === "pick-source" || s.step === "pick-target";

export const edgeFlowReducer = (state: EdgeFlowState, action: EdgeFlowAction): EdgeFlowState => {
  switch (action.type) {
    case "start":
      return state.step === "idle" ? { step: "pick-source" } : state;

    case "pick-node":
      if (state.step === "pick-source") {
        return { step: "pick-target", sourceId: action.nodeId };
      }
      if (state.step === "pick-target") {
        if (action.nodeId === state.sourceId) {
          return { ...state, error: "The destination must be a different node." };
        }
        return { step: "pick-type", sourceId: state.sourceId, targetId: action.nodeId };
      }
      return state; // ignore clicks in other steps

    case "back":
      if (state.step === "pick-type") return { step: "pick-target", sourceId: state.sourceId };
      if (state.step === "pick-target") return { step: "pick-source" };
      return EDGE_FLOW_IDLE;

    case "cancel":
      return EDGE_FLOW_IDLE;

    default:
      return state;
  }
};
