import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Header from './components/Header';
import LoginPage from './pages/LoginPage';
import LandingPage from './pages/LandingPage';
import CustomerIntakeAgent from './pages/CustomerIntakeAgent';
import VerificationAgent from './pages/VerificationAgent';
import CustomerPortal from './pages/CustomerPortal';
import BankerDashboard from './pages/BankerDashboard';
import ApplicationDetail from './pages/ApplicationDetail';
import AgentWorkflowShowcase from './pages/AgentWorkflowShowcase';
import LendWise from './components/LendWise';
import './App.css';

function App() {
  const [user, setUser] = useState(null);
  const [applicationData, setApplicationData] = useState(null);
  const [verificationResult, setVerificationResult] = useState(null);
  const [activeCaseId, setActiveCaseId] = useState(null);
  const [lendWiseOpen, setLendWiseOpen] = useState(false);

  const handleLogin = (userData) => {
    setUser(userData);
  };

  const handleLogout = () => {
    setUser(null);
    setApplicationData(null);
    setVerificationResult(null);
  };


  if (!user) {
    return (
      <Router>
        <Routes>
          <Route path="*" element={<LoginPage onLogin={handleLogin} />} />
        </Routes>
      </Router>
    );
  }

  return (
    <Router>
      <div className="app">
        <Header user={user} onLogout={handleLogout} />
        <main className="main-content">
          <Routes>
            {}
            {user.role === 'customer' ? (
              <>
                <Route path="/" element={<LandingPage />} />
                <Route
                  path="/intake"
                  element={
                    <CustomerIntakeAgent
                      onSubmit={setApplicationData}
                      applicationData={applicationData}
                    />
                  }
                />
                <Route
                  path="/verification"
                  element={
                    <VerificationAgent
                      applicationData={applicationData}
                      onVerificationComplete={setVerificationResult}
                      verificationResult={verificationResult}
                    />
                  }
                />
                <Route
                  path="/portal"
                  element={
                    <CustomerPortal
                      applicationData={applicationData}
                      verificationResult={verificationResult}
                      onOpenChat={(caseId, bizName) => {
                        setActiveCaseId(caseId);
                        setLendWiseOpen({ caseId, bizName });
                      }}
                    />
                  }
                />
                <Route path="*" element={<Navigate to="/portal" replace />} />
              </>
            ) : user.role === 'ops' ? (
              // Ops = AI Workflow Explorer. Eye-candy only — animated
              // pipeline view, no real data, no agent calls.
              <>
                <Route path="/workflow" element={<AgentWorkflowShowcase user={user} />} />
                <Route path="*" element={<Navigate to="/workflow" replace />} />
              </>
            ) : (

              <>
                <Route path="/" element={<BankerDashboard user={user} />} />
                <Route path="/banker-dashboard" element={<BankerDashboard user={user} />} />
                <Route path="/application/:id" element={<ApplicationDetail user={user} onCaseLoad={setActiveCaseId} />} />
                <Route
                  path="/verification"
                  element={
                    <VerificationAgent
                      applicationData={applicationData}
                      onVerificationComplete={setVerificationResult}
                      verificationResult={verificationResult}
                    />
                  }
                />
                <Route
                  path="/portal"
                  element={
                    <CustomerPortal
                      applicationData={applicationData}
                      verificationResult={verificationResult}
                    />
                  }
                />
                <Route path="*" element={<Navigate to="/banker-dashboard" replace />} />
              </>
            )}
          </Routes>
        </main>
        <LendWise user={user} activeCaseId={activeCaseId} openWithCase={lendWiseOpen} onOpened={() => setLendWiseOpen(false)} />
      </div>
    </Router>
  );
}

export default App;
