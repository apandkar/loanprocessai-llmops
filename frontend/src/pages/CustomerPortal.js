import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getCustomerTickets, getAllTickets } from '../services/api';
import './CustomerPortal.css';

function parseAmount(str) {
  return parseFloat(String(str || '0').replace(/[€₹$,]/g, ''));
}

function formatEUR(num) {
  return `$${Math.round(num).toLocaleString('en-US')}`;
}

function displayAmount(str) {
  if (!str) return '';
  const num = parseAmount(str);
  if (isNaN(num) || num === 0) return str;
  return `$${num.toLocaleString('en-US')}`;
}

const statusConfig = {
  'Pending Review': { icon: '⏳', color: '#f59e0b', bg: '#fef3c7', type: 'pending' },
  'Approved': { icon: '✅', color: '#16a34a', bg: '#dcfce7', type: 'approved' },
  'Verifying': { icon: '🔍', color: '#2563eb', bg: '#dbeafe', type: 'verifying' },
  'Declined': { icon: '❌', color: '#dc2626', bg: '#fee2e2', type: 'declined' },
  'On Hold': { icon: '⏸️', color: '#6b7280', bg: '#f3f4f6', type: 'hold' },
};

const CustomerPortal = ({ applicationData, verificationResult, onOpenChat }) => {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const userStr = localStorage.getItem('user');
    const user = userStr ? JSON.parse(userStr) : null;
    const email = user?.email || '';

    const fetcher = email
      ? getCustomerTickets(email).then(data =>
          data.length === 0 ? getAllTickets() : data
        )
      : getAllTickets();

    fetcher
      .then(data => setTickets(Array.isArray(data) ? data : []))
      .catch(() => setTickets([]))
      .finally(() => setLoading(false));
  }, []);

  const activeCount = tickets.length;
  const pendingCount = tickets.filter(t => t.status === 'Pending Review').length;
  const pipelineTotal = tickets.reduce((sum, t) => sum + parseAmount(t.formData?.loanAmount), 0);
  const pipelineLabel = formatEUR(pipelineTotal);

  return (
    <div className="portal-page">
      <div className="portal-hero">
        <div className="portal-hero-content">
          <div className="portal-user-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
          </div>
          <div className="portal-hero-text">
            {/* <span className="portal-label">LENDING PORTAL</span> */}
            <h1>Welcome</h1>
            <p>Apply for a loan and track your application.</p>
          </div>
          <div className="portal-stats">
            <div className="portal-stat">
              <span className="stat-number">{activeCount}</span>
              <span className="stat-label">Applications</span>
            </div>
            <div className="portal-stat">
              <span className="stat-number">{pendingCount}</span>
              <span className="stat-label">Pending Review</span>
            </div>
            <div className="portal-stat">
              <span className="stat-number">{pipelineLabel}</span>
              <span className="stat-label">Total Pipeline</span>
            </div>
          </div>
        </div>
      </div>

      <div className="portal-content">
        <div className="portal-main">
          {/* Applications List */}
          <div className="applications-section">
            <h2>Your Loan Applications</h2>

            {loading && <p style={{textAlign: 'center', padding: 40, color: '#999'}}>Application Loading...</p>}

            {tickets.map((ticket) => {
              const f = ticket.formData || {};
              const sc = statusConfig[ticket.status] || statusConfig['Pending Review'];
              return (
                <div key={ticket.ticketId} className="application-card">
                  <div className="app-header">
                    <div className="app-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="3" width="18" height="18" rx="2"/>
                        <path d="M9 9h6M9 13h6M9 17h4"/>
                      </svg>
                    </div>
                    <div className="app-info">
                      <h3>{f.businessLegalName || 'Untitled'}</h3>
                      <p>{f.loanPurpose || ''} · <strong>{displayAmount(f.loanAmount)}</strong> · {f.businessType || ''} · {f.state || ''}</p>
                      <p style={{fontSize: 11, color: '#999', marginTop: 2}}>
                        {ticket.applicationId} · Submitted {new Date(ticket.submittedAt).toLocaleDateString('en-GB')}
                      </p>
                    </div>
                    <div className="app-status">
                      <span className={`status-badge ${sc.type}`} style={{background: sc.bg, color: sc.color}}>
                        {sc.icon} {ticket.status}
                      </span>
                    </div>
                  </div>

                  {ticket.reviewedBy && (
                    <div style={{padding: '8px 16px', fontSize: 12, color: '#666', borderTop: '1px solid #f0f0f0'}}>
                      Reviewed by <strong>{ticket.reviewedBy}</strong>
                      {ticket.reviewNote && <span> — {ticket.reviewNote}</span>}
                    </div>
                  )}

                  <div className="app-actions">
                    {ticket.status === 'Pending Review' && (
                      <span style={{fontSize: 13, color: '#f59e0b'}}>⏳ Awaiting manager review</span>
                    )}
                    {ticket.status === 'Verifying' && (
                      <span style={{fontSize: 13, color: '#2563eb'}}>🔍 Documents being verified by AI agents</span>
                    )}
                    {ticket.status === 'On Hold' && (
                      <span style={{fontSize: 13, color: '#6b7280'}}>⏸️ Application on hold — contact your banker</span>
                    )}
                    {ticket.status === 'Declined' && (
                      <span style={{fontSize: 13, color: '#dc2626'}}>❌ Application was declined</span>
                    )}
                    {/* <button className="app-action-btn secondary" style={{marginLeft: 'auto'}} onClick={() => onOpenChat && onOpenChat(ticket.caseId, ticket.formData?.businessLegalName)}>
                      <span>💬</span>
                      Chat with Assistant
                    </button> */}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Exception Alert */}
          {verificationResult?.hasIssues && (
            <div className="exception-alert">
              <div className="exception-header">
                <span className="exception-icon">⚠️</span>
                <div>
                  <h4>1 Open Exception</h4>
                  <p>Ownership mismatch between intake and formation documents</p>
                </div>
                <button className="close-btn">×</button>
              </div>
              <Link to="/verification" className="resolve-btn">
                View Details →
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CustomerPortal;
