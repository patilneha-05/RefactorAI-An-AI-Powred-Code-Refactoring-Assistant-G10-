import { useState } from 'react';
import { Link } from 'react-router-dom';
import { SETTINGS_AGENTS } from '../config/agents';
import { useAgentSettings } from '../context/AgentSettings';

const SECTIONS = [
  { id: 'api', label: 'API KEY LIFECYCLE' },
  { id: 'agents', label: 'AGENT PIPELINE' },
  { id: 'ports', label: 'PORT FORWARDING' },
  { id: 'team', label: 'TEAM & COLLABORATION' },
];

/**
 * Settings — the supplied design rendered verbatim (top header, left nav,
 * agent cards with the custom rectangular switch).
 *
 * Agent Pipeline is the only functional section: its toggles are stored in
 * this browser (see AgentSettingsProvider) and decide which agents run when
 * REFACTOR is pressed in the workspace. The backend exposes no settings
 * endpoint, so the other sections keep the design's honest placeholder copy.
 */
export default function Settings() {
  const [section, setSection] = useState('agents');
  const { isEnabled, setEnabled } = useAgentSettings();
  const [agentStatus, setAgentStatus] = useState('');
  const [portsNotice, setPortsNotice] = useState('');

  const toggleAgent = (agent, checked) => {
    setEnabled(agent.key, checked);
    setAgentStatus(
      `${agent.name} ${checked ? 'enabled' : 'disabled'}. ` +
        'Saved in this browser — the backend exposes no settings endpoint.',
    );
  };

  return (
    <div className="stg-screen">
      <header className="stg-header">
        <div className="stg-header-left">
          <div className="stg-brand">REFACTORAI</div>
          <div className="stg-header-divider" />
          <div className="stg-header-section">SETTINGS</div>
        </div>

        <Link className="stg-launcher-link" to="/">
          ← LAUNCHER
        </Link>
      </header>

      <div className="stg-layout">
        <aside className="stg-sidebar">
          <nav className="stg-nav-list" aria-label="Settings navigation">
            {SECTIONS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`stg-nav-item${section === item.id ? ' active' : ''}`}
                aria-current={section === item.id ? 'page' : undefined}
                onClick={() => setSection(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </aside>

        <main className="stg-main">
          <div className="stg-inner">
            {section === 'agents' ? (
              <section className="stg-section">
                <h1 className="stg-page-title">AGENT PIPELINE</h1>

                <p className="stg-page-description">
                  Toggle which agents run during Analyze. Inactive agents are skipped
                  entirely — not called, not shown as pending.
                </p>

                <div className="stg-agent-list">
                  {SETTINGS_AGENTS.map((agent) => {
                    const enabled = isEnabled(agent.key);
                    return (
                      <article
                        key={agent.key}
                        className={`stg-agent-card${enabled ? ' enabled' : ''}`}
                      >
                        <div className="stg-agent-info">
                          <h2 className="stg-agent-name">{agent.name}</h2>
                          <p className="stg-agent-description">{agent.description}</p>
                          {!agent.available ? (
                            <p className="stg-agent-note">
                              Not exposed by this backend — shown for design parity and has
                              no effect on analysis.
                            </p>
                          ) : null}
                        </div>

                        <label
                          className="stg-switch"
                          title={
                            agent.available
                              ? `${enabled ? 'Disable' : 'Enable'} ${agent.name}`
                              : `${agent.name} is not available in this backend`
                          }
                        >
                          <input
                            type="checkbox"
                            data-agent={agent.name}
                            checked={enabled}
                            disabled={!agent.available}
                            onChange={(event) => toggleAgent(agent, event.target.checked)}
                          />
                          <span className="stg-switch-track" />
                        </label>
                      </article>
                    );
                  })}
                </div>

                <p className="stg-notice" role="status" aria-live="polite">
                  {agentStatus}
                </p>
              </section>
            ) : null}

            {section === 'api' ? (
              <section className="stg-section">
                <h1 className="stg-page-title">API KEY LIFECYCLE</h1>
                <p className="stg-page-description">
                  Manage API provider credentials and credential status.
                </p>

                <div className="stg-secondary-card">
                  <h2>Provider credentials</h2>
                  <p>
                    Configure credentials through your backend&apos;s secure credential
                    management API.
                  </p>
                  <div className="stg-field">
                    <label>PROVIDER</label>
                    <input value="Groq" readOnly />
                  </div>
                  <p className="stg-notice">
                    Secret values should never be returned to the browser.
                  </p>
                </div>
              </section>
            ) : null}

            {section === 'ports' ? (
              <section className="stg-section">
                <h1 className="stg-page-title">PORT FORWARDING</h1>
                <p className="stg-page-description">
                  Configure and inspect supported port forwarding settings.
                </p>

                <div className="stg-secondary-card">
                  <h2>Forwarding configuration</h2>
                  <p>Connect this section to your existing backend configuration.</p>
                  <div className="stg-field">
                    <label>LOCAL PORT</label>
                    <input type="number" placeholder="8000" />
                  </div>
                  <div className="stg-field">
                    <label>REMOTE PORT</label>
                    <input type="number" placeholder="8000" />
                  </div>
                  <button
                    type="button"
                    className="stg-save-button"
                    onClick={() =>
                      setPortsNotice('Connect this form to your port forwarding API.')
                    }
                  >
                    SAVE CONFIGURATION
                  </button>
                  <p className="stg-notice" role="status">
                    {portsNotice}
                  </p>
                </div>
              </section>
            ) : null}

            {section === 'team' ? (
              <section className="stg-section">
                <h1 className="stg-page-title">TEAM &amp; COLLABORATION</h1>
                <p className="stg-page-description">
                  Manage supported team and collaboration settings.
                </p>

                <div className="stg-secondary-card">
                  <h2>Collaboration</h2>
                  <p>Team management features depend on your backend implementation.</p>
                </div>
              </section>
            ) : null}
          </div>
        </main>
      </div>
    </div>
  );
}
