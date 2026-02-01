
import { Request, Response, NextFunction } from "express";
import { X402Merchant, NetworkKey } from "../utils/x402-merchant";
import { x402Config } from "../config";
import { parseUnits } from "viem";
import { loggers } from "../utils/logger";

export interface X402MiddlewareOptions {
    priceUSDC: number;
    resourceId: string;
    description: string;
    merchant?: X402Merchant;
}

// Singleton merchant instance to avoid creating it on every request if not needed
let defaultMerchant: X402Merchant | undefined;

function getDefaultMerchant(): X402Merchant {
    if (!defaultMerchant) {
        const payToAddress = x402Config.payToAddress || "";
        if (!payToAddress) {
            throw new Error("X402_PAY_TO_ADDRESS not configured");
        }

        defaultMerchant = new X402Merchant({
            payToAddress,
            network: (x402Config.defaultNetwork || "base-sepolia") as NetworkKey,
            facilitatorUrl: x402Config.facilitatorUrl || "",
            facilitatorApiKey: x402Config.facilitatorApiKey || "",
            settlementMode: (x402Config.settlementMode || "facilitator") as "facilitator" | "direct",
            privateKey: x402Config.privateKey || "",
            rpcUrl: x402Config.getRpcUrl() || "",
        });
    }
    return defaultMerchant;
}

/**
 * Middleware to protect an endpoint with x402 payment
 * 
 * Usage:
 * router.post("/premium-service", x402Protect({
 *   priceUSDC: 5.0,
 *   resourceId: "premium-service-v1",
 *   description: "Access to Premium Service"
 * }), (req, res) => { ... })
 */
export const x402Protect = (options: X402MiddlewareOptions) => {
    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            const merchant = options.merchant || getDefaultMerchant();
            const { priceUSDC, resourceId, description } = options;

            // Check for payment in body or header
            // We accept payment in `req.body.payment` or `req.headers['x-payment']`
            let payment = req.body.payment;

            // Allow passing payment via header (useful for GET requests)
            if (!payment && req.headers['x-payment']) {
                try {
                    const headerVal = req.headers['x-payment'];
                    if (typeof headerVal === 'string') {
                        payment = JSON.parse(headerVal);
                    } else if (Array.isArray(headerVal)) {
                        payment = JSON.parse(headerVal[0]);
                    }
                } catch (e) {
                    loggers.x402.warn("Invalid x-payment header JSON");
                }
            }

            if (!payment && req.query.payment) {
                try {
                    payment = JSON.parse(req.query.payment as string);
                } catch (e) {
                    loggers.x402.warn("Invalid payment query param JSON");
                }
            }

            if (!payment) {
                const requirements = merchant.createCustomPaymentRequiredResponse(
                    priceUSDC,
                    resourceId,
                    description
                );
                return res.status(402).json({
                    success: false,
                    error: "Payment required",
                    ...requirements
                });
            }

            // Verify payment
            const requiredAmountAtomic = parseUnits(priceUSDC.toString(), 6).toString();
            const verification = await merchant.verifyDealPayment(payment, requiredAmountAtomic);

            if (!verification.isValid) {
                const requirements = merchant.createCustomPaymentRequiredResponse(
                    priceUSDC,
                    resourceId,
                    description
                );
                return res.status(402).json({
                    success: false,
                    error: "Payment verification failed",
                    reason: verification.invalidReason,
                    ...requirements
                });
            }

            // Settle payment
            // Note: In high-load scenarios, consider moving settlement to a background job
            const settlement = await merchant.settlePayment(payment);

            if (!settlement.success) {
                loggers.x402.error(`Payment settlement failed: ${settlement.errorReason}`);
                return res.status(500).json({
                    success: false,
                    error: "Payment settlement failed",
                    reason: settlement.errorReason
                });
            }

            // Save payment to history
            try {
                // Dynamic import to avoid circular dependencies
                const RelayUser = await import("../utils/relay-user");
                if (RelayUser.isRelayUserInitialized()) {
                    await RelayUser.savePayment({
                        transaction: settlement.transaction!,
                        payer: verification.payer!,
                        amount: verification.amount!,
                        network: settlement.network!,
                        resourceId: resourceId,
                        description: description,
                        timestamp: Date.now()
                    });
                }
            } catch (err) {
                loggers.x402.warn({ err }, "Failed to save payment history");
                // Don't fail the request if saving history fails
            }

            // Store payment info in request for the route handler
            // Extend Express Request type locally if needed, or just cast to any
            (req as any).x402 = {
                paid: true,
                payer: verification.payer,
                amount: verification.amount,
                transaction: settlement.transaction,
                network: settlement.network
            };

            next();

        } catch (error: any) {
            loggers.x402.error({ err: error }, "x402 Middleware Error");
            res.status(500).json({
                success: false,
                error: "Internal payment processing error"
            });
        }
    };
};
