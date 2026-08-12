/**
 * Position health vs MockKinetic collateral ratio + FTSO-informed alert threshold.
 */
export type HealthStatus = "Healthy" | "Drift Detected" | "Liquidation Risk";

export type HealthSnapshot = {
  follower: string;
  lead: string;
  collateralRatioBps: number;
  alertBps: number;
  liquidateBps: number;
  status: HealthStatus;
  needsTopUp: boolean;
  suggestedTopUp: bigint;
};

export function liquidationAlertBps(): number {
  const n = Number(process.env.LIQUIDATION_ALERT_BPS ?? "13000");
  return Number.isFinite(n) ? n : 13000;
}

export function assessHealth(opts: {
  follower: string;
  lead: string;
  collateralRatioBps: number;
  /** Mock liquidate threshold (e.g. 11000). */
  liquidateBps?: number;
  alertBps?: number;
  drift?: boolean;
  /** Borrow outstanding in asset wei — used to size top-up. */
  borrowBalance?: bigint;
  supplyBalance?: bigint;
}): HealthSnapshot {
  const alertBps = opts.alertBps ?? liquidationAlertBps();
  const liquidateBps = opts.liquidateBps ?? 11000;
  const cr = opts.collateralRatioBps;

  let status: HealthStatus = "Healthy";
  if (opts.drift) status = "Drift Detected";
  // Alert BEFORE liquidation threshold (higher CR is safer; alert when CR drops below alert line)
  if (cr < alertBps) status = "Liquidation Risk";

  const needsTopUp = cr < alertBps && cr >= liquidateBps;
  let suggestedTopUp = 0n;
  if (needsTopUp && opts.borrowBalance && opts.borrowBalance > 0n) {
    // Target restoring CR to alertBps: supply' / borrow >= alert/10000
    const targetSupply = (opts.borrowBalance * BigInt(alertBps)) / 10000n;
    const current = opts.supplyBalance ?? 0n;
    suggestedTopUp = targetSupply > current ? targetSupply - current : 0n;
  }

  return {
    follower: opts.follower,
    lead: opts.lead,
    collateralRatioBps: cr,
    alertBps,
    liquidateBps,
    status,
    needsTopUp,
    suggestedTopUp,
  };
}
