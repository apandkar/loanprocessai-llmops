// ============================================================================
// DEMO DATA — completely isolated from the real backend / agent pipeline.
// ----------------------------------------------------------------------------
// Anything in this file is for showcase only. Demo applications never call the
// backend, never trigger agents, never upload documents. Every panel that
// renders for a demo case reads from the pre-baked output below.
//
// Identification rule:
//   - We keep an explicit allow-list of demo IDs (DEMO_APP_IDS / DEMO_TICKET_IDS
//     / DEMO_CASE_IDS). The IDs themselves use the same `APP-XXXXXX` /
//     `TKT-XXXXXX` / `CASE-XXXXXX` 6-hex format the backend emits, so demo
//     rows are visually indistinguishable from live ones in the UI.
// ============================================================================

// Stable, real-looking IDs for the 3 demo cases. Picked once and never
// regenerated so localStorage overrides keep working across sessions.
const MERIDIAN     = { app: 'APP-A14F2C', ticket: 'TKT-A14F2C', case: 'CASE-A14F2C' };
const PACIFIC      = { app: 'APP-B82E91', ticket: 'TKT-B82E91', case: 'CASE-B82E91' };
const SUMMIT       = { app: 'APP-C73D5A', ticket: 'TKT-C73D5A', case: 'CASE-C73D5A' };

const DEMO_APP_IDS    = new Set([MERIDIAN.app,    PACIFIC.app,    SUMMIT.app]);
const DEMO_TICKET_IDS = new Set([MERIDIAN.ticket, PACIFIC.ticket, SUMMIT.ticket]);
const DEMO_CASE_IDS   = new Set([MERIDIAN.case,   PACIFIC.case,   SUMMIT.case]);

// Ordered list of demo case IDs (Meridian, Pacific Coast, Summit) so the
// dashboard can enumerate them without hardcoding the IDs in the UI layer.
export const DEMO_CASE_ID_LIST = [MERIDIAN.case, PACIFIC.case, SUMMIT.case];

// ---------- ID allow-list helpers ----------
export function isDemoApplicationId(id) {
  return typeof id === 'string' && DEMO_APP_IDS.has(id);
}
export function isDemoTicketId(id) {
  return typeof id === 'string' && DEMO_TICKET_IDS.has(id);
}
export function isDemoCaseId(id) {
  return typeof id === 'string' && DEMO_CASE_IDS.has(id);
}
export function isAnyDemoId(id) {
  return isDemoApplicationId(id) || isDemoTicketId(id) || isDemoCaseId(id);
}

// applicationId -> caseId mapping. Caches keep it stable across sessions.
const APP_TO_CASE = {
  [MERIDIAN.app]: MERIDIAN.case,
  [PACIFIC.app]:  PACIFIC.case,
  [SUMMIT.app]:   SUMMIT.case,
};
export function demoCaseIdForApplication(applicationId) {
  return APP_TO_CASE[applicationId] || null;
}

// ============================================================================
// TICKETS — what the dashboard list shows.
// ============================================================================
export const DEMO_APPLICATIONS = [
  {
    ticketId: MERIDIAN.ticket,
    applicationId: MERIDIAN.app,
    status: 'Approved',
    completeness: 100,
    isDemo: true,
    formData: {
      businessLegalName: 'Meridian Healthcare Solutions LLC',
      dba: 'Meridian Health',
      businessTaxId: '82-4571936',
      businessType: 'Limited Liability Company',
      industry: 'Healthcare Services',
      businessAddress: '1250 Technology Drive, Suite 400',
      city: 'San Francisco',
      state: 'CA',
      zipCode: '94105',
      businessPhone: '(415) 555-8200',
      businessEmail: 'finance@meridianhealthcare.com',
      annualRevenue: '8500000',
      ownerFirstName: 'Sarah',
      ownerMiddleName: 'J',
      ownerLastName: 'Mitchell',
      ownerEmail: 'sarah.mitchell@meridianhealthcare.com',
      ownerPhone: '(415) 555-8201',
      ownershipPercentage: '65',
      loanAmount: '750000',
      loanCurrency: 'USD',
      loanPurpose: 'Equipment financing and facility expansion',
      loanTerm: '60',
    },
    documents: [],
    createdAt: '2026-04-15T10:30:00Z',
    updatedAt: '2026-04-20T14:45:00Z',
    reviewedBy: 'Jennifer Adams',
    reviewNote: 'Strong financials, approved for equipment financing',
    businessLegalName: 'Meridian Healthcare Solutions LLC',
    loanAmount: '750000',
    loanPurpose: 'Equipment financing and facility expansion',
    ownerEmail: 'sarah.mitchell@meridianhealthcare.com',
  },
  {
    ticketId: PACIFIC.ticket,
    applicationId: PACIFIC.app,
    status: 'Under Review',
    completeness: 75,
    isDemo: true,
    formData: {
      businessLegalName: 'Pacific Coast Manufacturing Inc.',
      dba: 'PCM Industries',
      businessTaxId: '94-3287561',
      businessType: 'Corporation',
      industry: 'Manufacturing',
      businessAddress: '8900 Industrial Boulevard',
      city: 'Los Angeles',
      state: 'CA',
      zipCode: '90021',
      businessPhone: '(213) 555-4500',
      businessEmail: 'accounting@pcmindustries.com',
      annualRevenue: '12000000',
      ownerFirstName: 'Michael',
      ownerMiddleName: 'R',
      ownerLastName: 'Thompson',
      ownerEmail: 'm.thompson@pcmindustries.com',
      ownerPhone: '(213) 555-4501',
      ownershipPercentage: '51',
      loanAmount: '1500000',
      loanCurrency: 'USD',
      loanPurpose: 'Working capital and inventory expansion',
      loanTerm: '48',
    },
    documents: [],
    createdAt: '2026-05-01T09:15:00Z',
    updatedAt: '2026-05-10T16:20:00Z',
    reviewedBy: null,
    reviewNote: null,
    businessLegalName: 'Pacific Coast Manufacturing Inc.',
    loanAmount: '1500000',
    loanPurpose: 'Working capital and inventory expansion',
    ownerEmail: 'm.thompson@pcmindustries.com',
  },
  {
    ticketId: SUMMIT.ticket,
    applicationId: SUMMIT.app,
    status: 'Pending Review',
    completeness: 45,
    isDemo: true,
    formData: {
      businessLegalName: 'Summit Technology Partners LLC',
      dba: 'Summit Tech',
      businessTaxId: '76-8924103',
      businessType: 'Limited Liability Company',
      industry: 'Information Technology',
      businessAddress: '500 Innovation Way, Floor 12',
      city: 'Austin',
      state: 'TX',
      zipCode: '78701',
      businessPhone: '(512) 555-7800',
      businessEmail: 'finance@summittech.io',
      annualRevenue: '5200000',
      ownerFirstName: 'David',
      ownerMiddleName: 'K',
      ownerLastName: 'Chen',
      ownerEmail: 'david.chen@summittech.io',
      ownerPhone: '(512) 555-7801',
      ownershipPercentage: '70',
      loanAmount: '500000',
      loanCurrency: 'USD',
      loanPurpose: 'Software development and talent acquisition',
      loanTerm: '36',
    },
    documents: [],
    createdAt: '2026-05-12T14:00:00Z',
    updatedAt: '2026-05-12T14:00:00Z',
    reviewedBy: null,
    reviewNote: null,
    businessLegalName: 'Summit Technology Partners LLC',
    loanAmount: '500000',
    loanPurpose: 'Software development and talent acquisition',
    ownerEmail: 'david.chen@summittech.io',
  },
];

