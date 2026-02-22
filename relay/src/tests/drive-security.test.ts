import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Request, Response } from "express";
import { handlePublicLinkAccess, initDrivePublicLinks } from "../routes/drive";
import { driveManager } from "../utils/drive";

// Mock dependencies
vi.mock("../utils/drive", () => ({
  driveManager: {
    downloadFileAsync: vi.fn(),
  },
}));

vi.mock("../utils/drive-public-links", () => {
  return {
    DrivePublicLinksManager: vi.fn().mockImplementation(() => ({
      getPublicLink: vi.fn(),
      listPublicLinks: vi.fn(),
      createPublicLink: vi.fn(),
      revokePublicLink: vi.fn(),
    })),
  };
});

// Import mock class to configure return values
import { DrivePublicLinksManager } from "../utils/drive-public-links";

describe("Drive Security - Public Link Access", () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockLinkManager: any;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Setup mock request/response
    mockReq = {
      params: { linkId: "test-link-id" },
      url: "/public/test-link-id",
      get: vi.fn(),
      protocol: "http",
    };

    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      setHeader: vi.fn(),
      send: vi.fn(),
    };

    // Setup mock link manager
    mockLinkManager = {
      getPublicLink: vi.fn(),
      listPublicLinks: vi.fn(),
      createPublicLink: vi.fn(),
      revokePublicLink: vi.fn(),
    };

    // Mock the constructor to return our mock instance
    (DrivePublicLinksManager as any).mockImplementation(() => mockLinkManager);

    // Initialize the manager in the module
    initDrivePublicLinks({} as any, "test-pub", {} as any);
  });

  it("should force text/plain for HTML files to prevent XSS when served inline", async () => {
    // 1. Setup mock data
    mockLinkManager.getPublicLink.mockResolvedValue({
      linkId: "test-link-id",
      filePath: "malicious.html",
      createdAt: Date.now(),
      expiresAt: null,
      accessCount: 0,
    });

    (driveManager.downloadFileAsync as any).mockResolvedValue({
      buffer: Buffer.from("<script>alert(1)</script>"),
      filename: "malicious.html",
      size: 25,
    });

    // 2. Call the handler
    await handlePublicLinkAccess(mockReq as Request, mockRes as Response);

    // 3. Verify security headers
    const setHeaderMock = mockRes.setHeader as any;

    // Check all calls to setHeader
    const calls = setHeaderMock.mock.calls;
    const contentTypeCall = calls.find((c: any) => c[0] === "Content-Type");
    const contentDispositionCall = calls.find((c: any) => c[0] === "Content-Disposition");
    const nosniffCall = calls.find((c: any) => c[0] === "X-Content-Type-Options");

    // Before fix: Content-Type: text/html, Content-Disposition: inline
    // Expected fix: Content-Type: text/plain OR Content-Disposition: attachment

    const isTextHtml = contentTypeCall && contentTypeCall[1] === "text/html";
    const isInline = contentDispositionCall && contentDispositionCall[1].startsWith("inline");

    // Assert that we are NOT serving HTML inline as HTML
    if (isInline) {
        expect(contentTypeCall[1], "Should force text/plain for inline HTML").toBe("text/plain");
        // Also ensure nosniff is set
        expect(nosniffCall, "Should set X-Content-Type-Options: nosniff").toBeDefined();
        expect(nosniffCall[1]).toBe("nosniff");
    } else {
       // If attached, it's safer, but we prefer checking for text/plain in this fix
    }
  });

  it("should force text/plain for SVG files to prevent XSS", async () => {
     // 1. Setup mock data
    mockLinkManager.getPublicLink.mockResolvedValue({
      linkId: "test-link-id",
      filePath: "malicious.svg",
    });

    (driveManager.downloadFileAsync as any).mockResolvedValue({
      buffer: Buffer.from("<svg onload=alert(1)>"),
      filename: "malicious.svg",
      size: 25,
    });

    // 2. Call the handler
    await handlePublicLinkAccess(mockReq as Request, mockRes as Response);

    // 3. Verify security headers
    const setHeaderMock = mockRes.setHeader as any;
    const calls = setHeaderMock.mock.calls;
    const contentTypeCall = calls.find((c: any) => c[0] === "Content-Type");

    expect(contentTypeCall[1], "Should force text/plain for SVG").toBe("text/plain");
  });

  it("should serve safe images inline with correct mime type", async () => {
    // 1. Setup mock data
    mockLinkManager.getPublicLink.mockResolvedValue({
      linkId: "image-link",
      filePath: "photo.jpg",
    });

    (driveManager.downloadFileAsync as any).mockResolvedValue({
      buffer: Buffer.from("image data"),
      filename: "photo.jpg",
      size: 10,
    });

    // 2. Call the handler
    await handlePublicLinkAccess(mockReq as Request, mockRes as Response);

    // 3. Verify headers
    const setHeaderMock = mockRes.setHeader as any;
    const calls = setHeaderMock.mock.calls;

    const contentTypeCall = calls.find((c: any) => c[0] === "Content-Type");
    const contentDispositionCall = calls.find((c: any) => c[0] === "Content-Disposition");

    expect(contentTypeCall[1]).toBe("image/jpeg");
    expect(contentDispositionCall[1]).toContain("inline");
  });
});
