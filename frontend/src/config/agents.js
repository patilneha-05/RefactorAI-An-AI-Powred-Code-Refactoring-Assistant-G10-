/**
 * Agent registry.
 *
 * The backend validates `agent_id` against `backend/agent_config.json` on
 * POST /refactor and does not expose an endpoint to list agents, so the
 * configured agents are mirrored here. Keep in sync with that file.
 *
 * Agent ids (must match agent_config.json exactly):
 *   coding-standards-agent-01 · security-agent-01 · performance-agent-01
 *   logic-agent-01 · syntax-agent-01 · information-agent-01
 */
export const AGENTS = [
  {
    agentId: 'coding-standards-agent-01',
    name: 'CodingStandardsAgent',
    description:
      'Reviews style, formatting, naming, dead code and consistency, and proposes line-level fixes.',
    capabilities: [
      'Code Review',
      'Style and Formatting Checks',
      'Best Practices Enforcement',
      'Feedback Generation',
    ],
    defaultInstruction: 'Review this file for coding standards issues.',
  },
  {
    agentId: 'security-agent-01',
    name: 'SecurityAgent',
    description:
      'Finds security vulnerabilities: injection, unsafe input handling, auth weaknesses and sensitive-data exposure.',
    capabilities: [
      'Vulnerability Detection',
      'Injection Detection',
      'Auth Analysis',
      'Sensitive Data Exposure',
      'Input Validation',
      'Insecure Configuration',
    ],
    defaultInstruction: 'Analyze this file for security vulnerabilities.',
  },
  {
    agentId: 'performance-agent-01',
    name: 'PerformanceAgent',
    description:
      'Detects performance bottlenecks, inefficient algorithms and unnecessary computation.',
    capabilities: [
      'Performance Analysis',
      'Bottleneck Detection',
      'Algorithm Efficiency',
      'Memory Usage Analysis',
    ],
    defaultInstruction: 'Analyze this file for performance issues.',
  },
  {
    agentId: 'logic-agent-01',
    name: 'LogicAgent',
    description:
      'Finds logical errors, incorrect conditions, boundary mistakes and unintended behavior.',
    capabilities: [
      'Logical Error Detection',
      'Conditional Logic Analysis',
      'Boundary Condition Analysis',
      'Control Flow Validation',
      'Race Condition Detection',
    ],
    defaultInstruction: 'Analyze this file for logical errors.',
  },
  {
    agentId: 'syntax-agent-01',
    name: 'SyntaxAgent',
    description:
      'Detects syntax errors, malformed statements, indentation problems, broken imports and type issues.',
    capabilities: [
      'Syntax Error Detection',
      'Indentation Validation',
      'Import Validation',
      'Type Issue Detection',
      'Code Structure Validation',
    ],
    defaultInstruction: 'Analyze this file for syntax and structural issues.',
  },
  {
    agentId: 'information-agent-01',
    name: 'InformationAgent',
    description:
      'Explains the selected file instead of proposing changes — useful for a quick walkthrough.',
    capabilities: ['Code Info'],
    defaultInstruction: 'Explain this file.',
  },
];

export const DEFAULT_AGENT_ID = 'coding-standards-agent-01';

export const DEFAULT_USER_MESSAGE =
  'Review this file for coding standards issues.';

/** Instruction shown when a chosen agent defines no custom default. */
export function instructionFor(agent) {
  return agent?.defaultInstruction || DEFAULT_USER_MESSAGE;
}

/* ------------------------------------------------------------------ settings */

/**
 * Key for the design-only PostAcceptValidator card. The current backend does
 * NOT implement this agent, so it is listed for design parity with
 * `available: false` and never enters an analysis run.
 */
export const POST_ACCEPT_VALIDATOR_KEY = 'post-accept-validator';

/**
 * Order and copy for Settings → Agent Pipeline, matching the supplied design
 * (short one-line descriptions) plus InformationAgent as a seventh card.
 *
 * `key` is the agent id in the runtime registry above — except for
 * PostAcceptValidator, which has none. Only entries with `available: true`
 * run during Analyze.
 */
export const SETTINGS_AGENTS = [
  {
    key: 'security-agent-01',
    name: 'SecurityAgent',
    description: 'Finds injection, auth, secrets, and other security issues',
    available: true,
    defaultEnabled: false,
  },
  {
    key: 'performance-agent-01',
    name: 'PerformanceAgent',
    description: 'Flags N+1 queries, hot loops, memory leaks, and inefficient patterns',
    available: true,
    defaultEnabled: false,
  },
  {
    key: 'logic-agent-01',
    name: 'LogicAgent',
    description: 'Catches off-by-one, race conditions, and incorrect control flow',
    available: true,
    defaultEnabled: false,
  },
  {
    key: 'syntax-agent-01',
    name: 'SyntaxAgent',
    description: 'Detects syntax errors, type issues, and broken imports',
    available: true,
    defaultEnabled: false,
  },
  {
    key: 'coding-standards-agent-01',
    name: 'CodingStandardsAgent',
    description: 'Enforces naming, structure, and project style conventions',
    available: true,
    defaultEnabled: true,
  },
  {
    key: POST_ACCEPT_VALIDATOR_KEY,
    name: 'PostAcceptValidator',
    description:
      'Validates that modified code is syntactically valid and runnable after a suggestion is accepted',
    available: false,
    defaultEnabled: true,
  },
  {
    key: 'information-agent-01',
    name: 'InformationAgent',
    description: 'Explains the selected file instead of proposing changes.',
    available: true,
    defaultEnabled: false,
  },
];