// ============================================================================
// DOCUMENTS — what the DocReader / KYC tabs show as "files on file".
// ============================================================================
function buildDemoDocs(prefix, files) {
  return files.map((f, i) => ({
    documentId: `${prefix}-DOC-${String(i + 1).padStart(3, '0')}`,
    filename: f.filename,
    docType: f.docType,
    sizeBytes: f.sizeBytes,
    gcsUri: `gs://demo-bucket/${prefix}/${f.filename}`,
    uploadedAt: f.uploadedAt,
  }));
}

const DEMO_DOCUMENTS = {
  [MERIDIAN.app]: buildDemoDocs(MERIDIAN.app, [
    { filename: 'meridian-articles-of-organization.pdf', docType: 'Certificate of Incorporation', sizeBytes: 184320, uploadedAt: '2026-04-15T10:32:00Z' },
    { filename: 'meridian-ein-cp575.pdf',                docType: 'Business EIN / Tax ID',          sizeBytes: 98304,  uploadedAt: '2026-04-15T10:33:00Z' },
    { filename: 'meridian-utility-bill-2026Q1.pdf',      docType: 'Proof of Address',                sizeBytes: 156672, uploadedAt: '2026-04-15T10:34:00Z' },
    { filename: 'mitchell-drivers-license.pdf',          docType: 'Government Photo ID',             sizeBytes: 122880, uploadedAt: '2026-04-15T10:35:00Z' },
    { filename: 'meridian-financial-statements-2024-2025.pdf', docType: 'Financial Statements',     sizeBytes: 524288, uploadedAt: '2026-04-15T10:38:00Z' },
    { filename: 'meridian-tax-returns-2023-2025.pdf',    docType: 'Tax Returns',                     sizeBytes: 712704, uploadedAt: '2026-04-15T10:40:00Z' },
  ]),
  [PACIFIC.app]: buildDemoDocs(PACIFIC.app, [
    { filename: 'pcm-articles-of-incorporation.pdf', docType: 'Certificate of Incorporation', sizeBytes: 209920, uploadedAt: '2026-05-01T09:18:00Z' },
    { filename: 'pcm-ein-letter.pdf',                docType: 'Business EIN / Tax ID',          sizeBytes: 86016,  uploadedAt: '2026-05-01T09:19:00Z' },
    { filename: 'pcm-lease-agreement.pdf',           docType: 'Proof of Address',                sizeBytes: 245760, uploadedAt: '2026-05-01T09:21:00Z' },
    { filename: 'thompson-passport.pdf',             docType: 'Government Photo ID',             sizeBytes: 132096, uploadedAt: '2026-05-01T09:22:00Z' },
    { filename: 'pcm-balance-sheet-2025.pdf',        docType: 'Financial Statements',            sizeBytes: 412672, uploadedAt: '2026-05-01T09:25:00Z' },
    { filename: 'pcm-income-statement-2024-2025.pdf', docType: 'Financial Statements',           sizeBytes: 376832, uploadedAt: '2026-05-01T09:26:00Z' },
  ]),
  [SUMMIT.app]: buildDemoDocs(SUMMIT.app, [
    { filename: 'summit-articles-of-organization.pdf', docType: 'Certificate of Incorporation', sizeBytes: 178176, uploadedAt: '2026-05-12T14:02:00Z' },
    { filename: 'summit-ein-cp575.pdf',                docType: 'Business EIN / Tax ID',          sizeBytes: 92160,  uploadedAt: '2026-05-12T14:03:00Z' },
    { filename: 'summit-coworking-membership.pdf',     docType: 'Proof of Address',                sizeBytes: 102400, uploadedAt: '2026-05-12T14:04:00Z' },
    { filename: 'chen-drivers-license.pdf',            docType: 'Government Photo ID',             sizeBytes: 116736, uploadedAt: '2026-05-12T14:05:00Z' },
    { filename: 'summit-financials-2024-2025.pdf',     docType: 'Financial Statements',            sizeBytes: 294912, uploadedAt: '2026-05-12T14:08:00Z' },
  ]),
};

export function getDemoDocuments(applicationId) {
  return DEMO_DOCUMENTS[applicationId] || [];
}

