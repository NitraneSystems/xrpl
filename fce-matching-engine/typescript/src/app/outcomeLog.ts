/**
 * Private outcome log for TEE-to-TEE reads by the AI agent FCE.
 * Never log plaintext signal fields here — only aggregate outcome metadata.
 */

export type OutcomeRecord = {
  lead: string;
  timestamp: number;
  pnlBps: number;
  direction: "BUY" | "SELL";
  sizePct: number;
};

const MAX_ENTRIES = 10_000;
const log: OutcomeRecord[] = [];

export function appendOutcome(rec: OutcomeRecord): void {
  log.push(rec);
  if (log.length > MAX_ENTRIES) {
    log.splice(0, log.length - MAX_ENTRIES);
  }
}

export function getOutcomesForLead(lead: string): OutcomeRecord[] {
  const lower = lead.toLowerCase();
  return log.filter((e) => e.lead.toLowerCase() === lower);
}

export function getAllOutcomes(): OutcomeRecord[] {
  return [...log];
}

export function clearOutcomeLog(): void {
  log.length = 0;
}
