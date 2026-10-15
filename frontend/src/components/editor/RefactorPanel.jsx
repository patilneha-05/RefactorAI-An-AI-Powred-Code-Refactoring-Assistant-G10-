import { useMemo } from 'react';
import {
  AlertCircle,
  Brain,
  Bug,
  CheckCircle2,
  Gauge,
  Info,
  ShieldAlert,
  ShieldCheck,
  WandSparkles,
} from 'lucide-react';
import Badge from '../common/Badge';
import { AGENTS, DEFAULT_AGENT_ID, instructionFor } from '../../config/agents';

/** Icon per agent id, with a sensible fallback for newly added agents. */
const AGENT_ICONS = {
  'coding-standards-agent-01': ShieldCheck,
  'security-agent-01': ShieldAlert,
  'performance-agent-01': Gauge,
  'logic-agent-01': Brain,
  'syntax-agent-01': Bug,
  'information-agent-01': Info,
};

function iconFor(agent) {
  if (AGENT_ICONS[agent.agentId]) return AGENT_ICONS[agent.agentId];
  if (/info/i.test(agent.name)) return Info;
  return WandSparkles;
}

/** Best-effort parse of an agent's raw text output (may be a fenced JSON block). */
function parseAgentOutput(output) {
  if (typeof output !== 'string' || !output.trim()) return null;
  const cleaned = output
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

/** Renders an informational agent's output (summary/details JSON, or raw text). */
function AgentOutput({ output }) {
  const parsed = useMemo(() => parseAgentOutput(output), [output]);

  const summary = parsed && typeof parsed === 'object' ? parsed.summary : null;
  const details = parsed && typeof parsed === 'object' ? parsed.details : null;

  if (summary || details) {
    return (
      <div className="agent-output">
        {summary ? <p className="agent-output__summary">{summary}</p> : null}
        {details ? (
          typeof details === 'string' ? (
            <p className="agent-output__details">{details}</p>
          ) : (
            <pre className="code-block agent-output__details">
              {JSON.stringify(details, null, 2)}
            </pre>
          )
        ) : null}
      </div>
    );
  }

  return (
    <pre className="code-block agent-output__raw">
      {parsed ? JSON.stringify(parsed, null, 2) : output}
    </pre>
  );
}

/**
 * Right-sidebar refactoring panel.
 *
 * Lists EVERY configured agent (mirrored from backend/agent_config.json) as a
 * selectable card and renders run status/results. The run itself is triggered
 * from the "Refactor" button in the code pane header (see Workspace) — picking
 * a card here sets the agent that button runs, and its default instruction.
 */
export default function RefactorPanel({
  agentId = DEFAULT_AGENT_ID,
  onAgentChange,
  onInstructionChange,
  disabledReason = null,
  loading = false,
  runInfo = null,
  error = null,
}) {
  const agent = AGENTS.find((item) => item.agentId === agentId) || AGENTS[0];

  /** Selecting an agent swaps the instruction to that agent's own default. */
  const selectAgent = (item) => {
    onAgentChange?.(item.agentId);
    onInstructionChange?.(instructionFor(item));
  };

  const output = runInfo?.output || null;

  return (
    <div className="workspace__refactor-form">
      <div className="agent-picker">
        <div className="agent-picker__head">
          <span className="agent-picker__label">Agents</span>
          <Badge tone="neutral">{AGENTS.length}</Badge>
        </div>
        <div className="agent-list" role="radiogroup" aria-label="Choose a refactoring agent">
          {AGENTS.map((item) => {
            const Icon = iconFor(item);
            const active = item.agentId === agentId;
            return (
              <button
                key={item.agentId}
                type="button"
                role="radio"
                aria-checked={active}
                className={`agent-card${active ? ' agent-card--active' : ''}`}
                onClick={() => selectAgent(item)}
                disabled={loading}
              >
                <span className="agent-card__icon" aria-hidden="true">
                  <Icon size={16} />
                </span>
                <span className="agent-card__main">
                  <span className="agent-card__name">{item.name}</span>
                  <span className="agent-card__desc">{item.description}</span>
                  {item.capabilities?.length ? (
                    <span className="agent-card__caps">
                      {item.capabilities.map((capability) => (
                        <span className="agent-chip" key={capability}>
                          {capability}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {disabledReason ? (
        <div className="callout callout--warning">
          <span className="callout__icon" aria-hidden="true">
            <AlertCircle size={15} />
          </span>
          <span>{disabledReason}</span>
        </div>
      ) : null}

      {error ? (
        <div className="inline-alert inline-alert--error" role="alert">
          <AlertCircle size={15} className="inline-alert__icon" aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      {runInfo ? (
        <div className="inline-alert inline-alert--success" role="status">
          <CheckCircle2 size={15} className="inline-alert__icon" aria-hidden="true" />
          <span>
            {runInfo.count > 0
              ? `${runInfo.count} suggestion(s) returned by ${runInfo.agent}`
              : `${runInfo.agent} responded`}
            {runInfo.model ? ` · ${runInfo.model}` : ''}
          </span>
        </div>
      ) : null}

      {output ? (
        <div className="agent-result">
          <div className="agent-result__head">
            <Info size={13} aria-hidden="true" />
            <span>{agent.name} output</span>
          </div>
          <AgentOutput output={output} />
        </div>
      ) : null}
    </div>
  );
}