const DEMO_DOC_SUMMARIES = {
  // Meridian
  [`${MERIDIAN.app}-DOC-001`]: 'Articles of Organization filed with the California Secretary of State on March 14, 2018. Confirms Meridian Healthcare Solutions LLC as a domestic LLC in good standing. Registered agent: CT Corporation System.',
  [`${MERIDIAN.app}-DOC-002`]: 'IRS Form CP-575 confirming EIN 82-4571936 issued to Meridian Healthcare Solutions LLC on April 02, 2018. Entity type: LLC. Mailing address matches application.',
  [`${MERIDIAN.app}-DOC-003`]: 'PG&E utility bill dated March 2026 addressed to Meridian Healthcare Solutions LLC at 1250 Technology Drive, Suite 400, San Francisco CA 94105. Matches application address.',
  [`${MERIDIAN.app}-DOC-004`]: 'California driver license for Sarah J. Mitchell. DOB 1979-08-22. Issued 2023-09-12, expires 2028-09-12. Photo and signature legible. Verified against application owner record.',
  [`${MERIDIAN.app}-DOC-005`]: 'Reviewed audited financial statements for fiscal years 2024 and 2025. FY2025 revenue $8.5M (+11.8% YoY), EBITDA $1.62M (19.1% margin), net income $940K. Strong liquidity (current ratio 2.4) and conservative leverage (D/E 0.42).',
  [`${MERIDIAN.app}-DOC-006`]: 'Federal tax returns (Form 1065) for tax years 2023, 2024 and 2025. Reported income consistent with audited financials within ±2%. No outstanding tax liens identified.',
  // Pacific Coast
  [`${PACIFIC.app}-DOC-001`]: 'Articles of Incorporation filed with the California Secretary of State on June 09, 2009. Confirms Pacific Coast Manufacturing Inc. as a C-corporation in good standing.',
  [`${PACIFIC.app}-DOC-002`]: 'IRS EIN confirmation letter for EIN 94-3287561 issued to Pacific Coast Manufacturing Inc. on July 18, 2009.',
  [`${PACIFIC.app}-DOC-003`]: 'Commercial lease agreement for 8900 Industrial Boulevard, Los Angeles CA 90021. 60,000 sqft warehouse + office. Lease runs through 2029-04-30. Rent $48K/month.',
  [`${PACIFIC.app}-DOC-004`]: 'United States passport for Michael R. Thompson. DOB 1971-04-15. Issued 2022-06-04, expires 2032-06-03. Photo verified.',
  [`${PACIFIC.app}-DOC-005`]: 'Balance sheet as of FY-end 2025. Total assets $9.8M, total liabilities $5.6M, equity $4.2M. Inventory $2.9M (flagged: rising vs. prior year). Receivables $1.7M. No off-balance-sheet exposures disclosed.',
  [`${PACIFIC.app}-DOC-006`]: 'Income statements FY2024–FY2025. Revenue $11.2M → $12.0M (+7.1%). Gross margin compressed from 31.2% to 28.4% on raw-material cost increases. Operating income $1.05M, net income $620K.',
  // Summit
  [`${SUMMIT.app}-DOC-001`]: 'Articles of Organization filed with the Texas Secretary of State on November 22, 2020. Summit Technology Partners LLC active and in good standing.',
  [`${SUMMIT.app}-DOC-002`]: 'IRS CP-575 confirming EIN 76-8924103 issued to Summit Technology Partners LLC on December 04, 2020.',
  [`${SUMMIT.app}-DOC-003`]: 'WeWork co-working membership agreement for 500 Innovation Way, Floor 12, Austin TX 78701. Active through 2026-12-31. Acceptable as proof of business presence.',
  [`${SUMMIT.app}-DOC-004`]: 'Texas driver license for David K. Chen. DOB 1985-02-09. Issued 2024-01-18, expires 2030-02-09. Verified against owner record.',
  [`${SUMMIT.app}-DOC-005`]: 'Compiled financial statements FY2024–FY2025. Revenue $4.1M → $5.2M (+26.8%). EBITDA $580K (11.2% margin). Cash $310K, R&D capitalized $420K. Limited tangible collateral.',
};

export function getDemoDocumentSummary(documentId) {
  const text = DEMO_DOC_SUMMARIES[documentId];
  if (!text) return null;
  return {
    document_id: documentId,
    summary: text,
  };
}

// ============================================================================
// FULL CASE PAYLOADS — the agent outputs each demo case will display.
// Each case has DIFFERENT financials, ratios, decisions, narratives.
// ============================================================================

