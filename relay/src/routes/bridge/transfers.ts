import express, { Router } from "express";
import { ethers } from "ethers";
import { log, getBridgeClient, strictLimiter } from "./utils";
import { transferBalance, reconcileUserBalance } from "../../utils/bridge-state";
import { sanitizeForLog } from "../../utils/security";

const router: Router = Router();

/**
 * POST /api/v1/bridge/transfer
 *
 * Transfer balance from one user to another (L2 -> L2).
 */
router.post("/transfer", strictLimiter, express.json(), async (req, res) => {
  try {
    const gun = req.app.get("gunInstance");
    if (!gun) {
      return res.status(503).json({
        success: false,
        error: "GunDB not initialized",
      });
    }

    const { from, to, amount, message, seaSignature, ethSignature, gunPubKey } = req.body;

    // DEBUG info
    log.debug(
      {
        hasFrom: !!from,
        hasTo: !!to,
        hasAmount: !!amount,
        hasMessage: !!message,
        hasSeaSignature: !!seaSignature,
        hasEthSignature: !!ethSignature,
        hasGunPubKey: !!gunPubKey,
      },
      "Transfer request received - param check"
    );

    if (!from || !to || !amount || !message || !seaSignature || !ethSignature || !gunPubKey) {
      return res.status(400).json({
        success: false,
        error: "from, to, amount, message, seaSignature, ethSignature, and gunPubKey required",
      });
    }

    let fromAddress: string;
    let toAddress: string;
    try {
      fromAddress = ethers.getAddress(from);
      toAddress = ethers.getAddress(to);
    } catch {
      return res.status(400).json({
        success: false,
        error: "Invalid address format",
      });
    }

    if (fromAddress.toLowerCase() === toAddress.toLowerCase()) {
      return res.status(400).json({
        success: false,
        error: "Cannot transfer to self",
      });
    }

    const amountBigInt = BigInt(amount);
    if (amountBigInt <= 0n) {
      return res.status(400).json({
        success: false,
        error: "Amount must be positive",
      });
    }

    const relayKeyPair = req.app.get("relayKeyPair") || null;
    if (!relayKeyPair) {
      return res.status(503).json({
        success: false,
        error: "Relay keypair not available - transfers require relay signature",
      });
    }

    const result = await transferBalance(
      gun,
      fromAddress,
      toAddress,
      amountBigInt,
      relayKeyPair,
      message,
      seaSignature,
      ethSignature,
      gunPubKey
    );

    log.debug(
      sanitizeForLog({
        from: fromAddress,
        to: toAddress,
        amount: amountBigInt.toString(),
        txHash: result.txHash,
      }),
      "Balance transferred"
    );

    res.json({
      success: true,
      transfer: {
        from: fromAddress,
        to: toAddress,
        amount: amountBigInt.toString(),
        txHash: result.txHash,
        fromBalance: result.fromBalance,
        toBalance: result.toBalance,
      },
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error({ error }, "Error in transfer endpoint");
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

/**
 * POST /api/v1/bridge/reconcile-balance
 *
 * Reconcile a user's L2 balance.
 */
router.post("/reconcile-balance", express.json(), async (req, res) => {
  try {
    const gun = req.app.get("gunInstance");
    if (!gun) {
      return res.status(503).json({
        success: false,
        error: "GunDB not initialized",
      });
    }

    const { user } = req.body;
    if (!user) {
      return res.status(400).json({
        success: false,
        error: "user address required",
      });
    }

    let userAddress: string;
    try {
      userAddress = ethers.getAddress(user);
    } catch {
      return res.status(400).json({
        success: false,
        error: "Invalid user address",
      });
    }

    const relayKeyPair = req.app.get("relayKeyPair");
    if (!relayKeyPair) {
      return res.status(503).json({
        success: false,
        error: "Relay keypair not configured",
      });
    }

    const client = getBridgeClient();
    log.debug({ user: userAddress }, "Starting balance reconciliation");

    // The function is imported from bridge-state, not passed Gun directly
    const result = await reconcileUserBalance(gun, userAddress, relayKeyPair, client);

    if (result.success) {
      res.json({
        success: true,
        user: userAddress,
        currentBalance: result.currentBalance,
        calculatedBalance: result.calculatedBalance,
        corrected: result.corrected,
        message: result.corrected
          ? `Balance corrected from ${result.currentBalance} to ${result.calculatedBalance}`
          : "Balance is already correct",
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error || "Reconciliation failed",
      });
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error({ error: errorMessage }, "Error in reconcile-balance endpoint");
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

export default router;
