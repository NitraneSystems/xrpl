import {
  clientsFromEnv,
  requestAttestation,
  waitForDaProof,
  toUtf8Bytes32,
  registryAddress,
} from "./fdc.ts";
import { keccak256, toBytes, type Hex } from "viem";

export type Web2JsonPrepareResult = {
  abiEncodedRequest: Hex;
  status?: string;
};

/**
 * Prepare a Web2Json attestation (PublicWeb2 on Coston2 — any HTTPS URL).
 * Verifier path: /verifier/web2/Web2Json/prepareRequest
 */
export async function prepareWeb2JsonRequest(opts: {
  url: string;
  postProcessJq: string;
  abiSignature: string;
  httpMethod?: string;
  headers?: string;
  queryParams?: string;
  body?: string;
}): Promise<Web2JsonPrepareResult> {
  const verifierBase = (process.env.FDC_VERIFIER_URL ?? "https://fdc-verifiers-testnet.flare.network").replace(
    /\/$/,
    ""
  );
  const apiKey = process.env.FDC_VERIFIER_API_KEY || "00000000-0000-0000-0000-000000000000";
  const endpoint = `${verifierBase}/verifier/web2/Web2Json/prepareRequest`;
  const request = {
    attestationType: toUtf8Bytes32("Web2Json"),
    sourceId: toUtf8Bytes32("PublicWeb2"),
    requestBody: {
      url: opts.url,
      httpMethod: opts.httpMethod ?? "GET",
      headers: opts.headers ?? "{}",
      queryParams: opts.queryParams ?? "{}",
      body: opts.body ?? "{}",
      postProcessJq: opts.postProcessJq,
      abiSignature: opts.abiSignature,
    },
  };
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    throw new Error(`Web2Json prepareRequest failed ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as Web2JsonPrepareResult;
}

export async function fetchMarketContext(): Promise<{
  defillamaTvlUsd: number;
  coingeckoVolHint: number;
  sourceUrls: string[];
}> {
  const llamaBase = (process.env.DEFILLAMA_API_BASE || "https://api.llama.fi").replace(/\/$/, "");
  const llamaUrl = `${llamaBase}/v2/historicalChainTvl/Flare`;
  const llamaRes = await fetch(llamaUrl);
  if (!llamaRes.ok) throw new Error(`DeFiLlama HTTP ${llamaRes.status}`);
  const llamaJson = (await llamaRes.json()) as Array<{ date: number; tvl: number }>;
  const last = llamaJson[llamaJson.length - 1];
  const defillamaTvlUsd = last?.tvl ?? 0;

  let coingeckoVolHint = 0;
  const cgKey = process.env.COINGECKO_API_KEY;
  try {
    const cgUrl = cgKey
      ? `https://pro-api.coingecko.com/api/v3/simple/price?ids=ripple&vs_currencies=usd&include_24hr_vol=true`
      : `https://api.coingecko.com/api/v3/simple/price?ids=ripple&vs_currencies=usd&include_24hr_vol=true`;
    const headers: Record<string, string> = {};
    if (cgKey) headers["x-cg-pro-api-key"] = cgKey;
    const cgRes = await fetch(cgUrl, { headers });
    if (cgRes.ok) {
      const j = (await cgRes.json()) as { ripple?: { usd_24h_vol?: number } };
      coingeckoVolHint = j.ripple?.usd_24h_vol ?? 0;
    }
  } catch {
    /* optional */
  }

  return {
    defillamaTvlUsd,
    coingeckoVolHint,
    sourceUrls: [llamaUrl, "https://api.coingecko.com/api/v3/simple/price"],
  };
}

/** Full Web2Json cycle against DeFiLlama Flare TVL; returns attestationId = keccak256(response_hex). */
export async function attestDefiLlamaTvl(): Promise<{
  attestationId: Hex;
  roundId: number;
  proof: { merkleProof: Hex[]; data: unknown };
  market: Awaited<ReturnType<typeof fetchMarketContext>>;
}> {
  const market = await fetchMarketContext();
  const { publicClient, wallet, account } = clientsFromEnv();

  const prepared = await prepareWeb2JsonRequest({
    url: `${(process.env.DEFILLAMA_API_BASE || "https://api.llama.fi").replace(/\/$/, "")}/v2/historicalChainTvl/Flare`,
    postProcessJq: ".|length",
    abiSignature: "uint256",
  });

  const submitted = await requestAttestation(publicClient, wallet, account, prepared.abiEncodedRequest);
  const raw = await waitForDaProof(publicClient, prepared.abiEncodedRequest, submitted.roundId);
  const attestationId = keccak256(toBytes(raw.response_hex as Hex)) as Hex;
  return {
    attestationId,
    roundId: submitted.roundId,
    proof: { merkleProof: raw.proof, data: raw.response_hex },
    market,
  };
}

/**
 * Phase 6 — Web2Json attestation for CoinGecko XRP 24h volume (FXRP volatility proxy).
 * Falls back to public API; set COINGECKO_API_KEY for pro endpoint.
 */
export async function attestCoinGeckoFxrpVol(): Promise<{
  attestationId: Hex;
  roundId: number;
  proof: { merkleProof: Hex[]; data: unknown };
  volumeUsd: number;
  url: string;
}> {
  const { publicClient, wallet, account } = clientsFromEnv();
  const cgKey = process.env.COINGECKO_API_KEY;
  const url = cgKey
    ? "https://pro-api.coingecko.com/api/v3/simple/price?ids=ripple&vs_currencies=usd&include_24hr_vol=true"
    : "https://api.coingecko.com/api/v3/simple/price?ids=ripple&vs_currencies=usd&include_24hr_vol=true";

  const prepared = await prepareWeb2JsonRequest({
    url,
    httpMethod: "GET",
    headers: cgKey ? JSON.stringify({ "x-cg-pro-api-key": cgKey }) : "{}",
    postProcessJq: ".ripple.usd_24h_vol // 0 | floor",
    abiSignature: "uint256",
  });

  const submitted = await requestAttestation(publicClient, wallet, account, prepared.abiEncodedRequest);
  const raw = await waitForDaProof(publicClient, prepared.abiEncodedRequest, submitted.roundId);
  const attestationId = keccak256(toBytes(raw.response_hex as Hex)) as Hex;

  let volumeUsd = 0;
  try {
    const market = await fetchMarketContext();
    volumeUsd = market.coingeckoVolHint;
  } catch {
    /* best-effort local hint */
  }

  return {
    attestationId,
    roundId: submitted.roundId,
    proof: { merkleProof: raw.proof, data: raw.response_hex },
    volumeUsd,
    url,
  };
}

export { clientsFromEnv, registryAddress };

async function cli() {
  const mode = (process.argv[2] ?? "defillama").toLowerCase();
  if (mode === "coingecko" || mode === "cg") {
    const r = await attestCoinGeckoFxrpVol();
    console.log(JSON.stringify({ attestationId: r.attestationId, roundId: r.roundId, volumeUsd: r.volumeUsd }, null, 2));
    return;
  }
  const r = await attestDefiLlamaTvl();
  console.log(JSON.stringify({ attestationId: r.attestationId, roundId: r.roundId, market: r.market }, null, 2));
}

if (process.argv[1]?.includes("fdc-web2json")) {
  cli().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
