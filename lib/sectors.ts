
// Heuristic mapping for major companies often found in 13F filings.
// In a real production app, this would query a market data API (e.g., Polygon, FMP).

const SECTOR_MAP: Record<string, string> = {
    "APPLE INC": "Information Technology",
    "MICROSOFT CORP": "Information Technology",
    "AMAZON COM INC": "Consumer Discretionary",
    "NVIDIA CORP": "Information Technology",
    "ALPHABET INC": "Communication Services",
    "META PLATFORMS INC": "Communication Services",
    "TESLA INC": "Consumer Discretionary",
    "BERKSHIRE HATHAWAY INC": "Financial Services",
    "JPMORGAN CHASE & CO": "Financial Services",
    "VISA INC": "Financial Services",
    "JOHNSON & JOHNSON": "Healthcare",
    "WALMART INC": "Consumer Defensive",
    "PROCTER & GAMBLE CO": "Consumer Defensive",
    "MASTERCARD INC": "Financial Services",
    "EXXON MOBIL CORP": "Energy",
    "CHEVRON CORP": "Energy",
    "HOME DEPOT INC": "Consumer Discretionary",
    "ABBVIE INC": "Healthcare",
    "MERCK & CO INC": "Healthcare",
    "COSTCO WHOLESALE CORP": "Consumer Defensive",
    "ADOBE INC": "Information Technology",
    "SALESFORCE INC": "Information Technology",
    "DISNEY WALT CO": "Communication Services",
    "CISCO SYSTEMS INC": "Technology",
    "NETFLIX INC": "Communication Services",
    "ADVANCED MICRO DEVICES": "Information Technology",
    "AMD": "Information Technology",
    "INTEL CORP": "Information Technology",
    "COCA COLA CO": "Consumer Defensive",
    "PEPSICO INC": "Consumer Defensive",
    "BANK OF AMERICA CORP": "Financial Services",
    "WELLS FARGO & CO": "Financial Services",
    "MCDONALDS CORP": "Consumer Discretionary",
    "NIKE INC": "Consumer Discretionary",
    "ELI LILLY & CO": "Healthcare",
    "BROADCOM INC": "Information Technology",
    "ORACLE CORP": "Information Technology",
    "UNITEDHEALTH GROUP INC": "Healthcare",
    "PFIZER INC": "Healthcare",
    "ABBOTT LABORATORIES": "Healthcare",
    "THERMO FISHER SCIENTIFIC": "Healthcare",
    "COMCAST CORP": "Communication Services",
    "VERIZON COMMUNICATIONS": "Communication Services",
    "AT&T INC": "Communication Services",
    "NEXTERA ENERGY INC": "Utilities",
    "CONSTELLATION ENERGY": "Utilities",
    "VISTRA": "Utilities",
    "NRG ENERGY": "Utilities",
    "SOUTHERN CO": "Utilities",
    "DUKE ENERGY": "Utilities",
    "AMERICAN ELECTRIC POWER": "Utilities",
    "EXELON": "Utilities",
    "PUBLIC SERVICE ENTERPRISE": "Utilities",
    "SEMPRA": "Utilities",
    "PG&E": "Utilities",
    "PG E": "Utilities",
    "ENTERGY": "Utilities",
    "DOMINION ENERGY": "Utilities",
    "XCEL ENERGY": "Utilities",
    "AES CORP": "Utilities",
    "UNION PACIFIC CORP": "Industrials",
    "UPS": "Industrials",
    "BOEING CO": "Industrials",
    "CAT": "Industrials",
    "GENERAL ELECTRIC": "Industrials",
    "GM": "Consumer Discretionary",
    "FORD": "Consumer Discretionary",
    "UBER": "Industrials",
    "AIRBNB": "Consumer Discretionary",
    "PALANTIR": "Information Technology",
    "SNOWFLAKE": "Information Technology",
    "SERVICENOW": "Information Technology",
    "DATADOG": "Information Technology",
    "MONGODB": "Information Technology",
    "CLOUDFLARE": "Information Technology",
    "ATLASSIAN": "Information Technology",
    "ZSCALER": "Information Technology",
    "CROWDSTRIKE": "Information Technology",
    "OKTA": "Information Technology",
    "TWILIO": "Information Technology",
    "HUBSPOT": "Information Technology",
    "WORKDAY": "Information Technology",
    "DOCUSIGN": "Information Technology",
    "BILL HOLDINGS": "Information Technology",
    "GITLAB": "Information Technology",
    "ELASTIC": "Information Technology",
    "SENTINELONE": "Information Technology",
    "ASANA": "Information Technology",
    "QUALCOMM": "Information Technology",
    "MICRON": "Information Technology",
    "TEXAS INSTRUMENTS": "Information Technology",
    "APPLIED MATERIALS": "Information Technology",
    "LAM RESEARCH": "Information Technology",
    "KLA": "Information Technology",
    "ASML": "Information Technology",
    "TAIWAN SEMICONDUCTOR": "Information Technology",
    "ARM HOLDINGS": "Information Technology",
    "MARVELL": "Information Technology",
    "ON SEMICONDUCTOR": "Information Technology",
    "ANALOG DEVICES": "Information Technology",
    "MICROCHIP TECHNOLOGY": "Information Technology",
    "ARISTA NETWORKS": "Information Technology",
    "VERTIV": "Industrials",
    "DELL": "Information Technology",
    "SUPER MICRO": "Information Technology",
    "HEWLETT PACKARD": "Information Technology",
    "IBM": "Information Technology",
    "EQUINIX": "Real Estate",
    "DIGITAL REALTY": "Real Estate",
    "IRON MOUNTAIN": "Real Estate",
    "AMERICAN TOWER": "Real Estate",
    "CROWN CASTLE": "Real Estate",
    "EATON": "Industrials",
    "QUANTA SERVICES": "Industrials",
    "BLUE OWL": "Financial Services",
    "OWL ROCK": "Financial Services",
    "ARES CAPITAL": "Financial Services",
    "ARES MANAGEMENT": "Financial Services",
    "KKR": "Financial Services",
    "FS KKR": "Financial Services",
    "BLACKSTONE SECURED LENDING": "Financial Services",
    "MAIN STREET CAPITAL": "Financial Services",
    "GOLUB CAPITAL": "Financial Services",
    "HERCULES CAPITAL": "Financial Services",
    "SIXTH STREET SPECIALTY LENDING": "Financial Services",
    "PROSPECT CAPITAL": "Financial Services",
    "BLOCK INC": "Financial Services",
    "PAYPAL": "Financial Services",
    "SPDR S&P 500 ETF TRUST": "ETF",
    "INVESCO QQQ TRUST": "ETF",
    "VANGUARD": "ETF",
    "ISHARES": "ETF"
};

