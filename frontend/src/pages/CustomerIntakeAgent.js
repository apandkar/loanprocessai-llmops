import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ApplicationProgress from '../components/ApplicationProgress';
import { submitTicket, uploadApplicationDocuments, autoProcessTicket } from '../services/api';
import './CustomerIntakeAgent.css';

// Hardcoded profile aligned with the uploaded KYC documents:
// - Government Photo ID (CA Driver License "Specimen"): LN ABC, FN MR.,
//   DOB 03/15/1972, license C1234567, expires 03/15/2030
// - IRS EIN Certificate (CP 575 G): EIN 47-1234567, ABC, INC.,
//   Attn: Mr. ABC, Chief Executive Officer
// - Certificate of Incorporation (Delaware, File #7654321): ABC, INC.
//   incorporated September 1, 2010
// - Pacific Coast Electric Utility Bill: 350 Fifth Avenue, 21st Floor,
//   New York, NY 10118 (statement date Apr 30, 2026)
// - Audited Financial Statements (KPMG): ABC, Inc. and Subsidiaries,
//   FY2023 / FY2022 consolidated statements (USD)
// - FirstRand Bank Periodic Credit Review: ABC, INC. PD rating BB-(upper),
//   review date May 29, 2026
const ABC_INC_PROFILE = {
  // Business details (per IRS EIN Letter & Certificate of Incorporation)
  businessLegalName: 'ABC, INC.',
  dba: 'ABC',
  businessTaxId: '47-1234567',          // IRS EIN Letter CP 575 G
  businessAddress: '350 Fifth Avenue, 21st Floor',  // Utility Bill + EIN letter
  city: 'New York',
  state: 'New York',
  zipCode: '10118',
  businessPhone: '(212) 555-0117',
  businessEmail: 'accounts.payable@abc-inc.com',
  businessType: 'C Corporation',
  // Certificate of Incorporation: September 1, 2010
  dateEstablished: '2010-09-01',

  numberOfEmployees: '250',
  // From Audited Financial Statements (KPMG, FY2023, USD millions).
  annualRevenue: '$1,431,800,000',
  industry: 'Financial Services',

  // Owner details (per CA Driver License + IRS EIN Letter "Attn: Mr. ABC, CEO")
  ownerFirstName: 'Mr.',
  ownerMiddleName: '',
  ownerLastName: 'ABC',
  ownerSSN: '123-45-6789',              // Demo placeholder (not in uploaded docs)
  ownerDateOfBirth: '1972-03-15',       // From Driver License DOB 03/15/1972
  ownerAddress: '1450 Mission Street, Apt 7B',  // From Driver License
  ownerCity: 'San Francisco',
  ownerState: 'California',
  ownerZip: '94103',
  ownerPhone: '(212) 555-0117',
  ownerEmail: 'ceo@abc-inc.com',
  // Certificate of Incorporation: 60% shareholder / CEO
  ownershipPercentage: '60',

  loanPurpose: 'Working Capital',
  loanAmount: '1,000,000',
  loanCurrency: 'USD',
  loanTerm: '12',
  consentCredit: true,
  consentTerms: true,
  consentPrivacy: true,
};

function getRandomProfile() {

  return { ...ABC_INC_PROFILE };
}

