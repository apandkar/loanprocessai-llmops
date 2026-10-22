import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { runKycCheck, getDemoCases } from '../services/api';
import './VerificationAgent.css';

const VerificationAgent = ({ applicationData, onVerificationComplete, verificationResult }) => {
  const navigate = useNavigate();
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationSteps, setVerificationSteps] = useState([]);
  const [result, setResult] = useState(verificationResult);
  const [demoData, setDemoData] = useState(applicationData || null);
  const [loadingDemo, setLoadingDemo] = useState(!applicationData);


  useEffect(() => {
    if (!applicationData) {
      getDemoCases()
        .then(data => {
          if (data.length > 0) {
            const c = data[0].case;
            const f = c.formData || {};
            setDemoData({ ...f, applicationId: c.applicationId, _case: c });
          }
        })
        .catch(err => console.error('Failed to load demo data:', err))
        .finally(() => setLoadingDemo(false));
    }
  }, [applicationData]);

  const runVerification = async () => {
    setIsVerifying(true);

    const caseId = demoData._case?.caseId || 'CASE-A14F2C';


    setVerificationSteps(prev => prev.map(s => ({ ...s, status: 'running', detail: '' })));


    let kycResult = null;
    try {
      kycResult = await runKycCheck(caseId, demoData);
    } catch (err) {
      console.error('KYC check error:', err);
      setVerificationSteps([{ id: 'err', name: 'KYC Backend Call', status: 'error', detail: 'Backend KYC call failed.' }]);
      setIsVerifying(false);
      return;
    }





    const steps = [];
    let stepId = 1;

    const checklist = Array.isArray(kycResult?.kycChecklist) ? kycResult.kycChecklist : [];
    if (checklist.length === 0) {
      steps.push({
        id: stepId++, name: 'Uploaded KYC Documents',
        status: 'warning',
        detail: 'No KYC documents found in storage for this application.',
      });
    } else {
      for (const item of checklist) {
        const sizeKb = item.sizeBytes ? `${Math.round(item.sizeBytes / 1024)} KB` : '';
        steps.push({
          id: stepId++,
          name: item.name,
          status: item.status === 'verified' ? 'complete' : 'warning',
          detail: item.filename
            ? `${item.filename}${sizeKb ? ` · ${sizeKb}` : ''} · stored in GCS`
            : 'Awaiting upload',
        });
      }
    }

    const sanc = kycResult?.sanctions || {};
    const pep = kycResult?.pepCheck || {};
    const adv = kycResult?.adverseMedia || {};
    const credit = kycResult?.creditScore || {};

    steps.push({
      id: stepId++, name: 'Sanctions / AML Screening',
      status: sanc.overallStatus === 'clear' ? 'complete' : sanc.overallStatus ? 'warning' : 'error',
      detail: `Screened ${sanc.listsChecked ?? 0} list(s) — ${sanc.overallStatus ?? 'unavailable'}`,
    });
    steps.push({
      id: stepId++, name: 'PEP & Adverse Media',
      status: (pep.status === 'clear' && adv.status === 'clear') ? 'complete' : 'warning',
      detail: `PEP: ${pep.status ?? 'n/a'} · Adverse media hits: ${adv.hits ?? 0}`,
    });
    steps.push({
      id: stepId++, name: 'Credit Score',
      status: (credit.score ?? 0) >= 650 ? 'complete' : 'warning',
      detail: credit.score ? `Score ${credit.score} (${credit.rating ?? '—'}) via ${credit.bureau ?? 'bureau'}` : 'Credit score unavailable',
    });
    steps.push({
      id: stepId++, name: 'KYC Completeness',
      status: (kycResult?.completeness ?? 0) === 100 ? 'complete' : 'warning',
      detail: `${kycResult?.completeness ?? 0}% of required KYC docs verified`,
    });

    setVerificationSteps(steps);

    setIsVerifying(false);

    const verificationData = {
      hasIssues: (kycResult?.flags?.length || 0) > 0,
      issues: kycResult?.flags || [],
      kyc: kycResult,
      verifiedAt: new Date().toISOString(),
    };

    setResult(verificationData);
    onVerificationComplete(verificationData);
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'complete': return '✓';
      case 'warning': return '⚠';
      case 'error': return '✗';
      case 'running': return '⟳';
      default: return '○';
    }
  };

  const getStatusClass = (status) => {
    switch (status) {
      case 'complete': return 'status-complete';
      case 'warning': return 'status-warning';
      case 'error': return 'status-error';
      case 'running': return 'status-running';
      default: return 'status-pending';
    }
  };

  return (
    <div className="verification-page">
      <div className="verification-container">
        <div className="verification-header">
          <div className="agent-banner" style={{borderColor: '#93c5fd', background: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 50%, #bfdbfe 100%)', marginBottom: 24, textAlign: 'left'}}>
            <div className="agent-avatar blue">🔍</div>
            <div className="agent-banner-info">
              <div className="agent-banner-name" style={{color: '#1e40af'}}>
                KYC Agent
              </div>
              <div className="agent-banner-desc">Cross-checking business information against official records, sanctions lists & credit bureaus</div>
            </div>
            <div className={`agent-status-pill ${isVerifying ? 'processing' : result ? 'complete' : 'active'}`}>
              {isVerifying ? 'Verifying...' : result ? '✅ Complete' : 'Ready'}
            </div>
          </div>
          <h1>Entity Verification</h1>
          <p>AI-powered cross-checking against IRS, Secretary of State, OFAC sanctions & credit bureaus</p>
        </div>

        {loadingDemo || !demoData ? (
          <div style={{textAlign: 'center', padding: 60, color: '#999'}}>
            <p>Loading application data from backend...</p>
          </div>
        ) : (
        <div className="verification-content">
          <div className="verification-main">
            {}
            <div className="card summary-card">
              <h3>Application Summary</h3>
              <div className="summary-grid">
                <div className="summary-item">
                  <span className="summary-label">Business Name</span>
                  <span className="summary-value">{demoData.businessLegalName}</span>
                </div>
                <div className="summary-item">
                  <span className="summary-label">DBA</span>
                  <span className="summary-value">{demoData.dba}</span>
                </div>
                <div className="summary-item">
                  <span className="summary-label">Tax ID (EIN)</span>
                  <span className="summary-value">{demoData.businessTaxId}</span>
                </div>
                <div className="summary-item">
                  <span className="summary-label">Owner</span>
                  <span className="summary-value">{demoData.ownerFirstName} {demoData.ownerMiddleName}. {demoData.ownerLastName}</span>
                </div>
                <div className="summary-item">
                  <span className="summary-label">Ownership</span>
                  <span className="summary-value">{demoData.ownershipPercentage}</span>
                </div>
                <div className="summary-item">
                  <span className="summary-label">Location</span>
                  <span className="summary-value">{demoData.city}, {demoData.state} {demoData.zipCode}</span>
                </div>
                <div className="summary-item">
                  <span className="summary-label">Loan Amount</span>
                  <span className="summary-value" style={{color: '#2E7D4A', fontWeight: 600}}>{demoData.loanAmount}</span>
                </div>
                <div className="summary-item">
                  <span className="summary-label">Purpose</span>
                  <span className="summary-value">{demoData.loanPurpose}</span>
                </div>
                <div className="summary-item">
                  <span className="summary-label">Industry</span>
                  <span className="summary-value">{demoData.industry}</span>
                </div>
                <div className="summary-item">
                  <span className="summary-label">Annual Revenue</span>
                  <span className="summary-value">{demoData.annualRevenue}</span>
                </div>
                <div className="summary-item">
                  <span className="summary-label">Years in Business</span>
                  <span className="summary-value">{demoData.yearsInBusiness} years</span>
                </div>
                <div className="summary-item">
                  <span className="summary-label">State of Formation</span>
                  <span className="summary-value">{demoData.state}</span>
                </div>
              </div>
            </div>

            {}
            <div className="card verification-steps-card">
              <div className="card-header">
                <div style={{display: 'flex', alignItems: 'center', gap: 10}}>
                  <h3>Verification Process</h3>
                  <span style={{fontSize: 10, fontWeight: 700, background: '#dbeafe', color: '#1e40af', padding: '2px 8px', borderRadius: 4}}>KYC AGENT</span>
                </div>
                {!isVerifying && !result && (
                  <button className="btn btn-primary" onClick={runVerification}>
                    <span>▶</span> Run Verification
                  </button>
                )}
                {isVerifying && (
                  <span className="verifying-badge">
                    <div className="spinner"></div>
                    Verifying...
                  </span>
                )}
              </div>

              <div className="verification-steps">
                {verificationSteps.map((step, index) => (
                  <div
                    key={step.id}
                    className={`verification-step ${getStatusClass(step.status)}`}
                  >
                    <div className="step-indicator">
                      <span className="step-icon">{getStatusIcon(step.status)}</span>
                      {index < verificationSteps.length - 1 && <div className="step-line"></div>}
                    </div>
                    <div className="step-content">
                      <div className="step-name">{step.name}</div>
                      {step.detail && <div className="step-detail">{step.detail}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>

          {}
          <div className="verification-sidebar">
            <div className="card agent-info-card">
              <div style={{display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16}}>
                <div style={{width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg, #1d4ed8, #2563eb)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: '#fff'}}>🤖</div>
                <h4 style={{margin: 0}}>KYC Agent Activity Log</h4>
              </div>
              <div className="agent-log">
                {verificationSteps.filter(s => s.status !== 'pending').length === 0 && (
                  <div className="log-entry">
                    <span className="log-time">—</span>
                    <span className="log-message">Awaiting verification run.</span>
                  </div>
                )}
                {verificationSteps.filter(s => s.status !== 'pending').map(step => (
                  <div key={step.id} className="log-entry">
                    <span className="log-time">
                      {step.status === 'error' ? '⚠️' : step.status === 'warning' ? '⚡' : '✓'}
                    </span>
                    <span className="log-message">{step.detail || step.name}</span>
                  </div>
                ))}
              </div>
            </div>

            {result && (
              <div className="card next-steps-card">
                <h4>Next Steps</h4>
                <div className="next-steps-list">
                  <button className="next-step-btn" onClick={() => navigate('/portal')}>
                    <span>📝</span>
                    Review in Customer Portal
                  </button>
                  <button className="next-step-btn">
                    <span>📧</span>
                    Send Clarification Request
                  </button>
                  <button className="next-step-btn">
                    <span>📋</span>
                    Add to Exception Queue
                  </button>
                </div>
              </div>
            )}

            {result?.kyc && (
              <div className="card agent-info-card">
                <div style={{display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16}}>
                  <div style={{width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg, #16a34a, #22c55e)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: '#fff'}}>🛡️</div>
                  <h4 style={{margin: 0}}>KYC / AML Results</h4>
                  <span style={{fontSize: 10, fontWeight: 700, background: '#dcfce7', color: '#166534', padding: '2px 8px', borderRadius: 4}}>KYC AGENT</span>
                </div>
                <div className="agent-log">
                  <div className="log-entry">
                    <span className="log-time">
                      {result.kyc.sanctions?.overallStatus === 'clear' ? '✅' : '🚨'}
                    </span>
                    <span className="log-message">
                      Sanctions: {result.kyc.sanctions?.overallStatus || 'N/A'} ({result.kyc.sanctions?.listsChecked} lists)
                    </span>
                  </div>
                  <div className="log-entry">
                    <span className="log-time">
                      {result.kyc.pepCheck?.status === 'clear' ? '✅' : '⚠️'}
                    </span>
                    <span className="log-message">
                      PEP Check: {result.kyc.pepCheck?.status || 'N/A'}
                    </span>
                  </div>
                  <div className="log-entry">
                    <span className="log-time">
                      {result.kyc.adverseMedia?.status === 'clear' ? '✅' : '⚠️'}
                    </span>
                    <span className="log-message">
                      Adverse Media: {result.kyc.adverseMedia?.status || 'N/A'}
                    </span>
                  </div>
                  <div className="log-entry">
                    <span className="log-time">📊</span>
                    <span className="log-message">
                      Credit Score: {result.kyc.creditScore?.score} ({result.kyc.creditScore?.rating})
                    </span>
                  </div>
                  <div className="log-entry">
                    <span className="log-time">🏭</span>
                    <span className="log-message">
                      Industry Risk: {result.kyc.industryRisk?.riskLevel}
                    </span>
                  </div>
                  {result.kyc.missingDocuments?.length > 0 && (
                    <div className="log-entry">
                      <span className="log-time">📄</span>
                      <span className="log-message">
                        {result.kyc.missingDocuments.length} KYC document(s) pending
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
        )}
      </div>
    </div>
  );
};

export default VerificationAgent;
