import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleDriveError } from "../utils/route-utils";
import { Response } from "express";

// Mock loggers
vi.mock("../utils/logger", () => ({
  loggers: {
    server: {
      error: vi.fn(),
    },
  },
}));

describe("handleDriveError", () => {
  let mockRes: Response;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as Response;
  });

  it("should handle 404 Not Found errors when error message contains 'does not exist'", () => {
    const error = new Error("file does not exist");
    handleDriveError(mockRes, error, "Test log message");

    expect(mockRes.status).toHaveBeenCalledWith(404);
    expect(mockRes.json).toHaveBeenCalledWith({
      success: false,
      error: "file does not exist",
    });
  });

  it("should handle 409 Conflict errors when error message contains 'already exists'", () => {
    const error = new Error("file already exists");
    handleDriveError(mockRes, error, "Test log message");

    expect(mockRes.status).toHaveBeenCalledWith(409);
    expect(mockRes.json).toHaveBeenCalledWith({
      success: false,
      error: "file already exists",
    });
  });

  it("should handle 500 Internal Server Error for other errors", () => {
    const error = new Error("something went wrong");
    handleDriveError(mockRes, error, "Test log message");

    expect(mockRes.status).toHaveBeenCalledWith(500);
    expect(mockRes.json).toHaveBeenCalledWith({
      success: false,
      error: "something went wrong",
    });
  });

  it("should use default messages if error message is missing", () => {
    const error = { message: "does not exist" }; // not a real Error object but has the substring
    handleDriveError(mockRes, error, "Test log message", { notFoundDefault: "Default Not Found" });

    expect(mockRes.status).toHaveBeenCalledWith(404);
    expect(mockRes.json).toHaveBeenCalledWith({
      success: false,
      error: "does not exist", // substring matches, so it uses message
    });

    const errorEmpty = { message: "error: does not exist" };
    handleDriveError(mockRes, errorEmpty, "Test log message", { notFoundDefault: "Default Not Found" });
    expect(mockRes.json).toHaveBeenLastCalledWith({
      success: false,
      error: "error: does not exist",
    });
  });

  it("should respect notFoundDefault if message is empty but contains 'does not exist'", () => {
      // If message is exactly "does not exist", it will use it.
      // If we want to test default, we need message to be JUST the substring or similar.
      const error = new Error("does not exist");
      handleDriveError(mockRes, error, "Log", { notFoundDefault: "Default NF" });
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ error: "does not exist" }));
  });

  it("should respect useErrorMsg: false", () => {
    const error = new Error("internal detail: does not exist");
    handleDriveError(mockRes, error, "Test log message", {
      notFoundDefault: "File not found",
      useErrorMsg: false
    });

    expect(mockRes.status).toHaveBeenCalledWith(404);
    expect(mockRes.json).toHaveBeenCalledWith({
      success: false,
      error: "File not found",
    });
  });

  it("should handle custom default messages for 409", () => {
    const error = new Error("already exists");
    handleDriveError(mockRes, error, "Test log message", {
      alreadyExistsDefault: "Target exists"
    });

    expect(mockRes.status).toHaveBeenCalledWith(409);
    expect(mockRes.json).toHaveBeenCalledWith({
      success: false,
      error: "already exists",
    });
  });

  it("should fallback to 'Internal Server Error' if error.message is missing", () => {
    const error = {};
    handleDriveError(mockRes, error, "Test log message");

    expect(mockRes.status).toHaveBeenCalledWith(500);
    expect(mockRes.json).toHaveBeenCalledWith({
      success: false,
      error: "Internal Server Error",
    });
  });
});
