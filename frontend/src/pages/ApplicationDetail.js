import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  getFullCase,
  submitHumanDecision,
  runPreApprovalPipeline,
  listApplicationDocuments,
  resetCaseAgentOutputs,
  getDocumentUrl,
} from '../services/api';
import './ApplicationDetail.css';

// Tracks caseIds whose Phase-A auto-pipeline has been kicked off in the
// current browser session. Lives at module scope so it survives any
// re-mount of <ApplicationDetail/> (e.g. user navigating back to the
// dashboard and re-opening the same case before the pipeline finishes).
const autoPipelineStarted = new Set();
// Treat a persisted pipelineStartedAt as "still in flight" for this many ms.
const PIPELINE_STALE_MS = 15 * 60 * 1000;

const fmtMoney = (n) => {
  if (n == null || n === '') return '—';
  const num = Number(String(n).replace(/[^0-9.-]/g, ''));
  if (isNaN(num)) return String(n);
  return `$${num.toLocaleString('en-US')}`;
};

const Card = ({ title, children, action }) => (
  <div className="detail-card" style={{ marginBottom: 16 }}>
    {(title || action) && (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        {title && <h3 style={{ margin: 0, fontSize: 16 }}>{title}</h3>}
        {action}
      </div>
    )}
    {children}
  </div>
);

const KV = ({ label, value }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f1f5f9' }}>
    <span style={{ color: '#64748b', fontSize: 13 }}>{label}</span>
    <span style={{ fontWeight: 600, fontSize: 13 }}>{value ?? '—'}</span>
  </div>
);

const Empty = ({ title, message, onRun, runLabel }) => (
  <div className="detail-card" style={{ textAlign: 'center', padding: 40 }}>
    <div style={{ fontSize: 36, marginBottom: 12 }}>🤖</div>
    <h3 style={{ margin: '0 0 8px' }}>{title}</h3>
    <p style={{ color: '#666', margin: '0 0 20px' }}>{message}</p>
    {onRun && (
      <button
        onClick={onRun}
        style={{
          background: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
          color: '#fff', border: 'none', padding: '12px 28px',
          borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: 'pointer',
        }}
      >
        ▶ {runLabel || 'Run Agent'}
      </button>
    )}
  </div>
);

const MarkdownCard = ({ title, text }) => {
  if (!text) return null;
  return (
    <div className="detail-card" style={{ marginBottom: 16 }}>
      <h3 style={{ margin: '0 0 12px', fontSize: 16 }}>{title}</h3>
      <div className="markdown-content" style={{
        fontSize: 13, lineHeight: 1.6,
        background: '#f8fafc', padding: 12, borderRadius: 8,
      }}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
      </div>
    </div>
  );
};

// ---------- Shared template primitives ----------
const ReportLetterhead = ({ kicker, title, accent, idLabel, idValue, subtitleRight }) => {
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  return (
    <div style={{ background: accent.gradient, color: '#fff', padding: '20px 28px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: 2, opacity: 0.85, fontWeight: 600 }}>{kicker}</div>
          <h2 style={{ margin: '4px 0 0', fontSize: 24, fontWeight: 700, letterSpacing: 0.3 }}>{title}</h2>
        </div>
        <div style={{ textAlign: 'right', fontSize: 12, lineHeight: 1.6 }}>
          {idValue && <div><strong>{idValue}</strong></div>}
          <div style={{ opacity: 0.85 }}>{today}</div>
          <div style={{ opacity: 0.85 }}>{subtitleRight || 'Confidential — Internal Use Only'}</div>
        </div>
      </div>
    </div>
  );
};

const ReportShell = ({ accent, children }) => (
  <div className="detail-card" style={{
    padding: 0,
    background: '#fff',
    borderRadius: 8,
    boxShadow: `0 4px 20px ${accent.shadow}`,
    overflow: 'hidden',
  }}>
    {children}
  </div>
);

const ReportSection = ({ num, title, accent, children }) => (
  <section style={{ marginBottom: 22, pageBreakInside: 'avoid' }}>
    <h3 style={{
      margin: '0 0 10px',
      fontSize: 13,
      fontWeight: 700,
      letterSpacing: 0.4,
      color: '#0f172a',
      textTransform: 'uppercase',
      borderBottom: `2px solid ${accent.line}`,
      paddingBottom: 6,
    }}>
      {num != null && <span style={{ color: accent.line, marginRight: 8 }}>{String(num).padStart(2, '0')}</span>}
      {title}
    </h3>
    <div style={{ fontSize: 13, lineHeight: 1.65, color: '#1e293b' }}>{children}</div>
  </section>
);

const Stat = ({ label, value, sub, tone }) => {
  // Long single-token values (e.g. "PENDING_CLARIFICATION") were overflowing
  // the stat tile because there's no whitespace for the browser to wrap on.
  // Force break-anywhere and shrink the font for long strings so the value
  // always stays inside its tile regardless of width.
  const valueStr = value == null ? '—' : String(value);
  const longValue = valueStr.length > 14;
  return (
    <div style={{
      flex: '1 1 140px',
      minWidth: 0,
      padding: '12px 14px',
      background: tone?.bg || '#f8fafc',
      borderRadius: 8,
      border: `1px solid ${tone?.fg ? tone.fg + '33' : '#e2e8f0'}`,
      overflow: 'hidden',
    }}>
      <div style={{
        fontSize: 11, color: tone?.fg || '#64748b', textTransform: 'uppercase',
        letterSpacing: 0.5, fontWeight: 700, opacity: tone ? 0.85 : 1,
      }}>{label}</div>
      <div style={{
        fontSize: longValue ? 14 : 18,
        fontWeight: 700,
        color: tone?.fg || '#0f172a',
        marginTop: 4,
        lineHeight: 1.25,
        overflowWrap: 'anywhere',
        wordBreak: 'break-word',
      }}>{valueStr}</div>
      {sub && <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{sub}</div>}
    </div>
  );
};

const ACCENT = {
  kyc:       { gradient: 'linear-gradient(135deg, #1e293b 0%, #334155 100%)', line: '#1e293b', shadow: 'rgba(30, 41, 59, 0.12)' },
  spreading: { gradient: 'linear-gradient(135deg, #0c4a6e 0%, #0369a1 100%)', line: '#0c4a6e', shadow: 'rgba(12, 74, 110, 0.12)' },
  decision:  { gradient: 'linear-gradient(135deg, #4c1d24 0%, #7f1d1d 100%)', line: '#7f1d1d', shadow: 'rgba(127, 29, 29, 0.14)' },
  closing:   { gradient: 'linear-gradient(135deg, #312e81 0%, #4338ca 100%)', line: '#4338ca', shadow: 'rgba(67, 56, 202, 0.14)' },
};

// Inline summary display below badges (no modal)
const InlineSummary = ({ reason, isVisible }) => {
  if (!isVisible) return null;
  return (
    <div style={{
      marginTop: 8,
      padding: '10px 12px',
      background: '#fffbeb',
      border: '1px solid #fcd34d',
      borderRadius: 6,
      fontSize: 12,
      lineHeight: 1.5,
      color: '#92400e',
      animation: 'fadeIn 0.2s ease-out',
    }}>
      <strong>⚠️ Reason:</strong> {reason}
    </div>
  );
};

// Generate reason for document status
const getDocumentReason = (doc) => {
  if (doc.status === 'verified') {
    return `Document "${doc.name}" has been verified successfully. ${doc.extractedData ? `Extracted data: ${doc.extractedData}` : ''}`;
  } else if (doc.status === 'missing') {
    return `Required document "${doc.name}" is missing from the application package. Please request this document from the applicant.`;
  } else if (doc.status === 'issues' || doc.status === 'pending') {
    return `Document "${doc.name}" requires review. ${doc.extractedData ? `Extracted information: ${doc.extractedData}. ` : ''}Possible issues include: data inconsistencies, expired document, incomplete information, or quality concerns.`;
  }
  return `Document status: ${doc.status || 'Unknown'}. Manual review may be required.`;
};

// ---------- KYC Agent — Compliance Report template ----------
const KycPanel = ({ kyc, app, onRerun, running }) => {
  const [expandedItem, setExpandedItem] = useState(null);
  
  const toggleExpand = (key) => {
    setExpandedItem(expandedItem === key ? null : key);
  };

  if (!kyc || kyc.completeness == null) {
    if (running) {
      return <Empty title="KYC Agent" message="⏳ KYC Agent is analysing the documents…" />;
    }
    return <Empty title="KYC Agent" message="KYC analysis will appear here once the agent finishes. It runs automatically in the background." />;
  }
  
  // Handler to open document in new tab via signed URL
  const handleDocumentClick = async (doc) => {
    const applicationId = app?.id;
    if (!applicationId) {
      alert('Application not loaded yet. Please wait and try again.');
      return;
    }
    
    // Try to get document_id from the KYC checklist item first,
    // otherwise look it up by matching filename in the app's documents list
    let documentId = doc.document_id;
    
    if (!documentId && doc.filename && app.documents && app.documents.length > 0) {
      // Extract just the filename without path
      const kycFilename = doc.filename.split('/').pop().toLowerCase();
      const match = app.documents.find(d => {
        if (!d.filename) return false;
        const appFilename = d.filename.split('/').pop().toLowerCase();
        // Check for exact match or if one contains the other
        return appFilename === kycFilename || 
               appFilename.includes(kycFilename) || 
               kycFilename.includes(appFilename);
      });
      documentId = match?.documentId;
    }
    
    if (!documentId) {
      console.warn('Documents available:', app.documents);
      console.warn('Looking for:', doc.filename);
      alert('Document link not available. The document may not be uploaded yet, or try re-running the KYC agent.');
      return;
    }
    
    try {
      const result = await getDocumentUrl(applicationId, documentId);
      if (result.signed_url) {
        window.open(result.signed_url, '_blank');
      } else {
        alert('Could not get document URL. Please try again.');
      }
    } catch (err) {
      console.error('Failed to get document URL:', err);
      alert('Unable to open document: ' + err.message);
    }
  };
  
  const accent = ACCENT.kyc;
  const checklist = Array.isArray(kyc.kycChecklist) ? kyc.kycChecklist : [];
  const flags = Array.isArray(kyc.flags) ? kyc.flags : [];
  const passed = String(kyc.status || '').toLowerCase().startsWith('passed');
  const statusTone = passed
    ? { bg: '#dcfce7', fg: '#166534' }
    : flags.length > 0
      ? { bg: '#fee2e2', fg: '#991b1b' }
      : { bg: '#fef3c7', fg: '#92400e' };
  const completeness = Number(kyc.completeness) || 0;
  return (
    <ReportShell accent={accent}>
      <ReportLetterhead kicker="COMPLIANCE & FINANCIAL CRIME — KYC" title="KYC COMPLIANCE REPORT" accent={accent} idLabel="KYC" idValue={kyc.kycId} />
      <div style={{ padding: '24px 28px', maxWidth: 980 }}>
        {/* Subject */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 22, paddingBottom: 18, borderBottom: '1px solid #e2e8f0' }}>
          <div>
            <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700, marginBottom: 6 }}>Subject Entity</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: '#0f172a' }}>{app?.businessName || '—'}</div>
            <div style={{ fontSize: 12, color: '#475569', marginTop: 2 }}>{app?.entityType || '—'}{app?.industry ? ` · ${app.industry}` : ''}</div>
            <div style={{ fontSize: 12, color: '#475569' }}>EIN {app?.ein || '—'}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700, marginBottom: 6 }}>Beneficial Owner</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: '#0f172a' }}>{app?.owner?.name || '—'}</div>
            <div style={{ fontSize: 12, color: '#475569', marginTop: 2 }}>Ownership: {app?.owner?.ownership || '—'}</div>
            <div style={{ fontSize: 12, color: '#475569' }}>{app?.owner?.email || '—'}</div>
          </div>
        </div>

        {/* Top stats */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 22 }}>
          <Stat label="KYC Status" value={passed ? 'PASSED' : (kyc.status || 'PENDING').toUpperCase()} tone={statusTone} sub={passed && kyc.flags?.length ? 'with flags — see notes below' : undefined} />
          <Stat label="Document Completeness" value={`${completeness}%`} sub={completeness >= 95 ? 'Full pack' : completeness >= 70 ? 'Minor gaps' : 'Insufficient'} />
          <Stat label="Sanctions Lists" value={`${kyc.sanctions?.listsChecked ?? 0} checked`} sub={kyc.sanctions?.overallStatus || '—'} />
          <Stat label="Adverse Media" value={`${kyc.adverseMedia?.hits ?? 0} hits`} sub={kyc.adverseMedia?.details} />
        </div>

        {/* Completeness bar */}
        <div style={{ marginBottom: 26 }}>
          <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700, marginBottom: 6 }}>KYC File Completeness</div>
          <div style={{ background: '#e2e8f0', height: 10, borderRadius: 6, overflow: 'hidden' }}>
            <div style={{
              width: `${Math.min(100, completeness)}%`,
              height: '100%',
              background: completeness >= 95 ? '#16a34a' : completeness >= 70 ? '#f59e0b' : '#dc2626',
              transition: 'width 0.5s',
            }} />
          </div>
        </div>

        {/* Sections */}
        <ReportSection num={1} title="Documents Held in Vault" accent={accent}>
          {checklist.length === 0 ? (
            <p style={{ color: '#64748b', margin: 0, fontStyle: 'italic' }}>No KYC documents found in the bucket for this case.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {checklist.map((d, i) => (
                <div key={i}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: 12,
                    borderRadius: 6, border: '1px solid #cbd5e1', background: '#f8fafc',
                  }}>
                  <span style={{ fontSize: 18 }}>{d.status === 'verified' ? '✅' : d.status === 'missing' ? '❌' : '📄'}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{d.name}</div>
                    {d.filename && (
                      <div 
                        style={{ 
                          fontSize: 11, 
                          color: '#0369a1',
                          cursor: 'pointer',
                          textDecoration: 'underline',
                        }}
                        onClick={() => handleDocumentClick(d)}
                        title="Click to view document"
                      >
                        {d.filename}
                      </div>
                    )}
                    {d.extractedData && <div style={{ fontSize: 11, color: '#475569', marginTop: 4, fontStyle: 'italic' }}>“{d.extractedData}”</div>}
                    {d.note && <div style={{ fontSize: 10, color: '#92400e', marginTop: 3 }}>{d.note}</div>}
                  </div>
                  <span 
                    style={{
                      fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 4, letterSpacing: 0.5,
                      background: d.status === 'verified' ? '#dcfce7' : d.status === 'missing' ? '#fee2e2' : '#fef3c7',
                      color: d.status === 'verified' ? '#166534' : d.status === 'missing' ? '#991b1b' : '#92400e',
                      cursor: d.status !== 'verified' ? 'pointer' : 'default',
                      transition: 'all 0.2s',
                    }}
                    onClick={() => d.status !== 'verified' && toggleExpand(`doc-${i}`)}
                    onMouseEnter={(e) => {
                      if (d.status !== 'verified') {
                        e.target.style.transform = 'scale(1.05)';
                        e.target.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      e.target.style.transform = 'scale(1)';
                      e.target.style.boxShadow = 'none';
                    }}
                    title={d.status !== 'verified' ? 'Click to see details' : ''}
                  >
                    {(d.status || 'PENDING').toUpperCase()} {d.status !== 'verified' && (expandedItem === `doc-${i}` ? '▲' : '▼')}
                  </span>
                  </div>
                  <InlineSummary reason={getDocumentReason(d)} isVisible={expandedItem === `doc-${i}` && d.status !== 'verified'} />
                </div>
              ))}
            </div>
          )}
        </ReportSection>

        {kyc.markdown && (() => {
          // Strip out the "Screening Summary" section from the markdown
          const cleaned = kyc.markdown.replace(/#{1,4}\s*Screening Summary[\s\S]*?(?=\n#{1,4}\s|\n*$)/, '').trim();
          if (!cleaned) return null;
          return (
            <ReportSection num={2} title="Analyst Narrative" accent={accent}>
              <div className="markdown-content"><ReactMarkdown remarkPlugins={[remarkGfm]}>{cleaned}</ReactMarkdown></div>
            </ReportSection>
          );
        })()}

        {/* Footer */}
        <div style={{ marginTop: 30, paddingTop: 14, borderTop: `2px solid ${accent.line}`, fontSize: 11, color: '#64748b', display: 'flex', justifyContent: 'space-between' }}>
          <span>Performed by: KYC Agent</span>
          <span>Status: {passed ? 'CLEARED FOR UNDERWRITING' : 'UNDER REVIEW'}</span>
        </div>
      </div>
    </ReportShell>
  );
};

