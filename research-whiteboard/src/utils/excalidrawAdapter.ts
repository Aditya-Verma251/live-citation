import type { ExcalidrawElement } from "@excalidraw/excalidraw";
import { ResearchPaperNode, ResearchPaperEdge } from "../types";

export const generateExcalidrawElements = (
  papers: ResearchPaperNode[],
  edges: ResearchPaperEdge[]
): ExcalidrawElement[] => {
  const elements: ExcalidrawElement[] = [];

  // Generate Nodes (Research Paper Cards)
  papers.forEach((paper) => {
    // Container Rectangle
    elements.push({
      id: paper.id,
      type: "rectangle",
      x: paper.x,
      y: paper.y,
      width: paper.width || 250,
      height: paper.height || 100,
      strokeColor: paper.color || "#1e1e1e",
      backgroundColor: "#ffffff",
      fillStyle: "solid",
      strokeWidth: 2,
      roughness: 0,
      roundness: { type: 3 },
      groupIds: [paper.id],
    } as ExcalidrawElement);

    // Paper Metadata (Title)
    elements.push({
      id: `${paper.id}-text`,
      type: "text",
      x: paper.x + 10,
      y: paper.y + 10,
      width: (paper.width || 250) - 20,
      height: (paper.height || 100) - 20,
      text: paper.title,
      fontSize: 16,
      fontFamily: 1,
      textAlign: "left",
      verticalAlign: "top",
      strokeColor: "#000000",
      groupIds: [paper.id],
    } as ExcalidrawElement);
  });

  // Generate Edges (Connections)
  edges.forEach((edge) => {
    const sourceNode = elements.find((el) => el.id === edge.sourceNodeId);
    const targetNode = elements.find((el) => el.id === edge.targetNodeId);

    if (sourceNode && targetNode) {
      elements.push({
        id: edge.id,
        type: "arrow",
        x: sourceNode.x + sourceNode.width / 2,
        y: sourceNode.y + sourceNode.height / 2,
        width: targetNode.x - sourceNode.x,
        height: targetNode.y - sourceNode.y,
        strokeColor: edge.color || "#868e96",
        strokeWidth: 2,
        roughness: 1,
        strokeStyle: edge.style === "dashed" ? "dashed" : "solid",
        points: [
          [0, 0],
          [targetNode.x - sourceNode.x, targetNode.y - sourceNode.y],
        ],
        startBinding: { elementId: sourceNode.id, focus: 0, gap: 10 },
        endBinding: { elementId: targetNode.id, focus: 0, gap: 10 },
      } as ExcalidrawElement);
    }
  });

  return elements;
};