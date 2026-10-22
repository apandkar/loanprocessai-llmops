import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getDemoCases,
  getAllTickets,
  reviewTicket,
  findCaseIdByApplication,
  autoProcessTicket,
  getProcessedApps,
  deleteApplication,
} from '../services/api';
import {
  isDemoTicketId,
  isDemoApplicationId,
  isDemoCaseId,
  getDemoCaseWithOverrides,
  DEMO_CASE_ID_LIST,
} from '../mock-data/demoCases';
import './BankerDashboard.css';

const DASH_CACHE_KEY = 'cl.dash.cache.v1';
const DASH_CACHE_VERSION = 'v7-no-ghost-apps'; // Bump to force clear stale cached rows

function readCache() {
  try {
    const raw = localStorage.getItem(DASH_CACHE_KEY);
    const data = raw ? JSON.parse(raw) : null;
    // Check version - clear if outdated
    if (data && data.version !== DASH_CACHE_VERSION) {
      localStorage.removeItem(DASH_CACHE_KEY);
      // Also wipe the per-case + per-ticket caches so deleted backend apps
      // (e.g. APP-F384BF) don't keep ghost-rendering from localStorage.
      try { localStorage.removeItem('cl.cases'); } catch { /* ignore */ }
      try { localStorage.removeItem('cl.tickets'); } catch { /* ignore */ }
      try { localStorage.removeItem('cl.docSummaries'); } catch { /* ignore */ }
      return null;
    }
    return data;
  } catch { return null; }
}
function writeCache(applications, tickets) {
  try {
    localStorage.setItem(
      DASH_CACHE_KEY,
      JSON.stringify({ applications, tickets, ts: Date.now(), version: DASH_CACHE_VERSION })
    );
  } catch { /* ignore */ }
}

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

function mapCaseToApp(item) {
  const c = item.case;
  const f = c.formData || {};
  const owner = [f.ownerFirstName, f.ownerMiddleName, f.ownerLastName].filter(Boolean).join(' ');
  // Derive progress from where the case is in its lifecycle. The backend's
  // c.completeness.overall is set once at intake (~70% — reflects how
  // complete the application form was) and never updated, so we override
  // it here with a value that actually tracks the case status.
  const statusLower = String(c.status || '').toLowerCase();
  const isFinal = c.kycApproved && (statusLower.includes('approved') || statusLower.includes('declined') || statusLower.includes('rejected'));
  const baseCompleteness = Math.round(c.completeness?.overall || 0);
  const derivedCompleteness = isFinal
    ? 100
    : (statusLower.includes('approved') || statusLower.includes('declined') || statusLower.includes('rejected'))
      ? 100
      : baseCompleteness;
  return {
    caseId: c.caseId,
    ticketId: item.ticketId || null,
    id: c.applicationId,
    businessName: f.businessLegalName || '',
    dba: f.dba || null,
    owner,
    ownerEmail: f.ownerEmail || '',
    ownerPhone: f.ownerPhone || '',
    ein: f.businessTaxId || '',
    loanAmount: f.loanAmount || '',
    loanPurpose: f.loanPurpose || '',
    completeness: derivedCompleteness,
    status: c.status || 'created',
    statusType: c.statusType || 'pending',
    priority: c.priority || 'medium',
    assignedTo: c.assignedTo || 'Unassigned',
    submittedDate: (c.createdAt || '').slice(0, 10),
    lastUpdated: (c.updatedAt || '').slice(0, 10),
    entityType: f.businessType || '',
    state: f.state || '',
    industry: f.industry || '',
    annualRevenue: f.annualRevenue || '',
    employees: f.numberOfEmployees || 0,
    exceptions: 0,
    exceptionType: null,
    kycApproved: c.kycApproved || false,
    isTicket: false,
    isDemo: isDemoCaseId(c.caseId),
  };
}

