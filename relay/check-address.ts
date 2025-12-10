
import { ShogunSDK } from "shogun-contracts-sdk";
import { ethers } from "ethers";
import { config } from "./src/config/env-config";

async function main() {
    const chainId = config.bridge.chainId;
    console.log(`Checking address for Chain ID: ${chainId}`);

    const sdk = new ShogunSDK({
        provider: new ethers.JsonRpcProvider("http://localhost:8545"), // Dummy provider
        chainId: chainId,
    });

    const bridge = sdk.getGunL2Bridge();
    const address = await bridge.getAddress();

    console.log(`SDK Resolved Address: ${address}`);
}

main().catch(console.error);
