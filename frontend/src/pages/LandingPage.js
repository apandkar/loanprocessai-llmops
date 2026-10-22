import React from 'react';
import { Link } from 'react-router-dom';
import './LandingPage.css';

const LandingPage = () => {
  const stats = [
    { icon: '🏢', value: '28', label: 'Active Cases', color: '#1D4D2F' },
    { icon: '📊', value: '$1.25M', label: 'Pipeline Value', color: '#2E7D4A' },
    { icon: '✓', value: '13', label: 'Decision Ready', color: '#4CAF50' },
  ];

  return (
    <div className="landing-page">
      <div className="hero-section">
        <div className="hero-content">
          <h1 className="hero-title">
            Welcome back, let's pick up
            <span className="hero-highlight"> where we left off</span>
          </h1>
          <p className="hero-subtitle">
            Simple onboarding from intake through underwriting-ready —
            powered by <strong>AI-driven automation</strong>.
          </p>

          <div className="stats-row">
            {stats.map((stat, index) => (
              <div key={index} className="stat-card">
                <span className="stat-icon">{stat.icon}</span>
                <div className="stat-info">
                  <span className="stat-value">{stat.value}</span>
                  <span className="stat-label">{stat.label}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="cta-section">
            <Link to="/intake" className="cta-btn primary">
              Start New Application
            </Link>
            <Link to="/portal" className="cta-btn secondary">
              Continue Application
            </Link>
          </div>
        </div>

        <div className="hero-image">
          <div className="building-graphic">
            <svg viewBox="0 0 300 400" fill="none">
              <rect x="50" y="100" width="80" height="280" fill="#2E7D4A" opacity="0.3"/>
              <rect x="140" y="50" width="100" height="330" fill="#1D4D2F" opacity="0.5"/>
              <rect x="250" y="150" width="60" height="230" fill="#4CAF50" opacity="0.2"/>
              {/* Windows */}
              {[...Array(8)].map((_, i) => (
                <React.Fragment key={i}>
                  <rect x="160" y={70 + i * 38} width="20" height="25" fill="#fff" opacity="0.6"/>
                  <rect x="200" y={70 + i * 38} width="20" height="25" fill="#fff" opacity="0.6"/>
                </React.Fragment>
              ))}
            </svg>
          </div>
        </div>
      </div>

      <div className="agents-section">
        <h2 className="section-title">AI-Powered Lending Agents</h2>
        <div className="agents-grid">
          <div className="agent-card">
            <div className="agent-icon"><img src="/icons/agent-icon.svg" alt="Agent" style={{width: '36px', height: '36px'}} /></div>
            <h3>Document Validation Agent</h3>
            <p>Captures entity details, verifies consents, and generates document checklists automatically.</p>
            <Link to="/intake" className="agent-link">
              Start Intake →
            </Link>
          </div>

          <div className="agent-card">
            <div className="agent-icon"><img src="/icons/agent-icon.svg" alt="Agent" style={{width: '36px', height: '36px'}} /></div>
            <h3>KYC Agent</h3>
            <p>Cross-checks EIN against Secretary of State records and flags any entity mismatches.</p>
            <Link to="/verification" className="agent-link">
              Run Verification →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LandingPage;
