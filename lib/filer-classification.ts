export type FilerType =
    | 'Pension / Public Fund'
    | 'University / Endowment'
    | 'Hedge Fund'
    | 'Asset Manager'
    | 'Investment Adviser'
    | 'Insurance'
    | 'Bank'
    | 'Other';

export interface FilerClassification {
    type: FilerType;
    reason: string;
}

const CIK_OVERRIDES: Record<string, FilerClassification> = {
    '0001067983': { type: 'Asset Manager', reason: 'Manual CIK override: Berkshire Hathaway' },
    '0001350694': { type: 'Hedge Fund', reason: 'Manual CIK override: Bridgewater Associates' },
    '0001423053': { type: 'Hedge Fund', reason: 'Manual CIK override: Renaissance Technologies' },
};

const NAME_RULES: Array<{ type: FilerType; pattern: RegExp; reason: string }> = [
    {
        type: 'Pension / Public Fund',
        pattern: /\b(PENSION|RETIREMENT|RETIREMENT SYSTEM|PUBLIC EMPLOYEES|TEACHERS RETIREMENT|STATE BOARD|CALPERS|CALSTRS|SUPERANNUATION)\b/i,
        reason: 'Name contains pension/public fund language',
    },
    {
        type: 'University / Endowment',
        pattern: /\b(UNIVERSITY|COLLEGE|ENDOWMENT|FOUNDATION|REGENTS)\b/i,
        reason: 'Name contains university/endowment language',
    },
    {
        type: 'Hedge Fund',
        pattern: /\b(HEDGE|CAPITAL MANAGEMENT|CAPITAL ADVISORS|PARTNERS|LP|L P|MASTER FUND|CITADEL|MILLENNIUM|TWO SIGMA|POINT72|SCULPTOR)\b/i,
        reason: 'Name contains hedge-fund style language',
    },
    {
        type: 'Asset Manager',
        pattern: /\b(ASSET MANAGEMENT|GLOBAL INVESTORS|INVESTMENT MANAGEMENT|MANAGEMENT CO|ADVISERS|ADVISORS|VANGUARD|BLACKROCK|STATE STREET|FIDELITY|T ROWE PRICE|INVESCO)\b/i,
        reason: 'Name contains asset-manager language',
    },
    {
        type: 'Investment Adviser',
        pattern: /\b(INVESTMENT ADVISER|INVESTMENT ADVISOR|WEALTH|FINANCIAL ADVISORS|RIA)\b/i,
        reason: 'Name contains investment-adviser language',
    },
    {
        type: 'Insurance',
        pattern: /\b(INSURANCE|ASSURANCE|REINSURANCE|LIFE INS|MUTUAL INS|PRUDENTIAL|METLIFE|AIG)\b/i,
        reason: 'Name contains insurance language',
    },
    {
        type: 'Bank',
        pattern: /\b(BANK|BANCORP|TRUST CO|TRUST COMPANY|NATIONAL ASSOCIATION|JPMORGAN|MORGAN STANLEY|GOLDMAN SACHS|CITIGROUP|WELLS FARGO)\b/i,
        reason: 'Name contains bank/trust language',
    },
];

export function classifyFiler(cik: string, fundName: string): FilerClassification {
    const normalizedCik = cik.replace(/\D/g, '').replace(/^0+/, '');
    const paddedCik = normalizedCik.padStart(10, '0');
    const override = CIK_OVERRIDES[paddedCik] || CIK_OVERRIDES[normalizedCik];
    if (override) return override;

    for (const rule of NAME_RULES) {
        if (rule.pattern.test(fundName)) {
            return { type: rule.type, reason: rule.reason };
        }
    }

    return { type: 'Other', reason: 'No manual CIK override or name rule matched' };
}
