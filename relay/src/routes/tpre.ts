import express from "express";
import { loggers } from "../utils/logger";
import * as umbral from "@nucypher/umbral-pre";

const router = express.Router();

/**
 * Re-encrypt Endpoint
 * Body: { groupId, memberPub, capsuleB64 }
 */
router.post("/reencrypt", async (req, res) => {
  const { groupId, memberPub, capsuleB64 } = req.body;
  if (!groupId || !memberPub || !capsuleB64) {
    return res.status(400).json({ error: "Missing required parameters" });
  }

  const gun = req.app.get("gunInstance");
  if (!gun) {
    return res.status(500).json({ error: "Gun instance not available" });
  }

  try {
    // Look up this relay's kfrag for this (group, member) pair
    const kfragString: string | null = await new Promise((resolve) => {
      gun.get("signal_rooms").get(groupId).get("relay_kfrags").get(memberPub).once((data: any) => {
        resolve(data);
      });
      // Safety timeout
      setTimeout(() => resolve(null), 5000);
    });
    
    if (!kfragString || typeof kfragString !== 'string') {
      return res.status(404).json({ error: "No relay kfrag found for this member" });
    }

    // 2. Deserialize Handlers
    const kfragBytes = new Uint8Array(Buffer.from(kfragString, "base64"));
    // VerifiedKeyFrag non ha un metodo statico fromBytes, usiamo KeyFrag + skipVerification
    const kfrag = (umbral as any).KeyFrag.fromBytes(kfragBytes).skipVerification();
    const capsuleBytes = new Uint8Array(Buffer.from(capsuleB64, 'base64'));
    const capsule = umbral.Capsule.fromBytes(capsuleBytes);

    // 3. Re-encrypt
    const cfrag = umbral.reencrypt(capsule, kfrag);
    const cfragB64 = Buffer.from(cfrag.toBytes()).toString('base64');

    res.json({ cfrag: cfragB64 });
  } catch (err: any) {
    loggers.server.error({ err, groupId, memberPub }, "Error during Proxy Re-Encryption");
    res.status(500).json({ error: "Failed to perform re-encryption", details: err.message });
  }
});

export default router;
