/**
 * Oracle Integration Tests
 * 
 * Verifies the interaction between:
 * - Oracle Feeds (Plugins)
 * - Usage Tracking (GunDB)
 * - Price Sync Manager
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { keccak256, toUtf8Bytes, parseEther } from "ethers";
import { createPriceFeed } from "../oracle-feeds/plugin-interface.js";
import { recordOracleAccess, OracleAccess } from "../utils/oracle-tracking.js";
import type { OracleFeedPlugin } from "../oracle-feeds/plugin-interface.js";

// Mock dependencies
const mockGun = {
    get: vi.fn().mockReturnThis(),
    put: vi.fn((data, cb) => {
        if (cb) cb({ err: null }); // Callback immediately
        return mockGun;
    }),
    map: vi.fn().mockReturnThis(),
    once: vi.fn((cb) => {
        if (cb) cb(null); // Callback immediately
        return mockGun;
    }),
};

// Mock config
vi.mock("../config/index.js", () => ({
    blockchainConfig: { relayPrivateKey: "0x123..." },
    bridgeConfig: { rpcUrl: "http://localhost:8545" },
    oracleConfig: { chainId: 84532 }
}));

// Mock logger
vi.mock("../utils/logger.js", () => ({
    loggers: {
        server: {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        }
    }
}));

describe("Oracle System Integration", () => {

    describe("Feed Plugins", () => {
        it("should create a valid price feed", async () => {
            const fetchPrice = async () => 2500.50;
            const feed = createPriceFeed("ETH/USD", fetchPrice, 60, 1.0);

            expect(feed.name).toBe("ETH/USD");
            expect(feed.dataType).toBe(0); // PRICE
            expect(feed.priceUSDC).toBe(1.0);

            const value = await feed.getValue();
            expect(value).toBe(250050000000); // 2500.50 * 1e8
        });
    });

    describe("Usage Tracking", () => {
        it("should record oracle access", async () => {
            const access: OracleAccess = {
                id: "test-access-id",
                userAddress: "0xUser",
                feedId: "0xFeed",
                feedName: "ETH/USD",
                timestamp: Date.now(),
                paymentMethod: "x402",
                paymentAmount: "1.0"
            };

            await recordOracleAccess(mockGun, access);

            // Verify GunDB put calls
            expect(mockGun.get).toHaveBeenCalledWith("shogun");
            expect(mockGun.put).toHaveBeenCalled();
        });
    });

    describe("Price Sync Logic", () => {
        it("should calculate correct ETH price for on-chain sync", () => {
            const feedPriceUSDC = 10.0;
            const ethPriceUSD = 2000.0;

            // Expected: 10 / 2000 = 0.005 ETH
            const expectedEth = 0.005;

            const calculatedWei = parseEther((feedPriceUSDC / ethPriceUSD).toFixed(18));
            const expectedWei = parseEther(expectedEth.toString());

            expect(calculatedWei).toBe(expectedWei);
        });

        it("should detect deviation correctly", () => {
            const currentOnChainWei = parseEther("0.01"); // 0.01 ETH
            const newRequiredWei = parseEther("0.012");   // 0.012 ETH (20% increase)

            const diff = newRequiredWei - currentOnChainWei;

            // 0.166... > 0.05
            // Using Number() on large Wei values loses precision but ratio is preserved generally
            const deviation = Number(diff) / Number(newRequiredWei);

            expect(deviation).toBeGreaterThan(0.05);
        });
    });

    describe("Feed ID Computation", () => {
        it("should compute consistent feed IDs", () => {
            const name = "ETH/USD";
            const id1 = keccak256(toUtf8Bytes(name));
            const id2 = keccak256(toUtf8Bytes(name));

            expect(id1).toBe(id2);
            expect(id1).toMatch(/^0x[a-f0-9]{64}$/);
        });
    });

});
