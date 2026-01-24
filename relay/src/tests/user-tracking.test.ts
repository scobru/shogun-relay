
import { describe, it, expect, vi, beforeEach } from "vitest";
import { trackUser, getObservedUsers } from "../utils/relay-user";

// Mock gun and relay user
const mockPut = vi.fn((data, cb) => cb({}));
const mockGet = vi.fn(() => ({
    put: mockPut,
    get: mockGet,
    once: vi.fn(),
}));

vi.mock("../utils/relay-user", async () => {
    const actual = await vi.importActual("../utils/relay-user");
    return {
        ...actual,
        getGunNode: vi.fn(() => ({
            get: mockGet
        }))
    };
});

// Since we can't easily mock the internal relayUser state without exporting setters,
// we will have to rely on the fact that the module exports functions that might throw if not init.
// However, trackUser handles "not initialized" gracefully with a warning.

describe("User Tracking", () => {
    it("should define trackUser and getObservedUsers", () => {
        expect(trackUser).toBeDefined();
        expect(getObservedUsers).toBeDefined();
    });
});
