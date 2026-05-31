/**
 * Minimal hierarchical DAG layout for architecture diagrams.
 * Returns node positions and edge anchor points (top-to-bottom flow).
 */

function buildGraph(nodes, edges) {
  const ids = new Set(nodes.map((n) => n.id));
  const incoming = new Map();
  const outgoing = new Map();

  for (const id of ids) {
    incoming.set(id, new Set());
    outgoing.set(id, new Set());
  }

  for (const edge of edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) continue;
    outgoing.get(edge.from).add(edge.to);
    incoming.get(edge.to).add(edge.from);
  }

  return { ids, incoming, outgoing };
}

function assignRanks(ids, incoming, outgoing) {
  const rank = new Map();
  const roots = [...ids].filter((id) => incoming.get(id).size === 0);

  if (roots.length === 0) {
    roots.push([...ids][0]);
  }

  const queue = roots.map((id) => ({ id, r: 0 }));
  while (queue.length) {
    const { id, r } = queue.shift();
    const prev = rank.get(id);
    if (prev != null && prev >= r) continue;
    rank.set(id, r);

    for (const next of outgoing.get(id)) {
      queue.push({ id: next, r: r + 1 });
    }
  }

  for (const id of ids) {
    if (!rank.has(id)) rank.set(id, 0);
  }

  return rank;
}

function groupByRank(ids, rank) {
  const groups = new Map();
  for (const id of ids) {
    const r = rank.get(id);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(id);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([r, nodeIds]) => ({ rank: r, nodeIds }));
}

export function computeDAGLayout({
  nodes,
  edges,
  direction = 'vertical',
  nodeWidth = 160,
  nodeHeight = 40,
  rankGap = 64,
  nodeGap = 48,
  padding = 24,
}) {
  const { ids, incoming, outgoing } = buildGraph(nodes, edges);
  const rankMap = assignRanks(ids, incoming, outgoing);
  const ranks = groupByRank(ids, rankMap);

  const positioned = [];
  const rankBoxes = [];
  let maxWidth = 0;
  let maxHeight = 0;

  ranks.forEach(({ rank, nodeIds }, rankIndex) => {
    const rowWidth =
      nodeIds.length * nodeWidth + Math.max(0, nodeIds.length - 1) * nodeGap;
    maxWidth = Math.max(maxWidth, rowWidth);

    const y =
      direction === 'vertical'
        ? padding + rankIndex * (nodeHeight + rankGap)
        : padding;
    const baseX =
      direction === 'vertical' ? padding : padding + rankIndex * (nodeWidth + rankGap);

    rankBoxes.push({
      rank,
      x: baseX,
      y: direction === 'vertical' ? y - 18 : baseX - 18,
      width: direction === 'vertical' ? rowWidth : nodeHeight + 24,
      height: direction === 'vertical' ? nodeHeight + 24 : rowWidth,
      nodeIds,
    });

    nodeIds.forEach((id, order) => {
      const x =
        direction === 'vertical'
          ? baseX + order * (nodeWidth + nodeGap)
          : baseX;
      const nodeY =
        direction === 'vertical'
          ? y
          : padding + order * (nodeWidth + nodeGap);

      positioned.push({ id, x, y: nodeY, rank, order });
      maxHeight = Math.max(
        maxHeight,
        direction === 'vertical' ? nodeY + nodeHeight : nodeY + nodeWidth
      );
    });
  });

  const posById = new Map(positioned.map((n) => [n.id, n]));

  const layoutEdges = edges
    .filter((e) => posById.has(e.from) && posById.has(e.to))
    .map((e) => {
      const from = posById.get(e.from);
      const to = posById.get(e.to);

      const sourceX = from.x + nodeWidth / 2;
      const sourceY = from.y + nodeHeight;
      const targetX = to.x + nodeWidth / 2;
      const targetY = to.y;

      return {
        from: e.from,
        to: e.to,
        sourceX,
        sourceY,
        targetX,
        targetY,
        isBackEdge: rankMap.get(e.to) <= rankMap.get(e.from),
      };
    });

  const width = maxWidth + padding * 2;
  const height = maxHeight + padding;

  return {
    nodes: positioned,
    edges: layoutEdges,
    ranks: rankBoxes,
    direction,
    width,
    height,
  };
}