// ---------- Financial Spreading — Analyst Report template ----------
const RATIO_GUIDE = {
  current_ratio:       { label: 'Current Ratio',       good: (v) => v >= 1.5, watch: (v) => v >= 1.0, sub: 'Liquidity (>1.5 healthy)' },
  quick_ratio:         { label: 'Quick Ratio',         good: (v) => v >= 1.0, watch: (v) => v >= 0.7, sub: 'Acid test (>1.0 healthy)' },
  debt_to_equity:      { label: 'Debt / Equity',       good: (v) => v <= 1.0, watch: (v) => v <= 2.0, sub: 'Leverage (<1.0 healthy)' },
  DSCR:                { label: 'DSCR',                good: (v) => v >= 1.25, watch: (v) => v >= 1.0, sub: 'Debt service (>1.25)' },
  ICR:                 { label: 'Interest Coverage',   good: (v) => v >= 3.0, watch: (v) => v >= 1.5, sub: 'EBIT / Interest (>3.0)' },
  EBITDA_Margin:       { label: 'EBITDA Margin',       good: (v) => v >= 15, watch: (v) => v >= 8, sub: '% of revenue (>15%)' },
  profit_margin:       { label: 'Profit Margin',       good: (v) => v >= 10, watch: (v) => v >= 5, sub: 'Net % (>10%)' },
};

const SpreadingPanel = ({ spreading, memo, app, onRun, running }) => {
  const [expandedItem, setExpandedItem] = useState(null);
  
  const toggleExpand = (key) => {
    setExpandedItem(expandedItem === key ? null : key);
  };

  if (!spreading) {
    if (running) {
      return <Empty title="Financial Spreading Agent" message="⏳ Financial Spreading Agent is computing ratios…" />;
    }
    return <Empty title="Financial Spreading Agent" message="Financial spreading will appear here once the agent finishes. It runs automatically in the background." />;
  }
  const accent = ACCENT.spreading;
  const ratios = spreading.ratios || {};
  const summary = spreading.summary || {};
  const assessments = Array.isArray(spreading.assessments) ? spreading.assessments : [];
  const anomalies = Array.isArray(spreading.anomalies) ? spreading.anomalies : [];

  // When financial agent returns INSUFFICIENT_DATA or no values, fall back to memo agent's metrics
  const memoSummary = (memo && memo.summary) || {};
  const memoPd = typeof memoSummary.pd === 'object' ? memoSummary.pd?.value : memoSummary.pd;
  const memoLgd = typeof memoSummary.lgd === 'object' ? memoSummary.lgd?.value : memoSummary.lgd;
  const memoRisk = memoSummary.riskLevel;
  const memoDecision = memoSummary.recommendation;
  const isInsufficient = !summary.riskLevel || summary.riskLevel === 'Unknown' || summary.decision === 'INSUFFICIENT_DATA';

  const effectiveRisk = isInsufficient && memoRisk ? memoRisk : (summary.riskLevel || null);
  const effectiveConf = summary.overallConfidence != null ? Number(summary.overallConfidence) : (isInsufficient && memoSummary.overallConfidence != null ? Number(memoSummary.overallConfidence) : null);
  const effectiveDecision = isInsufficient && memoDecision ? memoDecision : (summary.decision || null);

  const conf = effectiveConf;
  const rTone = riskTone(effectiveRisk);

  // PD/LGD: prefer financial agent, fall back to memo
  const pdPct = summary.pdPct != null ? Number(summary.pdPct) : (isInsufficient && memoPd != null ? Number(memoPd) : null);
  const lgdPct = summary.lgdPct != null ? Number(summary.lgdPct) : (isInsufficient && memoLgd != null ? Number(memoLgd) : null);
  const elPct = summary.expectedLossPct != null ? Number(summary.expectedLossPct) : (pdPct != null && lgdPct != null ? Number((pdPct * lgdPct / 100).toFixed(2)) : null);

  return (
    <ReportShell accent={accent}>
      <ReportLetterhead kicker="CREDIT ANALYTICS — FINANCIAL SPREADING (ML: Isolation Forest + PD/LGD Scorecard)" title="FINANCIAL ANALYSIS REPORT" accent={accent} idLabel="SPR" idValue={spreading.spreadingId} />
      <div style={{ padding: '24px 28px', maxWidth: 980 }}>
        {/* Header strip — only fields we actually have from app + agent */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 22, paddingBottom: 18, borderBottom: '1px solid #e2e8f0' }}>
          <div>
            <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700, marginBottom: 6 }}>Borrower</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>{app?.businessName || '—'}</div>
            <div style={{ fontSize: 12, color: '#475569' }}>{app?.industry || '—'}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700, marginBottom: 6 }}>Stated Annual Revenue</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>{fmtMoney(app?.annualRevenue)}</div>
            <div style={{ fontSize: 12, color: '#475569' }}>{app?.entityType || '—'}</div>
          </div>
        </div>

        {/* Headline metrics */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 22 }}>
          <Stat label="Confidence" value={conf != null ? `${conf}%` : '—'} sub={conf >= 80 ? 'High' : conf >= 60 ? 'Moderate' : 'Low'} />
          <Stat label="Risk Level" value={effectiveRisk || '—'} tone={rTone} />
          {pdPct != null && <Stat label="PD" value={`${pdPct.toFixed(2)}%`} sub="Probability of default" />}
          {lgdPct != null && <Stat label="LGD" value={`${lgdPct.toFixed(2)}%`} sub="Loss given default" />}
          {elPct != null && <Stat label="Expected Loss" value={`${elPct.toFixed(2)}%`} sub="PD × LGD × EAD" />}
          {effectiveDecision && (
            <Stat
              label="Engine Decision"
              value={String(effectiveDecision)
                .replace(/_/g, ' ')
                .toLowerCase()
                .replace(/\b\w/g, (m) => m.toUpperCase())}
            />
          )}
        </div>

        {isInsufficient && memo && (
          <div style={{ fontSize: 11, color: '#64748b', fontStyle: 'italic', marginBottom: 16 }}>
            metrics sourced from credit memo agent (financial agent had insufficient data)
          </div>
        )}

        {/* Ratio dashboard */}
        <ReportSection num={1} title="Computed Financial Ratios" accent={accent}>
          {Object.keys(ratios).length === 0 ? (
            <p style={{ color: '#64748b', margin: 0, fontStyle: 'italic' }}>No ratios computed.</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
              {Object.entries(ratios).map(([k, v]) => {
                const guide = RATIO_GUIDE[k] || RATIO_GUIDE[k.toLowerCase()] || null;
                const num = Number(v);
                let dot = '#94a3b8';
                let label = '—';
                if (guide && !isNaN(num)) {
                  if (guide.good(num))      { dot = '#16a34a'; label = 'Healthy'; }
                  else if (guide.watch(num)){ dot = '#f59e0b'; label = 'Watch'; }
                  else                       { dot = '#dc2626'; label = 'Stressed'; }
                }
                return (
                  <div key={k} style={{ padding: 12, borderRadius: 8, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                    <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', fontWeight: 700, letterSpacing: 0.5 }}>
                      {guide?.label || k}
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', marginTop: 4 }}>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot, display: 'inline-block' }} />
                      <span style={{ fontSize: 11, color: '#475569' }}>{label}</span>
                    </div>
                    {guide?.sub && <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 4 }}>{guide.sub}</div>}
                  </div>
                );
              })}
            </div>
          )}
        </ReportSection>

        {/* Assessments */}
        {assessments.length > 0 && (
          <ReportSection num={2} title="Policy Assessments" accent={accent}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {assessments.map((a, i) => {
                const s = String(a.status || '').toLowerCase();
                const tone = s === 'pass' ? '#16a34a' : s === 'warning' || s === 'warn' ? '#f59e0b' : s === 'fail' ? '#dc2626' : '#64748b';
                const isIssue = s !== 'pass';
                const isExpanded = expandedItem === `assessment-${i}`;
                return (
                  <div key={i}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: 12,
                      borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff',
                      borderLeft: `4px solid ${tone}`,
                    }}>
                      <span style={{ fontSize: 18 }}>{s === 'pass' ? '✅' : s === 'warning' ? '⚠️' : s === 'fail' ? '❌' : 'ℹ️'}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{a.metric || a.name}</div>
                        <div style={{ fontSize: 12, color: '#64748b' }}>{a.detail || a.message || ''}</div>
                      </div>
                      <span 
                        style={{ 
                          fontSize: 10, fontWeight: 700, color: tone, letterSpacing: 0.5,
                          cursor: isIssue ? 'pointer' : 'default',
                          padding: '3px 8px', borderRadius: 4,
                          background: isIssue ? tone + '15' : 'transparent',
                          transition: 'all 0.2s',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                        }}
                        onClick={() => isIssue && toggleExpand(`assessment-${i}`)}
                        onMouseEnter={(e) => {
                          if (isIssue) {
                            e.target.style.transform = 'scale(1.05)';
                            e.target.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
                          }
                        }}
                        onMouseLeave={(e) => {
                          e.target.style.transform = 'scale(1)';
                          e.target.style.boxShadow = 'none';
                        }}
                        title={isIssue ? 'Click to see details' : ''}
                      >
                        {(a.status || '—').toUpperCase()} {isIssue && (isExpanded ? '▲' : '▼')}
                      </span>
                    </div>
                    <InlineSummary 
                      reason={`Assessment Status: ${(a.status || 'Unknown').toUpperCase()}. ${a.detail || a.message || 'This policy assessment requires attention. The metric did not meet the expected threshold for approval. Review the financial data and consider risk mitigation strategies.'}`}
                      isVisible={isExpanded} 
                    />
                  </div>
                );
              })}
            </div>
          </ReportSection>
        )}

        {/* Anomalies */}
        {anomalies.length > 0 && (
          <ReportSection num={3} title="Anomaly Detection" accent={accent}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {anomalies.map((a, i) => {
                const sev = String(a.severity || '').toLowerCase();
                const tone = sev === 'high' ? '#dc2626' : sev === 'medium' ? '#f59e0b' : '#0ea5e9';
                const isExpanded = expandedItem === `anomaly-${i}`;
                return (
                  <div key={i}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: 12,
                      borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff',
                      borderLeft: `4px solid ${tone}`,
                    }}>
                      <span 
                        style={{ 
                          fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 4, 
                          background: tone + '20', color: tone, letterSpacing: 0.5,
                          cursor: 'pointer',
                          transition: 'all 0.2s',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                        }}
                        onClick={() => toggleExpand(`anomaly-${i}`)}
                        onMouseEnter={(e) => {
                          e.target.style.transform = 'scale(1.05)';
                          e.target.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
                        }}
                        onMouseLeave={(e) => {
                          e.target.style.transform = 'scale(1)';
                          e.target.style.boxShadow = 'none';
                        }}
                        title="Click to see details"
                      >
                        {(a.severity || 'INFO').toUpperCase()} {isExpanded ? '▲' : '▼'}
                      </span>
                      <div style={{ flex: 1, fontSize: 13 }}>{a.message || a.description || JSON.stringify(a)}</div>
                    </div>
                    <InlineSummary 
                      reason={`Severity: ${(a.severity || 'Unknown').toUpperCase()}. ${a.message || a.description || 'Financial anomaly detected by ML model. This indicates unusual patterns in the financial data that deviate from expected norms. Manual review recommended to assess potential risks.'}`}
                      isVisible={isExpanded} 
                    />
                  </div>
                );
              })}
            </div>
          </ReportSection>
        )}

        {spreading.markdown && (
          <ReportSection num={anomalies.length > 0 ? 4 : assessments.length > 0 ? 3 : 2} title="ML Model Analysis & Analyst Commentary" accent={accent}>
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8, fontStyle: 'italic' }}>
              Generated via the <strong>financial_anomaly_tool</strong> ML pipeline
              — Isolation Forest anomaly detection vs. industry benchmark, bank-policy
              threshold checks, PD scorecard, and LGD by collateral coverage.
            </div>
            <div className="markdown-content"><ReactMarkdown remarkPlugins={[remarkGfm]}>{spreading.markdown}</ReactMarkdown></div>
          </ReportSection>
        )}

        <div style={{ marginTop: 30, paddingTop: 14, borderTop: `2px solid ${accent.line}`, fontSize: 11, color: '#64748b', display: 'flex', justifyContent: 'space-between' }}>
          <span>Performed by: Financial Spreading Agent · ML engine: financial_anomaly_tool</span>
          <span>Status: {spreading.status || '—'}</span>
        </div>
      </div>
    </ReportShell>
  );
};

// ---------- Credit Memo (professional template) ----------
const MEMO_SECTION_ORDER = [
  'Borrower Overview',
  'Facility Requested',
  'Purpose & Use of Funds',
  'Financial Highlights',
  'KYC & Compliance Position',
  'Strengths',
  'Weaknesses / Gaps',
  'PD / LGD Analysis',
  'Underwriter Narrative',
  'Missing Information',
  'Review-Ready Summary',
];