// ---------- CASE 1: Meridian Healthcare — APPROVED, low risk ----------
const CASE_001 = (() => {
  const ticket = DEMO_APPLICATIONS[0];
  const f = ticket.formData;
  return {
    ticketId: ticket.ticketId,
    case: {
      caseId: MERIDIAN.case,
      applicationId: ticket.applicationId,
      formData: f,
      status: 'Approved',
      statusType: 'approved',
      completeness: { overall: 100 },
      assignedTo: 'Jennifer Adams',
      createdAt: '2026-04-15T10:30:00Z',
      updatedAt: '2026-04-20T14:45:00Z',
      documentChecklist: [],
      timeline: [
        { date: '2026-04-15T10:30:00Z', event: 'Application submitted', actor: 'Sarah Mitchell' },
        { date: '2026-04-15T10:42:00Z', event: 'Pre-approval pipeline complete', actor: 'AI Pipeline' },
        { date: '2026-04-20T14:45:00Z', event: 'Underwriter approved', actor: 'Jennifer Adams' },
        { date: '2026-04-20T14:46:00Z', event: 'Closing package assembled', actor: 'Loan Package Agent' },
      ],
      kycApproved: true,
    },
    intake: {
      intakeId: 'INTAKE-A14F2C',
      status: 'complete',
      docsClassified: 6,
      markdown: '## Intake Summary\n\nAll 6 expected documents received and classified. Owner identity, business identity, address, and full financial pack are present. No follow-up needed before underwriting.',
    },
    kyc: {
      kycId: 'KYC-A14F2C',
      status: 'passed',
      completeness: 100,
      sanctions: { listsChecked: 5, overallStatus: 'CLEAR' },
      pepCheck: { status: 'NOT A PEP' },
      adverseMedia: { hits: 0, details: 'No adverse mentions in last 36 months' },
      creditScore: { score: 782, rating: 'GOOD' },
      industryRisk: { riskLevel: 'LOW', sector: 'Healthcare Services' },
      flags: [],
      kycChecklist: [
        { name: 'Articles of Organization',  status: 'verified', filename: 'meridian-articles-of-organization.pdf', extractedData: 'CA LLC, formed 2018-03-14, in good standing.' },
        { name: 'Business EIN (CP-575)',      status: 'verified', filename: 'meridian-ein-cp575.pdf',                extractedData: 'EIN 82-4571936 confirmed.' },
        { name: 'Proof of Business Address',  status: 'verified', filename: 'meridian-utility-bill-2026Q1.pdf',      extractedData: 'PG&E utility bill matching application address.' },
        { name: 'Owner Photo ID',             status: 'verified', filename: 'mitchell-drivers-license.pdf',          extractedData: 'CA driver license for Sarah J. Mitchell, current.' },
        { name: 'Beneficial Ownership',       status: 'verified', extractedData: 'Sarah J. Mitchell — 65% ownership disclosed and confirmed.' },
      ],
      markdown: '## Compliance Position\n\nAll five mandatory KYC checks pass with no flags. The borrower clears OFAC, UN, EU, UK and HMT sanctions screens, has no PEP exposure, and shows no adverse media in the prior 36 months. The Healthcare Services sector is rated LOW risk under bank policy. Recommend the file as **CLEARED FOR UNDERWRITING**.',
    },
    spreading: {
      spreadingId: 'SPR-A14F2C',
      status: 'complete',
      ratios: {
        current_ratio: 2.4,
        quick_ratio: 1.7,
        debt_to_equity: 0.42,
        DSCR: 2.15,
        ICR: 6.8,
        EBITDA_Margin: 19.1,
        profit_margin: 11.1,
      },
      summary: {
        overallConfidence: 92,
        riskLevel: 'Low',
        decision: 'APPROVE',
        pdPct: 0.85,
        lgdPct: 22.0,
        expectedLossPct: 0.19,
      },
      assessments: [
        { metric: 'Liquidity (Current Ratio)',   status: 'pass',    detail: '2.4x — well above 1.5x policy floor.' },
        { metric: 'Leverage (D/E)',              status: 'pass',    detail: '0.42x — conservative capital structure.' },
        { metric: 'Debt Service Coverage',       status: 'pass',    detail: 'DSCR 2.15x vs. 1.25x minimum.' },
        { metric: 'Profitability (EBITDA %)',    status: 'pass',    detail: '19.1% — above industry median 14%.' },
      ],
      anomalies: [],
      markdown: '## Spreading Commentary\n\nFY2025 revenue grew 11.8% to $8.5M with EBITDA expansion of 240 bps. Operating cash flow comfortably covers proposed debt service (DSCR 2.15x). Isolation Forest anomaly score 0.07 — well within the healthy band for healthcare services peers. PD scored at **0.85%** (Low band), LGD **22%** assuming standard equipment-secured facility. Recommend approval at the requested $750K with standard covenants.',
    },
    memo: {
      memoId: 'MEMO-A14F2C',
      summary: {
        internalRating: 'BBB+',
        pd: { value: 0.85, band: 'Low' },
        lgd: { value: 22.0, product: 'Equipment-secured term' },
        riskLevel: 'Low',
        recommendation: 'Approve',
        decisionHint: 'Strong financials, clean compliance, well-collateralised request.',
      },
      markdown: [
        '## 1. Borrower Overview',
        'Meridian Healthcare Solutions LLC is a California-domiciled LLC operating outpatient diagnostic imaging centers across the San Francisco Bay Area since 2018. The business is led by founder and 65% owner Sarah J. Mitchell. FY2025 revenue reached $8.5M with 47 FTEs.',
        '',
        '## 2. Facility Requested',
        '$750,000 60-month term loan to finance the acquisition of two new MRI/CT diagnostic units and the build-out of an additional Bay Area location.',
        '',
        '## 3. Purpose & Use of Funds',
        'Equipment purchase ($580K) and tenant-improvement / leasehold build-out ($170K). Both are productive uses tied to specific revenue-generating assets.',
        '',
        '## 4. Financial Highlights',
        '- Revenue $8.5M (+11.8% YoY)\n- EBITDA $1.62M (19.1% margin)\n- DSCR 2.15x · Current ratio 2.4x · D/E 0.42x',
        '',
        '## 5. KYC & Compliance Position',
        'All five mandatory KYC checks pass. No sanctions, PEP, adverse-media or credit-bureau concerns. Healthcare Services sector rated LOW risk.',
        '',
        '## 6. Strengths',
        '- Multi-year track record of double-digit revenue growth.\n- Strong cash generation supports facility comfortably.\n- Equipment provides clean collateral coverage.',
        '',
        '## 7. Weaknesses / Gaps',
        '- Customer concentration: top three payors represent 41% of revenue (acceptable for the segment).\n- Owner concentration in single sponsor.',
        '',
        '## 8. PD / LGD Analysis',
        'PD scored at 0.85% via the bank scorecard, placing the facility in the **Low** band. LGD modelled at 22% assuming first-lien on financed equipment with 75% advance rate.',
        '',
        '## 9. Underwriter Narrative',
        'The request is well-supported by historical performance and provides clean collateral coverage. Recommend approval at the requested amount with standard equipment-finance covenants.',
        '',
        '## 10. Missing Information',
        'None — file is complete.',
        '',
        '## 11. Review-Ready Summary',
        'Recommend **APPROVE** $750K, 60-month term, internal rating BBB+, pricing tier P3.',
      ].join('\n'),
    },
    decision: {
      decisionId: 'DEC-A14F2C',
      goNoGo: 'GO',
      agentRecommendation: 'Approve',
      internalRating: 'BBB+',
      pricingTier: 'P3 — Prime + 2.25%',
      pd: { value: 0.85, band: 'Low', policyText: 'Below 2.0% policy threshold for unsecured / equipment-secured facilities.' },
      lgd: { value: 22.0, product: 'Equipment-secured term', policyMin: 15, policyMax: 35, rejectAbove: 60 },
      agentRationale: 'Strong DSCR (2.15x) and conservative leverage support the requested facility. Equipment collateral provides clear loss mitigation. PD and LGD both within Low policy bands.',
      markdown: '## Detailed Decision\n\nThe Decision Agent recommends approval at the full requested amount of $750,000 over 60 months. Internal rating BBB+ and pricing tier P3 reflect the borrower\'s strong cash generation and conservative balance sheet. No exception or escalation required.',
      humanDecision: 'approved',
      humanDecisionBy: 'Jennifer Adams',
      humanDecisionAt: '2026-04-20T14:45:00Z',
      humanDecisionNotes: 'Concur with AI recommendation. Approved at requested amount with standard equipment-finance covenants.',
    },
    closing: {
      packageId: 'PKG-A14F2C',
      status: 'assembled',
      markdown: [
        '### Manager Decision',
        'Approved on 2026-04-20 by Jennifer Adams (Senior Credit Officer). Decision: **APPROVED** at the full requested amount of $750,000 for a 60-month term.',
        '',
        '### Why this decision is supported',
        'Borrower demonstrates a multi-year track record of profitable growth, strong DSCR (2.15x) and a conservative balance sheet. Collateral (financed diagnostic equipment) is well-aligned with the use of funds.',
        '',
        '### Alignment with AI Recommendation',
        'Underwriter sign-off is fully aligned with the Decision Agent\'s GO recommendation. No override applied.',
        '',
        '### Closing Package',
        '- Loan Agreement and Promissory Note (template T-EQ-2026)\n- Security Agreement (UCC-1 over financed equipment)\n- Personal guarantee — Sarah J. Mitchell (limited to facility amount)\n- Insurance assignment (lender as loss payee)\n- Disbursement instructions to vendor escrow',
        '',
        '### Final Loan Package Summary',
        'Facility $750,000 · Term 60 months · Pricing P3 (Prime + 2.25%) · Internal rating BBB+ · Equipment collateral (75% advance rate).',
        '',
        '### Closing Checklist',
        '- [x] Loan documents generated\n- [x] UCC-1 prepared\n- [x] Personal guarantee drafted\n- [x] Insurance binder requested\n- [ ] Borrower signatures pending',
        '',
        '### Closing Readiness',
        'Ready to proceed to signing. Funding window: 2026-04-25 onward.',
        '',
        '### Next Steps for the Manager',
        'Schedule the closing call with the borrower and request signed insurance binder before disbursement.',
      ].join('\n'),
    },
    phaseA: { status: 'complete', completedAt: '2026-04-15T10:42:00Z' },
    pipelineRanAt: '2026-04-15T10:42:00Z',
    pipelineStartedAt: '2026-04-15T10:30:30Z',
  };
})();

