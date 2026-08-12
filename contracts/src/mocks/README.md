# Contract mocks

This stands in for SparkDEX's V3.1 spot swap router, which has no live bytecode on Coston2 as of August 2026 (verified via `eth_getCode` against chain ID 114). Real SparkDEX V3 is confirmed live only on Flare mainnet (chain ID 14). SparkDEX Perps/Eternal on Coston2 does not serve spot FXRP/USDT0. Replace `MockSparkDexRouter` with the real `SwapRouter` address once SparkDEX deploys spot swap to Coston2, or move this integration to mainnet.

**MockKineticPool:** This is a stand-in for Kinetic, which has no usable Coston2 deployment as of this build. Replace with the real integration once Kinetic ships testnet parity or Mirror moves to mainnet.

**MockEnosysCDP:** This is a stand-in for Enosys, which has no usable Coston2 deployment as of this build. Real Enosys tests on Coston (Songbird), not Coston2. Replace with the real integration once Enosys ships testnet parity or Mirror moves to mainnet. Demo parameters are **not** real Enosys risk parameters.

**MockFirelightStrategy:** This is a stand-in for Firelight strategy wiring used by Mirror's passive tier. A real Firelight vault exists on Coston2 (`0xC90D6847747b85d1fa2E07859869fb9fB72c0361`) but passive-staking UX is out of MVP scope. Replace with the real integration once that tier ships or Mirror moves to mainnet.

Mainnet-only reference addresses (chain ID 14 — do **not** use on Coston2):

- SPARKDEX_SWAP_ROUTER=`0x8a1E35F5c98C4E85B36B7B253222eE17773b2781`
- SPARKDEX_V3_FACTORY=`0x8A2578d23d4C532cC9A98FaD91C0523f5efDE652`
- SPARKDEX_FXRP_USDT0_POOL=`0x88d46717b16619b37fa2dfd2f038defb4459f1f7`
- SPARKDEX_POOL_FEE=`500`
