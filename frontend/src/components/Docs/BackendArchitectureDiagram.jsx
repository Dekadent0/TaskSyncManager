import { computeDAGLayout } from '../../utils/dagLayout.js';
import { styles } from '../../styles/theme.js';

const NODE_META = {
  frontend: { label: 'React Dashboard', tone: 'external' },
  apis: { label: 'Trello & Jira APIs', tone: 'external' },
  server: { label: 'server.js', sub: 'Express · :3001', tone: 'accent' },
  routes: {
    label: 'Routes',
    sub: 'environments · rules · integrations · webhooks',
    tone: 'layer',
  },
  syncEngine: { label: 'syncEngine', sub: 'webhook sync + backfill', tone: 'layer' },
  services: {
    label: 'Services',
    sub: 'Trello/Jira clients · webhooks · credentials',
    tone: 'layer',
  },
  sqlite: { label: 'SQLite', sub: 'rules · mappings · webhooks', tone: 'layer' },
};

const LAYER_LABELS = ['Clients', 'Entry', 'HTTP layer', 'Core', 'Data'];

const DAG_NODES = [
  { id: 'frontend' },
  { id: 'apis' },
  { id: 'server' },
  { id: 'routes' },
  { id: 'syncEngine' },
  { id: 'services' },
  { id: 'sqlite' },
];

const DAG_EDGES = [
  { from: 'frontend', to: 'server' },
  { from: 'apis', to: 'routes' },
  { from: 'server', to: 'routes' },
  { from: 'routes', to: 'syncEngine' },
  { from: 'routes', to: 'services' },
  { from: 'syncEngine', to: 'services' },
  { from: 'services', to: 'apis' },
  { from: 'syncEngine', to: 'sqlite' },
  { from: 'routes', to: 'sqlite' },
];

const DIAGRAM_THEME = {
  accentFill: '#0052cc',
  accentText: '#ffffff',
  externalFill: '#fafbfc',
  layerFill: '#f4f5f7',
  layerStroke: '#dfe1e6',
  rankFill: '#fafbfc',
  rankStroke: '#ebecf0',
  textPrimary: '#172b4d',
  textSecondary: '#5e6c84',
  textTertiary: '#97a0af',
  edge: '#97a0af',
};

function nodeFill(tone) {
  switch (tone) {
    case 'accent':
      return DIAGRAM_THEME.accentFill;
    case 'external':
      return DIAGRAM_THEME.externalFill;
    default:
      return DIAGRAM_THEME.layerFill;
  }
}

function nodeText(tone) {
  return tone === 'accent' ? DIAGRAM_THEME.accentText : DIAGRAM_THEME.textPrimary;
}

function nodeSubText(tone) {
  return tone === 'accent' ? DIAGRAM_THEME.accentText : DIAGRAM_THEME.textSecondary;
}

const NODE_W = 220;
const NODE_H = 48;

function ArchitectureSvg() {
  const layout = computeDAGLayout({
    nodes: DAG_NODES,
    edges: DAG_EDGES,
    direction: 'vertical',
    nodeWidth: NODE_W,
    nodeHeight: NODE_H,
    rankGap: 48,
    nodeGap: 24,
    padding: 28,
  });

  return (
    <div style={{ overflowX: 'auto', width: '100%' }}>
      <svg
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        role="img"
        aria-label="TaskManagerCurs backend architecture diagram"
      >
        <defs>
          <marker id="arch-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 Z" fill={DIAGRAM_THEME.edge} />
          </marker>
        </defs>

        {layout.ranks.map((rank) => (
          <g key={`rank-${rank.rank}`}>
            <rect
              x={rank.x - 8}
              y={rank.y}
              width={rank.width + 16}
              height={rank.height + 8}
              rx={6}
              fill={DIAGRAM_THEME.rankFill}
              stroke={DIAGRAM_THEME.rankStroke}
              strokeWidth={1}
            />
            <text
              x={rank.x}
              y={rank.y + 12}
              fill={DIAGRAM_THEME.textTertiary}
              fontSize={11}
              fontFamily="system-ui, sans-serif"
              fontWeight={600}
            >
              {LAYER_LABELS[rank.rank] ?? `Layer ${rank.rank}`}
            </text>
          </g>
        ))}

        {layout.edges.map((edge) => (
          <line
            key={`${edge.from}-${edge.to}`}
            x1={edge.sourceX}
            y1={edge.sourceY}
            x2={edge.targetX}
            y2={edge.targetY}
            stroke={DIAGRAM_THEME.edge}
            strokeWidth={1.5}
            markerEnd="url(#arch-arrow)"
            opacity={edge.isBackEdge ? 0.45 : 1}
            strokeDasharray={edge.isBackEdge ? '4 3' : undefined}
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
                width={NODE_W}
                height={NODE_H}
                rx={6}
                fill={nodeFill(meta.tone)}
                stroke={DIAGRAM_THEME.layerStroke}
                strokeWidth={1}
              />
              <text
                x={node.x + NODE_W / 2}
                y={node.y + (meta.sub ? 19 : 28)}
                textAnchor="middle"
                fill={nodeText(meta.tone)}
                fontSize={13}
                fontWeight={600}
                fontFamily="system-ui, sans-serif"
              >
                {meta.label}
              </text>
              {meta.sub ? (
                <text
                  x={node.x + NODE_W / 2}
                  y={node.y + 36}
                  textAnchor="middle"
                  fill={nodeSubText(meta.tone)}
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

export default function BackendArchitectureDiagram() {
  return (
    <div style={styles.pageCentered}>
      <div style={{ ...styles.welcomeInner, maxWidth: 720 }}>
        <h1 style={styles.title}>Backend Architecture</h1>
        <p style={styles.subtitle}>
          Express API stores config in SQLite, receives Trello/Jira webhooks, and runs the sync
          engine to keep boards aligned.
        </p>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
          {['Node.js', 'Express', 'SQLite'].map((tag) => (
            <span
              key={tag}
              style={{
                fontSize: '0.75rem',
                fontWeight: 600,
                padding: '3px 10px',
                borderRadius: 4,
                background: '#deebff',
                color: '#0747a6',
              }}
            >
              {tag}
            </span>
          ))}
        </div>

        <div style={styles.card}>
          <div style={{ ...styles.sectionTitle, marginBottom: 12 }}>Overview</div>
          <ArchitectureSvg />
        </div>

        <div style={{ ...styles.card, marginTop: 16 }}>
          <div style={{ ...styles.sectionTitle, marginBottom: 10 }}>How sync works</div>
          <ol style={{ margin: 0, paddingLeft: 20, color: '#5e6c84', fontSize: '0.9rem', lineHeight: 1.7 }}>
            <li>Trello or Jira sends a webhook → routes verify and respond immediately</li>
            <li>syncEngine matches rules and creates or moves the card/issue</li>
            <li>Mappings saved in SQLite · activity shown in the dashboard log</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