// ---------- CASE 2: Pacific Coast Manufacturing — APPROVE WITH CONDITIONS ----------
const CASE_002 = (() => {
  const ticket = DEMO_APPLICATIONS[1];
  const f = ticket.formData;
  return {
    ticketId: ticket.ticketId,
    case: {
      caseId: PACIFIC.case,
      applicationId: ticket.applicationId,
      formData: f,
      status: 'In Review',
      statusType: 'review',
      completeness: { overall: 80 },
      assignedTo: 'Daniel Park',
      createdAt: '2026-05-01T09:15:00Z',
      updatedAt: '2026-05-10T16:20:00Z',
      documentChecklist: [],
      timeline: [
        { date: '2026-05-01T09:15:00Z', event: 'Application submitted', actor: 'Michael Thompson' },
        { date: '2026-05-01T09:28:00Z', event: 'Pre-approval pipeline complete', actor: 'AI Pipeline' },
      ],
      kycApproved: true,
    },
    intake: {
      intakeId: 'INTAKE-B82E91',
      status: 'complete',
      docsClassified: 6,
      markdown: '## Intake Summary\n\nAll mandatory KYC documents and the latest balance sheet plus 2-year income statement received. Cash-flow statement and detailed debt schedule are not in the pack — flagged for follow-up if facility moves to closing.',
    },
    kyc: {
      kycId: 'KYC-B82E91',
      status: 'passed',
      completeness: 95,
      sanctions: { listsChecked: 5, overallStatus: 'CLEAR' },
      pepCheck: { status: 'NOT A PEP' },
      adverseMedia: { hits: 1, details: 'One historical article (2021) re: minor OSHA citation; cleared.' },
      creditScore: { score: 712, rating: 'GOOD' },
      industryRisk: { riskLevel: 'MODERATE', sector: 'Manufacturing — Industrial Goods' },
      flags: [
        { severity: 'Low', message: '2021 OSHA citation cited in adverse-media check; resolved with no fine.' },
      ],
      kycChecklist: [
        { name: 'Articles of Incorporation', status: 'verified', filename: 'pcm-articles-of-incorporation.pdf', extractedData: 'CA C-corp, formed 2009-06-09, in good standing.' },
        { name: 'Business EIN',               status: 'verified', filename: 'pcm-ein-letter.pdf',                extractedData: 'EIN 94-3287561 confirmed.' },
        { name: 'Proof of Business Address',  status: 'verified', filename: 'pcm-lease-agreement.pdf',           extractedData: 'Lease for 8900 Industrial Blvd, valid through 2029-04-30.' },
        { name: 'Owner Photo ID',             status: 'verified', filename: 'thompson-passport.pdf',             extractedData: 'US passport for Michael R. Thompson, current.' },
        { name: 'Beneficial Ownership',       status: 'verified', extractedData: '51% Michael Thompson; remaining 49% held by two passive investors (each <25%).' },
      ],
      markdown: '## Compliance Position\n\nKYC clears overall. One minor adverse-media item (2021 OSHA citation, resolved) noted but does not warrant escalation. Manufacturing sector carries MODERATE industry risk under bank policy. Recommend proceeding to underwriting with standard ongoing-monitoring obligations.',
    },
    spreading: {
      spreadingId: 'SPR-B82E91',
      status: 'complete',
      ratios: {
        current_ratio: 1.6,
        quick_ratio: 0.9,
        debt_to_equity: 1.35,
        DSCR: 1.42,
        ICR: 3.1,
        EBITDA_Margin: 9.8,
        profit_margin: 5.2,
      },
      summary: {
        overallConfidence: 81,
        riskLevel: 'Moderate',
        decision: 'APPROVE_WITH_CONDITIONS',
        pdPct: 2.40,
        lgdPct: 32.0,
        expectedLossPct: 0.77,
      },
      assessments: [
        { metric: 'Liquidity (Current Ratio)', status: 'pass',    detail: '1.6x — above policy floor of 1.5x.' },
        { metric: 'Quick Ratio',                status: 'warning', detail: '0.9x — below 1.0x; inventory-heavy balance sheet.' },
        { metric: 'Leverage (D/E)',             status: 'warning', detail: '1.35x — above 1.0x healthy threshold.' },
        { metric: 'Debt Service Coverage',      status: 'pass',    detail: 'DSCR 1.42x — above 1.25x minimum but limited cushion.' },
        { metric: 'Profitability (EBITDA %)',   status: 'warning', detail: '9.8% — below 12% industry median; margin compression noted.' },
      ],
      anomalies: [
        { severity: 'Medium', message: 'Inventory grew 18% YoY while revenue grew only 7% — possible overstock; investigate turnover.' },
        { severity: 'Low',    message: 'Receivables aging shifted: 60+ day buckets up 6 percentage points.' },
      ],
      markdown: '## Spreading Commentary\n\nFY2025 revenue $12.0M (+7.1%) with gross-margin compression of ~280 bps from raw-material cost inflation. DSCR of 1.42x covers the proposed debt service but the cushion is thinner than peer median. Isolation Forest flagged inventory-build vs. revenue mismatch. PD scored **2.40%** (Moderate band), LGD **32%** with mixed inventory + receivables collateral. Recommend **Approve with Conditions**: financial covenants on D/E and minimum DSCR, plus quarterly inventory reporting.',
    },
    memo: {
      memoId: 'MEMO-B82E91',
      summary: {
        internalRating: 'BB+',
        pd: { value: 2.40, band: 'Moderate' },
        lgd: { value: 32.0, product: 'Working-capital revolver' },
        riskLevel: 'Moderate',
        recommendation: 'Approve with conditions',
        decisionHint: 'Solid franchise but margin compression and inventory build warrant covenants.',
      },
      markdown: [
        '## 1. Borrower Overview',
        'Pacific Coast Manufacturing Inc. is a Los Angeles–based industrial fabricator (operating since 2009) producing custom metal components for aerospace and EV OEMs. 51% owner Michael R. Thompson serves as CEO. FY2025 revenue $12.0M with 86 employees.',
        '',
        '## 2. Facility Requested',
        '$1,500,000 48-month working-capital and inventory facility (revolver-style draw with quarterly clean-down).',
        '',
        '## 3. Purpose & Use of Funds',
        'Bridge a seasonal working-capital gap and finance an inventory build ahead of two contracted Q3 deliveries.',
        '',
        '## 4. Financial Highlights',
        '- Revenue $12.0M (+7.1% YoY)\n- EBITDA $1.18M (9.8% margin — compressed)\n- DSCR 1.42x · Current ratio 1.6x · D/E 1.35x',
        '',
        '## 5. KYC & Compliance Position',
        'KYC passes. One historical adverse-media item (2021 OSHA citation, resolved) noted; not material.',
        '',
        '## 6. Strengths',
        '- 16-year operating history with named OEM relationships.\n- Adequate DSCR even after margin compression.\n- Real-asset backing via inventory and receivables.',
        '',
        '## 7. Weaknesses / Gaps',
        '- Margin compression (~280 bps) on input-cost inflation.\n- Inventory grew 18% vs. revenue +7% — possible overstock.\n- Quick ratio 0.9x signals limited near-term liquidity outside inventory.',
        '',
        '## 8. PD / LGD Analysis',
        'PD scored at 2.40% (Moderate). LGD modelled at 32% reflecting working-capital advance against blended inventory + AR collateral.',
        '',
        '## 9. Underwriter Narrative',
        'Recommend approval **with conditions**: financial covenants on D/E (≤1.5x) and minimum DSCR (≥1.25x), quarterly inventory aging report, and borrowing base certificate at each draw.',
        '',
        '## 10. Missing Information',
        '- Full cash-flow statement (only summary received).\n- Detailed debt schedule.',
        '',
        '## 11. Review-Ready Summary',
        'Recommend **APPROVE WITH CONDITIONS** $1.5M revolver, 48-month tenor, internal rating BB+, pricing tier P5.',
      ].join('\n'),
    },
    decision: {
      decisionId: 'DEC-B82E91',
      goNoGo: 'CONDITIONAL GO',
      agentRecommendation: 'Approve with conditions',
      internalRating: 'BB+',
      pricingTier: 'P5 — Prime + 3.75%',
      pd: { value: 2.40, band: 'Moderate', policyText: 'Within 1.5%–4.0% Moderate band; pricing reflects elevated risk.' },
      lgd: { value: 32.0, product: 'Working-capital revolver', policyMin: 25, policyMax: 45, rejectAbove: 65 },
      agentRationale: 'Solid franchise and adequate DSCR but margin compression, leverage above 1.0x, and quick-ratio weakness justify financial covenants and a borrowing-base discipline before draw.',
      markdown: '## Detailed Decision\n\nThe Decision Agent recommends approval at the full $1.5M with the following conditions: (i) D/E covenant ≤1.5x, (ii) minimum DSCR 1.25x, (iii) quarterly inventory and AR aging certificates, (iv) borrowing base at each draw.',
      humanDecision: null,
      humanDecisionBy: null,
      humanDecisionAt: null,
      humanDecisionNotes: null,
    },
    closing: null, // Closing only assembles after underwriter sign-off.
    phaseA: { status: 'complete', completedAt: '2026-05-01T09:28:00Z' },
    pipelineRanAt: '2026-05-01T09:28:00Z',
    pipelineStartedAt: '2026-05-01T09:15:30Z',
  };
})();

