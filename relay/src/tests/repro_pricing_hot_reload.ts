
import { getSubscriptionTiers } from "../utils/x402-merchant";
import { setRuntimeValue } from "../utils/runtime-config";

async function testHotReload() {
    console.log("--- Testing Pricing Hot-Reload ---");

    // 1. Get initial price
    const initialTiers = getSubscriptionTiers();
    const initialPrice = initialTiers.standard.priceUSDC;
    console.log(`Initial Standard Price: ${initialPrice}`);

    // 2. Update price via runtime config
    const newPrice = 9.99;
    console.log(`Updating SUB_STANDARD_PRICE to ${newPrice}...`);
    const success = setRuntimeValue("SUB_STANDARD_PRICE", newPrice.toString());

    if (!success) {
        console.error("Failed to set runtime value!");
        process.exit(1);
    }

    // 3. Get new price
    const newTiers = getSubscriptionTiers();
    const updatedPrice = newTiers.standard.priceUSDC;
    console.log(`Updated Standard Price: ${updatedPrice}`);

    // 4. Verify
    if (updatedPrice === newPrice) {
        console.log("✅ SUCCESS: Price updated dynamically!");
    } else {
        console.error(`❌ FAILURE: Price did not update. Expected ${newPrice}, got ${updatedPrice}`);
        process.exit(1);
    }
}

testHotReload().catch(console.error);
