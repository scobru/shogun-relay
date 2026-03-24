import { describe, it, expect } from "vitest";
import { detectContentType, getContentTypeFromExtension } from "./utils";

describe("IPFS utils", () => {
  describe("getContentTypeFromExtension", () => {
    it("should return correct mime type for known extensions", () => {
      expect(getContentTypeFromExtension("test.png")).toBe("image/png");
      expect(getContentTypeFromExtension("test.jpeg")).toBe("image/jpeg");
      expect(getContentTypeFromExtension("test.jpg")).toBe("image/jpeg");
      expect(getContentTypeFromExtension("test.pdf")).toBe("application/pdf");
      expect(getContentTypeFromExtension("test.json")).toBe("application/json");
      expect(getContentTypeFromExtension("test.txt")).toBe("text/plain");
    });

    it("should handle uppercase extensions", () => {
      expect(getContentTypeFromExtension("test.PNG")).toBe("image/png");
      expect(getContentTypeFromExtension("test.PDF")).toBe("application/pdf");
    });

    it("should handle files with multiple dots", () => {
      expect(getContentTypeFromExtension("archive.tar.zip")).toBe("application/zip");
    });

    it("should return application/octet-stream for unknown extensions", () => {
      expect(getContentTypeFromExtension("test.unknown")).toBe("application/octet-stream");
      expect(getContentTypeFromExtension("test.xyz")).toBe("application/octet-stream");
    });

    it("should return application/octet-stream for files without extension", () => {
      expect(getContentTypeFromExtension("test")).toBe("application/octet-stream");
    });

    it("should return application/octet-stream for empty strings", () => {
      expect(getContentTypeFromExtension("")).toBe("application/octet-stream");
    });
  });

  describe("detectContentType", () => {
    it("should detect PNG", () => {
      const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      expect(detectContentType(buffer)).toBe("image/png");
    });

    it("should detect JPEG", () => {
      const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
      expect(detectContentType(buffer)).toBe("image/jpeg");
    });

    it("should detect GIF", () => {
      const buffer = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // GIF89a
      expect(detectContentType(buffer)).toBe("image/gif");
    });

    it("should detect PDF", () => {
      const buffer = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // %PDF-1.4
      expect(detectContentType(buffer)).toBe("application/pdf");
    });

    it("should detect HTML with <html", () => {
      const buffer = Buffer.from("<html><body>Hello</body></html>");
      expect(detectContentType(buffer)).toBe("text/html");
    });

    it("should detect HTML with <!DOCTYPE", () => {
      const buffer = Buffer.from("<!DOCTYPE html><html><body>Hello</body></html>");
      expect(detectContentType(buffer)).toBe("text/html");
    });

    it("should detect JSON", () => {
      const buffer = Buffer.from('{"key": "value"}');
      expect(detectContentType(buffer)).toBe("application/json");

      const arrayBuffer = Buffer.from('[1, 2, 3]');
      expect(detectContentType(arrayBuffer)).toBe("application/json");
    });

    it("should fallback to application/octet-stream for unknown binary data", () => {
      const buffer = Buffer.from([0x01, 0x02, 0x03, 0x04]);
      expect(detectContentType(buffer)).toBe("application/octet-stream");
    });

    it("should fallback to application/octet-stream for invalid JSON string", () => {
      const buffer = Buffer.from('{"key": "value"'); // Missing closing brace
      expect(detectContentType(buffer)).toBe("application/octet-stream");

      const bufferText = Buffer.from('Just some plain text that is not html or json');
      expect(detectContentType(bufferText)).toBe("application/octet-stream");
    });

    it("should fallback to application/octet-stream for empty buffer", () => {
      const buffer = Buffer.alloc(0);
      expect(detectContentType(buffer)).toBe("application/octet-stream");
    });

    it("should handle short buffers safely without throwing", () => {
      const buffer = Buffer.from([0x89]); // Only 1 byte, PNG needs 4
      expect(detectContentType(buffer)).toBe("application/octet-stream");
    });
  });
});