// ---------- CASE 3: Summit Technology Partners — recommended APPROVE ----------
const CASE_003 = (() => {
  const ticket = DEMO_APPLICATIONS[2];
  const f = ticket.formData;
  return {
    ticketId: ticket.ticketId,
    case: {
      caseId: SUMMIT.case,
      applicationId: ticket.applicationId,
      formData: f,
      status: 'Pending Review',
      statusType: 'pending',
      completeness: { overall: 70 },
      assignedTo: 'Priya Raman',
      createdAt: '2026-05-12T14:00:00Z',
      updatedAt: '2026-05-12T14:18:00Z',
      documentChecklist: [],
      timeline: [
        { date: '2026-05-12T14:00:00Z', event: 'Application submitted', actor: 'David Chen' },
        { date: '2026-05-12T14:18:00Z', event: 'Pre-approval pipeline complete', actor: 'AI Pipeline' },
      ],
      kycApproved: true,
    },
    intake: {
      intakeId: 'INTAKE-C73D5A',
      status: 'complete',
      docsClassified: 5,
      markdown: '## Intake Summary\n\nMandatory KYC documents and a single combined financial pack received. No personal financial statement on file for the sponsor — flagged because of the smaller balance sheet.',
    },
    kyc: {
      kycId: 'KYC-C73D5A',
      status: 'passed',
      completeness: 90,
      sanctions: { listsChecked: 5, overallStatus: 'CLEAR' },
      pepCheck: { status: 'NOT A PEP' },
      adverseMedia: { hits: 0, details: 'No adverse mentions located.' },
      creditScore: { score: 745, rating: 'GOOD' },
      industryRisk: { riskLevel: 'MODERATE', sector: 'Information Technology — SaaS' },
      flags: [],
      kycChecklist: [
        { name: 'Articles of Organization', status: 'verified', filename: 'summit-articles-of-organization.pdf', extractedData: 'TX LLC, formed 2020-11-22, active.' },
        { name: 'Business EIN (CP-575)',     status: 'verified', filename: 'summit-ein-cp575.pdf',                extractedData: 'EIN 76-8924103 confirmed.' },
        { name: 'Proof of Business Address', status: 'verified', filename: 'summit-coworking-membership.pdf',     extractedData: 'WeWork membership at 500 Innovation Way through 2026-12-31.' },
        { name: 'Owner Photo ID',            status: 'verified', filename: 'chen-drivers-license.pdf',            extractedData: 'TX driver license for David K. Chen, current.' },
        { name: 'Beneficial Ownership',      status: 'verified', extractedData: '70% David Chen; 30% co-founder (passive).' },
      ],
      markdown: '## Compliance Position\n\nKYC clears with no flags. Information-technology / SaaS sector carries MODERATE industry risk under bank policy due to revenue-recognition complexity. Recommend proceeding to underwriting.',
    },
    spreading: {
      spreadingId: 'SPR-C73D5A',
      status: 'complete',
      ratios: {
        current_ratio: 1.9,
        quick_ratio: 1.5,
        debt_to_equity: 0.65,
        DSCR: 1.78,
        ICR: 4.2,
        EBITDA_Margin: 11.2,
        profit_margin: 6.4,
      },
      summary: {
        overallConfidence: 86,
        riskLevel: 'Low to Moderate',
        decision: 'APPROVE',
        pdPct: 1.45,
        lgdPct: 38.0,
        expectedLossPct: 0.55,
      },
      assessments: [
        { metric: 'Liquidity (Current Ratio)', status: 'pass', detail: '1.9x — comfortably above policy floor.' },
        { metric: 'Leverage (D/E)',            status: 'pass', detail: '0.65x — below 1.0x healthy threshold.' },
        { metric: 'Debt Service Coverage',     status: 'pass', detail: 'DSCR 1.78x — strong cushion.' },
        { metric: 'Profitability (EBITDA %)',  status: 'warning', detail: '11.2% — slightly below SaaS median 14% but improving.' },
        { metric: 'Revenue Growth',            status: 'pass', detail: '+26.8% YoY — top quartile vs. peers.' },
      ],
      anomalies: [
        { severity: 'Low', message: 'R&D capitalization $420K — verify accounting policy at closing.' },
      ],
      markdown: '## Spreading Commentary\n\nRevenue grew 26.8% to $5.2M with EBITDA margin expanding from 9.6% to 11.2%. DSCR comfortable at 1.78x. Limited tangible collateral is the principal risk consideration. Isolation Forest score 0.21 — within healthy band. PD **1.45%** (Low–Moderate), LGD **38%** reflecting limited collateral. Recommend approval at the requested $500K with a personal guarantee.',
    },
    memo: {
      memoId: 'MEMO-C73D5A',
      summary: {
        internalRating: 'BB',
        pd: { value: 1.45, band: 'Low to Moderate' },
        lgd: { value: 38.0, product: 'Unsecured term + PG' },
        riskLevel: 'Low to Moderate',
        recommendation: 'Approve',
        decisionHint: 'Strong growth and DSCR; thin collateral mitigated via sponsor guarantee.',
      },
      markdown: [
        '## 1. Borrower Overview',
        'Summit Technology Partners LLC is an Austin-based B2B SaaS company providing developer-tooling for cloud-native engineering teams. Founded in 2020. 70% owner David K. Chen is CEO. FY2025 revenue $5.2M with 32 employees.',
        '',
        '## 2. Facility Requested',
        '$500,000 36-month term loan to fund product engineering and a four-person sales hire.',
        '',
        '## 3. Purpose & Use of Funds',
        'Engineering headcount ($310K) and go-to-market expansion ($190K) — both directly aligned with the FY2026 revenue plan.',
        '',
        '## 4. Financial Highlights',
        '- Revenue $5.2M (+26.8% YoY)\n- EBITDA $580K (11.2% margin)\n- DSCR 1.78x · Current ratio 1.9x · D/E 0.65x',
        '',
        '## 5. KYC & Compliance Position',
        'KYC clears; no flags. SaaS sector rated MODERATE.',
        '',
        '## 6. Strengths',
        '- 26.8% top-line growth — top quartile vs. peers.\n- Comfortable DSCR cushion.\n- Disciplined leverage profile.',
        '',
        '## 7. Weaknesses / Gaps',
        '- Limited tangible collateral.\n- Smaller revenue base concentrates execution risk on the founder.',
        '',
        '## 8. PD / LGD Analysis',
        'PD scored at 1.45% (Low–Moderate). LGD modelled at 38% on a substantially unsecured basis, partially mitigated by full personal guarantee.',
        '',
        '## 9. Underwriter Narrative',
        'Recommend approval at the requested $500K with a full unconditional personal guarantee from David Chen and quarterly MRR / churn reporting.',
        '',
        '## 10. Missing Information',
        '- Sponsor personal financial statement (request prior to closing).',
        '',
        '## 11. Review-Ready Summary',
        'Recommend **APPROVE** $500K, 36-month term, internal rating BB, pricing tier P5, with PG and quarterly KPI reporting.',
      ].join('\n'),
    },
    decision: {
      decisionId: 'DEC-C73D5A',
      goNoGo: 'GO',
      agentRecommendation: 'Approve',
      internalRating: 'BB',
      pricingTier: 'P5 — Prime + 3.75%',
      pd: { value: 1.45, band: 'Low to Moderate', policyText: 'Within Low–Moderate band; pricing reflects unsecured profile.' },
      lgd: { value: 38.0, product: 'Unsecured term + PG', policyMin: 30, policyMax: 50, rejectAbove: 65 },
      agentRationale: 'High-growth SaaS profile with comfortable DSCR. Limited collateral is the principal risk; mitigated by sponsor PG and right-sized facility.',
      markdown: '## Detailed Decision\n\nThe Decision Agent recommends approval at the requested $500,000 over 36 months with: (i) full personal guarantee from David Chen, (ii) quarterly MRR / churn reporting, (iii) financial covenant on minimum DSCR 1.25x.',
      humanDecision: null,
      humanDecisionBy: null,
      humanDecisionAt: null,
      humanDecisionNotes: null,
    },
    closing: null,
    phaseA: { status: 'complete', completedAt: '2026-05-12T14:18:00Z' },
    pipelineRanAt: '2026-05-12T14:18:00Z',
    pipelineStartedAt: '2026-05-12T14:00:30Z',
  };
})();

