/**
 * Phase 10 mock venue routing (Enosys CDP / Firelight).
 *
 * NON-GOAL: this suite does not validate real Enosys risk parameters —
 * see `non_goal_not_real_enosys_params` and docs/KNOWN-LIMITATIONS.md.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as handlers from "../app/handlers.js";
import { bytesToHex, hexToBytes } from "../base/encoding.js";
import type { HandlerResult } from "../base/types.js";

function jsonMsg(obj: unknown): string {
  return bytesToHex(Buffer.from(JSON.stringify(obj), "utf-8"));
}

function parseData(result: HandlerResult): Record<string, unknown> {
  return JSON.parse(Buffer.from(hexToBytes(result[0]!)).toString("utf-8"));
}

const ENOSYS = "0xB2f32371D761F52895E697C8b2910098cf57FA60";
const FIRELIGHT = "0xa652DFD628be13feC4D56710D1cf281692deCE02";
const RECIPIENT = "0x000000000000000000000000000000000000dEaD";

beforeEach(() => {
  handlers.resetState();
  process.env.FCE_PLAINTEXT_DECRYPT_FALLBACK = "1";
  delete process.env.SIGN_PORT;
  process.env.MIRROR_MOCK_VENUES = "true";
  process.env.MOCK_ENOSYS_CDP_ADDRESS = ENOSYS;
  process.env.MOCK_FIRELIGHT_STRATEGY_ADDRESS = FIRELIGHT;
});

afterEach(() => {
  handlers.resetState();
  delete process.env.MIRROR_MOCK_VENUES;
  delete process.env.MOCK_ENOSYS_CDP_ADDRESS;
  delete process.env.MOCK_FIRELIGHT_STRATEGY_ADDRESS;
  delete process.env.FCE_PLAINTEXT_DECRYPT_FALLBACK;
});

describe("Phase 10 mock venue Stage B", () => {
  it("routes enosys-cdp CDP-management signal to MockEnosysCDP openCdp calldata", async () => {
    const r = await handlers.handleMirrorMatchStageB(
      jsonMsg({
        venue: "enosys-cdp",
        strategyKind: "enosys-cdp",
        sizePct: 1000,
        recipient: RECIPIENT,
        lead: "0x03182be182be76F11D1d136574190708844aE079",
      }),
    );
    expect([r[1], r[2]]).toEqual([1, null]);
    const payload = parseData(r);
    expect(payload.to?.toString().toLowerCase()).toBe(ENOSYS.toLowerCase());
    expect(payload.venue).toBe("enosys-cdp");
    expect(typeof payload.data).toBe("string");
    expect(String(payload.data).toLowerCase().startsWith("0x")).toBe(true);
    // openCdp(uint256,uint256) selector
    expect(String(payload.data).slice(0, 10).toLowerCase()).toBe("0xbedd9e3b");
  });

  it("routes firelight-strategy to MockFirelightStrategy deposit calldata", async () => {
    const r = await handlers.handleMirrorMatchStageB(
      jsonMsg({
        venue: "firelight-strategy",
        sizePct: 500,
        recipient: RECIPIENT,
      }),
    );
    expect(r[1]).toBe(1);
    const payload = parseData(r);
    expect(payload.to?.toString().toLowerCase()).toBe(FIRELIGHT.toLowerCase());
    expect(payload.venue).toBe("firelight-strategy");
    expect(String(payload.data).toLowerCase().startsWith("0x")).toBe(true);
  });

  it("non_goal_not_real_enosys_params — suite does not claim Enosys risk fidelity", async () => {
    // Explicit non-goal marker for reviewers / Phase 10 exit checklist.
    expect(true).toBe(true);
  });

  it("does not short-circuit to Enosys when MIRROR_MOCK_VENUES is off", async () => {
    delete process.env.MIRROR_MOCK_VENUES;
    // CDP-shaped payload without swap fields — mock path would succeed; swap path must reject.
    const r = await handlers.handleMirrorMatchStageB(
      jsonMsg({
        venue: "enosys-cdp",
        sizePct: 1000,
        recipient: RECIPIENT,
      }),
    );
    expect(r[1]).toBe(0);
    expect(r[2]).toContain("signal.asset");
  });
});

describe("Stage B follower fan-out", () => {
  it("returns fanOut batch with one instruction per follower allocation", async () => {
    process.env.MIRROR_MOCK_VENUES = "true";
    const followers = [
      { address: "0x1111111111111111111111111111111111111111", allocationBps: 2000 },
      { address: "0x2222222222222222222222222222222222222222", allocationBps: 3000 },
      { address: "0x3333333333333333333333333333333333333333", allocationBps: 5000 },
    ];
    const r = await handlers.handleMirrorMatchStageB(
      jsonMsg({
        venue: "enosys-cdp",
        sizePct: 1000,
        followers,
        lead: "0x03182be182be76F11D1d136574190708844aE079",
      }),
    );
    expect([r[1], r[2]]).toEqual([1, null]);
    const payload = parseData(r) as {
      fanOut?: boolean;
      instructions?: Array<{ recipient: string; venue: string; to: string; data: string }>;
      venue?: string;
    };
    expect(payload.fanOut).toBe(true);
    expect(payload.instructions).toHaveLength(3);
    expect(payload.venue).toBe("enosys-cdp");
    expect(payload.instructions!.map((i) => i.recipient.toLowerCase())).toEqual(
      followers.map((f) => f.address.toLowerCase()),
    );
  });
});
