// Feed IDs sourced from the official dev.flare.network/ftso/feeds list.
// For this MVP:
// - FXRP/USD is proxied by the official XRP/USD block-latency feed id.
// - USDT0/USD is proxied by the official USDT/USD block-latency feed id.
//
// IMPORTANT: These are `bytes21` values, represented as 0x-prefixed hex strings.

export const FXRP_USD_FEED_ID = "0x015852502f55534400000000000000000000000000" as const;
export const USDT0_USD_FEED_ID = "0x01555344542f555344000000000000000000000000" as const;

