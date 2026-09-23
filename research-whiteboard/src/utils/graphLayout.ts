import { ResearchPaperNode, ResearchPaperEdge } from '../types';

/**
 * Arranges paper nodes chronologically and hierarchically based on publication year & edge relationships
 */
export function autoLayoutResearchGraph(
  nodes: ResearchPaperNode[],
  edges: ResearchPaperEdge[]
): ResearchPaperNode[] {
  if (nodes.length === 0) return [];

  // Group by publication year or approximate topological order
  const sorted = [...nodes].sort((a, b) => {
    const yearA = typeof a.year === 'number' ? a.year : parseInt(String(a.year)) || 2000;
    const yearB = typeof b.year === 'number' ? b.year : parseInt(String(b.year)) || 2000;
    return yearA - yearB;
  });

  // Calculate year buckets
  const buckets: Record<string, ResearchPaperNode[]> = {};
  sorted.forEach((node) => {
    const yStr = String(node.year || 'Unknown');
    if (!buckets[yStr]) buckets[yStr] = [];
    buckets[yStr].push(node);
  });

  const yearKeys = Object.keys(buckets);
  const startX = 140;
  const startY = 180;
  const colSpacing = 380;
  const rowSpacing = 240;

  const updatedNodes = nodes.map((node) => {
    // Find column index (by year)
    const yearIndex = yearKeys.indexOf(String(node.year || 'Unknown'));
    const colIndex = yearIndex >= 0 ? yearIndex : 0;
    const bucketList = buckets[String(node.year || 'Unknown')] || [];
    const rowIndex = bucketList.findIndex((n) => n.id === node.id);

    return {
      ...node,
      x: startX + colIndex * colSpacing,
      y: startY + (rowIndex >= 0 ? rowIndex : 0) * rowSpacing,
    };
  });

  return updatedNodes;
}
