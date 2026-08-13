/**
 * Malformed payment reference must not credit MirrorVault.
 */
import * as dotenv from "dotenv";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";
import { Client, Wallet } from "xrpl";
import { createPublicClient, http, parseAbi, getAddress, type Address, type Hex } from "viem";
import { coston2 } from "../lib/chain.ts";
import { encodeMalformedReference, paymentReferenceToMemoData } from "./encode-reference.ts";
import { attestXrplPayment, resolveMasterAccountController } from "../relayer/fdc-payment.ts";
import { createWalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: join(ROOT, ".env") });

async function main() {
  const seed = process.env.XRPL_FOLLOWER_FSA_1_SECRET;
  if (!seed) throw new Error("XRPL_FOLLOWER_FSA_1_SECRET required");
  const cfg = JSON.parse(readFileSync(join(ROOT, "config/coston2.json"), "utf8"));
  const operator = (process.env.XRPL_OPERATOR_ADDRESS || cfg.fsa?.xrplOperatorAddress) as string;
  if (!operator) throw new Error("XRPL_OPERATOR_ADDRESS missing");

  const wallet = Wallet.fromSeed(seed);
  const ref = encodeMalformedReference();
  const client = new Client(process.env.XRPL_TESTNET_RPC_URL ?? "wss://s.altnet.rippletest.net:51233");
  await client.connect();
  const prepared = await client.autofill({
    TransactionType: "Payment",
    Account: wallet.classicAddress,
    Destination: operator,
    Amount: "1500000",
    Memos: [{ Memo: { MemoData: paymentReferenceToMemoData(ref) } }],
  });
  const signed = wallet.sign(prepared);
  const result = await client.submitAndWait(signed.tx_blob);
  await client.disconnect();
  const txHash = result.result.hash!;
  console.log(`malformed payment ${txHash}`);

  const rpc = process.env.FLARE_RPC_URL ?? "https://coston2-api.flare.network/ext/C/rpc";
  const publicClient = createPublicClient({ chain: coston2, transport: http(rpc) });
  const mac = await resolveMasterAccountController();
  const personalAccount = (await publicClient.readContract({
    address: mac,
    abi: parseAbi(["function getPersonalAccount(string) view returns (address)"]),
    functionName: "getPersonalAccount",
    args: [wallet.classicAddress],
  })) as Address;

  const vault = getAddress(cfg.contracts.mirrorVault) as Address;
  const lead = getAddress(
    (cfg.fsa?.defaultLead as string) ||
      JSON.parse(readFileSync(join(ROOT, "config/accounts.testnet.json"), "utf8")).personas[
        "lead-trader-1"
      ].address,
  ) as Address;

  const balBefore = (await publicClient.readContract({
    address: vault,
    abi: parseAbi(["function getBalance(address,address) view returns (uint256)"]),
    functionName: "getBalance",
    args: [personalAccount, lead],
  })) as bigint;

  let reverted = false;
  try {
    const proof = await attestXrplPayment(txHash);
    const pk = (process.env.PERSONA_OPERATOR_RELAYER_PRIVATE_KEY ??
      process.env.DEPLOYER_PRIVATE_KEY ??
      process.env.PERSONA_DEPLOYER_PRIVATE_KEY) as Hex;
    const account = privateKeyToAccount(pk);
    const walletClient = createWalletClient({ account, chain: coston2, transport: http(rpc) });
    const data = proof.data as any;
    const proofTuple = {
      merkleProof: proof.merkleProof,
      data: {
        attestationType: data.attestationType,
        sourceId: data.sourceId,
        votingRound: data.votingRound,
        lowestUsedTimestamp: data.lowestUsedTimestamp,
        requestBody: data.requestBody,
        responseBody: data.responseBody,
      },
    };
    const hash = await walletClient.writeContract({
      address: mac,
      abi: parseAbi([
        "function executeInstruction((bytes32[] merkleProof,(bytes32 attestationType,bytes32 sourceId,uint64 votingRound,uint64 lowestUsedTimestamp,(bytes32 transactionId,uint256 inUtxo,uint256 utxo) requestBody,(uint64 blockNumber,uint64 blockTimestamp,bytes32 sourceAddressHash,bytes32 sourceAddressesRoot,bytes32 receivingAddressHash,bytes32 intendedReceivingAddressHash,int256 spentAmount,int256 intendedSpentAmount,int256 receivedAmount,int256 intendedReceivedAmount,bytes32 standardPaymentReference,bool oneToOne,uint8 status) responseBody) data) _proof, string _xrplAddress) payable",
      ]),
      functionName: "executeInstruction",
      args: [proofTuple as never, wallet.classicAddress],
      gas: 2_000_000n,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") reverted = true;
    else {
      // Instruction may "succeed" at MAC level but must not mint/credit Mirror vault
      console.log("executeInstruction mined — checking vault unchanged");
    }
  } catch {
    reverted = true;
    console.log("executeInstruction reverted as expected for malformed ref");
  }

  const balAfter = (await publicClient.readContract({
    address: vault,
    abi: parseAbi(["function getBalance(address,address) view returns (uint256)"]),
    functionName: "getBalance",
    args: [personalAccount, lead],
  })) as bigint;

  if (balAfter !== balBefore) {
    throw new Error(`Vault balance changed for malformed ref: ${balBefore} → ${balAfter}`);
  }
  console.log(
    JSON.stringify({ ok: true, revertedOrNoVaultCredit: true, balBefore: balBefore.toString(), txHash }, null, 2),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
