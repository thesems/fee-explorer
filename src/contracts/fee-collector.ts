import type { providers } from "ethers";
import { FeeCollector__factory } from "lifi-contract-typings";

export interface ParsedFeeCollectedLog {
  tokenAddress: string;
  integrator: string;
  integratorFee: string;
  lifiFee: string;
}

const feeCollectorInterface = FeeCollector__factory.createInterface();
export const feesCollectedTopic =
  feeCollectorInterface.getEventTopic("FeesCollected");

export function parseFeesCollectedLog(
  log: providers.Log,
): ParsedFeeCollectedLog {
  const parsed = feeCollectorInterface.parseLog(log);
  return {
    tokenAddress: parsed.args._token.toLowerCase(),
    integrator: parsed.args._integrator.toLowerCase(),
    integratorFee: parsed.args._integratorFee.toString(),
    lifiFee: parsed.args._lifiFee.toString(),
  };
}
