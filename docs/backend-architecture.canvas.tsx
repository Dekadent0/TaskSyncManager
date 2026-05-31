/**
 * Cursor Canvas source — open beside chat in the IDE.
 * Standalone React version: frontend/src/components/Docs/BackendArchitectureDiagram.jsx
 */
import {
  Card,
  CardBody,
  CardHeader,
  H1,
  Pill,
  Row,
  Stack,
  Text,
  computeDAGLayout,
  useHostTheme,
} from "cursor/canvas";

type NodeMeta = {
  label: string;
  sub?: string;
  tone?: "accent" | "layer" | "external";
};

const NODE_META: Record<string, NodeMeta> = {
  frontend: { label: "React Dashboard", tone: "external" },
  apis: { label: "Trello & Jira APIs", tone: "external" },
  server: { label: "server.js", sub: "Express · :3001", tone: "accent" },
  routes: {
    label: "Routes",
    sub: "environments · rules · integrations · webhooks",
    tone: "layer",
  },
  syncEngine: { label: "syncEngine", sub: "webhook sync + backfill", tone: "layer" },
  services: {
    label: "Services",
    sub: "Trello/Jira clients · webhooks · credentials",
    tone: "layer",
  },
  sqlite: { label: "SQLite", sub: "rules · mappings · webhooks", tone: "layer" },
};

const LAYER_LABELS = ["Clients", "Entry", "HTTP layer", "Core", "Data"];

const DAG_NODES = [
  { id: "frontend" },
  { id: "apis" },
  { id: "server" },
  { id: "routes" },
  { id: "syncEngine" },
  { id: "services" },
  { id: "sqlite" },
];

const DAG_EDGES = [
  { from: "frontend", to: "server" },
  { from: "apis", to: "routes" },
  { from: "server", to: "routes" },
  { from: "routes", to: "syncEngine" },
  { from: "routes", to: "services" },
  { from: "syncEngine", to: "services" },
  { from: "services", to: "apis" },
  { from: "syncEngine", to: "sqlite" },
  { from: "routes", to: "sqlite" },
];

function nodeFill(tone: NodeMeta["tone"], theme: ReturnType<typeof useHostTheme>) {
  switch (tone) {
    case "accent":
      return theme.accent.control;
    case "external":
      return theme.fill.quaternary;
    default:
      return theme.fill.tertiary;
  }
}

function nodeText(tone: NodeMeta["tone"], theme: ReturnType<typeof useHostTheme>) {
  return tone === "accent" ? theme.text.onAccent : theme.text.primary;
}

function nodeSubText(tone: NodeMeta["tone"], theme: ReturnType<typeof useHostTheme>) {
  return tone === "accent" ? theme.text.onAccent : theme.text.secondary;
}

function ArchitectureDiagram() {
  const theme = useHostTheme();
  const layout = computeDAGLayout({
    nodes: DAG_NODES,
    edges: DAG_EDGES,
    direction: "vertical",
    nodeWidth: 220,
    nodeHeight: 48,
    rankGap: 48,
    nodeGap: 24,
    padding: 28,
  });

  return (
    <div style={{ overflowX: "auto", width: "100%" }}>
      <svg
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        role="img"
        aria-label="TaskManagerCurs backend architecture diagram"
      >
        {layout.ranks.map((rank) => (
          <g key={`rank-${rank.rank}`}>
            <rect
              x={rank.x - 8}
              y={rank.y - 18}
              width={rank.width + 16}
              height={rank.height + 24}
              rx={6}
              fill={theme.fill.quaternary}
              stroke={theme.stroke.tertiary}
              strokeWidth={1}
            />
            <text
              x={rank.x}
              y={rank.y - 5}
              fill={theme.text.tertiary}
              fontSize={11}
              fontFamily="system-ui, sans-serif"
              fontWeight={600}
            >
              {LAYER_LABELS[rank.rank] ?? `Layer ${rank.rank}`}
            </text>
          </g>
        ))}

        <defs>
          <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 Z" fill={theme.stroke.secondary} />
          </marker>
        </defs>

        {layout.edges.map((edge) => (
          <line
            key={`${edge.from}-${edge.to}`}
            x1={edge.sourceX}
            y1={edge.sourceY}
            x2={edge.targetX}
            y2={edge.targetY}
            stroke={theme.stroke.secondary}
            strokeWidth={1.5}
            markerEnd="url(#arrow)"
          />
        ))}

        {layout.nodes.map((node) => {
          const meta = NODE_META[node.id];
          if (!meta) return null;
          return (
            <g key={node.id}>
              <rect
                x={node.x}
                y={node.y}
                width={220}
                height={48}
                rx={6}
                fill={nodeFill(meta.tone, theme)}
                stroke={theme.stroke.primary}
                strokeWidth={1}
              />
              <text
                x={node.x + 110}
                y={node.y + (meta.sub ? 19 : 28)}
                textAnchor="middle"
                fill={nodeText(meta.tone, theme)}
                fontSize={13}
                fontWeight={600}
                fontFamily="system-ui, sans-serif"
              >
                {meta.label}
              </text>
              {meta.sub ? (
                <text
                  x={node.x + 110}
                  y={node.y + 36}
                  textAnchor="middle"
                  fill={nodeSubText(meta.tone, theme)}
                  fontSize={10}
                  fontFamily="system-ui, sans-serif"
                >
                  {meta.sub}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default function BackendArchitectureCanvas() {
  return (
    <Stack gap={16} style={{ padding: "4px 2px 24px", maxWidth: 720 }}>
      <Stack gap={6}>
        <H1>Backend Architecture</H1>
        <Text tone="secondary">
          Express API stores config in SQLite, receives Trello/Jira webhooks, and runs the sync
          engine to keep boards aligned.
        </Text>
        <Row gap={8} wrap>
          <Pill tone="info">Node.js</Pill>
          <Pill tone="info">Express</Pill>
          <Pill tone="info">SQLite</Pill>
        </Row>
      </Stack>

      <Card>
        <CardHeader>Overview</CardHeader>
        <CardBody>
          <ArchitectureDiagram />
        </CardBody>
      </Card>

      <Stack gap={8}>
        <Text weight="semibold">How sync works</Text>
        <Text size="small" tone="secondary">
          1. Trello or Jira sends a webhook → routes verify and respond immediately
        </Text>
        <Text size="small" tone="secondary">
          2. syncEngine matches rules and creates or moves the card/issue
        </Text>
        <Text size="small" tone="secondary">
          3. Mappings saved in SQLite · activity shown in the dashboard log
        </Text>
      </Stack>
    </Stack>
  );
}