const CustomerIntakeAgent = ({ onSubmit, applicationData }) => {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(1);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errors, setErrors] = useState({});
  const [agentResult, setAgentResult] = useState(null);
  const [showPipeline, setShowPipeline] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [uploadStatus, setUploadStatus] = useState(null);

  const [formData, setFormData] = useState(applicationData || getRandomProfile());








  const REQUIRED_DOC_SLOTS = [
    { key: 'owner_id',          label: 'Government Photo ID (Owner)',
      docType: 'Identity Verification',         kycPurpose: 'Identity Verification',
      hint:  'Passport, Driver\'s License, or National ID of the primary owner.',
      icon:  '🪪', accept: '*/*', required: true },
    { key: 'address_proof',     label: 'Proof of Address',
      docType: 'Address Verification',          kycPurpose: 'Address Verification',
      hint:  'Recent utility bill, bank statement, or lease (≤ 3 months old).',
      icon:  '🏠', accept: '*/*', required: true },
    { key: 'business_ein',      label: 'Business EIN / Tax ID Certificate',
      docType: 'Business Tax ID Verification',  kycPurpose: 'Business Tax ID Verification',
      hint:  'IRS EIN confirmation letter (CP 575) or equivalent.',
      icon:  '🏛️', accept: '*/*', required: true },
    { key: 'financial_statements', label: 'Financial Statements',
      docType: 'Financial Statements',          kycPurpose: 'Financial Spreading',
      hint:  'Profit & Loss, Balance Sheet, and Cash Flow (most recent fiscal year).',
      icon:  '📊', accept: '*/*', required: true },
    { key: 'tax_returns',       label: 'Business Tax Returns',
      docType: 'Tax Returns',                   kycPurpose: 'Financial Spreading',
      hint:  'Most recent 1–2 years of business tax returns.',
      icon:  '📑', accept: '*/*', required: true },
    { key: 'incorporation_letter', label: 'Letter / Certificate of Incorporation',
      docType: 'Certificate of Incorporation',  kycPurpose: 'Business Verification',
      hint:  'State-issued Certificate of Incorporation or Formation.',
      icon:  '📜', accept: '*/*', required: true },
  ];

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));


    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: null }));
    }
  };

  const validateStep = (step) => {
    const newErrors = {};

    if (step === 1) {
      if (!formData.businessLegalName) newErrors.businessLegalName = 'Please enter business legal name';
      if (!formData.businessTaxId) newErrors.businessTaxId = 'Please enter Tax ID / EIN';
      if (!formData.businessAddress) newErrors.businessAddress = 'Please enter business address';
      if (!formData.city) newErrors.city = 'Please enter city';
      if (!formData.state) newErrors.state = 'Please select state';
      if (!formData.zipCode) newErrors.zipCode = 'Please enter ZIP code';
    } else if (step === 2) {
      if (!formData.ownerFirstName) newErrors.ownerFirstName = 'Please enter your first name';
      if (!formData.ownerLastName) newErrors.ownerLastName = 'Please enter your last name';
      if (!formData.ownerSSN) newErrors.ownerSSN = 'Please enter your SSN';
      if (!formData.ownerDateOfBirth) newErrors.ownerDateOfBirth = 'Please enter date of birth';
      if (!formData.ownershipPercentage) newErrors.ownershipPercentage = 'Please enter ownership percentage';
    } else if (step === 3) {
      if (!formData.loanPurpose) newErrors.loanPurpose = 'Please select loan purpose';
      if (!formData.loanAmount) newErrors.loanAmount = 'Please enter loan amount';
      if (!formData.consentCredit) newErrors.consentCredit = 'Credit check consent is required';
      if (!formData.consentTerms) newErrors.consentTerms = 'Terms acceptance is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNext = () => {
    if (validateStep(currentStep)) {
      setCurrentStep(prev => prev + 1);
    }
  };

  const handleBack = () => {
    setCurrentStep(prev => prev - 1);
  };

  const handleFilesSelected = (e) => {
    const newFiles = Array.from(e.target.files || []).map(file => ({
      file,
      docType: 'Other',
      slotKey: null,
      status: 'queued',
      error: null,
    }));
    setUploadedFiles(prev => [...prev, ...newFiles]);
    e.target.value = '';
  };


  const handleSlotFileSelected = (slot, file) => {
    if (!file) return;
    setUploadedFiles(prev => {
      const existing = prev.findIndex(f => f.slotKey === slot.key);
      const entry = {
        file,
        docType: slot.docType,
        slotKey: slot.key,
        status: 'queued',
        error: null,
      };
      if (existing >= 0) {
        return prev.map((f, i) => (i === existing ? entry : f));
      }
      return [...prev, entry];
    });
  };

  const handleRemoveFile = (idx) => {
    setUploadedFiles(prev => prev.filter((_, i) => i !== idx));
  };

  const handleDocTypeChange = (idx, value) => {
    setUploadedFiles(prev => prev.map((f, i) => i === idx ? { ...f, docType: value } : f));
  };

  const handleSubmit = async () => {
    if (!validateStep(3)) return;

    // Validate all required documents are uploaded
    const docErrors = {};
    const requiredSlots = REQUIRED_DOC_SLOTS.filter(s => s.required);
    for (const slot of requiredSlots) {
      const hasFile = uploadedFiles.some(f => f.slotKey === slot.key);
      if (!hasFile) {
        docErrors[`doc_${slot.key}`] = `${slot.label} is required`;
      }
    }
    if (Object.keys(docErrors).length > 0) {
      setErrors(prev => ({ ...prev, ...docErrors }));
      return;
    }

    setIsProcessing(true);

    try {

      const ticketResult = await submitTicket(formData);
      setAgentResult(ticketResult);



      if (uploadedFiles.length > 0 && ticketResult?.applicationId) {
        const total = uploadedFiles.length;


        setUploadedFiles(prev => prev.map(f => ({ ...f, status: 'uploading', error: null })));
        setUploadStatus({ uploading: true, message: `Uploading ${total} document(s)…` });

        let okCount = 0;
        const errs = [];
        try {
          const res = await uploadApplicationDocuments(
            ticketResult.applicationId,
            uploadedFiles.map(u => u.file),
            uploadedFiles.map(u => u.docType),
          );
          const uploadedNames = new Set((res?.uploaded || []).map(u => u.filename));
          okCount = uploadedNames.size;

          setUploadedFiles(prev => prev.map(f =>
            uploadedNames.has(f.file.name)
              ? { ...f, status: 'uploaded' }
              : { ...f, status: 'failed', error: 'Upload failed' }
          ));
          if (res?.errors?.length) errs.push(...res.errors);
        } catch (upErr) {
          const msg = String(upErr?.message || upErr);
          errs.push(msg);
          setUploadedFiles(prev => prev.map(f => ({ ...f, status: 'failed', error: msg })));
        }

        setUploadStatus({
          uploading: false,
          message: `${okCount} of ${total} document(s) uploaded`,
          count: okCount,
          errors: errs,
        });
      }



      let autoResult = null;
      if (ticketResult?.ticketId) {
        try {
          // Wrap in a race so a slow/unreachable backend doesn't keep the
          // submit button stuck on "Processing..." forever. The pipeline
          // runs fire-and-forget inside autoProcessTicket anyway, so timing
          // out here doesn't lose any work — the RM page will pick up the
          // agent outputs once they land in BQ/localStorage.
          const timeout = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('autoProcessTicket timed out')), 15000)
          );
          autoResult = await Promise.race([
            autoProcessTicket(ticketResult.ticketId),
            timeout,
          ]);
        } catch (apErr) {
          console.error('Auto-process failed:', apErr);
        }
      }

      onSubmit({ ...formData, _ticket: ticketResult, _auto: autoResult });
      setIsProcessing(false);
      setCurrentStep(5);
    } catch (err) {
      console.error('Submission error:', err);
      setIsProcessing(false);
      alert('Failed to submit application. Please make sure the server is running and try again.');
    }
  };


  const states = [
    'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware',
    'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky',
    'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi',
    'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey', 'New Mexico',
    'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania',
    'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont',
    'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming', 'District of Columbia',
    'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat',
    'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh',
    'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan',
    'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
    'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu',
    'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry'
  ];

  const businessTypes = [
    'Sole Proprietorship',
    'Partnership',
    'Limited Partnership',
    'C Corporation',
    'S Corporation',
    'Limited Liability Company (LLC)',
    'Business Individual',
    'Non-Profit'
  ];

  const industries = [
    'Manufacturing',
    'Wholesale',
    'Retail',
    'Service',
    'Agricultural',
    'Construction',
    'Healthcare',
    'Technology',
    'Other'
  ];

  const loanPurposes = [
    'Working Capital', 'Equipment Purchase', 'Business Expansion',
    'Real Estate', 'Inventory', 'Refinancing', 'Other',
  ];

  const currencies = [
    { code: 'USD', symbol: '$', label: 'US Dollar ($)' },
  ];

  return (
    <div className="intake-page">
      <ApplicationProgress currentStep={currentStep} totalSteps={5} steps={[
        { id: 1, label: 'Business Info', shortLabel: '1' },
        { id: 2, label: 'Owner Info', shortLabel: '2' },
        { id: 3, label: 'Loan Details', shortLabel: '3' },
        { id: 4, label: 'Documents', shortLabel: '4' },
        { id: 5, label: 'Submitted', shortLabel: '5' },
      ]} />

      <div className="intake-container">
        <div className="intake-header">
          <div className="agent-banner" style={{textAlign: 'left', marginBottom: 24}}>
            <div className="agent-avatar">🤖</div>
            <div className="agent-banner-info">
              
              <div className="agent-banner-desc">Complete your business and owner information to get started with your loan application.</div>
            </div>
            {/* <div className={`agent-status-pill ${currentStep === 5 ? 'complete' : isProcessing ? 'processing' : 'active'}`}>
              {currentStep === 5 ? '✅ Submitted' : isProcessing ? 'Processing...' : 'Assisting'}
            </div> */}
          </div>
          {/* <h1>Let's check if you've borrowed from us before</h1> */}
          {/* <p>Complete your business and owner information to get started with your loan application.</p> */}
        </div>

        {}
        {currentStep === 1 && (
          <div className="intake-step">
            <div className="card">
              <h2 className="form-section-title">About the business</h2>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Business Legal Name *</label>
                  <input
                    type="text"
                    name="businessLegalName"
                    value={formData.businessLegalName}
                    onChange={handleInputChange}
                    className={`form-input ${errors.businessLegalName ? 'error' : ''}`}
                    placeholder="e.g., Acme Food Products"
                  />
                  {errors.businessLegalName && <span className="form-error">{errors.businessLegalName}</span>}
                </div>

                <div className="form-group">
                  <label className="form-label">DBA (Doing Business As)</label>
                  <input
                    type="text"
                    name="dba"
                    value={formData.dba}
                    onChange={handleInputChange}
                    className="form-input"
                    placeholder="If different from legal name"
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Business Tax ID (EIN) *</label>
                  <input
                    type="text"
                    name="businessTaxId"
                    value={formData.businessTaxId}
                    onChange={handleInputChange}
                    className={`form-input ${errors.businessTaxId ? 'error' : ''}`}
                    placeholder="XX-XXXXXXX"
                  />
                  {errors.businessTaxId && <span className="form-error">{errors.businessTaxId}</span>}
                </div>

                <div className="form-group">
                  <label className="form-label">Business Type</label>
                  <select
                    name="businessType"
                    value={formData.businessType}
                    onChange={handleInputChange}
                    className="form-input"
                  >
                    <option value="">Select business type</option>
                    {businessTypes.map(type => (
                      <option key={type} value={type}>{type}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group" style={{ flex: 2 }}>
                  <label className="form-label">Business Address *</label>
                  <input
                    type="text"
                    name="businessAddress"
                    value={formData.businessAddress}
                    onChange={handleInputChange}
                    className={`form-input ${errors.businessAddress ? 'error' : ''}`}
                    placeholder="Street address"
                  />
                  {errors.businessAddress && <span className="form-error">{errors.businessAddress}</span>}
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">City *</label>
                  <input
                    type="text"
                    name="city"
                    value={formData.city}
                    onChange={handleInputChange}
                    className={`form-input ${errors.city ? 'error' : ''}`}
                  />
                  {errors.city && <span className="form-error">{errors.city}</span>}
                </div>

                <div className="form-group">
                  <label className="form-label">State *</label>
                  <select
                    name="state"
                    value={formData.state}
                    onChange={handleInputChange}
                    className={`form-input ${errors.state ? 'error' : ''}`}
                  >
                    <option value="">Select</option>
                    {states.map(state => (
                      <option key={state} value={state}>{state}</option>
                    ))}
                  </select>
                  {errors.state && <span className="form-error">{errors.state}</span>}
                </div>

                <div className="form-group">
                  <label className="form-label">ZIP Code *</label>
                  <input
                    type="text"
                    name="zipCode"
                    value={formData.zipCode}
                    onChange={handleInputChange}
                    className={`form-input ${errors.zipCode ? 'error' : ''}`}
                    placeholder="XXXXX"
                  />
                  {errors.zipCode && <span className="form-error">{errors.zipCode}</span>}
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Business Phone</label>
                  <input
                    type="tel"
                    name="businessPhone"
                    value={formData.businessPhone}
                    onChange={handleInputChange}
                    className="form-input"
                    placeholder="(XXX) XXX-XXXX"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Business Email</label>
                  <input
                    type="email"
                    name="businessEmail"
                    value={formData.businessEmail}
                    onChange={handleInputChange}
                    className="form-input"
                    placeholder="email@business.com"
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Date Established</label>
                  <input
                    type="date"
                    name="dateEstablished"
                    value={formData.dateEstablished}
                    onChange={handleInputChange}
                    className="form-input"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Industry</label>
                  <select
                    name="industry"
                    value={formData.industry}
                    onChange={handleInputChange}
                    className="form-input"
                  >
                    <option value="">Select industry</option>
                    {industries.map(ind => (
                      <option key={ind} value={ind}>{ind}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Number of Employees</label>
                  <input
                    type="number"
                    name="numberOfEmployees"
                    value={formData.numberOfEmployees}
                    onChange={handleInputChange}
                    className="form-input"
                    placeholder="e.g., 12"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Annual Revenue</label>
                  <input
                    type="text"
                    name="annualRevenue"
                    value={formData.annualRevenue}
                    onChange={handleInputChange}
                    className="form-input"
                    placeholder="$"
                  />
                </div>
              </div>
            </div>

            <div className="step-actions">
              <button className="btn btn-secondary" disabled>Back</button>
              <button className="btn btn-primary" onClick={handleNext}>
                Next: Owner Details
                <span style={{marginLeft: 8}}>→</span>
              </button>
            </div>
          </div>
        )}

        {}
        {currentStep === 2 && (
          <div className="intake-step">
            <div className="card">
              <h2 className="form-section-title">About the business owner</h2>

              <div className="alert alert-info">
                <span className="alert-icon">ℹ️</span>
                <div className="alert-content">
                  <div className="alert-title">ID verification check</div>
                  <div className="alert-message">
                    The name you provide <strong>must</strong> match your ID exactly for ID verification to be successful.
                  </div>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">First Name *</label>
                  <input
                    type="text"
                    name="ownerFirstName"
                    value={formData.ownerFirstName}
                    onChange={handleInputChange}
                    className={`form-input ${errors.ownerFirstName ? 'error' : ''}`}
                    placeholder="First name"
                  />
                  {errors.ownerFirstName && <span className="form-error">{errors.ownerFirstName}</span>}
                </div>

                <div className="form-group">
                  <label className="form-label">Middle Name/Initial</label>
                  <input
                    type="text"
                    name="ownerMiddleName"
                    value={formData.ownerMiddleName}
                    onChange={handleInputChange}
                    className="form-input"
                    placeholder="Middle name"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Last Name *</label>
                  <input
                    type="text"
                    name="ownerLastName"
                    value={formData.ownerLastName}
                    onChange={handleInputChange}
                    className={`form-input ${errors.ownerLastName ? 'error' : ''}`}
                    placeholder="Last name"
                  />
                  {errors.ownerLastName && <span className="form-error">{errors.ownerLastName}</span>}
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Social Security Number *</label>
                  <input
                    type="password"
                    name="ownerSSN"
                    value={formData.ownerSSN}
                    onChange={handleInputChange}
                    className={`form-input ${errors.ownerSSN ? 'error' : ''}`}
                    placeholder="XXX-XX-XXXX"
                  />
                  {errors.ownerSSN && <span className="form-error">{errors.ownerSSN}</span>}
                </div>

                <div className="form-group">
                  <label className="form-label">Date of Birth *</label>
                  <input
                    type="date"
                    name="ownerDateOfBirth"
                    value={formData.ownerDateOfBirth}
                    onChange={handleInputChange}
                    className={`form-input ${errors.ownerDateOfBirth ? 'error' : ''}`}
                  />
                  {errors.ownerDateOfBirth && <span className="form-error">{errors.ownerDateOfBirth}</span>}
                </div>

                <div className="form-group">
                  <label className="form-label">Ownership Percentage *</label>
                  <input
                    type="number"
                    name="ownershipPercentage"
                    value={formData.ownershipPercentage}
                    onChange={handleInputChange}
                    className={`form-input ${errors.ownershipPercentage ? 'error' : ''}`}
                    placeholder="%"
                    min="0"
                    max="100"
                  />
                  {errors.ownershipPercentage && <span className="form-error">{errors.ownershipPercentage}</span>}
                </div>
              </div>

              <div className="form-row">
                <div className="form-group" style={{ flex: 2 }}>
                  <label className="form-label">Home Address</label>
                  <input
                    type="text"
                    name="ownerAddress"
                    value={formData.ownerAddress}
                    onChange={handleInputChange}
                    className="form-input"
                    placeholder="Street address"
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">City</label>
                  <input
                    type="text"
                    name="ownerCity"
                    value={formData.ownerCity}
                    onChange={handleInputChange}
                    className="form-input"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">State</label>
                  <select
                    name="ownerState"
                    value={formData.ownerState}
                    onChange={handleInputChange}
                    className="form-input"
                  >
                    <option value="">Select</option>
                    {states.map(state => (
                      <option key={state} value={state}>{state}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">ZIP Code</label>
                  <input
                    type="text"
                    name="ownerZip"
                    value={formData.ownerZip}
                    onChange={handleInputChange}
                    className="form-input"
                    placeholder="$"
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Phone Number</label>
                  <input
                    type="tel"
                    name="ownerPhone"
                    value={formData.ownerPhone}
                    onChange={handleInputChange}
                    className="form-input"
                    placeholder="(XXX) XXX-XXXX"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Email Address</label>
                  <input
                    type="email"
                    name="ownerEmail"
                    value={formData.ownerEmail}
                    onChange={handleInputChange}
                    className="form-input"
                    placeholder="email@example.com"
                  />
                </div>
              </div>
            </div>

            <div className="step-actions">
              <button className="btn btn-secondary" onClick={handleBack}>
                <span style={{marginRight: 8}}>←</span>
                Back
              </button>
              <button className="btn btn-primary" onClick={handleNext}>
                Next: Loan Details
                <span style={{marginLeft: 8}}>→</span>
              </button>
            </div>
          </div>
        )}

        {}
        {currentStep === 3 && (
          <div className="intake-step">
            <div className="card">
              <h2 className="form-section-title">Loan Details</h2>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Purpose of Loan *</label>
                  <select
                    name="loanPurpose"
                    value={formData.loanPurpose}
                    onChange={handleInputChange}
                    className={`form-input ${errors.loanPurpose ? 'error' : ''}`}
                  >
                    <option value="">Select loan purpose</option>
                    {loanPurposes.map(purpose => (
                      <option key={purpose} value={purpose}>{purpose}</option>
                    ))}
                  </select>
                  {errors.loanPurpose && <span className="form-error">{errors.loanPurpose}</span>}
                </div>

                <div className="form-group">
                  <label className="form-label">Requested Amount *</label>
                  <div style={{display: 'flex', gap: 8}}>
                    <select
                      name="loanCurrency"
                      value={formData.loanCurrency || 'USD'}
                      onChange={handleInputChange}
                      style={{width: 130, flexShrink: 0}}
                      className="form-input"
                    >
                      {currencies.map(c => (
                        <option key={c.code} value={c.code}>{c.label}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      name="loanAmount"
                      value={formData.loanAmount}
                      onChange={handleInputChange}
                      className={`form-input ${errors.loanAmount ? 'error' : ''}`}
                      placeholder="$ Amount"
                    />
                  </div>
                  {errors.loanAmount && <span className="form-error">{errors.loanAmount}</span>}
                </div>

                <div className="form-group">
                  <label className="form-label">Preferred Term</label>
                  <select
                    name="loanTerm"
                    value={formData.loanTerm}
                    onChange={handleInputChange}
                    className="form-input"
                  >
                    <option value="">Select term</option>
                    <option value="12">12 months</option>
                    <option value="24">24 months</option>
                    <option value="36">36 months</option>
                    <option value="48">48 months</option>
                    <option value="60">60 months</option>
                    <option value="84">84 months</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="card">
              <h2 className="form-section-title">Consents & Authorization</h2>

              <div className="checkbox-group">
                <label className="checkbox-item">
                  <input
                    type="checkbox"
                    name="consentCredit"
                    checked={formData.consentCredit}
                    onChange={handleInputChange}
                    className="checkbox-input"
                  />
                  <span className="checkbox-label">
                    I authorize the lender to obtain my credit report and verify my information for the purpose of this loan application. *
                  </span>
                </label>
                {errors.consentCredit && <span className="form-error" style={{ marginLeft: 28 }}>{errors.consentCredit}</span>}

                <label className="checkbox-item">
                  <input
                    type="checkbox"
                    name="consentTerms"
                    checked={formData.consentTerms}
                    onChange={handleInputChange}
                    className="checkbox-input"
                  />
                  <span className="checkbox-label">
                    I have read and agree to the Terms and Conditions and Privacy Policy. *
                  </span>
                </label>
                {errors.consentTerms && <span className="form-error" style={{ marginLeft: 28 }}>{errors.consentTerms}</span>}

                <label className="checkbox-item">
                  <input
                    type="checkbox"
                    name="consentPrivacy"
                    checked={formData.consentPrivacy}
                    onChange={handleInputChange}
                    className="checkbox-input"
                  />
                  <span className="checkbox-label">
                    I consent to receive communications about my application via email and phone.
                  </span>
                </label>
              </div>
            </div>

            <div className="step-actions">
              <button className="btn btn-secondary" onClick={handleBack}>
                <span style={{marginRight: 8}}>←</span>
                Back
              </button>
              <button
                className="btn btn-primary"
                onClick={handleNext}
              >
                <span style={{marginRight: 8}}>📎</span>
                Next: Upload Documents
                <span style={{marginLeft: 8}}>→</span>
              </button>
            </div>
          </div>
        )}

        {}
        {currentStep === 4 && (
          <div className="intake-step">
            <div className="card">
              <h2 className="form-section-title">Upload Required Documents</h2>
              <p style={{color: '#666', fontSize: 14, marginBottom: 20}}>
                All documents below are <strong>required</strong> before you can submit your application. Each document will be validated by the Document Intake Agent.
              </p>

              {/* Per-slot upload fields */}
              <div style={{display: 'flex', flexDirection: 'column', gap: 16}}>
                {REQUIRED_DOC_SLOTS.map((slot) => {
                  const uploaded = uploadedFiles.find(f => f.slotKey === slot.key);
                  const hasError = errors[`doc_${slot.key}`];
                  return (
                    <div key={slot.key} style={{
                      border: `2px solid ${hasError ? '#fca5a5' : uploaded ? '#86efac' : '#e2e8f0'}`,
                      borderRadius: 12,
                      padding: 16,
                      background: uploaded ? '#f0fdf4' : hasError ? '#fef2f2' : '#f8fafc',
                      transition: 'all 0.2s',
                    }}>
                      <div style={{display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8}}>
                        <span style={{fontSize: 28}}>{slot.icon}</span>
                        <div style={{flex: 1}}>
                          <div style={{fontWeight: 700, fontSize: 14, color: '#1e293b'}}>
                            {slot.label} <span style={{color: '#dc2626'}}>*</span>
                          </div>
                          <div style={{fontSize: 12, color: '#64748b', marginTop: 2}}>{slot.hint}</div>
                        </div>
                        {uploaded && (
                          <span style={{fontSize: 11, fontWeight: 700, color: '#15803d', background: '#dcfce7', padding: '4px 10px', borderRadius: 12}}>
                            ✓ Ready
                          </span>
                        )}
                      </div>

                      {uploaded ? (
                        <div style={{display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: '#fff', border: '1px solid #bbf7d0', borderRadius: 8}}>
                          <span style={{fontSize: 18}}>📄</span>
                          <div style={{flex: 1, minWidth: 0}}>
                            <div style={{fontSize: 13, fontWeight: 600, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>
                              {uploaded.file.name}
                            </div>
                            <div style={{fontSize: 11, color: '#64748b'}}>
                              {(uploaded.file.size / 1024).toFixed(1)} KB · {slot.docType}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setUploadedFiles(prev => prev.filter(f => f.slotKey !== slot.key));
                              if (errors[`doc_${slot.key}`]) setErrors(prev => ({ ...prev, [`doc_${slot.key}`]: null }));
                            }}
                            style={{background: 'transparent', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 16, padding: 4}}
                            title="Remove"
                          >✕</button>
                        </div>
                      ) : (
                        <div>
                          <input
                            type="file"
                            id={`doc-slot-${slot.key}`}
                            accept={slot.accept}
                            style={{display: 'none'}}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                handleSlotFileSelected(slot, file);
                                if (errors[`doc_${slot.key}`]) setErrors(prev => ({ ...prev, [`doc_${slot.key}`]: null }));
                              }
                              e.target.value = '';
                            }}
                          />
                          <label htmlFor={`doc-slot-${slot.key}`} style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                            background: '#fff',
                            color: '#2563eb',
                            border: '1px solid #2563eb',
                            padding: '8px 16px',
                            borderRadius: 8,
                            fontSize: 13,
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}>
                            📁 Choose File
                          </label>
                          {hasError && (
                            <span className="form-error" style={{display: 'block', marginTop: 6}}>{hasError}</span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Upload progress summary */}
              <div style={{
                marginTop: 20,
                padding: 14,
                background: uploadedFiles.filter(f => REQUIRED_DOC_SLOTS.some(s => s.key === f.slotKey)).length === REQUIRED_DOC_SLOTS.length ? '#f0fdf4' : '#fef9c3',
                border: `1px solid ${uploadedFiles.filter(f => REQUIRED_DOC_SLOTS.some(s => s.key === f.slotKey)).length === REQUIRED_DOC_SLOTS.length ? '#bbf7d0' : '#fde68a'}`,
                borderRadius: 8,
                fontSize: 13,
                color: '#334155',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}>
                <span style={{fontSize: 16}}>
                  {uploadedFiles.filter(f => REQUIRED_DOC_SLOTS.some(s => s.key === f.slotKey)).length === REQUIRED_DOC_SLOTS.length ? '✅' : '⚠️'}
                </span>
                <strong>{uploadedFiles.filter(f => REQUIRED_DOC_SLOTS.some(s => s.key === f.slotKey)).length} of {REQUIRED_DOC_SLOTS.length}</strong> required documents uploaded.
                {uploadedFiles.filter(f => REQUIRED_DOC_SLOTS.some(s => s.key === f.slotKey)).length < REQUIRED_DOC_SLOTS.length &&
                  <span style={{color: '#b45309'}}> All documents must be uploaded before submission.</span>
                }
              </div>
            </div>

            <div className="step-actions">
              <button className="btn btn-secondary" onClick={handleBack}>
                <span>←</span>
                Back
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSubmit}
                disabled={isProcessing}
              >
                {isProcessing ? (
                  <>
                    <div className="spinner"></div>
                    Processing...
                  </>
                ) : (
                  <>
                    Submit Application
                    <span>→</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {}
        {currentStep === 5 && agentResult && (
          <div className="intake-step">
            <div className="card" style={{textAlign: 'center', padding: '48px 32px'}}>
              <div style={{fontSize: 64, marginBottom: 16}}>✅</div>
              <h2 className="form-section-title" style={{marginBottom: 8}}>
                Application Submitted Successfully!
              </h2>
              <p style={{color: '#666', fontSize: 15, marginBottom: 24, maxWidth: 500, margin: '0 auto 24px'}}>
                Your loan application has been submitted and is now <strong>pending manager review</strong>.
                You will be notified once it is reviewed.
              </p>

              <div style={{background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 12, padding: 20, marginBottom: 24, maxWidth: 400, margin: '0 auto 24px'}}>
                <div style={{fontSize: 13, color: '#666', marginBottom: 4}}>Application ID</div>
                <div style={{fontSize: 18, fontWeight: 700, color: '#16a34a'}}>{agentResult.applicationId}</div>
                <div style={{fontSize: 13, color: '#666', marginTop: 8, marginBottom: 4}}>Status</div>
                <span style={{
                  display: 'inline-block',
                  padding: '4px 14px',
                  borderRadius: 20,
                  fontSize: 13,
                  fontWeight: 600,
                  background: '#fef3c7',
                  color: '#92400e',
                }}>
                  ⏳ {agentResult.status}
                </span>
              </div>

              {uploadStatus && (
                <div style={{
                  background: uploadStatus.errors && uploadStatus.errors.length > 0 ? '#fef2f2' : '#eff6ff',
                  border: `1px solid ${uploadStatus.errors && uploadStatus.errors.length > 0 ? '#fecaca' : '#bfdbfe'}`,
                  borderRadius: 10,
                  padding: 14,
                  marginBottom: 24,
                  maxWidth: 500,
                  margin: '0 auto 24px',
                  fontSize: 13,
                  color: '#1e40af',
                  textAlign: 'left',
                }}>
                  <strong>📎 Documents:</strong> {uploadStatus.message}
                  {uploadStatus.errors && uploadStatus.errors.length > 0 && (
                    <ul style={{margin: '6px 0 0 18px', color: '#b91c1c'}}>
                      {uploadStatus.errors.map((e, i) => <li key={i}>{e}</li>)}
                    </ul>
                  )}
                </div>
              )}
            </div>

            <div className="step-actions">
              <button className="btn btn-primary" onClick={() => navigate('/portal')}>
                Go to My Portal
                <span>→</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CustomerIntakeAgent;
