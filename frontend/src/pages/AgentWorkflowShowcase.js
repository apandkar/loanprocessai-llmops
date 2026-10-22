import React, { useEffect, useState } from 'react';
import './AgentWorkflowShowcase.css';

// Eye-candy only — pure visual / animated walkthrough of the multi-agent
// pipeline. NO real outputs, NO data fetched, NO API calls. The page just
// cycles through the steps so anyone watching gets an instant feel for how
// the system flows end-to-end.

const PHASE_A_AGENTS = [
  { id: 'intake',    name: 'Document Validation Agent', icon: '📄', tag: 'Classify · Extract',          desc: 'Reads every uploaded PDF, classifies it, extracts key fields.' },
  { id: 'kyc',       name: 'KYC Agent',                 icon: '🛡️', tag: 'Compliance · Screening',     desc: 'Sanctions, PEP, adverse media, credit bureau & industry risk.' },
  { id: 'financial', name: 'Financial Spreading Agent', icon: '📊', tag: 'ML · Isolation Forest',      desc: 'Spreads ratios, runs the anomaly model, computes PD / LGD.' },
  { id: 'memo',      name: 'Memo Drafting Agent',       icon: '📝', tag: 'Synthesis · Narrative',      desc: 'Writes the full underwriter-grade credit memo from upstream output.' },
  { id: 'decision',  name: 'Decision Agent',            icon: '⚖️', tag: 'Recommendation · HITL',      desc: 'Internal rating, pricing tier, Approve / Reject recommendation.' },
];

const PHASE_B_AGENTS = [
  { id: 'closing', name: 'Loan Package Agent', icon: '📦', tag: 'Manager Summary · Package', desc: 'Records the manager decision and assembles the closing package.' },
];

const STANDALONE_AGENTS = [
  { id: 'chatbot', name: 'LoanAssist Chatbot', icon: '💬', tag: 'Always-on · Dashboard chat', desc: 'Answers questions about any case, any stage, at any time.' },
];

// Total ordered sequence used to drive the animation.
const SEQUENCE = [
  { type: 'agent', phase: 'A', ...PHASE_A_AGENTS[0] },
  { type: 'agent', phase: 'A', ...PHASE_A_AGENTS[1] },
  { type: 'agent', phase: 'A', ...PHASE_A_AGENTS[2] },
  { type: 'agent', phase: 'A', ...PHASE_A_AGENTS[3] },
  { type: 'agent', phase: 'A', ...PHASE_A_AGENTS[4] },
  { type: 'gate',  phase: 'HITL', id: 'hitl',    name: 'Underwriter Decision', icon: '👤', tag: 'Human-in-the-Loop', desc: 'Underwriter reviews the AI recommendation and clicks Approve or Reject.' },
  { type: 'agent', phase: 'B', ...PHASE_B_AGENTS[0] },
];