// Parse the full markdown the agent returns (## 1. Title) into a map of
// { title -> body markdown }. Falls back gracefully when the agent skips a
// section. Strips the leading number (e.g. "## 1. Borrower Overview" -> "Borrower Overview").
const parseMemoMarkdown = (md) => {
  if (!md || typeof md !== 'string') return {};
  const lines = md.split(/\r?\n/);
  const out = {};
  let cur = null;
  let buf = [];
  const flush = () => {
    if (cur) out[cur] = buf.join('\n').trim();
    buf = [];
  };
  for (const ln of lines) {
    // Accept ##, ### or ####. The Credit Memo agent emits ##; the Closing
    // Package agent emits ###. Both should be parsed into sections.
    const m = ln.match(/^#{2,4}\s+(?:\d+\.\s*)?(.+?)\s*$/);
    if (m) {
      flush();
      cur = m[1].trim();
    } else if (cur) {
      buf.push(ln);
    }
  }
  flush();
  return out;
};

// Extract the final summary section from an agent's markdown.
// Looks for a heading matching one of the keywords, returns the content
// of the LAST matching section (agents put summaries at the end).
const extractFinalSection = (md, keywords) => {
  if (!md || typeof md !== 'string') return null;
  const sections = parseMemoMarkdown(md);
  // Try each keyword in order, find the LAST section that matches
  for (const kw of keywords) {
    const kwLower = kw.toLowerCase();
    // Find all section keys that include this keyword
    const matches = Object.keys(sections).filter(k => k.toLowerCase().includes(kwLower));
    if (matches.length > 0) {
      // Return the last match (most likely the final summary)
      const key = matches[matches.length - 1];
      const content = sections[key];
      if (content && content.trim().length > 10) return content;
    }
  }
  // Fallback: return the last section if it has meaningful content
  const allKeys = Object.keys(sections);
  if (allKeys.length > 0) {
    const lastContent = sections[allKeys[allKeys.length - 1]];
    if (lastContent && lastContent.trim().length > 10) return lastContent;
  }
  return null;
};

const recommendationTone = (rec) => {
  const r = String(rec || '').toLowerCase();
  if (r.includes('approve with')) return { bg: '#fef3c7', fg: '#92400e', border: '#f59e0b', label: 'APPROVE WITH CONDITIONS' };
  if (r.includes('approve'))      return { bg: '#dcfce7', fg: '#166534', border: '#22c55e', label: 'RECOMMEND APPROVAL' };
  if (r.includes('reject') || r.includes('decline')) return { bg: '#fee2e2', fg: '#991b1b', border: '#ef4444', label: 'RECOMMEND REJECTION' };
  return { bg: '#e0f2fe', fg: '#075985', border: '#0ea5e9', label: String(rec || 'PENDING').toUpperCase() };
};

const riskTone = (level) => {
  const l = String(level || '').toLowerCase();
  if (l.startsWith('low'))  return { bg: '#dcfce7', fg: '#166534' };
  if (l.startsWith('mod'))  return { bg: '#fef3c7', fg: '#92400e' };
  if (l.startsWith('high')) return { bg: '#fee2e2', fg: '#991b1b' };
  if (l.startsWith('very')) return { bg: '#fecaca', fg: '#7f1d1d' };
  return { bg: '#e2e8f0', fg: '#475569' };
};

const MemoStat = ({ label, value, sub }) => (
  <div style={{ flex: 1, minWidth: 140, padding: '12px 14px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
    <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>{label}</div>
    <div style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', marginTop: 4 }}>{value ?? '—'}</div>
    {sub && <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{sub}</div>}
  </div>
);

const MemoSection = ({ num, title, children }) => (
  <section style={{ marginBottom: 20, pageBreakInside: 'avoid' }}>
    <h3 style={{
      margin: '0 0 10px',
      fontSize: 13,
      fontWeight: 700,
      letterSpacing: 0.4,
      color: '#0f172a',
      textTransform: 'uppercase',
      borderBottom: '2px solid #0f4c30',
      paddingBottom: 6,
    }}>
      {num != null && <span style={{ color: '#0f4c30', marginRight: 8 }}>{String(num).padStart(2, '0')}</span>}
      {title}
    </h3>
    <div style={{ fontSize: 13, lineHeight: 1.65, color: '#1e293b' }}>{children}</div>
  </section>
);

const MemoPanel = ({ memo, app, onRun, running }) => {
  if (!memo || (!memo.markdown && !memo.summary && !(memo.sections && memo.sections.length))) {
    if (running) {
      return <Empty title="Memo Drafting Agent" message="⏳ Memo Drafting Agent is drafting the memo…" />;
    }
    return <Empty title="Memo Drafting Agent" message="The credit memo will appear here once the agent finishes. It runs automatically in the background." />;
  }

  const summary = memo.summary || {};
  const memoId = memo.memoId || 'MEMO-PENDING';
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  // Normalise PD / LGD which can be either { value, band } or a plain number.
  const pdVal = typeof summary.pd === 'object' ? summary.pd?.value : summary.pd;
  const pdBand = typeof summary.pd === 'object' ? summary.pd?.band : null;
  const lgdVal = typeof summary.lgd === 'object' ? summary.lgd?.value : summary.lgd;
  const lgdProd = typeof summary.lgd === 'object' ? summary.lgd?.product : null;

  const recTone = recommendationTone(summary.recommendation);
  const rTone = riskTone(summary.riskLevel);

  // Map section title -> body. Prefer markdown parsing (richer), fall back to memo.sections.
  const fromMd = parseMemoMarkdown(memo.markdown);
  const fromArr = {};
  (Array.isArray(memo.sections) ? memo.sections : []).forEach((s) => {
    if (!s || !s.title) return;
    fromArr[s.title] = s.narrative || (s.body ? JSON.stringify(s.body, null, 2) : '');
  });
  const sectionMap = { ...fromArr, ...fromMd };

  const findSection = (name) => {
    if (sectionMap[name]) return sectionMap[name];
    // Fuzzy: case-insensitive contains on key.
    const key = Object.keys(sectionMap).find((k) => k.toLowerCase().includes(name.toLowerCase()));
    return key ? sectionMap[key] : null;
  };

  return (
    <div className="detail-card" style={{
      padding: 0,
      background: '#fff',
      borderRadius: 8,
      boxShadow: '0 4px 20px rgba(15, 76, 48, 0.08)',
      overflow: 'hidden',
    }}>
      {/* Letterhead */}
      <div style={{
        background: 'linear-gradient(135deg, #0f4c30 0%, #1a6b44 100%)',
        color: '#fff',
        padding: '20px 28px',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: 2, opacity: 0.85, fontWeight: 600 }}>MEMO DRAFTER</div>
            <h2 style={{ margin: '4px 0 0', fontSize: 24, fontWeight: 700, letterSpacing: 0.3 }}>CREDIT MEMORANDUM</h2>
          </div>
          <div style={{ textAlign: 'right', fontSize: 12, lineHeight: 1.6 }}>
            <div><strong>{memoId}</strong></div>
            <div style={{ opacity: 0.85 }}>{today}</div>
            <div style={{ opacity: 0.85 }}>Confidential — Internal Use Only</div>
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: '24px 28px', maxWidth: 980 }}>
        {/* Borrower / Facility quick reference */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 22, paddingBottom: 18, borderBottom: '1px solid #e2e8f0' }}>
          <div>
            <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700, marginBottom: 6 }}>Borrower</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: '#0f172a' }}>{app?.businessName || '—'}</div>
            <div style={{ fontSize: 12, color: '#475569', marginTop: 2 }}>{app?.entityType || '—'}{app?.industry ? ` · ${app.industry}` : ''}</div>
            <div style={{ fontSize: 12, color: '#475569' }}>EIN {app?.ein || '—'}</div>
            <div style={{ fontSize: 12, color: '#475569' }}>{[app?.businessAddress, app?.city, app?.state, app?.zipCode].filter(Boolean).join(', ') || '—'}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700, marginBottom: 6 }}>Facility Requested</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: '#0f172a' }}>{fmtMoney(app?.loan?.amount, app?.loan?.currency)}</div>
            <div style={{ fontSize: 12, color: '#475569', marginTop: 2 }}>{app?.loan?.purpose || '—'}</div>
            <div style={{ fontSize: 12, color: '#475569' }}>Term: {app?.loan?.term || '—'}</div>
            <div style={{ fontSize: 12, color: '#475569' }}>Sponsor: {app?.owner?.name || '—'}</div>
          </div>
        </div>

        {/* Risk dashboard */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 22 }}>
          <MemoStat label="Internal Rating" value={summary.internalRating || '—'} />
          <MemoStat
            label="Probability of Default"
            value={pdVal != null ? `${Number(pdVal).toFixed(1)}%` : '—'}
            sub={pdBand}
          />
          <MemoStat
            label="Loss Given Default"
            value={lgdVal != null ? `${Number(lgdVal).toFixed(1)}%` : '—'}
            sub={lgdProd ? `${lgdProd} loan` : null}
          />
          <div style={{ flex: 1, minWidth: 140, padding: '12px 14px', background: rTone.bg, borderRadius: 8, border: `1px solid ${rTone.fg}33` }}>
            <div style={{ fontSize: 11, color: rTone.fg, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700, opacity: 0.85 }}>Risk Level</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: rTone.fg, marginTop: 4 }}>{summary.riskLevel || '—'}</div>
          </div>
        </div>

        {/* Recommendation banner */}
        <div style={{
          background: recTone.bg,
          border: `1.5px solid ${recTone.border}`,
          borderLeft: `6px solid ${recTone.border}`,
          color: recTone.fg,
          padding: '14px 18px',
          borderRadius: 6,
          marginBottom: 26,
        }}>
          <div style={{ fontSize: 11, letterSpacing: 1.2, fontWeight: 700, opacity: 0.9 }}>UNDERWRITER RECOMMENDATION</div>
          <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>{recTone.label}</div>
          {summary.decisionHint && (
            <div style={{ fontSize: 12, marginTop: 6, fontStyle: 'italic', opacity: 0.95 }}>{summary.decisionHint}</div>
          )}
        </div>

        {/* Numbered sections */}
        {MEMO_SECTION_ORDER.map((title, idx) => {
          const body = findSection(title);
          if (!body) return null;
          return (
            <MemoSection key={title} num={idx + 1} title={title}>
              <div className="markdown-content">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
              </div>
            </MemoSection>
          );
        })}

        {/* Signature block */}
        <div style={{
          marginTop: 30,
          paddingTop: 18,
          borderTop: '2px solid #0f4c30',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 24,
          fontSize: 12,
          color: '#475569',
        }}>
          <div>
            <div style={{ borderBottom: '1px solid #94a3b8', height: 30 }} />
            <div style={{ marginTop: 4, fontWeight: 600 }}>Prepared by — Memo Drafting Agent</div>
            <div>Date: {today}</div>
          </div>
          <div>
            <div style={{ borderBottom: '1px solid #94a3b8', height: 30 }} />
            <div style={{ marginTop: 4, fontWeight: 600 }}>Reviewed by — Underwriter</div>
            <div>Pending sign-off</div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ---------- Agent Explanation Card for Decision Panel ----------
const AgentExplanationCard = ({ title, explanation }) => {
  if (!explanation) {
    return (
      <div style={{ padding: 14, background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: 8, marginBottom: 12 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: '#92400e', marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 12, color: '#92400e' }}>Review Required — Agent output not available</div>
      </div>
    );
  }
  const statusColors = {
    'Pass': { bg: '#dcfce7', fg: '#166534', border: '#16a34a', icon: '✅' },
    'Fail': { bg: '#fee2e2', fg: '#991b1b', border: '#dc2626', icon: '❌' },
    'Warning': { bg: '#fef3c7', fg: '#92400e', border: '#f59e0b', icon: '⚠️' },
    'Review Required': { bg: '#e0f2fe', fg: '#075985', border: '#0ea5e9', icon: '🔍' },
  };
  const tone = statusColors[explanation.status] || statusColors['Review Required'];
  return (
    <div style={{ border: `1px solid ${tone.border}`, borderRadius: 8, overflow: 'hidden', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: tone.bg }}>
        <span style={{ fontWeight: 700, fontSize: 13, color: tone.fg }}>{tone.icon} {title}</span>
        <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: '#fff', color: tone.fg, border: `1px solid ${tone.border}` }}>
          {explanation.status || 'Unknown'}
        </span>
      </div>
      <div style={{ padding: '12px 14px', fontSize: 12, lineHeight: 1.6 }}>
        {Array.isArray(explanation.keyFindings) && explanation.keyFindings.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontWeight: 600, color: '#475569', marginBottom: 4 }}>Key Findings:</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {explanation.keyFindings.map((f, i) => <li key={i} style={{ marginBottom: 2 }}>{f}</li>)}
            </ul>
          </div>
        )}
        {Array.isArray(explanation.missingOrFailed) && explanation.missingOrFailed.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontWeight: 600, color: '#991b1b', marginBottom: 4 }}>Missing / Failed Checks:</div>
            <ul style={{ margin: 0, paddingLeft: 18, color: '#991b1b' }}>
              {explanation.missingOrFailed.map((f, i) => <li key={i} style={{ marginBottom: 2 }}>{f}</li>)}
            </ul>
          </div>
        )}
        {explanation.impactOnDecision && (
          <div style={{ marginTop: 6, padding: '6px 10px', background: '#f8fafc', borderRadius: 4, fontStyle: 'italic', color: '#475569' }}>
            <strong>Impact:</strong> {explanation.impactOnDecision}
          </div>
        )}
      </div>
    </div>
  );
};

const ReviewerSummaryPanel = ({ reviewerSummary }) => {
  if (!reviewerSummary) return null;
  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', background: '#f1f5f9', borderBottom: '1px solid #e2e8f0' }}>
        <span style={{ fontWeight: 700, fontSize: 13, color: '#0f172a' }}>📋 Reviewer Summary</span>
      </div>
      <div style={{ padding: '14px 14px', fontSize: 12, lineHeight: 1.6 }}>
        {reviewerSummary.decisionSummary && (
          <div style={{ marginBottom: 12, padding: '10px 12px', background: '#f8fafc', borderRadius: 6, fontSize: 13, fontWeight: 500 }}>
            {reviewerSummary.decisionSummary}
          </div>
        )}
        {Array.isArray(reviewerSummary.blockingReasons) && reviewerSummary.blockingReasons.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontWeight: 700, color: '#991b1b', marginBottom: 4 }}>🚫 Blocking Reasons:</div>
            <ul style={{ margin: 0, paddingLeft: 18, color: '#991b1b' }}>
              {reviewerSummary.blockingReasons.map((r, i) => <li key={i} style={{ marginBottom: 2 }}>{r}</li>)}
            </ul>
          </div>
        )}
        {Array.isArray(reviewerSummary.warnings) && reviewerSummary.warnings.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontWeight: 700, color: '#92400e', marginBottom: 4 }}>⚠️ Warnings:</div>
            <ul style={{ margin: 0, paddingLeft: 18, color: '#92400e' }}>
              {reviewerSummary.warnings.map((w, i) => <li key={i} style={{ marginBottom: 2 }}>{w}</li>)}
            </ul>
          </div>
        )}
        {Array.isArray(reviewerSummary.reviewReasons) && reviewerSummary.reviewReasons.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontWeight: 700, color: '#075985', marginBottom: 4 }}>🔍 Review Reasons:</div>
            <ul style={{ margin: 0, paddingLeft: 18, color: '#075985' }}>
              {reviewerSummary.reviewReasons.map((r, i) => <li key={i} style={{ marginBottom: 2 }}>{r}</li>)}
            </ul>
          </div>
        )}
        {reviewerSummary.recommendedNextAction && (
          <div style={{ marginTop: 10, padding: '10px 12px', background: '#dcfce7', border: '1px solid #16a34a', borderRadius: 6 }}>
            <strong style={{ color: '#166534' }}>Recommended Next Action:</strong>{' '}
            <span style={{ color: '#166534' }}>{reviewerSummary.recommendedNextAction}</span>
          </div>
        )}
      </div>
    </div>
  );
};

