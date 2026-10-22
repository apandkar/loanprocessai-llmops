import React from 'react';
import './ApplicationProgress.css';

const ApplicationProgress = ({ currentStep, totalSteps, steps }) => {
  const defaultSteps = [
    { id: 1, label: 'Getting Started', shortLabel: '1' },
    { id: 2, label: 'Your Consent', shortLabel: '2' },
    { id: 3, label: 'Business Info', shortLabel: '3' },
    { id: 4, label: 'Verifying', shortLabel: '4' },
    { id: 5, label: 'Docs Needed', shortLabel: '5' },
    { id: 6, label: 'Docs Received', shortLabel: '6' },
    { id: 7, label: 'Extraction', shortLabel: '7' },
    { id: 8, label: 'Completeness', shortLabel: '8' },
  ];

  const displaySteps = steps || defaultSteps.slice(0, totalSteps || 8);
  const activeStep = currentStep || 1;

  const getStepStatus = (stepId) => {
    if (stepId < activeStep) return 'completed';
    if (stepId === activeStep) return 'active';
    return 'pending';
  };

  return (
    <div className="progress-container">
      <div className="progress-header">
        <span className="progress-icon">🌿</span>
        <span className="progress-title">Application Progress</span>
      </div>

      <div className="progress-tracker">
        {displaySteps.map((step, index) => (
          <div
            key={step.id}
            className={`progress-step ${getStepStatus(step.id)}`}
          >
            <div className="step-circle">
              {getStepStatus(step.id) === 'completed' ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  <path d="M5 13l4 4L19 7" />
                </svg>
              ) : getStepStatus(step.id) === 'active' ? (
                <div className="active-dot"></div>
              ) : (
                <span>{step.shortLabel}</span>
              )}
            </div>
            <span className="step-label">{step.label}</span>
            {index < displaySteps.length - 1 && (
              <div className={`step-connector ${getStepStatus(step.id) === 'completed' ? 'completed' : ''}`}></div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default ApplicationProgress;