function mapTicketToApp(t) {
  const f = t.formData || {};
  const owner = [f.ownerFirstName, f.ownerMiddleName, f.ownerLastName].filter(Boolean).join(' ');
  return {
    caseId: null,
    ticketId: t.ticketId,
    id: t.applicationId,
    businessName: f.businessLegalName || t.businessLegalName || '',
    dba: f.dba || null,
    owner,
    ownerEmail: f.ownerEmail || t.ownerEmail || '',
    ownerPhone: f.ownerPhone || '',
    ein: f.businessTaxId || '',
    loanAmount: f.loanAmount || t.loanAmount || '',
    loanPurpose: f.loanPurpose || t.loanPurpose || '',
    completeness: t.completeness || 0,
    status: t.status || 'Pending Review',
    statusType: t.status === 'On Hold' ? 'warning' : 'pending',
    priority: 'medium',
    assignedTo: 'Unassigned',
    submittedDate: (t.createdAt || '').slice(0, 10),
    lastUpdated: (t.updatedAt || '').slice(0, 10),
    entityType: f.businessType || '',
    state: f.state || '',
    industry: f.industry || '',
    annualRevenue: f.annualRevenue || '',
    employees: f.numberOfEmployees || 0,
    exceptions: 0,
    exceptionType: null,
    kycApproved: false,
    isTicket: true,
    isDemo: isDemoTicketId(t.ticketId) || isDemoApplicationId(t.applicationId),
  };
}

