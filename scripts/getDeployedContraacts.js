const optimismSepolia = await import(
  "shogun-contracts/ignition/deployments/chain-11155420/deployed_addresses.json",
  {
    with: { type: "json" },
  }
);

console.log("Optimism Sepolia:", optimismSepolia.default);