const DEMO_CASES = {
  [MERIDIAN.case]: CASE_001,
  [PACIFIC.case]:  CASE_002,
  [SUMMIT.case]:   CASE_003,
};

export function getDemoCase(caseId) {
  return DEMO_CASES[caseId] || null;
}

// ============================================================================
// LOCAL OVERRIDE STORE
// Demo cases are read-only at module level. The user can still "Approve" or
// "Reject" a demo case in the UI — we record those edits in localStorage so
// the page reflects the action without ever hitting the backend.
// ============================================================================
const LS_DEMO_OVERRIDES = 'cl.demo.overrides';

function readOverrides() {
  try { return JSON.parse(localStorage.getItem(LS_DEMO_OVERRIDES) || '{}'); }
  catch { return {}; }
}
function writeOverrides(o) {
  try { localStorage.setItem(LS_DEMO_OVERRIDES, JSON.stringify(o)); } catch {}
}

export function getDemoOverride(caseId) {
  const all = readOverrides();
  return all[caseId] || null;
}

export function applyDemoHumanDecision(caseId, verdict, reviewer, notes) {
  const all = readOverrides();
  const v = String(verdict || '').toLowerCase();
  const isApproved = v === 'approved' || v === 'approve';
  all[caseId] = {
    ...(all[caseId] || {}),
    humanDecision: isApproved ? 'approved' : 'declined',
    humanDecisionBy: reviewer || 'Underwriter',
    humanDecisionAt: new Date().toISOString(),
    humanDecisionNotes: notes || '',
    closingAssembled: isApproved,
  };
  writeOverrides(all);
  return all[caseId];
}