// ---------- Decisioning — Credit Decision Letter template ----------
const DecisioningPanel = ({ decision, app, running, onSubmitHuman, kyc, spreading, intake }) => {
  const [notes, setNotes] = useState('');
  const [overrideMode, setOverrideMode] = useState(false);
  const [overrideNotes, setOverrideNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Checklist state: each item can be 'tick' (accepted), 'cross' (rejected), or null (pending)
  const [checklist, setChecklist] = useState({});
  const [expandedIssue, setExpandedIssue] = useState(null);
  // Checkboxes are locked until the RM clicks the edit icon
  const [checklistEditing, setChecklistEditing] = useState(false);

  // Build the issues/anomalies list from all agents
  const allIssues = React.useMemo(() => {
    const items = [];

    // --- Document Checklist from Intake Agent (reduced: issues always, max 3 present) ---
    if (intake?.markdown) {
      const lines = intake.markdown.split('\n');
      let inChecklistTable = false;
      let headerPassed = false;
      const parsedDocs = [];
      lines.forEach(line => {
        const trimmed = line.trim();
        if (trimmed.toLowerCase().includes('validation checklist') || trimmed.toLowerCase().includes('closing checklist')) {
          inChecklistTable = true;
          headerPassed = false;
          return;
        }
        if (inChecklistTable && trimmed.startsWith('|')) {
          if (trimmed.includes('Required Document') || trimmed.includes('---')) {
            headerPassed = true;
            return;
          }
          if (headerPassed) {
            const cols = trimmed.split('|').map(c => c.trim()).filter(Boolean);
            if (cols.length >= 3) {
              const docName = cols[1] || '';
              const statusRaw = cols[2] || '';
              const comments = cols[cols.length - 1] || '';
              const statusLower = statusRaw.toLowerCase();
              let status = 'present';
              if (statusLower.includes('missing') || statusLower.includes('❌')) status = 'missing';
              else if (statusLower.includes('incomplete') || statusLower.includes('⚠️')) status = 'incomplete';
              else if (statusLower.includes('present') || statusLower.includes('✅') || statusLower.includes('verified')) status = 'present';
              parsedDocs.push({ docName, status, comments });
            }
          }
        } else if (inChecklistTable && !trimmed.startsWith('|') && headerPassed && trimmed !== '') {
          inChecklistTable = false;
        }
      });
      // Always show missing/incomplete, show max 3 present docs
      const issues = parsedDocs.filter(d => d.status !== 'present');
      const present = parsedDocs.filter(d => d.status === 'present');
      issues.forEach(d => {
        items.push({
          id: `doc-checklist-${items.length}`,
          source: 'Documents',
          type: d.status === 'missing' ? '❌ Missing' : '⚠️ Incomplete',
          description: `${d.docName}${d.comments && d.comments !== d.docName ? ` — ${d.comments}` : ''}`,
          severity: d.status,
          reason: d.status === 'missing'
            ? `Required document "${d.docName}" was not found in the uploaded application package.`
            : `Document "${d.docName}" appears incomplete or has quality issues. ${d.comments ? `Details: ${d.comments}.` : ''}`,
        });
      });
      present.slice(0, 3).forEach(d => {
        items.push({
          id: `doc-checklist-${items.length}`,
          source: 'Documents',
          type: '✅ Present',
          description: `${d.docName}${d.comments && d.comments !== d.docName ? ` — ${d.comments}` : ''}`,
          severity: 'present',
          reason: `Document "${d.docName}" is present and verified.`,
        });
      });
      if (present.length > 3) {
        items.push({
          id: `doc-checklist-${items.length}`,
          source: 'Documents',
          type: '✅ Present',
          description: `+ ${present.length - 3} more document(s) verified`,
          severity: 'present',
          reason: `${present.length - 3} additional documents are present and verified in the application package.`,
        });
      }
    }

    // --- KYC: Screening results (always show) ---
    if (kyc) {
      const sanctions = kyc.sanctions || {};
      const sanctionsStatus = String(sanctions.overallStatus || '').toLowerCase();
      items.push({
        id: 'kyc-sanctions',
        source: 'KYC',
        type: sanctionsStatus.includes('clear') || sanctionsStatus.includes('no match') ? '✅ Clear' : sanctionsStatus ? '⚠️ Review' : '— Pending',
        description: `Sanctions Screening: ${sanctions.overallStatus || 'Not performed'} (${sanctions.listsChecked || 0} lists checked)`,
        severity: sanctionsStatus.includes('clear') || sanctionsStatus.includes('no match') ? 'present' : sanctionsStatus ? 'incomplete' : 'missing',
        reason: `Sanctions screening checked ${sanctions.listsChecked || 0} lists. Result: ${sanctions.overallStatus || 'Unknown'}.`,
      });
      const adverseMedia = kyc.adverseMedia || {};
      const amHits = Number(adverseMedia.hits || 0);
      items.push({
        id: 'kyc-adverse-media',
        source: 'KYC',
        type: amHits === 0 ? '✅ Clear' : '⚠️ Hits Found',
        description: `Adverse Media: ${amHits} hit(s)${adverseMedia.details ? ` — ${adverseMedia.details}` : ''}`,
        severity: amHits === 0 ? 'present' : 'incomplete',
        reason: amHits === 0 ? 'No adverse media findings.' : `${amHits} adverse media hit(s) found. ${adverseMedia.details || ''} Manual review recommended.`,
      });
      const kycStatus = String(kyc.status || '').toLowerCase();
      items.push({
        id: 'kyc-overall',
        source: 'KYC',
        type: kycStatus.startsWith('passed') ? '✅ Passed' : kycStatus ? '❌ Failed' : '— Pending',
        description: `Overall KYC Status: ${String(kyc.status || 'Pending').toUpperCase()} · Completeness: ${kyc.completeness || 0}%`,
        severity: kycStatus.startsWith('passed') ? 'present' : kycStatus ? 'missing' : 'incomplete',
        reason: kycStatus.startsWith('passed') ? 'KYC verification passed. All identity and compliance checks cleared.' : `KYC verification status: ${kyc.status || 'Pending'}. Document completeness at ${kyc.completeness || 0}%.`,
      });
    }
    // KYC flags
    const kycFlags = Array.isArray(kyc?.flags) ? kyc.flags : [];
    kycFlags.forEach((f, i) => {
      const msg = typeof f === 'string' ? f : (f.message || JSON.stringify(f));
      items.push({ id: `kyc-flag-${i}`, source: 'KYC', type: '⚠️ Flag', description: msg, reason: `KYC compliance flag: ${msg}.` });
    });
    // KYC checklist — missing or issues docs
    const kycChecklist = Array.isArray(kyc?.kycChecklist) ? kyc.kycChecklist : [];
    kycChecklist.filter(d => d.status === 'issues' || d.status === 'missing').forEach((d, i) => {
      const desc = `${d.name}: ${d.note || d.status}`;
      items.push({ id: `kyc-doc-${i}`, source: 'KYC', type: d.status === 'missing' ? '❌ Missing' : '⚠️ Issue', description: desc, reason: d.status === 'missing' ? `Required KYC document "${d.name}" is missing.` : `KYC document "${d.name}" has issues. ${d.note || ''}` });
    });

    // --- Financial anomalies ---
    const anomalies = Array.isArray(spreading?.anomalies) ? spreading.anomalies : [];
    anomalies.forEach((a, i) => {
      const desc = a.message || a.description || JSON.stringify(a);
      items.push({ id: `fin-anomaly-${i}`, source: 'Financial', type: `Anomaly (${(a.severity || 'info').toUpperCase()})`, description: desc, reason: `Financial anomaly: ${desc}. Severity: ${(a.severity || 'info').toUpperCase()}. ${a.details || a.explanation || ''}`.trim() });
    });
    // Financial assessments with issues
    const assessments = Array.isArray(spreading?.assessments) ? spreading.assessments : [];
    assessments.filter(a => {
      const s = String(a.status || a.result || '').toLowerCase();
      return s.includes('fail') || s.includes('breach') || s.includes('warning') || s.includes('high');
    }).forEach((a, i) => {
      const desc = `${a.metric || a.name || 'Check'}: ${a.status || a.result || ''} — ${a.comment || a.details || ''}`;
      items.push({ id: `fin-assess-${i}`, source: 'Financial', type: 'Policy Check', description: desc, reason: `Policy check "${a.metric || a.name || 'Check'}" resulted in ${a.status || a.result || 'a failure'}. ${a.comment || a.details || ''}`.trim() });
    });
    return items;
  }, [kyc, spreading, intake]);

  const toggleItem = (id, value) => {
    setChecklist(prev => ({ ...prev, [id]: prev[id] === value ? null : value }));
  };

  const allReviewed = allIssues.length === 0 || allIssues.every(item => checklist[item.id] != null);
  const hasRejections = allIssues.some(item => checklist[item.id] === 'cross');

  const handleSubmit = async (verdict, noteText) => {
    setSubmitting(true);
    // Build a rich checklist with descriptions for the Closing Package
    const richChecklist = {};
    allIssues.forEach(item => {
      richChecklist[item.id] = {
        state: checklist[item.id] || null,
        source: item.source,
        type: item.type,
        description: item.description,
        reason: item.reason || '',
      };
    });
    try { await onSubmitHuman(verdict, noteText, richChecklist); }
    finally { setSubmitting(false); }
  };

  if (!decision) {
    if (running) {
      return <Empty title="Decision Agent" message="⏳ Decision Agent is evaluating the case…" />;
    }
    return <Empty title="Decision Agent" message="The decision recommendation will appear here once the agent finishes. It runs automatically in the background." />;
  }
  const accent = ACCENT.decision;
  const pd = decision.pd || {};
  const lgd = decision.lgd || {};
  const recTone = recommendationTone(decision.agentRecommendation);
  const goNoGo = String(decision.goNoGo || '').toLowerCase();
  const verdictTone = goNoGo.includes('go') && !goNoGo.includes('no')
    ? { bg: '#dcfce7', fg: '#166534', border: '#16a34a' }
    : goNoGo.includes('no')
      ? { bg: '#fee2e2', fg: '#991b1b', border: '#dc2626' }
      : { bg: '#fef3c7', fg: '#92400e', border: '#f59e0b' };
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  return (
    <ReportShell accent={accent}>
      <ReportLetterhead kicker="CREDIT COMMITTEE — DECISION" title="CREDIT DECISION LETTER" accent={accent} idLabel="DEC" idValue={decision.decisionId} />
      <div style={{ padding: '24px 28px', maxWidth: 980 }}>
        {/* Re / Subject */}
        <div style={{ marginBottom: 22, paddingBottom: 18, borderBottom: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: 12, color: '#64748b' }}>Re:</div>
          <div style={{ fontSize: 17, fontWeight: 700, color: '#0f172a', marginTop: 2 }}>
            Credit Facility Application — {app?.businessName || 'Borrower'}
          </div>
          <div style={{ fontSize: 13, color: '#475569', marginTop: 4 }}>
            Facility: {fmtMoney(app?.loan?.amount, app?.loan?.currency)} · Term {app?.loan?.term || '—'} · Purpose: {app?.loan?.purpose || '—'}
          </div>
        </div>

        {/* Verdict banner */}
        <div style={{
          background: verdictTone.bg,
          border: `2px solid ${verdictTone.border}`,
          borderLeft: `8px solid ${verdictTone.border}`,
          color: verdictTone.fg,
          padding: '20px 24px',
          borderRadius: 6,
          marginBottom: 22,
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 11, letterSpacing: 1.5, fontWeight: 700, opacity: 0.85 }}>AI POWERED RECOMMENDATION</div>
          <div style={{ fontSize: 32, fontWeight: 800, marginTop: 6, letterSpacing: 1 }}>
            {(decision.goNoGo || decision.agentRecommendation || 'PENDING').toString().toUpperCase()}
          </div>
          <div style={{ fontSize: 13, marginTop: 6, opacity: 0.95 }}>{recTone.label}</div>
        </div>

        {/* Risk Parameters & Key Metrics — all agents */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <Stat label="Internal Rating" value={decision.internalRating || '—'} />
          <Stat label="Pricing Tier" value={decision.pricingTier || '—'} />
          <Stat label="PD" value={pd.value != null ? `${pd.value}%` : '—'} sub={pd.band} />
          <Stat label="LGD" value={lgd.value != null ? `${lgd.value}%` : '—'} sub={lgd.product} />
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 22 }}>
          <Stat label="KYC Status" value={kyc?.status ? String(kyc.status).toUpperCase() : '—'} tone={String(kyc?.status || '').toLowerCase().startsWith('passed') ? { bg: '#dcfce7', fg: '#166534' } : kyc?.status ? { bg: '#fee2e2', fg: '#991b1b' } : undefined} />
          <Stat label="Doc Completeness" value={kyc?.completeness != null ? `${kyc.completeness}%` : '—'} sub={Number(kyc?.completeness) >= 95 ? 'Full pack' : Number(kyc?.completeness) >= 70 ? 'Minor gaps' : undefined} />
          <Stat label="Sanctions" value={`${kyc?.sanctions?.listsChecked ?? 0} checked`} sub={kyc?.sanctions?.overallStatus || '—'} />
          <Stat label="Anomaly Score" value={spreading?.anomalyScore != null ? spreading.anomalyScore : (spreading?.anomalies?.length != null ? `${spreading.anomalies.length} flags` : '—')} sub={spreading?.anomalies?.length === 0 ? 'Clean' : undefined} />
        </div>

        {/* Risk Parameters & Policy table */}
        <ReportSection num={1} title="Risk Parameters & Policy" accent={accent}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <tbody>
              <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '10px 8px', color: '#475569', width: '30%', fontWeight: 600 }}>Probability of Default</td>
                <td style={{ padding: '10px 8px' }}>{pd.value != null ? `${pd.value}% · ${pd.band || ''}` : '—'}</td>
              </tr>
              <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '10px 8px', color: '#475569', fontWeight: 600 }}>PD Policy</td>
                <td style={{ padding: '10px 8px', color: '#475569' }}>{pd.policyText || '—'}</td>
              </tr>
              <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '10px 8px', color: '#475569', fontWeight: 600 }}>Loss Given Default</td>
                <td style={{ padding: '10px 8px' }}>{lgd.value != null ? `${lgd.value}% · ${lgd.product || ''}` : '—'}</td>
              </tr>
              <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '10px 8px', color: '#475569', fontWeight: 600 }}>LGD Policy Band</td>
                <td style={{ padding: '10px 8px', color: '#475569' }}>{lgd.policyMin != null ? `${lgd.policyMin}% – ${lgd.policyMax}% (reject above ${lgd.rejectAbove}%)` : '—'}</td>
              </tr>
            </tbody>
          </table>
        </ReportSection>

        {/* Agent Explanations — built from actual agent props + decision JSON */}
        <ReportSection num={2} title="Why This Decision — Agent Analysis" accent={accent}>
          <AgentExplanationCard title="Document Validation" explanation={decision.agentExplanations?.documentValidation || (intake ? {
            status: allIssues.filter(i => i.source === 'Documents' && i.severity === 'missing').length > 0 ? 'Fail' : allIssues.filter(i => i.source === 'Documents' && i.severity === 'incomplete').length > 0 ? 'Warning' : 'Pass',
            keyFindings: [
              `${allIssues.filter(i => i.source === 'Documents' && i.severity === 'present').length} documents verified`,
              ...(allIssues.filter(i => i.source === 'Documents' && i.severity === 'missing').length > 0 ? [`${allIssues.filter(i => i.source === 'Documents' && i.severity === 'missing').length} documents missing`] : []),
              ...(allIssues.filter(i => i.source === 'Documents' && i.severity === 'incomplete').length > 0 ? [`${allIssues.filter(i => i.source === 'Documents' && i.severity === 'incomplete').length} documents incomplete`] : []),
            ],
            missingOrFailed: allIssues.filter(i => i.source === 'Documents' && (i.severity === 'missing' || i.severity === 'incomplete')).map(i => i.description),
            impactOnDecision: allIssues.filter(i => i.source === 'Documents' && i.severity === 'missing').length > 0 ? 'Missing documents may block approval pending submission.' : 'All documents present — no negative impact on decision.',
          } : null)} />
          <AgentExplanationCard title="KYC Compliance" explanation={decision.agentExplanations?.kyc || (kyc ? {
            status: String(kyc.status || '').toLowerCase().startsWith('passed') ? 'Pass' : (Array.isArray(kyc.flags) && kyc.flags.length > 0) ? 'Fail' : 'Warning',
            keyFindings: [
              `KYC Status: ${String(kyc.status || 'Pending').toUpperCase()}`,
              `Document Completeness: ${kyc.completeness || 0}%`,
              `Sanctions: ${kyc.sanctions?.overallStatus || 'Not checked'}`,
              ...(kyc.adverseMedia?.hits > 0 ? [`Adverse Media: ${kyc.adverseMedia.hits} hits`] : []),
            ],
            missingOrFailed: [
              ...(Array.isArray(kyc.flags) ? kyc.flags.map(f => typeof f === 'string' ? f : f.message || JSON.stringify(f)) : []),
              ...(Array.isArray(kyc.kycChecklist) ? kyc.kycChecklist.filter(d => d.status === 'missing').map(d => `${d.name}: Missing`) : []),
            ],
            impactOnDecision: String(kyc.status || '').toLowerCase().startsWith('passed') ? 'KYC cleared — no negative impact on decision.' : 'KYC issues flagged — may require resolution before approval.',
          } : null)} />
          <AgentExplanationCard title="Anomaly Detection" explanation={decision.agentExplanations?.anomalyDetection || (spreading ? {
            status: allIssues.filter(i => i.source === 'Financial' && i.type.includes('HIGH')).length > 0 ? 'Warning' : allIssues.filter(i => i.source === 'Financial').length > 0 ? 'Pass' : 'Pass',
            keyFindings: [
              `${(spreading.anomalies || []).length} anomaly flags detected`,
              ...(spreading.anomalies || []).slice(0, 3).map(a => a.message || a.description || JSON.stringify(a)),
            ],
            missingOrFailed: allIssues.filter(i => i.source === 'Financial' && i.type.includes('Policy')).map(i => i.description),
            impactOnDecision: (spreading.anomalies || []).length === 0 ? 'No anomalies — clean financial profile supports approval.' : 'Anomalies flagged for review but within acceptable range for this risk tier.',
          } : null)} />
        </ReportSection>

        {/* Reviewer Summary */}
        <ReportSection num={3} title="Reviewer Decision Summary" accent={accent}>
          <ReviewerSummaryPanel reviewerSummary={decision.reviewerSummary || (() => {
            const goNoGoVal = String(decision.goNoGo || '').toUpperCase();
            const kycPassed = String(kyc?.status || '').toLowerCase().startsWith('passed');
            const hasKycFlags = Array.isArray(kyc?.flags) && kyc.flags.length > 0;
            const anomalyCount = (spreading?.anomalies || []).length;
            const blockingReasons = [];
            const warnings = [];
            const reviewReasons = [];
            if (!kycPassed && kyc) blockingReasons.push(`KYC status: ${String(kyc.status || 'Incomplete').toUpperCase()}`);
            if (hasKycFlags) kyc.flags.forEach(f => warnings.push(`KYC Flag: ${typeof f === 'string' ? f : f.message || JSON.stringify(f)}`));
            if (anomalyCount > 0) spreading.anomalies.filter(a => (a.severity || '').toLowerCase() === 'high').forEach(a => warnings.push(`Financial: ${a.message || a.description || 'High severity anomaly'}`));
            if (pd.value > 15) blockingReasons.push(`PD ${pd.value}% exceeds maximum threshold (15%)`);
            if (lgd.value > 60) blockingReasons.push(`LGD ${lgd.value}% exceeds reject threshold (60%)`);
            if (anomalyCount > 0) reviewReasons.push(`${anomalyCount} financial anomaly flag(s) require review`);
            if (!kycPassed && kyc) reviewReasons.push('KYC verification incomplete or failed');
            const recAction = goNoGoVal.includes('NO') ? 'Decline or request additional information before re-evaluation.'
              : goNoGoVal.includes('CONDITIONAL') ? 'Approve with conditions — attach covenants per agent recommendations.'
              : 'Approve at recommended pricing tier.';
            return {
              decisionSummary: decision.agentRationale || `Application ${goNoGoVal || 'PENDING'} based on PD ${pd.value != null ? pd.value + '%' : 'N/A'}, LGD ${lgd.value != null ? lgd.value + '%' : 'N/A'}, KYC ${kycPassed ? 'passed' : 'pending'}.`,
              blockingReasons,
              warnings,
              reviewReasons,
              recommendedNextAction: recAction,
            };
          })()} />
        </ReportSection>

        {decision.agentRationale && (
          <ReportSection num={4} title="Agent Rationale" accent={accent}>
            <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{decision.agentRationale}</p>
          </ReportSection>
        )}

        {decision.markdown && (
          <ReportSection num={5} title="Detailed Decision Memorandum" accent={accent}>
            <div className="markdown-content"><ReactMarkdown remarkPlugins={[remarkGfm]}>{decision.markdown}</ReactMarkdown></div>
          </ReportSection>
        )}

        {/* Issues & Anomalies Checklist */}
        <ReportSection num={6} title="Issues & Anomalies Review" accent={accent}>
          {allIssues.length === 0 ? (
            <div style={{ padding: 16, background: '#dcfce7', borderRadius: 6, color: '#166534', fontSize: 13, fontWeight: 600 }}>
              ✅ No issues or anomalies detected across all agents.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12, fontStyle: 'italic' }}>
                Review each issue below. Mark ✓ to accept (acknowledged/acceptable risk) or ✗ to reject (blocking concern). All items must be reviewed before final decision.
                {!checklistEditing && (
                  <button
                    onClick={() => setChecklistEditing(true)}
                    title="Enable editing"
                    style={{
                      marginLeft: 12, background: '#fff', border: '1px solid #cbd5e1', borderRadius: 6,
                      padding: '4px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer', color: '#1e293b',
                      verticalAlign: 'middle',
                    }}
                  >✎ Edit</button>
                )}
                {checklistEditing && (
                  <span style={{ marginLeft: 12, color: '#16a34a', fontWeight: 600 }}>✎ Editing enabled</span>
                )}
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #e2e8f0', background: '#f8fafc' }}>
                    <th style={{ padding: '10px 8px', textAlign: 'left', fontWeight: 700, width: 80 }}>Source</th>
                    <th style={{ padding: '10px 8px', textAlign: 'left', fontWeight: 700, width: 130 }}>Type</th>
                    <th style={{ padding: '10px 8px', textAlign: 'left', fontWeight: 700 }}>Description</th>
                    <th style={{ padding: '10px 8px', textAlign: 'center', fontWeight: 700, width: 100 }}>Accept/Reject</th>
                  </tr>
                </thead>
                <tbody>
                  {allIssues.map(item => {
                    const state = checklist[item.id];
                    const isExpanded = expandedIssue === item.id;
                    return (
                      <React.Fragment key={item.id}>
                        <tr style={{ borderBottom: isExpanded ? 'none' : '1px solid #f1f5f9', background: state === 'tick' ? '#f0fdf4' : state === 'cross' ? '#fef2f2' : '#fff', cursor: 'pointer' }} onClick={() => setExpandedIssue(isExpanded ? null : item.id)}>
                          <td style={{ padding: '10px 8px', fontWeight: 600, color: item.source === 'KYC' ? '#7c3aed' : item.source === 'Financial' ? '#0284c7' : '#0ea5e9' }}>{item.source}</td>
                          <td style={{ padding: '10px 8px', color: '#475569' }}>{item.type}</td>
                          <td style={{ padding: '10px 8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ flex: 1 }}>{item.description}</span>
                              <span style={{ fontSize: 10, color: '#94a3b8', flexShrink: 0 }}>{isExpanded ? '▲' : '▼'}</span>
                            </div>
                          </td>
                          <td style={{ padding: '10px 8px', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                              <button
                                onClick={() => checklistEditing && toggleItem(item.id, 'tick')}
                                disabled={!checklistEditing}
                                title="Accept (acknowledged risk)"
                                style={{
                                  width: 32, height: 32, borderRadius: 6, border: state === 'tick' ? '2px solid #16a34a' : '1px solid #cbd5e1',
                                  background: state === 'tick' ? '#dcfce7' : '#fff', color: '#16a34a',
                                  fontSize: 16, fontWeight: 700, cursor: checklistEditing ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  opacity: checklistEditing ? 1 : 0.4,
                                }}
                              >✓</button>
                              <button
                                onClick={() => checklistEditing && toggleItem(item.id, 'cross')}
                                disabled={!checklistEditing}
                                title="Reject (blocking issue)"
                                style={{
                                  width: 32, height: 32, borderRadius: 6, border: state === 'cross' ? '2px solid #dc2626' : '1px solid #cbd5e1',
                                  background: state === 'cross' ? '#fee2e2' : '#fff', color: '#dc2626',
                                  fontSize: 16, fontWeight: 700, cursor: checklistEditing ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  opacity: checklistEditing ? 1 : 0.4,
                                }}
                              >✗</button>
                            </div>
                          </td>
                        </tr>
                        {isExpanded && item.reason && (
                          <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td colSpan={4} style={{ padding: '0 8px 12px 8px' }}>
                              <div style={{
                                margin: '4px 0 0 0',
                                padding: '10px 14px',
                                background: '#fffbeb',
                                border: '1px solid #fcd34d',
                                borderRadius: 6,
                                fontSize: 12,
                                lineHeight: 1.6,
                                color: '#92400e',
                              }}>
                                <strong>⚠️ Reasoning:</strong> {item.reason}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
              <div style={{ marginTop: 12, fontSize: 12, color: '#64748b' }}>
                {allIssues.filter(i => checklist[i.id] === 'tick').length} accepted · {allIssues.filter(i => checklist[i.id] === 'cross').length} rejected · {allIssues.filter(i => !checklist[i.id]).length} pending
              </div>
            </div>
          )}
        </ReportSection>

        {/* Human decision */}
        {decision.humanDecision == null ? (
          <ReportSection num={7} title="Underwriter Sign-off — Required" accent={accent}>
            {!allReviewed && allIssues.length > 0 && (
              <div style={{ padding: 12, background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: 6, marginBottom: 14, fontSize: 13, color: '#92400e' }}>
                ⚠️ Please review all issues above (mark each ✓ or ✗) before signing off.
              </div>
            )}
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Underwriter notes (optional)…"
              rows={3}
              style={{ width: '100%', padding: 10, borderRadius: 6, border: '1px solid #cbd5e1', marginBottom: 12, fontFamily: 'inherit', fontSize: 13 }}
            />
            <div style={{ display: 'flex', gap: 12 }}>
              <button
                onClick={() => handleSubmit('approved', notes)}
                disabled={submitting || (!allReviewed && allIssues.length > 0)}
                style={{
                  flex: 1, padding: 14, borderRadius: 6, border: 'none',
                  background: (submitting || (!allReviewed && allIssues.length > 0)) ? '#86efac' : '#16a34a', color: '#fff', fontWeight: 700,
                  cursor: (submitting || (!allReviewed && allIssues.length > 0)) ? 'not-allowed' : 'pointer',
                  fontSize: 14, letterSpacing: 0.5, opacity: (submitting || (!allReviewed && allIssues.length > 0)) ? 0.5 : 1,
                }}
              >{submitting ? '⏳ Recording…' : '✅ APPROVE & SIGN'}</button>
              <button
                onClick={() => handleSubmit('declined', notes)}
                disabled={submitting || (!allReviewed && allIssues.length > 0)}
                style={{
                  flex: 1, padding: 14, borderRadius: 6, border: 'none',
                  background: (submitting || (!allReviewed && allIssues.length > 0)) ? '#fca5a5' : '#dc2626', color: '#fff', fontWeight: 700,
                  cursor: (submitting || (!allReviewed && allIssues.length > 0)) ? 'not-allowed' : 'pointer',
                  fontSize: 14, letterSpacing: 0.5, opacity: (submitting || (!allReviewed && allIssues.length > 0)) ? 0.5 : 1,
                }}
              >{submitting ? '⏳ Recording…' : '❌ DECLINE'}</button>
            </div>
            {hasRejections && (
              <div style={{ marginTop: 10, fontSize: 12, color: '#dc2626', fontStyle: 'italic' }}>
                ⚠️ You have rejected {allIssues.filter(i => checklist[i.id] === 'cross').length} issue(s). Consider declining unless these can be mitigated.
              </div>
            )}
          </ReportSection>
        ) : (
          <ReportSection num={7} title="Underwriter Sign-off — Recorded" accent={accent}>
            {(() => {
              const v = String(decision.humanDecision || '').toLowerCase();
              const isApproved = v === 'approved';
              return (
                <div style={{
                  padding: 14, borderRadius: 6,
                  background: isApproved ? '#dcfce7' : '#fee2e2',
                  border: `1px solid ${isApproved ? '#16a34a' : '#dc2626'}`,
                }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: isApproved ? '#166534' : '#991b1b' }}>
                    {isApproved ? '✅ APPROVED' : '❌ DECLINED'}
                  </div>
                  <div style={{ fontSize: 12, color: '#475569', marginTop: 6 }}>By: <strong>{decision.humanDecisionBy}</strong> · {decision.humanDecisionAt}</div>
                  {decision.humanDecisionNotes && <div style={{ fontSize: 12, color: '#475569', marginTop: 4, fontStyle: 'italic' }}>“{decision.humanDecisionNotes}”</div>}
                </div>
              );
            })()}

            {/* Override controls — let the underwriter flip an accidental
                click. The Loan Package Agent re-runs with the new verdict. */}
            <div style={{ marginTop: 14 }}>
              {!overrideMode ? (
                <button
                  onClick={() => { setOverrideMode(true); setChecklistEditing(true); }}
                  disabled={running}
                  style={{
                    background: '#fff', color: '#1e293b',
                    border: '1px solid #cbd5e1', padding: '8px 14px',
                    borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: running ? 'not-allowed' : 'pointer',
                  }}
                >✎ Change decision</button>
              ) : (
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 14 }}>
                  <div style={{ fontSize: 12, color: '#475569', fontWeight: 600, marginBottom: 8 }}>
                    Overriding the recorded sign-off will re-run the Loan Package Agent with the new verdict.
                  </div>
                  <textarea
                    value={overrideNotes}
                    onChange={(e) => setOverrideNotes(e.target.value)}
                    placeholder="Reason for override (optional)…"
                    rows={2}
                    style={{ width: '100%', padding: 10, borderRadius: 6, border: '1px solid #cbd5e1', marginBottom: 10, fontFamily: 'inherit', fontSize: 13 }}
                  />
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button
                      onClick={() => { handleSubmit('approved', overrideNotes); setOverrideMode(false); }}
                      disabled={submitting}
                      style={{
                        flex: 1, padding: 12, borderRadius: 6, border: 'none',
                        background: '#16a34a', color: '#fff', fontWeight: 700, cursor: submitting ? 'not-allowed' : 'pointer', fontSize: 13,
                      }}
                    >✅ APPROVE</button>
                    <button
                      onClick={() => { handleSubmit('declined', overrideNotes); setOverrideMode(false); }}
                      disabled={submitting}
                      style={{
                        flex: 1, padding: 12, borderRadius: 6, border: 'none',
                        background: '#dc2626', color: '#fff', fontWeight: 700, cursor: submitting ? 'not-allowed' : 'pointer', fontSize: 13,
                      }}
                    >❌ DECLINE</button>
                    <button
                      onClick={() => setOverrideMode(false)}
                      style={{
                        padding: '12px 16px', borderRadius: 6, border: '1px solid #cbd5e1',
                        background: '#fff', color: '#475569', fontWeight: 600, cursor: 'pointer', fontSize: 13,
                      }}
                    >Cancel</button>
                  </div>
                  {running && (
                    <div style={{ marginTop: 10, fontSize: 12, color: '#475569' }}>
                      ⏳ Re-running Loan Package Agent…
                    </div>
                  )}
                </div>
              )}
            </div>
          </ReportSection>
        )}

        {/* Signature block */}
        <div style={{
          marginTop: 30, paddingTop: 18, borderTop: `2px solid ${accent.line}`,
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, fontSize: 12, color: '#475569',
        }}>
          <div>
            <div style={{ borderBottom: '1px solid #94a3b8', height: 30 }} />
            <div style={{ marginTop: 4, fontWeight: 600 }}>Decision Agent</div>
            <div>Date: {today}</div>
          </div>
          <div>
            <div style={{ borderBottom: '1px solid #94a3b8', height: 30 }} />
            <div style={{ marginTop: 4, fontWeight: 600 }}>Senior Credit Officer</div>
            <div>{decision.humanDecision ? `Signed ${decision.humanDecisionAt || ''}` : 'Pending sign-off'}</div>
          </div>
        </div>
      </div>
    </ReportShell>
  );
};

// ---------- Closing Package — Manager Summary template ----------
// Shows only the tick/cross review checklist from the Decision tab.

const ClosingPanel = ({ closing, app, decision, kyc, spreading, memo, intake }) => {
  const [expandedIssue, setExpandedIssue] = useState(null);
  if (!closing || !closing.markdown) {
    return (
      <Empty
        title="Loan Package Agent"
        message="The Loan Package will be generated automatically once the manager records an Approve / Reject decision on the Decision tab."
      />
    );
  }
  const accent = ACCENT.closing;

  // Extract the manager verdict from the decision data
  const humanDecision = decision?.humanDecision;
  const isApproved = String(humanDecision || '').toLowerCase() === 'approved';
  const verdictTone = isApproved
    ? { bg: '#dcfce7', fg: '#166534', border: '#16a34a' }
    : { bg: '#fee2e2', fg: '#991b1b', border: '#dc2626' };

  // Extract the checklist from the decision (stored when human submitted)
  const reviewChecklist = decision?.reviewChecklist || {};
  const checklistItems = Object.entries(reviewChecklist).map(([id, val]) => {
    if (typeof val === 'object' && val !== null) {
      return { id, state: val.state, source: val.source || '', type: val.type || '', description: val.description || id, reason: val.reason || '' };
    }
    return { id, state: val, source: '', type: '', description: id.replace(/-/g, ' '), reason: '' };
  });

  return (
    <ReportShell accent={accent}>
      <ReportLetterhead kicker="LOAN OPERATIONS — LOAN PACKAGE" title="CLOSING PACKAGE SUMMARY" accent={accent} idLabel="CASE" idValue={app?.caseId} />
      <div style={{ padding: '24px 28px', maxWidth: 980 }}>
        {/* Borrower header */}
        <div style={{ marginBottom: 22, paddingBottom: 18, borderBottom: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700, marginBottom: 6 }}>Borrower</div>
          <div style={{ fontSize: 17, fontWeight: 700, color: '#0f172a' }}>{app?.businessName || '—'}</div>
          <div style={{ fontSize: 12, color: '#475569', marginTop: 2 }}>Facility: {fmtMoney(app?.loan?.amount, app?.loan?.currency)} · {app?.loan?.purpose || '—'}</div>
        </div>

        {/* Verdict banner */}
        {humanDecision && (
          <div style={{
            background: verdictTone.bg,
            border: `2px solid ${verdictTone.border}`,
            borderLeft: `8px solid ${verdictTone.border}`,
            color: verdictTone.fg,
            padding: '18px 22px',
            borderRadius: 6,
            marginBottom: 22,
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 11, letterSpacing: 1.5, fontWeight: 700, opacity: 0.85 }}>MANAGER DECISION</div>
            <div style={{ fontSize: 28, fontWeight: 800, marginTop: 4, letterSpacing: 1 }}>
              {isApproved ? 'APPROVED' : 'DECLINED'}
            </div>
            <div style={{ fontSize: 12, marginTop: 6, opacity: 0.8 }}>
              By: {decision.humanDecisionBy || '—'} · {decision.humanDecisionAt || '—'}
            </div>
          </div>
        )}

        {/* Section 1: Review Checklist with tick/cross */}
        <ReportSection num={1} title="Review Checklist" accent={accent}>
          {checklistItems.length === 0 ? (
            <div style={{ padding: 16, background: '#f0fdf4', borderRadius: 6, color: '#166534', fontSize: 13 }}>
              ✅ No issues were flagged during the review process.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e2e8f0', background: '#f8fafc' }}>
                  <th style={{ padding: '10px 8px', textAlign: 'left', fontWeight: 700, width: 80 }}>Source</th>
                  <th style={{ padding: '10px 8px', textAlign: 'left', fontWeight: 700 }}>Item</th>
                  <th style={{ padding: '10px 8px', textAlign: 'center', fontWeight: 700, width: 80 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {checklistItems.map(({ id, state, source, description, reason }) => {
                  const isExpanded = expandedIssue === id;
                  return (
                    <React.Fragment key={id}>
                      <tr style={{ borderBottom: isExpanded ? 'none' : '1px solid #f1f5f9', background: state === 'tick' ? '#f0fdf4' : '#fef2f2', cursor: reason ? 'pointer' : 'default' }} onClick={() => reason && setExpandedIssue(isExpanded ? null : id)}>
                        <td style={{ padding: '10px 8px', fontWeight: 600, color: source === 'KYC' ? '#7c3aed' : source === 'Financial' ? '#0284c7' : '#0ea5e9', fontSize: 12 }}>{source}</td>
                        <td style={{ padding: '10px 8px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ flex: 1 }}>{description}</span>
                            {reason && <span style={{ fontSize: 10, color: '#94a3b8', flexShrink: 0 }}>{isExpanded ? '▲' : '▼'}</span>}
                          </div>
                        </td>
                        <td style={{ padding: '10px 8px', textAlign: 'center', fontSize: 20 }}>
                          {state === 'tick' ? <span style={{ color: '#16a34a' }}>✓</span> : <span style={{ color: '#dc2626' }}>✗</span>}
                        </td>
                      </tr>
                      {isExpanded && reason && (
                        <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td colSpan={3} style={{ padding: '0 8px 12px 8px' }}>
                            <div style={{
                              margin: '4px 0 0 0',
                              padding: '10px 14px',
                              background: '#fffbeb',
                              border: '1px solid #fcd34d',
                              borderRadius: 6,
                              fontSize: 12,
                              lineHeight: 1.6,
                              color: '#92400e',
                            }}>
                              <strong>⚠️ Reasoning:</strong> {reason}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
          <div style={{ marginTop: 12, fontSize: 12, color: '#64748b' }}>
            {checklistItems.filter(i => i.state === 'tick').length} accepted · {checklistItems.filter(i => i.state === 'cross').length} rejected
          </div>
        </ReportSection>

        {decision?.humanDecisionNotes && (
          <ReportSection num={2} title="Underwriter Notes" accent={accent}>
            <p style={{ margin: 0, fontSize: 13, fontStyle: 'italic', color: '#475569' }}>"{decision.humanDecisionNotes}"</p>
          </ReportSection>
        )}

        {/* Section 3: Agent Summaries — only the final summary from each agent */}
        <ReportSection num={3} title="Agent Analysis Summaries" accent={accent}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Document Intake Summary */}
            {intake?.markdown && (() => {
              const summary = extractFinalSection(intake.markdown, ['Case Readiness Summary', 'Readiness Summary', 'Summary']);
              if (!summary) return null;
              return (
                <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
                  <div style={{ background: '#f0f9ff', padding: '10px 14px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>📄</span>
                    <span style={{ fontWeight: 700, fontSize: 13, color: '#0ea5e9' }}>Document Intake — Case Readiness Summary</span>
                  </div>
                  <div style={{ padding: 14, fontSize: 13, lineHeight: 1.7 }} className="markdown-content">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{summary}</ReactMarkdown>
                  </div>
                </div>
              );
            })()}

            {/* KYC Summary */}
            {kyc?.markdown && (() => {
              const summary = extractFinalSection(kyc.markdown, ['Compliance Summary', 'KYC Summary', 'Summary']);
              if (!summary) return null;
              return (
                <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
                  <div style={{ background: '#f5f3ff', padding: '10px 14px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>🔍</span>
                    <span style={{ fontWeight: 700, fontSize: 13, color: '#7c3aed' }}>KYC Agent — Compliance Summary</span>
                  </div>
                  <div style={{ padding: 14, fontSize: 13, lineHeight: 1.7 }} className="markdown-content">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{summary}</ReactMarkdown>
                  </div>
                </div>
              );
            })()}

            {/* Financial Spreading Summary */}
            {spreading?.markdown && (() => {
              const summary = extractFinalSection(spreading.markdown, ['Financial Summary', 'Analyst Commentary', 'Summary', 'Conclusion', 'Overall Assessment']);
              if (!summary) return null;
              return (
                <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
                  <div style={{ background: '#f0f9ff', padding: '10px 14px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>📊</span>
                    <span style={{ fontWeight: 700, fontSize: 13, color: '#0284c7' }}>Financial Spreading — Summary</span>
                  </div>
                  <div style={{ padding: 14, fontSize: 13, lineHeight: 1.7 }} className="markdown-content">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{summary}</ReactMarkdown>
                  </div>
                </div>
              );
            })()}

            {/* Memo Summary */}
            {memo?.markdown && (() => {
              const summary = extractFinalSection(memo.markdown, ['Recommendation', 'Credit Recommendation', 'Summary', 'Conclusion']);
              if (!summary) return null;
              return (
                <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
                  <div style={{ background: '#fffbeb', padding: '10px 14px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>📝</span>
                    <span style={{ fontWeight: 700, fontSize: 13, color: '#d97706' }}>Credit Memo — Recommendation</span>
                  </div>
                  <div style={{ padding: 14, fontSize: 13, lineHeight: 1.7 }} className="markdown-content">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{summary}</ReactMarkdown>
                  </div>
                </div>
              );
            })()}

            {/* Decision Summary */}
            {decision?.markdown && (() => {
              const summary = extractFinalSection(decision.markdown, ['Recommendation', 'Decision', 'Go/No-Go', 'Conclusion', 'Summary']);
              if (!summary) return null;
              return (
                <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
                  <div style={{ background: '#fff1f2', padding: '10px 14px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>⚖️</span>
                    <span style={{ fontWeight: 700, fontSize: 13, color: '#9f1239' }}>Decision Agent — Recommendation</span>
                  </div>
                  <div style={{ padding: 14, fontSize: 13, lineHeight: 1.7 }} className="markdown-content">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{summary}</ReactMarkdown>
                  </div>
                </div>
              );
            })()}
          </div>
        </ReportSection>

        <div style={{ marginTop: 30, paddingTop: 14, borderTop: `2px solid ${accent.line}`, fontSize: 11, color: '#64748b', display: 'flex', justifyContent: 'space-between' }}>
          <span>Prepared by: Loan Package Agent</span>
          {humanDecision && <span>Decision: {isApproved ? 'APPROVED' : 'DECLINED'}</span>}
        </div>
      </div>
    </ReportShell>
  );
};

const OVERVIEW_FLOW = [
  { id: 'intake',    label: 'Document Validation Agent', sub: 'Intake & validation',    icon: '📄', accent: '#0ea5e9',
    summary: 'Reads every uploaded document, classifies it (financials, KYC, legal, tax), extracts key fields with OCR + LLM, and builds a completeness checklist for the case file.' },
  { id: 'kyc',       label: 'KYC Agent',                 sub: 'Compliance & screening', icon: '🔍', accent: '#7c3aed',
    summary: 'Runs identity verification on owners and the business, screens against OFAC / PEP / sanctions / adverse-media lists, and surfaces compliance flags with a risk rating.' },
  { id: 'spread',    label: 'Financial Spreading Agent', sub: 'Statements & ratios',    icon: '📊', accent: '#0284c7',
    summary: 'Spreads the borrower\'s P&L, balance sheet and cash-flow statements, computes ratios (DSCR, leverage, liquidity), runs anomaly detection and estimates PD / LGD.' },
  { id: 'memo',      label: 'Memo Drafting Agent',       sub: 'Credit memo drafter',    icon: '📝', accent: '#d97706',
    summary: 'Aggregates the outputs of intake, KYC and spreading into a structured credit memo: borrower profile, financial analysis, risk assessment and recommended structure.' },
  { id: 'judge',     label: 'Decision Agent',            sub: 'Decision support',       icon: '⚖️', accent: '#9f1239',
    summary: 'Evaluates the memo and risk profile against credit policy, then issues a GO / NO GO / CONDITIONAL GO recommendation with rationale, suggested conditions and top risks.' },

  { id: 'close',     label: 'Loan Package Agent',        sub: 'Closing package',        icon: '📦', accent: '#15803d',
    summary: 'Once the manager records a decision, assembles the final closing package — manager summary, conditions, document manifest and next steps for operations.' },
];

const OverviewWorkflowMap = () => {
  // Play the agent flow once on mount, then settle. Previously this used
  // setInterval with a modulo cycle, which made the highlight + accent
  // colour loop forever and felt like a glitchy flicker on the Overview tab.
  // Now we step forward until the last node, stop the timer, and mark every
  // node as complete so the card holds a stable "pipeline finished" state.
  const [active, setActive] = useState(0);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (done) return undefined;
    const t = setInterval(() => {
      setActive((i) => {
        if (i >= OVERVIEW_FLOW.length - 1) {
          setDone(true);
          return i;
        }
        return i + 1;
      });
    }, 1600);
    return () => clearInterval(t);
  }, [done]);
  const current = OVERVIEW_FLOW[active];
  return (
    <div className="ow-card" style={{ '--ow-accent': current.accent }}>
      <div className="ow-header">
        <div>
          <div className="ow-kicker">AI MULTI-AGENT WORKFLOW</div>
          <div className="ow-title">End-to-end LoanProcessAI pipeline</div>
        </div>
        <div className="ow-now">
          <span className="ow-now-dot" />
          <span className="ow-now-text">
            {done ? <>Pipeline ready: <b>all agents online</b></> : <>Now showing: <b>{current.label}</b></>}
          </span>
        </div>
      </div>

      <div className="ow-flow">
        {OVERVIEW_FLOW.map((step, i) => {
          const isActive = !done && i === active;
          const isPast = done || i < active;
          return (
            <React.Fragment key={step.id}>
              <div
                className={[
                  'ow-node',
                  isActive ? 'is-active' : '',
                  isPast ? 'is-past' : '',
                  step.isGate ? 'is-gate' : '',
                ].join(' ')}
                style={{ '--node-accent': step.accent }}
              >
                <div className="ow-node-icon">{step.icon}</div>
                <div className="ow-node-label">{step.label}</div>
                <div className="ow-node-sub">{step.sub}</div>
                {isActive && <span className="ow-node-pulse" />}
                {step.summary && (
                  <div className="ow-node-tip" role="tooltip">
                    <div className="ow-node-tip-arrow" />
                    <div className="ow-node-tip-title">
                      <span className="ow-node-tip-icon">{step.icon}</span>
                      <span>{step.label}</span>
                    </div>
                    <div className="ow-node-tip-body">{step.summary}</div>
                  </div>
                )}
              </div>
              {i < OVERVIEW_FLOW.length - 1 && (
                <div className={`ow-conn ${isPast ? 'is-past' : ''} ${isActive ? 'is-active' : ''}`}>
                  <span className="ow-conn-line" />
                  <span className="ow-conn-dot" />
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>

      <div className="ow-legend">
        <span><i className="ow-legend-swatch" style={{ background: '#0ea5e9' }} /> Pre-approval pipeline</span>
        <span><i className="ow-legend-swatch" style={{ background: '#15803d' }} /> Post-approval pipeline</span>
      </div>
    </div>
  );
};

const OverviewPanel = ({ app }) => {
  const loanAmt = app?.loan?.amount
    ? fmtMoney(app.loan.amount) + (app.loan.currency && app.loan.currency !== 'USD' ? ` ${app.loan.currency}` : '')
    : '—';
  const docs = app?.documents || [];
  const docCount = docs.length;
  const location = [app?.city, app?.state].filter(Boolean).join(', ');
  return (
    <>
      <OverviewWorkflowMap />

      <Card title="📋 Case Snapshot">
        <KV label="Application ID" value={app.id} />
        <KV label="Case ID" value={app.caseId} />
        <KV label="Submitted" value={app.submittedDate} />
        <KV label="Status" value={app.status} />
      </Card>

      <Card title="🏢 Business">
        <KV label="Business Name" value={app.businessName} />
        {app.dba && <KV label="DBA" value={app.dba} />}
        <KV label="Entity Type" value={app.entityType} />
        <KV label="Industry" value={app.industry} />
        <KV label="EIN / Tax ID" value={app.ein} />
        <KV label="Annual Revenue" value={app.annualRevenue ? fmtMoney(app.annualRevenue) : '—'} />
        <KV label="Address" value={[app.businessAddress, location, app.zipCode].filter(Boolean).join(' · ') || '—'} />
        <KV label="Phone" value={app.businessPhone} />
        <KV label="Email" value={app.businessEmail} />
      </Card>

      <Card title="💰 Loan Request">
        <KV label="Amount Requested" value={loanAmt} />
        <KV label="Purpose" value={app?.loan?.purpose} />
        <KV label="Term" value={app?.loan?.term} />
        <KV label="Currency" value={app?.loan?.currency} />
      </Card>

      {app.owner && (app.owner.name || app.owner.email) && (
        <Card title="👤 Primary Owner">
          <KV label="Name" value={app.owner.name} />
          <KV label="Ownership" value={app.owner.ownership} />
          <KV label="Email" value={app.owner.email} />
          <KV label="Phone" value={app.owner.phone} />
        </Card>
      )}

      <Card title={`📎 Documents Uploaded (${docCount})`}>
        {docCount === 0 ? (
          <p style={{ color: '#999', fontSize: 13, margin: 0 }}>No documents recorded for this case yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {docs.map((d, i) => {
              const fname = d.filename || d.name || `Document ${i + 1}`;
              const sizeKb = d.sizeBytes ? `${Math.round(d.sizeBytes / 1024)} KB` : null;
              return (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 10px', background: '#f8fafc',
                  border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13,
                }}>
                  <span style={{ fontSize: 16 }}>📄</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {fname}
                    </div>
                    {(d.name || sizeKb) && (
                      <div style={{ fontSize: 11, color: '#64748b' }}>
                        {d.name && d.filename ? d.name : ''}
                        {d.name && sizeKb ? ' · ' : ''}
                        {sizeKb || ''}
                      </div>
                    )}
                  </div>

                </div>
              );
            })}
          </div>
        )}
      </Card>
    </>
  );
};

const DocumentIntakePanel = ({ intake, app, running }) => {
  if (!intake || !intake.markdown) {
    if (running) {
      return <Empty title="Document Validation Agent" message="⏳ Document Intake Agent is analysing the documents…" />;
    }
    return <Empty title="Document Validation Agent" message="Document intake analysis will appear here once the agent finishes. It runs automatically in the background." />;
  }

  const accent = { gradient: 'linear-gradient(135deg, #0c4a6e 0%, #0ea5e9 100%)', line: '#0ea5e9', shadow: 'rgba(14, 165, 233, 0.12)' };

  return (
    <ReportShell accent={accent}>
      <ReportLetterhead
        kicker="DOCUMENT VALIDATION AGENT"
        title="Intake & Completeness Report"
        accent={accent}
        idValue={app?.caseId || ''}
        subtitleRight="Confidential — Internal Use Only"
      />
      <div style={{ padding: '24px 28px' }}>
        <div className="markdown-content" style={{ fontSize: 13, lineHeight: 1.7 }}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{intake.markdown}</ReactMarkdown>
        </div>
      </div>
    </ReportShell>
  );
};

const DocumentsPanel = ({ app, summaries = {} }) => {
  const [expandedDoc, setExpandedDoc] = useState(null);
  const docs = app.documents || [];

  const handleDocClick = async (doc) => {
    const applicationId = app?.id;
    if (!applicationId) {
      alert('Application not loaded yet.');
      return;
    }
    const documentId = doc.documentId;
    if (!documentId) {
      alert('Document link not available.');
      return;
    }
    try {
      const result = await getDocumentUrl(applicationId, documentId);
      if (result.signed_url) {
        window.open(result.signed_url, '_blank');
      } else {
        alert('Could not get document URL. Please try again.');
      }
    } catch (err) {
      console.error('Failed to get document URL:', err);
      alert('Unable to open document: ' + err.message);
    }
  };

  return (
    <Card title={'\ud83d\udcc4 Documents on file'}>
      {docs.length === 0 ? (
        <p style={{ color: '#999' }}>No documents recorded for this case yet.</p>
      ) : (
        docs.map((d, i) => {
          const docId = d.documentId;
          const sm = summaries[docId];
          // Friendly heading: derive from filename when the upstream doc_type
          // is missing or just "Other" (legacy / generic uploads).
          const fname = (d.filename || '').toLowerCase();
          let inferred = null;
          if (/ein|tax[_\s-]?id|cp[_\s-]?575/.test(fname)) inferred = 'Business EIN / Tax ID';
          else if (/incorporat/.test(fname)) inferred = 'Certificate of Incorporation';
          else if (/utility|address/.test(fname)) inferred = 'Proof of Address';
          else if (/photo[_\s-]?id|driver|passport|license/.test(fname)) inferred = 'Government Photo ID';
          else if (/financial|balance|income|p&l|cash[_\s-]?flow|workbook|statement/.test(fname)) inferred = 'Financial Statements';
          else if (/tax[_\s-]?return|1120|1040|schedule[_\s-]?k/.test(fname)) inferred = 'Tax Returns';
          else if (/credit|review|memo/.test(fname)) inferred = 'Credit Review';
          const rawType = d.name || '';
          const heading = (inferred || (rawType && rawType.toLowerCase() !== 'other'
            ? rawType : 'Supporting Document'));
          return (
            <div key={i} style={{ marginBottom: 16 }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: 10, borderRadius: '6px 6px 0 0', background: '#f8fafc',
                borderBottom: '1px solid #e2e8f0',
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{heading}</div>
                  {d.filename && (
                    <div
                      style={{
                        fontSize: 11,
                        color: docId ? '#0369a1' : '#666',
                        cursor: docId ? 'pointer' : 'default',
                        textDecoration: docId ? 'underline' : 'none',
                      }}
                      onClick={() => docId && handleDocClick(d)}
                      title={docId ? 'Click to view document' : ''}
                    >
                      {d.filename}{d.sizeBytes ? ` · ${Math.round(d.sizeBytes / 1024)} KB` : ''}
                      {d.date ? ` · ${d.date}` : ''}
                    </div>
                  )}
                </div>
                <span style={{ fontSize: 18 }}>{docId ? '✅' : '📄'}</span>
              </div>
              {docId && (
                <>
                  <div
                    style={{
                      padding: '8px 12px', background: '#f1f5f9', borderBottom: '1px solid #e2e8f0',
                      fontSize: 12, color: '#0369a1', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600,
                    }}
                    onClick={() => setExpandedDoc(expandedDoc === i ? null : i)}
                  >
                    <span>{expandedDoc === i ? '▼' : '▶'}</span>
                    <span>{expandedDoc === i ? 'Hide Analysis' : 'Show Analysis'}</span>
                  </div>
                  {expandedDoc === i && (
                    <div style={{
                      padding: 12, borderRadius: '0 0 6px 6px',
                      background: '#fefce8', border: '1px solid #fde68a', borderTop: 'none',
                    }}>
                      {sm?.loading && <span style={{ color: '#666', fontSize: 13 }}>⏳ Analyzing document…</span>}
                      {sm?.error && <span style={{ color: '#dc2626', fontSize: 13 }}>Error: {sm.error}</span>}
                      {sm?.text && (
                        <div className="document-summary-content" style={{ fontSize: 13, lineHeight: 1.6 }}>
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{sm.text}</ReactMarkdown>
                        </div>
                      )}
                      {!sm && <span style={{ color: '#666', fontSize: 13 }}>⏳ Waiting to analyze…</span>}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })
      )}
    </Card>
  );
};

const TimelinePanel = ({ app }) => {
  const timeline = app.timeline || [];
  return (
    <Card title="📅 Timeline">
      {timeline.length === 0 ? (
        <p style={{ color: '#999' }}>No events recorded.</p>
      ) : (
        timeline.map((e, i) => (
          <div key={i} style={{ padding: 10, borderLeft: '3px solid #2563eb', marginBottom: 8, background: '#f8fafc' }}>
            <div style={{ fontSize: 11, color: '#666' }}>{e.date || e.timestamp}</div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{e.event || e.action}</div>
            {e.actor && <div style={{ fontSize: 11, color: '#999' }}>by {e.actor}</div>}
          </div>
        ))
      )}
    </Card>
  );
};

const ApplicationDetail = ({ user, onCaseLoad }) => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const [activeTab, setActiveTab] = useState(location.state?.tab || 'overview');
  const [app, setApp] = useState(null);
  const [loading, setLoading] = useState(true);

  const [kyc, setKyc] = useState(null);
  const [spreading, setSpreading] = useState(null);
  const [memo, setMemo] = useState(null);
  const [decision, setDecision] = useState(null);
  const [closing, setClosing] = useState(null);
  const [phaseA, setPhaseA] = useState(null);
  const [intake, setIntake] = useState(null);
  const [pipelineRanAt, setPipelineRanAt] = useState(null);
  const [pipelineStartedAt, setPipelineStartedAt] = useState(null);

  const [busy, setBusy] = useState({ intake: false, kyc: false, spreading: false, memo: false, decision: false });

  // Notify parent of active case for LendWise chatbot
  useEffect(() => {
    if (id && onCaseLoad) {
      onCaseLoad(id);
    }
  }, [id, onCaseLoad]);

  const loadCase = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getFullCase(id);
      const c = data.case || null;
      if (!c || !c.caseId) {
        // Case missing from local store (e.g. after a wipe). Render the
        // "Application not found" branch instead of spinning forever.
        setApp(null);
        setKyc(null); setSpreading(null); setMemo(null);
        setDecision(null); setClosing(null); setPhaseA(null); setIntake(null);
        setPipelineRanAt(null);
        setPipelineStartedAt(null);
        return;
      }
      const f = c.formData || {};

      // Helper that builds the app object given (possibly empty) realDocs.
      const buildApp = (realDocs) => {
        const owner = [f.ownerFirstName, f.ownerMiddleName, f.ownerLastName].filter(Boolean).join(' ');
        return {
          id: c.applicationId,
          caseId: c.caseId,
          businessName: f.businessLegalName || '',
          dba: f.dba || '',
          ein: f.businessTaxId || '',
          businessAddress: f.businessAddress || '',
          city: f.city || '',
          state: f.state || '',
          zipCode: f.zipCode || '',
          businessPhone: f.businessPhone || '',
          businessEmail: f.businessEmail || '',
          entityType: f.businessType || '',
          industry: f.industry || '',
          annualRevenue: f.annualRevenue || '',
          owner: {
            name: owner,
            ownership: (f.ownershipPercentage || '') + (f.ownershipPercentage ? '%' : ''),
            email: f.ownerEmail || '',
            phone: f.ownerPhone || '',
            ssn: f.ownerSSN || '',
            dob: f.ownerDateOfBirth || '',
            address: [f.ownerAddress, f.ownerCity, f.ownerState, f.ownerZip].filter(Boolean).join(', '),
          },
          loan: {
            amount: (f.loanAmount || '').toString().replace(/^[^\d]+/, '').trim(),
            currency: f.loanCurrency || 'USD',
            purpose: f.loanPurpose || '',
            term: (f.loanTerm || '') + (f.loanTerm ? ' months' : ''),
          },
          status: c.status || 'created',
          statusType: c.statusType || 'pending',
          submittedDate: (c.createdAt || '').slice(0, 10),
          documents: realDocs && realDocs.length
            ? realDocs
            : (c.documentChecklist || []).map((d) => ({
                name: d.name, status: d.status,
                date: d.uploadedAt ? d.uploadedAt.slice(0, 10) : null,
              })),
          timeline: c.timeline || [],
        };
      };

      // Render IMMEDIATELY using whatever's in localStorage. The page is now
      // visible; no more "Application Loading…" while we wait on the backend.
      setApp(buildApp([]));
      setKyc(data.kyc || null);
      setSpreading(data.spreading || null);
      setMemo(data.memo || null);
      setDecision(data.decision || null);
      setClosing(data.closing || null);
      setPhaseA(data.phaseA || null);
      setIntake(data.intake || null);
      setPipelineRanAt(data.pipelineRanAt || null);
      setPipelineStartedAt(data.pipelineStartedAt || null);
      setLoading(false);

      // Hydrate documents in the background (may take 30-60s if backend is
      // busy running agents in parallel). Doesn't block the page.
      if (c.applicationId) {
        listApplicationDocuments(c.applicationId)
          .then((r) => {
            const realDocs = (r.documents || []).map((d) => ({
              name: d.docType || d.filename,
              documentId: d.documentId,
              filename: d.filename,
              status: 'uploaded',
              date: d.uploadedAt ? d.uploadedAt.slice(0, 10) : null,
              sizeBytes: d.sizeBytes,
              gcsUri: d.gcsUri,
            }));
            if (realDocs.length > 0) {
              setApp((prev) => prev ? { ...prev, documents: realDocs } : prev);
            }
          })
          .catch((e) => console.warn('listApplicationDocuments failed:', e));
      }
    } catch (e) {
      console.error('Failed to load case:', e);
      setLoading(false);
    }
  }, [id]);

  // Lightweight refresh: re-reads agent panel state from localStorage + BQ
  // WITHOUT re-triggering document listing or summarization. Used by the
  // polling fallback and onAgentDone callbacks to avoid the request storm
  // that happens when full `loadCase()` fires repeatedly.
  const refreshPanels = useCallback(async () => {
    try {
      const data = await getFullCase(id);
      if (!data || !data.case) return;
      setKyc(data.kyc || null);
      setSpreading(data.spreading || null);
      setMemo(data.memo || null);
      setDecision(data.decision || null);
      setClosing(data.closing || null);
      setPhaseA(data.phaseA || null);
      setIntake(data.intake || null);
      setPipelineRanAt(data.pipelineRanAt || null);
      setPipelineStartedAt(data.pipelineStartedAt || null);
    } catch (e) {
      console.warn('refreshPanels failed:', e);
    }
  }, [id]);

  useEffect(() => { loadCase(); }, [loadCase]);

  // Auto-run the Phase A pipeline once when opening a case that has not been
  // processed yet. Each sub-agent's output then lands in its own tab.
  const [autoRan, setAutoRan] = useState(false);
  useEffect(() => {
    if (!app || !app.caseId || autoRan || loading) return;
    // Skip if the pipeline has ever finished for this case (the orchestrator
    // marks it with pipelineRanAt). This prevents the slow pipeline from
    // re-firing on every page visit / re-render.
    if (pipelineRanAt) return;
    // Skip if agent outputs already exist (pipeline ran but pipelineRanAt
    // was not persisted, e.g. due to a mid-run page close).
    if (kyc || spreading || memo || intake) {
      setAutoRan(true);
      return;
    }
    // Skip if this session has already kicked off the pipeline for this case
    // (survives <ApplicationDetail/> re-mounts triggered by tab/page nav).
    if (autoPipelineStarted.has(app.caseId)) {
      setAutoRan(true);
      setBusy((b) => ({ ...b, intake: true, kyc: true, spreading: true, memo: true, decision: true }));
      return;
    }
    // Skip if a previous page-load started the pipeline recently and it has
    // not yet finished — let the in-flight backend run complete instead of
    // firing a duplicate one that restarts every agent.
    if (pipelineStartedAt) {
      const startedMs = Date.parse(pipelineStartedAt);
      if (!isNaN(startedMs) && Date.now() - startedMs < PIPELINE_STALE_MS) {
        autoPipelineStarted.add(app.caseId);
        setAutoRan(true);
        setBusy((b) => ({ ...b, intake: true, kyc: true, spreading: true, memo: true, decision: true }));
        return;
      }
    }
    autoPipelineStarted.add(app.caseId);
    setAutoRan(true);
    setBusy((b) => ({ ...b, intake: true, kyc: true, spreading: true, memo: true, decision: true }));
    // Live update: as each per-agent endpoint resolves, the api layer fires
    // onAgentDone(slot) so we (a) refresh the case from localStorage and
    // (b) flip just that agent's busy flag off — instead of waiting for
    // the whole pipeline to finish.
    runPreApprovalPipeline(
      app.caseId,
      user?.name || 'Banker',
      (slot) => {
        refreshPanels();
        setBusy((b) => {
          const next = { ...b };
          if (slot === 'intake') next.intake = false;
          else if (slot === 'kyc') next.kyc = false;
          else if (slot === 'spreading') next.spreading = false;
          else if (slot === 'memo') next.memo = false;
          else if (slot === 'decision') next.decision = false;
          return next;
        });
      },
    )
      .then(() => refreshPanels())
      .catch((e) => console.error('Auto pipeline failed:', e))
      .finally(() => setBusy((b) => ({ ...b, intake: false, kyc: false, spreading: false, memo: false, decision: false })));
  }, [app, autoRan, loading, pipelineRanAt, pipelineStartedAt, kyc, spreading, memo, intake, user, refreshPanels]);

  useEffect(() => {
    if (location.state?.tab) setActiveTab(location.state.tab);
  }, [location.state]);

  // Polling fallback: while ANY agent is still busy, refresh the case
  // every 8 seconds from `getFullCase` (which now hydrates from BQ via
  // `GET /cases/:id/agent_outputs`). This way the UI catches up even when
  // an individual per-agent HTTP response is dropped — the agent has
  // already persisted its row to BigQuery, so the next poll surfaces it.
  useEffect(() => {
    const anyBusy = busy.intake || busy.kyc || busy.spreading || busy.memo || busy.decision;
    if (!anyBusy) return;
    const t = setInterval(() => { refreshPanels(); }, 8000);
    return () => clearInterval(t);
  }, [busy.intake, busy.kyc, busy.spreading, busy.memo, busy.decision, refreshPanels]);

  // As soon as a panel actually has agent output (from either the direct
  // per-agent HTTP response OR the BQ-hydration poll above), clear the
  // corresponding busy flag so the spinner doesn't linger.
  useEffect(() => {
    const hasContent = (slot) =>
      !!(slot && slot.markdown && String(slot.markdown).trim().length >= 20
         && !String(slot.markdown).trim().startsWith('(agent '));
    setBusy((b) => {
      const next = { ...b };
      if (b.intake    && hasContent(intake))    next.intake = false;
      if (b.kyc       && hasContent(kyc))       next.kyc = false;
      if (b.spreading && hasContent(spreading)) next.spreading = false;
      if (b.memo      && hasContent(memo))      next.memo = false;
      if (b.decision  && hasContent(decision))  next.decision = false;
      return next;
    });
  }, [intake, kyc, spreading, memo, decision]);

  const doSubmitHuman = async (verdict, notes, reviewChecklist) => {
    setBusy((b) => ({ ...b, decision: true }));
    try {
      await submitHumanDecision(app.caseId, verdict, user?.name || 'Underwriter', notes, reviewChecklist);
      await loadCase();
    } catch (e) {
      // Defensive catch: submitHumanDecision now records the verdict locally
      // even when the Closing Package backend call fails, but we still want
      // to swallow any unexpected error here so the React error overlay
      // never replaces the page just because of a transient network issue.
      console.error('Submit human decision failed:', e);
      try { await loadCase(); } catch (_) { /* ignore */ }
      // eslint-disable-next-line no-alert
      alert(`The decision was saved locally but the backend call failed:\n${e?.message || e}\n\nYou can re-run the Loan Package Agent from the Loan Package tab once the backend is reachable.`);
    } finally {
      setBusy((b) => ({ ...b, decision: false }));
    }
  };


  const tabs = [
    { id: 'overview',     label: 'Overview',                  sub: 'Case snapshot',          icon: '📋', accent: '#475569', show: true },
    { id: 'documents',    label: 'Document Validation Agent', sub: 'Intake & validation',    icon: '📄', accent: '#0ea5e9', show: true },
    { id: 'verification', label: 'KYC Agent',                 sub: 'Compliance & screening', icon: '🔍', accent: '#7c3aed', show: true },
    { id: 'spreading',    label: 'Financial Spreading Agent', sub: 'Statements & ratios',    icon: '📊', accent: '#0284c7', show: true },
    { id: 'memo',         label: 'Memo Drafting Agent',       sub: 'Credit memo drafter',    icon: '📝', accent: '#d97706', show: true },
    { id: 'decisioning',  label: 'Decision Agent',            sub: 'Decision support',       icon: '⚖️', accent: '#9f1239', show: true },
    { id: 'closing',      label: 'Loan Package Agent',        sub: 'Closing package',        icon: '📦', accent: '#15803d', show: true },
  ].filter((t) => t.show);


  useEffect(() => {
    if (!tabs.some((t) => t.id === activeTab)) setActiveTab('overview');

  }, [tabs.length]);

  if (loading) {
    return (
      <div className="application-detail">
        <div className="detail-header">
          <button className="back-btn" onClick={() => navigate(-1)}>← Back to Dashboard</button>
          <div className="detail-header-content"><div className="header-left"><h1>Application Loading...</h1></div></div>
        </div>
      </div>
    );
  }
  if (!app) {
    return (
      <div className="application-detail">
        <div className="detail-header">
          <button className="back-btn" onClick={() => navigate(-1)}>← Back to Dashboard</button>
          <div className="detail-header-content"><div className="header-left"><h1>Application not found</h1></div></div>
        </div>
      </div>
    );
  }

  const ccySym = '$';

  return (
    <div className="application-detail">
      <div className="detail-header">
        <button className="back-btn" onClick={() => navigate(-1)}>← Back to Dashboard</button>
        <div className="detail-header-content">
          <div className="header-left">
            <div className="app-badge">{app.id}</div>
            <h1>{app.businessName}</h1>
            {/* <p>{app.dba && `DBA: ${app.dba} • `}{app.entityType} • {app.city}, {app.state}</p> */}
          </div>
          <div className="header-right">
            <div className="loan-amount">{ccySym}{app.loan.amount}</div>
            <div className="loan-purpose">{app.loan.purpose}</div>
            <span className={`status-badge ${app.statusType}`}>{app.status}</span>
            <button
              type="button"
              title="Clear cached agent outputs and re-run the pipeline. Use only if Memo / Decision / Spreading appear stuck or empty."
              onClick={async () => {
                if (!window.confirm('Reset this case?\n\nThis will clear cached outputs from all agents (Intake, KYC, Spreading, Memo, Decision, Closing) for THIS case only and re-run the pipeline. Other cases are not affected.')) return;
                resetCaseAgentOutputs(app.caseId);
                autoPipelineStarted.delete(app.caseId);
                await loadCase();
                try {
                  await runPreApprovalPipeline(app.caseId, user?.name || 'Banker');
                } catch (e) { console.warn('reset pipeline failed', e); }
                await loadCase();
              }}
              style={{
                marginTop: 8,
                padding: '6px 12px',
                background: '#fff',
                color: '#991b1b',
                border: '1px solid #fca5a5',
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >↻ Reset Case</button>
          </div>
        </div>
      </div>

      <div className="detail-tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`tab-btn ${activeTab === t.id ? 'active' : ''}`}
            onClick={() => setActiveTab(t.id)}
            style={activeTab === t.id ? { '--tab-accent': t.accent } : undefined}
          >
            <span className="tab-btn-icon" style={{ background: `${t.accent}15`, color: t.accent }}>{t.icon}</span>
            <span className="tab-btn-text">
              <span className="tab-btn-label">{t.label}</span>
              <span className="tab-btn-sub">{t.sub}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="detail-content">
        <AgentTabContent tab={tabs.find(t => t.id === activeTab)} activeTab={activeTab}>
          {activeTab === 'overview' && <OverviewPanel app={app} />}
          {activeTab === 'documents' && <DocumentIntakePanel intake={intake} app={app} running={busy.intake} />}
          {activeTab === 'verification' && <KycPanel kyc={kyc} app={app} running={busy.kyc} />}
          {activeTab === 'spreading' && <SpreadingPanel spreading={spreading} memo={memo} app={app} running={busy.spreading} />}
          {activeTab === 'memo' && <MemoPanel memo={memo} app={app} running={busy.memo} />}
          {activeTab === 'decisioning' && <DecisioningPanel decision={decision} app={app} running={busy.decision} onSubmitHuman={doSubmitHuman} kyc={kyc} spreading={spreading} intake={intake} />}
          {activeTab === 'closing' && <ClosingPanel closing={closing} app={app} decision={decision} kyc={kyc} spreading={spreading} memo={memo} intake={intake} />}
          {activeTab === 'timeline' && <TimelinePanel app={app} />}
        </AgentTabContent>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------
// AgentTabContent / AgentBootScreen
//
// When the underwriter clicks any agent tab, briefly show a polished
// "agent activating" animation — pulsing agent icon, status ticker,
// progress bar — then fade in the actual panel content. Makes the
// experience feel like the agent is waking up and running, not like a
// static document tab.
// ---------------------------------------------------------------
const AGENT_BOOT_STATUSES = {
  overview:     ['Loading case snapshot…', 'Aggregating data…', 'Ready'],
  documents:    ['Connecting to Document Validation Agent…', 'Indexing uploaded files…', 'Extracting structured fields…', 'Ready'],
  verification: ['Spinning up KYC Agent…', 'Querying sanctions & PEP lists…', 'Pulling credit bureau…', 'Ready'],
  spreading:    ['Engaging Financial Spreading Agent…', 'Parsing financial statements…', 'Computing ratios & anomaly score…', 'Ready'],
  memo:         ['Waking Memo Drafting Agent…', 'Aggregating upstream agent output…', 'Drafting credit memo…', 'Ready'],
  decisioning:  ['Activating Decision Agent…', 'Evaluating risk profile…', 'Synthesizing recommendation…', 'Ready'],
  closing:      ['Spinning up Loan Package Agent…', 'Assembling closing package…', 'Ready'],
  timeline:     ['Loading timeline…', 'Ready'],
};

const BOOT_DURATION_MS = 1300;

const AgentTabContent = ({ tab, activeTab, children }) => {
  const [booting, setBooting] = useState(true);

  // IMPORTANT: depend ONLY on the stable `activeTab` string. The `tab`
  // prop is a fresh object literal from `tabs.find(...)` on every parent
  // re-render, so including it in the dep array (or omitting deps) caused
  // the boot animation to restart on every state update — which fired
  // continuously while polling / pipeline state updated, making the boot
  // screen re-trigger again and again.
  useEffect(() => {
    if (!activeTab) return undefined;
    setBooting(true);
    const t = setTimeout(() => setBooting(false), BOOT_DURATION_MS);
    return () => clearTimeout(t);
  }, [activeTab]);

  if (!tab) return null;

  if (booting) {
    return <AgentBootScreen tab={tab} />;
  }

  return (
    <div className="agent-panel-reveal" key={`reveal-${activeTab}`}>
      {children}
    </div>
  );
};

const AgentBootScreen = ({ tab }) => {
  const statuses = AGENT_BOOT_STATUSES[tab.id] || ['Initializing…', 'Ready'];
  const accent = tab.accent || '#0ea5e9';
  const isOverview = tab.id === 'overview';

  return (
    <div className="agent-boot" style={{ '--boot-accent': accent }}>
      <div className="agent-boot-card">
        <div className="agent-boot-glow" />

        <div className="agent-boot-icon-wrap">
          <div className="agent-boot-ring agent-boot-ring-1" />
          <div className="agent-boot-ring agent-boot-ring-2" />
          <div className="agent-boot-ring agent-boot-ring-3" />
          <div className="agent-boot-icon">{tab.icon}</div>
        </div>

        <div className="agent-boot-meta">
          <div className="agent-boot-kicker">{isOverview ? 'LOADING' : 'AGENT ACTIVATING'}</div>
          <div className="agent-boot-name">{tab.label}</div>
          <div className="agent-boot-sub">{tab.sub}</div>
        </div>

        <ul className="agent-boot-statuses">
          {statuses.map((s, i) => (
            <li key={i} style={{ animationDelay: `${i * (BOOT_DURATION_MS / statuses.length / 1000)}s` }}>
              <span className="agent-boot-tick">✓</span> {s}
            </li>
          ))}
        </ul>

        <div className="agent-boot-bar">
          <div className="agent-boot-bar-fill" />
        </div>
      </div>
    </div>
  );
};

export default ApplicationDetail;
