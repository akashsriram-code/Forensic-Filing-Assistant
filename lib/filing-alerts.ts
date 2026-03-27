import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { matchesFilingType, searchFilings, type FilingResult } from '@/lib/filing-search';

interface EmailAlertConfig {
  toEmail: string;
  fromEmail: string;
  ticker: string;
  filingType: string;
  smtpHost: string;
  smtpPort: number;
  smtpUsername: string;
  smtpPassword: string;
  lookbackDays: number;
  statePath: string;
}

interface EmailAlertState {
  sentAccessionNumbers: string[];
  updatedAt?: string;
}

export interface EmailAlertJobResult {
  ok: true;
  ticker: string;
  filingType: string;
  matchingFilings: number;
  emailsSent: number;
  alreadySentSkipped: number;
  statePath: string;
}

export async function runEmailAlertJob(): Promise<EmailAlertJobResult> {
  const config = getEmailAlertConfig();
  const state = await loadState(config.statePath);

  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setUTCDate(startDate.getUTCDate() - config.lookbackDays);

  const filings = (await searchFilings({
    ticker: config.ticker,
    startDate: toIsoDate(startDate),
    endDate: toIsoDate(endDate),
    filingType: 'ALL',
  }))
    .filter((filing) => matchesFilingType(filing.form, config.filingType))
    .sort((a, b) => a.filingDate.localeCompare(b.filingDate));

  const known = new Set(state.sentAccessionNumbers);
  const newFilings = filings.filter((filing) => !known.has(filing.accessionNumber));

  if (newFilings.length > 0) {
    const transporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpPort === 465,
      auth: {
        user: config.smtpUsername,
        pass: config.smtpPassword,
      },
      requireTLS: config.smtpPort !== 465,
      tls: { minVersion: 'TLSv1.2' },
    });

    for (const filing of newFilings) {
      await sendFilingAlertEmail(transporter, config, filing);
      known.add(filing.accessionNumber);
    }
  }

  await saveState(config.statePath, {
    sentAccessionNumbers: Array.from(known).slice(-200),
    updatedAt: new Date().toISOString(),
  });

  return {
    ok: true,
    ticker: config.ticker,
    filingType: config.filingType,
    matchingFilings: filings.length,
    emailsSent: newFilings.length,
    alreadySentSkipped: filings.length - newFilings.length,
    statePath: config.statePath,
  };
}

function getEmailAlertConfig(): EmailAlertConfig {
  const toEmail = process.env.ALERT_EMAIL_TO?.trim();
  const smtpHost = process.env.SMTP_HOST?.trim();
  const smtpUsername = process.env.SMTP_USERNAME?.trim();
  const smtpPassword = process.env.SMTP_PASSWORD?.trim();
  const smtpPort = Number(process.env.SMTP_PORT || '587');
  const fromEmail = (process.env.FROM_EMAIL || smtpUsername || '').trim();
  const ticker = (process.env.EMAIL_ALERT_TARGET_TICKER || 'SBUX').trim().toUpperCase();
  const filingType = (process.env.EMAIL_ALERT_TARGET_TYPE || '8-K').trim().toUpperCase();
  const lookbackDays = Number(process.env.EMAIL_ALERT_LOOKBACK_DAYS || '2');
  const statePath = process.env.ALERT_STATE_PATH || path.join(process.cwd(), '.github', 'email-alert-state', 'state.json');

  if (!toEmail || !fromEmail || !smtpHost || !smtpUsername || !smtpPassword || Number.isNaN(smtpPort)) {
    throw new Error('Missing SMTP email alert configuration');
  }

  return {
    toEmail,
    fromEmail,
    ticker,
    filingType,
    smtpHost,
    smtpPort,
    smtpUsername,
    smtpPassword,
    lookbackDays,
    statePath,
  };
}

async function loadState(statePath: string): Promise<EmailAlertState> {
  try {
    const raw = await readFile(statePath, 'utf8');
    const parsed = JSON.parse(raw) as EmailAlertState;

    return {
      sentAccessionNumbers: Array.isArray(parsed.sentAccessionNumbers) ? parsed.sentAccessionNumbers : [],
      updatedAt: parsed.updatedAt,
    };
  } catch {
    return { sentAccessionNumbers: [] };
  }
}

async function saveState(statePath: string, state: EmailAlertState) {
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, JSON.stringify(state, null, 2), 'utf8');
}

async function sendFilingAlertEmail(
  transporter: nodemailer.Transporter,
  config: EmailAlertConfig,
  filing: FilingResult
) {
  const subject = `${config.ticker} filed ${filing.form} on ${filing.filingDate}`;

  const text = [
    'New SEC filing alert',
    '',
    `Ticker: ${config.ticker}`,
    `Form: ${filing.form}`,
    `Filed: ${filing.filingDate}`,
    `Description: ${filing.description || filing.primaryDocument}`,
    `Read filing: ${filing.downloadUrl}`,
  ].join('\n');

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111827;">
      <h2 style="margin-bottom: 12px;">New SEC filing alert</h2>
      <p><strong>Ticker:</strong> ${escapeHtml(config.ticker)}</p>
      <p><strong>Form:</strong> ${escapeHtml(filing.form)}</p>
      <p><strong>Filed:</strong> ${escapeHtml(filing.filingDate)}</p>
      <p><strong>Description:</strong> ${escapeHtml(filing.description || filing.primaryDocument)}</p>
      <p style="margin-top: 20px;">
        <a href="${filing.downloadUrl}" style="display: inline-block; padding: 10px 14px; background: #111827; color: #ffffff; text-decoration: none; border-radius: 6px;">
          Open filing
        </a>
      </p>
    </div>
  `;

  await transporter.sendMail({
    from: config.fromEmail,
    to: config.toEmail,
    subject,
    text,
    html,
  });
}

function toIsoDate(date: Date) {
  return date.toISOString().split('T')[0];
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
