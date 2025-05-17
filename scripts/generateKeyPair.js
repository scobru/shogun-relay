import Gun from "gun";
import { ShogunCore } from "shogun-core";

const gun = new Gun({
  peers: ["http://localhost:8765/gun"],
  localStorage: false,
  radisk: false,
});

const authToken = "thisIsTheTokenForReals";

const authToken2 = "wrong";

const shogunCore = new ShogunCore({
  gun: gun,
  walletManager: {
    enabled: true,
  },
  authToken: authToken,
});

const random = Math.random().toString(36).substring(2, 15);
const username = "DAMN" + random;
const password = "thisIsTheTokenForReals";

const result = await shogunCore.signUp(username, password);
console.log("signUp result", result);

if (result.success) {
  const gunInstance = shogunCore.gundb;
  const pair = await gunInstance.user._.sea;

  const walletManager = await shogunCore.getPlugin("wallet");
  const credentials = await walletManager.getMainWalletCredentials();

  console.log("Copy in your .env file the following credentials:");
  console.log("APP_KEY_PAIR=" + JSON.stringify(pair));
  console.log("APP_WALLET_ADDRESS=" + credentials.address);
  console.log("APP_WALLET_PRIVATE_KEY=" + credentials.priv);
}
