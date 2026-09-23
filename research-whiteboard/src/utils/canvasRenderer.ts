import rough from 'roughjs';
import { WhiteboardElement, ResearchPaperNode, ResearchPaperEdge, Point, ViewTransform } from '../types';

export function drawGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  viewTransform: ViewTransform,
  gridType: 'dots' | 'grid' | 'none'
) {
  if (gridType === 'none') return;

  const { x: panX, y: panY, zoom } = viewTransform;
  const gridSize = 24 * zoom;
  if (gridSize < 8) return;

  const startX = (panX % gridSize + gridSize) % gridSize;
  const startY = (panY % gridSize + gridSize) % gridSize;

  ctx.save();
  if (gridType === 'dots') {
    ctx.fillStyle = '#cbd5e1';
    for (let x = startX; x < width; x += gridSize) {
      for (let y = startY; y < height; y += gridSize) {
        ctx.beginPath();
        ctx.arc(x, y, 1.2 * Math.min(zoom, 1.5), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else if (gridType === 'grid') {
    ctx.strokeStyle = '#f1f5f9';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = startX; x < width; x += gridSize) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let y = startY; y < height; y += gridSize) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

export function drawWhiteboardElement(
  rc: ReturnType<typeof rough.canvas>,
  ctx: CanvasRenderingContext2D,
  el: WhiteboardElement
) {
  const options = {
    stroke: el.strokeColor,
    strokeWidth: el.strokeWidth,
    roughness: el.roughness,
    fill: el.backgroundColor !== 'transparent' ? el.backgroundColor : undefined,
    fillStyle: el.fillStyle === 'none' ? undefined : el.fillStyle,
    strokeLineDash: undefined,
  };

  ctx.save();
  ctx.globalAlpha = el.opacity ?? 1;

  switch (el.type) {
    case 'rectangle':
      rc.rectangle(el.x, el.y, el.width, el.height, options);
      break;

    case 'diamond': {
      const midX = el.x + el.width / 2;
      const midY = el.y + el.height / 2;
      rc.polygon(
        [
          [midX, el.y],
          [el.x + el.width, midY],
          [midX, el.y + el.height],
          [el.x, midY],
        ],
        options
      );
      break;
    }

    case 'ellipse': {
      const cx = el.x + el.width / 2;
      const cy = el.y + el.height / 2;
      rc.ellipse(cx, cy, Math.max(1, el.width), Math.max(1, el.height), options);
      break;
    }

    case 'line':
      rc.line(el.x, el.y, el.x + el.width, el.y + el.height, options);
      break;

    case 'arrow': {
      const startX = el.x;
      const startY = el.y;
      const endX = el.x + el.width;
      const endY = el.y + el.height;
      rc.line(startX, startY, endX, endY, options);

      // Arrow head calculation
      const angle = Math.atan2(endY - startY, endX - startX);
      const headLength = 16;
      const headAngle = Math.PI / 6;

      const p1X = endX - headLength * Math.cos(angle - headAngle);
      const p1Y = endY - headLength * Math.sin(angle - headAngle);
      const p2X = endX - headLength * Math.cos(angle + headAngle);
      const p2Y = endY - headLength * Math.sin(angle + headAngle);

      rc.line(endX, endY, p1X, p1Y, options);
      rc.line(endX, endY, p2X, p2Y, options);
      break;
    }

    case 'draw': {
      if (el.points && el.points.length > 1) {
        const pts: [number, number][] = el.points.map((p) => [el.x + p.x, el.y + p.y]);
        rc.curve(pts, options);
      }
      break;
    }

    case 'text': {
      if (el.text) {
        ctx.fillStyle = el.strokeColor;
        const fontName =
          el.fontFamily === 'mono'
            ? 'JetBrains Mono, monospace'
            : el.fontFamily === 'sans'
            ? 'Inter, sans-serif'
            : 'Caveat, Kalam, cursive';
        ctx.font = `${el.fontSize || 18}px ${fontName}`;
        ctx.textBaseline = 'top';

        const lines = el.text.split('\n');
        const lineHeight = (el.fontSize || 18) * 1.35;
        lines.forEach((line, index) => {
          ctx.fillText(line, el.x, el.y + index * lineHeight);
        });
      }
      break;
    }
  }

  ctx.restore();
}

export const COMPACT_NODE_WIDTH = 210;
export const COMPACT_NODE_HEIGHT = 38;

export function getPaperNodeCenter(node: ResearchPaperNode): Point {
  const w = COMPACT_NODE_WIDTH;
  const h = COMPACT_NODE_HEIGHT;
  return {
    x: node.x + w / 2,
    y: node.y + h / 2,
  };
}

export function getEdgeConnectionPoints(
  source: ResearchPaperNode,
  target: ResearchPaperNode
): { start: Point; end: Point } {
  const sW = COMPACT_NODE_WIDTH;
  const sH = COMPACT_NODE_HEIGHT;
  const tW = COMPACT_NODE_WIDTH;
  const tH = COMPACT_NODE_HEIGHT;

  const c1 = getPaperNodeCenter(source);
  const c2 = getPaperNodeCenter(target);

  const dx = c2.x - c1.x;
  const dy = c2.y - c1.y;

  let start: Point = { x: c1.x, y: c1.y };
  let end: Point = { x: c2.x, y: c2.y };

  // Calculate intersection with source rectangle
  if (Math.abs(dx) * (sH / 2) > Math.abs(dy) * (sW / 2)) {
    // Left or right exit
    if (dx > 0) {
      start = { x: source.x + sW, y: c1.y };
    } else {
      start = { x: source.x, y: c1.y };
    }
  } else {
    // Top or bottom exit
    if (dy > 0) {
      start = { x: c1.x, y: source.y + sH };
    } else {
      start = { x: c1.x, y: source.y };
    }
  }

  // Calculate intersection with target rectangle
  if (Math.abs(dx) * (tH / 2) > Math.abs(dy) * (tW / 2)) {
    if (dx > 0) {
      end = { x: target.x, y: c2.y };
    } else {
      end = { x: target.x + tW, y: c2.y };
    }
  } else {
    if (dy > 0) {
      end = { x: c2.x, y: target.y };
    } else {
      end = { x: c2.x, y: target.y + tH };
    }
  }

  return { start, end };
}

export function drawResearchPaperEdge(
  rc: ReturnType<typeof rough.canvas>,
  ctx: CanvasRenderingContext2D,
  edge: ResearchPaperEdge,
  sourceNode: ResearchPaperNode,
  targetNode: ResearchPaperNode,
  isSelected: boolean = false
) {
  const { start, end } = getEdgeConnectionPoints(sourceNode, targetNode);

  const strokeColor = isSelected ? '#2563eb' : edge.color || '#475569';
  const strokeWidth = isSelected ? 2.8 : 2;

  // Draw hand-drawn arrow line
  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;

  // Slight subtle curvature for organic feel
  const offset = 12;
  const perpX = -(end.y - start.y) * 0.05;
  const perpY = (end.x - start.x) * 0.05;
  const ctrlX = midX + perpX;
  const ctrlY = midY + perpY;

  ctx.save();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = strokeWidth;

  if (edge.style === 'dashed') {
    ctx.setLineDash([8, 6]);
  } else if (edge.style === 'dotted') {
    ctx.setLineDash([3, 4]);
  } else {
    ctx.setLineDash([]);
  }

  // Draw curved line via rough.js or canvas path
  rc.curve(
    [
      [start.x, start.y],
      [ctrlX, ctrlY],
      [end.x, end.y],
    ],
    {
      stroke: strokeColor,
      strokeWidth,
      roughness: 1.2,
      strokeLineDash:
        edge.style === 'dashed' ? [8, 6] : edge.style === 'dotted' ? [3, 4] : undefined,
    }
  );

  // Arrow head at target
  const angle = Math.atan2(end.y - ctrlY, end.x - ctrlX);
  const headLength = 14;
  const headAngle = Math.PI / 7;

  const a1X = end.x - headLength * Math.cos(angle - headAngle);
  const a1Y = end.y - headLength * Math.sin(angle - headAngle);
  const a2X = end.x - headLength * Math.cos(angle + headAngle);
  const a2Y = end.y - headLength * Math.sin(angle + headAngle);

  // Filled rough arrow head
  rc.polygon(
    [
      [end.x, end.y],
      [a1X, a1Y],
      [a2X, a2Y],
    ],
    {
      stroke: strokeColor,
      fill: strokeColor,
      fillStyle: 'solid',
      strokeWidth: 1.5,
      roughness: 0.8,
    }
  );

  // Relationship Label Pill in center
  const labelText = edge.label || edge.relationType.replace('-', ' ');
  if (labelText) {
    ctx.font = '11px Inter, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    const textWidth = ctx.measureText(labelText).width;
    const paddingX = 8;
    const paddingY = 4;
    const pillW = textWidth + paddingX * 2;
    const pillH = 20;

    // Draw pill background
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0,0,0,0.06)';
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.roundRect(ctrlX - pillW / 2, ctrlY - pillH / 2, pillW, pillH, 10);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.strokeStyle = isSelected ? '#2563eb' : '#cbd5e1';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = isSelected ? '#1d4ed8' : '#334155';
    ctx.fillText(labelText, ctrlX, ctrlY);
  }

  ctx.restore();
}