export function clearDemoOverride(caseId) {
  const all = readOverrides();
  delete all[caseId];
  writeOverrides(all);
}

// Merge a base demo case payload with any persisted override (e.g. a manual
// approve/reject). Returns the same shape `getFullCase` normally returns.
export function getDemoCaseWithOverrides(caseId) {
  const base = getDemoCase(caseId);
  if (!base) return null;
  const ov = getDemoOverride(caseId);
  // Deep clone via JSON so we never mutate the canonical demo data.
  const out = JSON.parse(JSON.stringify(base));
  if (ov && ov.humanDecision) {
    out.decision = {
      ...(out.decision || {}),
      humanDecision: ov.humanDecision,
      humanDecisionBy: ov.humanDecisionBy,
      humanDecisionAt: ov.humanDecisionAt,
      humanDecisionNotes: ov.humanDecisionNotes,
    };
    if (ov.humanDecision === 'approved' && ov.closingAssembled && !out.closing) {
      out.closing = {
        packageId: `PKG-${caseId}`,
        status: 'assembled',
        markdown: [
          '### Manager Decision',
          `Approved on ${ov.humanDecisionAt?.slice(0, 10)} by ${ov.humanDecisionBy}.`,
          '',
          '### Closing Package',
          'Standard closing pack assembled (template T-EQ-2026). Loan agreement, security agreement, personal guarantee and insurance assignment generated.',
          '',
          '### Closing Readiness',
          'Ready to proceed to signing.',
        ].join('\n'),
      };
    }
    if (ov.humanDecision === 'declined') {
      out.closing = {
        packageId: `PKG-${caseId}`,
        status: 'declined',
        markdown: [
          '### Manager Decision',
          `Declined on ${ov.humanDecisionAt?.slice(0, 10)} by ${ov.humanDecisionBy}.`,
          ov.humanDecisionNotes ? `\n> "${ov.humanDecisionNotes}"` : '',
          '',
          '### Rejection Notice',
          'Borrower will receive a formal decline notice within five business days. No further action required.',
        ].join('\n'),
      };
    }
  }
  return out;
}