export function getSector(issuer: string): string {
    const cleanName = issuer.toUpperCase().replace(/[.,]/g, '').trim();

    // 1. Direct Match
    if (SECTOR_MAP[cleanName]) return SECTOR_MAP[cleanName];

    // 2. Partial Match keys
    for (const key of Object.keys(SECTOR_MAP)) {
        if (cleanName.includes(key) || key.includes(cleanName)) {
            return SECTOR_MAP[key];
        }
    }

    // 3. Heuristics
    if (cleanName.includes("ETF") || cleanName.includes("ISHARES") || cleanName.includes("VANGUARD") || cleanName.includes("SPDR") || cleanName.includes("TRUST")) return "ETF";
    if (cleanName.includes("PHARMA") || cleanName.includes("THERAPEUTICS") || cleanName.includes("MEDICAL") || cleanName.includes("HEALTH")) return "Healthcare";
    if (cleanName.includes("TECHNOLOGIES") || cleanName.includes("SYSTEMS") || cleanName.includes("SOFTWARE") || cleanName.includes("SEMICONDUCTOR")) return "Information Technology";
    if (cleanName.includes("ENERGY") || cleanName.includes("OIL") || cleanName.includes("GAS") || cleanName.includes("PETROLEUM")) return "Energy";
    if (cleanName.includes("BANK") || cleanName.includes("FINANCIAL") || cleanName.includes("CAPITAL") || cleanName.includes("INVESTMENT")) return "Financial Services";
    if (cleanName.includes("UTILITY") || cleanName.includes("ELECTRIC") || cleanName.includes("POWER")) return "Utilities";
    if (cleanName.includes("REALTY") || cleanName.includes("REIT")) return "Real Estate";
    if (cleanName.includes("AIRLINES") || cleanName.includes("MOTORS") || cleanName.includes("AUTOMOTIVE")) return "Consumer Discretionary";

    return "Other";
}