const BankerDashboard = ({ user }) => {
  const navigate = useNavigate();
  const [activeFilter, setActiveFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const cached = readCache();
  const [applications, setApplications] = useState(cached?.applications || []);
  const [tickets, setTickets] = useState(cached?.tickets || []);
  // Only show the full-page spinner on the very first visit (no cache yet).
  const [loading, setLoading] = useState(!cached);
  const [refreshing, setRefreshing] = useState(false);
  const [reviewingId, setReviewingId] = useState(null);
  const [processingState, setProcessingState] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  // viewTicket modal removed — pending tickets approve directly on click.
  // Track orphan tickets we've already fired auto-process for, so re-mounts
  // (StrictMode, navigation back) don't re-trigger the slow ADK pipeline.
  const firedAutoProcess = useRef(new Set());

  const loadData = useCallback(() => {
    setRefreshing(true);
    Promise.all([getDemoCases(), getAllTickets()])
      .then(([cases, tix]) => {
        // Inject the 3 hardcoded demo cases so they render with their
        // pre-baked agent outputs (Approved / In Review / Pending). Real
        // backend cases come from getDemoCases(); demo cases come from the
        // mock-data module and never touch the backend.
        const demoCases = DEMO_CASE_ID_LIST
          .map(id => getDemoCaseWithOverrides(id))
          .filter(Boolean);
        const allCases = [...cases, ...demoCases];
        const caseAppIds = new Set(allCases.map(c => c?.case?.applicationId));
        // Demo tickets always have a matching demo case, so they never count
        // as orphans — keeps the auto-process path real-only.
        const orphanTickets = tix.filter(t =>
          !caseAppIds.has(t.applicationId) && !isDemoTicketId(t.ticketId)
        );
        // Skip orphans that were already auto-processed in a previous session.
        // This prevents the "disappear then reappear" glitch: once a real app
        // is processed, if its local case gets pruned it stays gone.
        const processedSet = new Set(getProcessedApps());
        const realOrphans = orphanTickets.filter(t => !processedSet.has(t.applicationId));
        // Fire-and-forget auto-process for orphan tickets, deduped per session.
        // Serialize to avoid overwhelming the backend with N parallel requests.
        (async () => {
          for (const t of realOrphans) {
            if (firedAutoProcess.current.has(t.ticketId)) continue;
            firedAutoProcess.current.add(t.ticketId);
            try { await autoProcessTicket(t.ticketId); } catch (e) {
              console.warn('auto-process failed for', t.ticketId, e);
            }
          }
        })();

        const ticketRows = realOrphans.map(mapTicketToApp);
        const next = [...ticketRows, ...allCases.map(mapCaseToApp)];
        // Defensive prune: keep only rows whose applicationId is either a
        // demo app OR currently in the live backend (and not previously
        // processed then pruned). This prevents ghost rows from reappearing.
        // Rows with a caseId still have a valid local case — always show those.
        const liveAppIds = new Set(tix.map(t => t.applicationId));
        const filteredNext = next.filter(row =>
          isDemoApplicationId(row.id) || row.caseId || (liveAppIds.has(row.id) && !processedSet.has(row.id))
        );
        setApplications(filteredNext);
        setTickets(tix);
        writeCache(filteredNext, tix);
      })
      .catch(err => console.error('Failed to load data:', err))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleReview = async (ticketId, action) => {
    if (action === 'approve') {

      const ticket = tickets.find(t => t.ticketId === ticketId);
      const bizName = ticket?.formData?.businessLegalName || 'Application';

      const steps = [
        { id: 'approve', label: 'Approving Application', icon: '✅', description: 'Recording manager approval...' },
        { id: 'intake', label: 'Document Validation Agent', icon: '📄', description: 'Extracting fields, validating documents, building checklist...' },
        { id: 'kyc', label: 'KYC Agent', icon: '🔍', description: 'Running sanctions, PEP, adverse media & credit screening...' },
        { id: 'spreading', label: 'Financial Spreading Agent', icon: '📊', description: 'Computing ratios, DSCR, and detecting anomalies...' },
        { id: 'memo', label: 'Memo Drafting Agent', icon: '📝', description: 'Generating credit memo & risk assessment...' },
        { id: 'done', label: 'All Agents Complete', icon: '🎉', description: 'Memo ready — Decisioning awaits your review.' },
      ];

      setProcessingState({ ticketId, businessName: bizName, steps, currentStep: 0, caseId: null });

      try {

        await new Promise(r => setTimeout(r, 600));
        setProcessingState(prev => ({ ...prev, currentStep: 1 }));


        const reviewer = user?.name || 'Banker';
        const apiPromise = reviewTicket(ticketId, action, reviewer, '');


        await new Promise(r => setTimeout(r, 900));
        setProcessingState(prev => prev ? { ...prev, currentStep: 2 } : prev);
        await new Promise(r => setTimeout(r, 900));
        setProcessingState(prev => prev ? { ...prev, currentStep: 3 } : prev);
        await new Promise(r => setTimeout(r, 900));
        setProcessingState(prev => prev ? { ...prev, currentStep: 4 } : prev);


        const result = await apiPromise;


        setProcessingState(prev => prev ? { ...prev, currentStep: 5, caseId: result.caseId } : prev);


        await new Promise(r => setTimeout(r, 1200));
        setProcessingState(null);
        if (result.caseId) {
          navigate(`/application/${result.caseId}`, { state: { tab: 'verification' } });
        } else {
          loadData();
        }
      } catch (err) {
        console.error('Approval failed:', err);
        setProcessingState(null);
        loadData();
      }
      return;
    }


    setReviewingId(ticketId);
    try {
      const reviewer = user?.name || 'Banker';
      await reviewTicket(ticketId, action, reviewer, '');
      loadData();
    } catch (err) {
      console.error('Review failed:', err);
    } finally {
      setReviewingId(null);
    }
  };

  const pendingTickets = tickets.filter(t => t.status === 'Pending Review');
  const holdTickets = tickets.filter(t => t.status === 'On Hold');

  const pipelineTotal = applications.reduce((sum, a) => sum + parseAmount(a.loanAmount), 0);
  const pipelineLabel = formatEUR(pipelineTotal);

  const stats = [
    { label: 'Active Cases', value: applications.length, icon: '📋', color: '#1D4D2F' },
    { label: 'Decision Ready', value: applications.filter(a => a.status === 'Decision Ready').length, icon: '✅', color: '#22c55e' },
    { label: 'Total Pipeline', value: pipelineLabel, icon: '💰', color: '#2E7D4A' },
  ];

  const filters = [
    { id: 'all', label: 'All Applications' },
    { id: 'review', label: 'Expert Review' },
    { id: 'warning', label: 'Items to Resolve' },
    { id: 'success', label: 'Decision Ready' },
    { id: 'info', label: 'Docs Needed' },
  ];

  const filteredApplications = applications.filter(app => {
    const matchesFilter = activeFilter === 'all' || app.statusType === activeFilter;
    const matchesSearch = app.businessName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          app.owner.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          app.id.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const getStatusBadgeClass = (statusType) => {
    const classes = {
      success: 'badge-success',
      warning: 'badge-warning',
      review: 'badge-review',
      info: 'badge-info',
      pending: 'badge-pending',
    };
    return classes[statusType] || 'badge-info';
  };

  const getPriorityClass = (priority) => {
    const classes = {
      high: 'priority-high',
      medium: 'priority-medium',
      low: 'priority-low',
    };
    return classes[priority] || '';
  };

  return (
    <div className="banker-dashboard">
      {}
      <div className="dashboard-header">
        <div className="header-content">
          <div className="welcome-section">
            <h1>Welcome back, {user?.name || 'Banker'}</h1>
            <p>Loan Underwriting</p>
          </div>
        </div>
      </div>

      {}
      <div className="dashboard-content">

        <div className="content-header">
          <div style={{display: 'flex', alignItems: 'center', gap: 6 }}>
            <h2>📋 Active Cases</h2>
          </div>
          
          <div className="content-actions">
            <div className="search-box">
              <span>🔍</span>
              <input
                type="text"
                placeholder="Search by name, ID, or owner..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
        </div>
        <div style={{display: 'flex', alignItems: 'center', padding: '0 4px 10px 0', gap: 8, flexWrap: 'wrap'}}>
            <span style={{fontSize: 10, fontWeight: 800, background: '#dcfce7', color: '#166534', padding: '3px 10px', borderRadius: 6, letterSpacing: 0.5}}>AGENT-PROCESSED</span>
            {refreshing && (
              <span style={{fontSize: 10, fontWeight: 700, background: '#e0f2fe', color: '#075985', padding: '3px 10px', borderRadius: 6, letterSpacing: 0.5}}>REFRESHING…</span>
            )}
          </div>

        {}
        <div className="filters-row">
          {filters.map((filter) => (
            <button
              key={filter.id}
              className={`filter-btn ${activeFilter === filter.id ? 'active' : ''}`}
              onClick={() => setActiveFilter(filter.id)}
            >
              {filter.label}
              {filter.id !== 'all' && (
                <span className="filter-count">
                  {applications.filter(a => filter.id === 'all' || a.statusType === filter.id).length}
                </span>
              )}
            </button>
          ))}
        </div>

        {}
        {(() => {
          // Demo and live applications render identically in a single list.
          // The `isDemo` flag stays on the data for the short-circuits in
          // api.js, but it is intentionally NOT exposed in the UI.
          const renderRow = (app) => (
            <div
              key={app.caseId || app.ticketId || app.id}
              className={`table-row ${getPriorityClass(app.priority)}`}
              onClick={async () => {
                if (app.caseId) {
                  navigate(`/application/${app.caseId}`);
                  return;
                }
                // Ticket without local case yet — find or create the case, then go to the case view.
                const existing = await findCaseIdByApplication(app.id);
                if (existing) {
                  navigate(`/application/${existing}`);
                } else {
                  // No case yet — directly approve & run the agents.
                  const t = tickets.find(x => x.ticketId === app.ticketId);
                  if (t) handleReview(t.ticketId, 'approve');
                }
              }}
            >
              <div className="col-id">
                <span className="app-id">{app.id}</span>
                {app.kycApproved && (
                  <span className="app-id" style={{color: '#16a34a', fontSize: 11, fontWeight: 700}}>Case: {app.caseId}</span>
                )}
                <span className="app-date">Submitted {app.submittedDate}</span>
              </div>

              <div className="col-business">
                <div className="business-name">{app.businessName}</div>
                <div className="business-meta">
                  {app.entityType} • {app.state} • {app.industry}
                </div>
              </div>

              <div className="col-owner">
                <div className="owner-name">{app.owner}</div>
                <div className="owner-contact">{app.ownerEmail}</div>
              </div>

              <div className="col-amount">
                <div className="amount-value">{displayAmount(app.loanAmount)}</div>
                <div className="amount-purpose">{app.loanPurpose.slice(0, 30)}...</div>
              </div>

              <div className="col-progress">
                <div className="progress-bar-container">
                  <div className="progress-bar">
                    <div
                      className="progress-fill"
                      style={{ width: `${app.completeness}%` }}
                    ></div>
                  </div>
                  <span className="progress-text">{app.completeness}%</span>
                </div>
                {app.exceptions > 0 && (
                  <div className="exception-badge">
                    ⚠️ {app.exceptions} exception{app.exceptions > 1 ? 's' : ''}
                  </div>
                )}
              </div>

              <div className="col-status">
                <span className={`status-badge ${getStatusBadgeClass(app.statusType)}`}>
                  {app.status}
                </span>
              </div>

              <div className="col-actions" style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <button
                  className="action-btn primary"
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (app.caseId) {
                      navigate(`/application/${app.caseId}`);
                      return;
                    }
                    const existing = await findCaseIdByApplication(app.id);
                    if (existing) {
                      navigate(`/application/${existing}`);
                    } else {
                      const t = tickets.find(x => x.ticketId === app.ticketId);
                      if (t) handleReview(t.ticketId, 'approve');
                    }
                  }}
                  style={{
                    background: 'linear-gradient(135deg, #16a34a, #15803d)',
                    color: '#fff', border: 'none',
                    padding: '7px 14px', borderRadius: 7,
                    fontSize: 12, fontWeight: 700, cursor: 'pointer',
                    boxShadow: '0 2px 8px rgba(22,163,74,0.25)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  📂 Open
                </button>
                <button
                  title="Delete application"
                  disabled={deletingId === app.id}
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (deletingId) return; // Prevent double-click
                    if (isDemoApplicationId(app.id)) {
                      alert('Demo applications cannot be deleted.');
                      return;
                    }
                    if (!window.confirm(`Delete application ${app.id} and all associated data (case, documents, agent outputs)? This cannot be undone.`)) return;
                    setDeletingId(app.id);
                    try {
                      await deleteApplication(app.id);
                      // Refresh dashboard
                      loadData();
                    } catch (err) {
                      alert(`Failed to delete: ${err.message}`);
                    } finally {
                      setDeletingId(null);
                    }
                  }}
                  style={{
                    background: deletingId === app.id ? '#fee2e2' : 'transparent',
                    border: '1px solid #fca5a5',
                    padding: '6px 8px', borderRadius: 7,
                    fontSize: 14,
                    cursor: deletingId === app.id ? 'wait' : 'pointer',
                    color: '#dc2626',
                    opacity: deletingId === app.id ? 0.6 : 1,
                    transition: 'background 0.2s', lineHeight: 1,
                  }}
                  onMouseEnter={e => { if (deletingId !== app.id) e.currentTarget.style.background = '#fee2e2'; }}
                  onMouseLeave={e => { if (deletingId !== app.id) e.currentTarget.style.background = 'transparent'; }}
                >
                  {deletingId === app.id ? '⏳' : '🗑️'}
                </button>
              </div>
            </div>
          );

          const sectionHeaderStyle = {
            display: 'flex', alignItems: 'center', gap: 10,
            margin: '0 4px 10px', fontSize: 13, fontWeight: 700,
            color: '#0f4c30', letterSpacing: 0.6, textTransform: 'uppercase',
          };

          return (
            <div className="applications-table">
              <div style={sectionHeaderStyle}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#16a34a', boxShadow: '0 0 0 4px rgba(22,163,74,0.18)' }} />
                Applications
                <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b', letterSpacing: 0.3, textTransform: 'none' }}>
                  ({filteredApplications.length})
                </span>
              </div>
              <div className="table-header">
                <div className="col-id">Application ID</div>
                <div className="col-business">Business</div>
                <div className="col-owner">Owner</div>
                <div className="col-amount">Amount</div>
                <div className="col-progress">Progress</div>
                <div className="col-status">Status</div>
                <div className="col-actions">Actions</div>
              </div>
              {filteredApplications.length === 0 && !loading ? (
                <div className="no-results" style={{ padding: '20px 16px', textAlign: 'left', color: '#64748b' }}>
                  No applications match the current filter.
                </div>
              ) : filteredApplications.map(renderRow)}
            </div>
          );
        })()}

        {loading && applications.length === 0 && (
          <div className="no-results">
            <span>⏳</span>
            <p>Application Loading...</p>
          </div>
        )}

        {!loading && filteredApplications.length === 0 && (
          <div className="no-results">
            <span>🔍</span>
            <p>No applications found matching your criteria</p>
          </div>
        )}
      </div>

      {/* Application Details modal removed — clicks on pending tickets now go straight to approve & run. */}

      {/* AI Agents Processing modal removed — pipeline runs silently in the background. */}
    </div>
  );
};

export default BankerDashboard;
