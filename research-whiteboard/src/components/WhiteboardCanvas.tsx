import React, { useMemo } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import { generateExcalidrawElements } from "../utils/excalidrawAdapter";
import { ResearchPaperNode, ResearchPaperEdge } from "../types";

interface WhiteboardCanvasProps {
  paperNodes: ResearchPaperNode[];
  paperEdges: ResearchPaperEdge[];
}

export const WhiteboardCanvas: React.FC<WhiteboardCanvasProps> = ({
  paperNodes,
  paperEdges,
}) => {
  const elements = useMemo(() => {
    return generateExcalidrawElements(paperNodes, paperEdges);
  }, [paperNodes, paperEdges]);

  return (
    <div style={{ width: "100%", height: "100%", minHeight: "500px" }}>
      <Excalidraw
        initialData={{
          elements: elements,
          appState: { viewBackgroundColor: "#f5f6f8" },
        }}
      />
    </div>
  );
};