const AgentWorkflowShowcase = ({ user }) => {
  const [activeIdx, setActiveIdx] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return undefined;
    const t = setInterval(() => {
      setActiveIdx((i) => (i + 1) % SEQUENCE.length);
    }, 1800);
    return () => clearInterval(t);
  }, [paused]);

  const active = SEQUENCE[activeIdx];

  return (
    <div className="awf-page">
      {/* Hero */}
      <section className="awf-hero">
        <div className="awf-hero-inner">
          <div className="awf-hero-kicker">AI WORKFLOW EXPLORER</div>
          <h1 className="awf-hero-title">
            Watch the agents do the work.
          </h1>
          <p className="awf-hero-sub">
            A live look at the commercial-lending multi-agent pipeline.
            Seven AI agents, two pipelines, one underwriter in the loop.
          </p>
          <div className="awf-hero-stats">
            <div><span>7</span><label>Specialist Agents</label></div>
            <div><span>2</span><label>Sequential Pipelines</label></div>
            <div><span>1</span><label>Human Decision Gate</label></div>
            <div><span>∞</span><label>Always-on Chatbot</label></div>
          </div>
        </div>
        <div className="awf-hero-orbit">
          <div className="awf-orbit-ring awf-orbit-ring-1" />
          <div className="awf-orbit-ring awf-orbit-ring-2" />
          <div className="awf-orbit-ring awf-orbit-ring-3" />
          <div className="awf-orbit-core">🧠</div>
        </div>
      </section>

      {/* Now playing */}
      <section className="awf-now">
        <div className="awf-now-label">NOW SHOWING</div>
        <div className="awf-now-card" key={active.id}>
          <div className="awf-now-icon">{active.icon}</div>
          <div className="awf-now-text">
            <div className="awf-now-title">{active.name}</div>
            <div className="awf-now-tag">{active.tag}</div>
            <div className="awf-now-desc">{active.desc}</div>
          </div>
          <button
            className={`awf-pause ${paused ? 'is-paused' : ''}`}
            onClick={() => setPaused((p) => !p)}
          >
            {paused ? '▶  Resume' : '❚❚ Pause'}
          </button>
        </div>
      </section>

      {/* Phase A — Pre-Approval Pipeline */}
      <section className="awf-lane">
        <div className="awf-lane-header">
          <span className="awf-lane-badge awf-badge-a">PHASE A</span>
          <span className="awf-lane-title">Pre-Approval Pipeline</span>
          <span className="awf-lane-sub">Sequential · runs automatically on submission</span>
        </div>
        <div className="awf-flow">
          {PHASE_A_AGENTS.map((a, i) => {
            const isActive = active.id === a.id;
            const isPast = SEQUENCE.findIndex((s) => s.id === a.id) < activeIdx;
            return (
              <React.Fragment key={a.id}>
                <AgentNode agent={a} active={isActive} past={isPast} index={i + 1} />
                {i < PHASE_A_AGENTS.length - 1 && (
                  <Connector active={isActive || isPast} />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </section>

      {/* HITL gate */}
      <section className="awf-lane awf-lane-hitl">
        <div className="awf-lane-header">
          <span className="awf-lane-badge awf-badge-hitl">HUMAN-IN-THE-LOOP</span>
          <span className="awf-lane-title">Underwriter Decision</span>
          <span className="awf-lane-sub">Manual gate · Approve or Reject</span>
        </div>
        <div className="awf-hitl-card">
          <div className={`awf-hitl-orb ${active.id === 'hitl' ? 'is-active' : ''}`}>👤</div>
          <div className="awf-hitl-actions">
            <div className={`awf-hitl-btn approve ${active.id === 'hitl' ? 'is-pulsing' : ''}`}>✓ Approve</div>
            <div className={`awf-hitl-btn reject  ${active.id === 'hitl' ? 'is-pulsing' : ''}`}>✕ Reject</div>
          </div>
          <div className="awf-hitl-note">
            The underwriter sees every agent output and makes the final call.
          </div>
        </div>
      </section>

      {/* Phase B — Post-Approval Pipeline */}
      <section className="awf-lane">
        <div className="awf-lane-header">
          <span className="awf-lane-badge awf-badge-b">PHASE B</span>
          <span className="awf-lane-title">Post-Approval Pipeline</span>
          <span className="awf-lane-sub">Runs after the manager records a decision</span>
        </div>
        <div className="awf-flow">
          {PHASE_B_AGENTS.map((a, i) => {
            const isActive = active.id === a.id;
            const isPast = SEQUENCE.findIndex((s) => s.id === a.id) < activeIdx;
            return (
              <AgentNode key={a.id} agent={a} active={isActive} past={isPast} index={i + 1} wide />
            );
          })}
        </div>
      </section>

      {/* Standalone */}
      <section className="awf-lane">
        <div className="awf-lane-header">
          <span className="awf-lane-badge awf-badge-c">STANDALONE</span>
          <span className="awf-lane-title">Always-On Chatbot</span>
          <span className="awf-lane-sub">Floating assistant · available on every screen</span>
        </div>
        <div className="awf-flow">
          {STANDALONE_AGENTS.map((a) => (
            <AgentNode
              key={a.id}
              agent={a}
              active={false}
              past={false}
              standalone
              wide
            />
          ))}
        </div>
      </section>

      <footer className="awf-footer">
        <span>LoanProcessAI — Multi-Agent System</span>
        <span>Powered by Google ADK · Vertex AI Gemini · BigQuery · GCS</span>
      </footer>
    </div>
  );
};

const AgentNode = ({ agent, active, past, index, wide, standalone }) => (
  <div
    className={[
      'awf-node',
      active ? 'is-active' : '',
      past ? 'is-past' : '',
      wide ? 'is-wide' : '',
      standalone ? 'is-standalone' : '',
    ].join(' ')}
  >
    {!standalone && index && <div className="awf-node-step">{String(index).padStart(2, '0')}</div>}
    <div className="awf-node-icon">{agent.icon}</div>
    <div className="awf-node-name">{agent.name}</div>
    <div className="awf-node-tag">{agent.tag}</div>
    {active && <div className="awf-node-pulse" />}
  </div>
);

const Connector = ({ active }) => (
  <div className={`awf-connector ${active ? 'is-active' : ''}`}>
    <div className="awf-connector-line" />
    <div className="awf-connector-dot" />
    <div className="awf-connector-arrow">▶</div>
  </div>
);

export default AgentWorkflowShowcase;
