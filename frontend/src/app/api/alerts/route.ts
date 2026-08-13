/**
 * In-app alert store so Vercel does not need a separate webhook process.
 * Serverless memory is best-effort (resets on cold start).
 */
export type MirrorAlert = {
  type: "drift" | "liquidation_risk" | "topup_executed" | "info";
  lead?: string;
  follower?: string;
  message: string;
  meta?: Record<string, unknown>;
  at: string;
};

const g = globalThis as typeof globalThis & { __mirrorAlerts?: MirrorAlert[] };
if (!g.__mirrorAlerts) g.__mirrorAlerts = [];

export async function GET() {
  return Response.json(g.__mirrorAlerts ?? [], {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Partial<MirrorAlert>;
  const alert: MirrorAlert = {
    type: body.type ?? "info",
    lead: body.lead,
    follower: body.follower,
    message: body.message ?? "",
    meta: body.meta,
    at: body.at ?? new Date().toISOString(),
  };
  g.__mirrorAlerts = [...(g.__mirrorAlerts ?? []), alert].slice(-50);
  return Response.json(alert);
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}
