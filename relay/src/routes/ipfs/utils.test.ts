import { describe, it, expect } from "vitest";
import { getContentTypeFromExtension, detectContentType } from "./utils";

describe("IPFS Utils", () => {
  describe("getContentTypeFromExtension", () => {
    it("should return correct mime type for common extensions", () => {
      expect(getContentTypeFromExtension("image.jpg")).toBe("image/jpeg");
      expect(getContentTypeFromExtension("image.jpeg")).toBe("image/jpeg");
      expect(getContentTypeFromExtension("photo.png")).toBe("image/png");
      expect(getContentTypeFromExtension("animation.gif")).toBe("image/gif");
      expect(getContentTypeFromExtension("vector.svg")).toBe("image/svg+xml");
      expect(getContentTypeFromExtension("movie.mp4")).toBe("video/mp4");
      expect(getContentTypeFromExtension("doc.pdf")).toBe("application/pdf");
      expect(getContentTypeFromExtension("data.json")).toBe("application/json");
      expect(getContentTypeFromExtension("page.html")).toBe("text/html");
      expect(getContentTypeFromExtension("script.js")).toBe("application/javascript");
    });

    it("should be case insensitive", () => {
      expect(getContentTypeFromExtension("IMAGE.JPG")).toBe("image/jpeg");
      expect(getContentTypeFromExtension("photo.PnG")).toBe("image/png");
      expect(getContentTypeFromExtension("SCRIPT.JS")).toBe("application/javascript");
    });

    it("should handle multiple dots in filename", () => {
      expect(getContentTypeFromExtension("archive.tar.gz")).toBe("application/octet-stream");
      expect(getContentTypeFromExtension("my.photo.png")).toBe("image/png");
    });

    it("should return application/octet-stream for no extension", () => {
      expect(getContentTypeFromExtension("README")).toBe("application/octet-stream");
      expect(getContentTypeFromExtension("filename")).toBe("application/octet-stream");
    });

    it("should handle hidden files", () => {
      expect(getContentTypeFromExtension(".gitignore")).toBe("application/octet-stream");
      expect(getContentTypeFromExtension(".env")).toBe("application/octet-stream");
    });

    it("should handle empty string", () => {
      expect(getContentTypeFromExtension("")).toBe("application/octet-stream");
    });

    it("should handle trailing dot", () => {
      expect(getContentTypeFromExtension("filename.")).toBe("application/octet-stream");
    });

    it("should handle path-like strings", () => {
      expect(getContentTypeFromExtension("/home/user/image.png")).toBe("image/png");
      expect(getContentTypeFromExtension("./local/data.json")).toBe("application/json");
    });

    it("should return application/octet-stream for unknown extensions", () => {
      expect(getContentTypeFromExtension("file.unknown")).toBe("application/octet-stream");
      expect(getContentTypeFromExtension("data.foo")).toBe("application/octet-stream");
    });
  });

  describe("detectContentType", () => {
    it("should detect PNG from magic bytes", () => {
      const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      expect(detectContentType(buffer)).toBe("image/png");
    });

    it("should detect JPEG from magic bytes", () => {
      const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
      expect(detectContentType(buffer)).toBe("image/jpeg");
    });

    it("should detect GIF from magic bytes", () => {
      const buffer = Buffer.from([0x47, 0x49, 0x46, 0x38]);
      expect(detectContentType(buffer)).toBe("image/gif");
    });

    it("should detect PDF from magic bytes", () => {
      const buffer = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
      expect(detectContentType(buffer)).toBe("application/pdf");
    });

    it("should detect HTML from tags", () => {
      const html1 = Buffer.from("<html><body>Hi</body></html>");
      const html2 = Buffer.from("<!DOCTYPE html><html></html>");
      expect(detectContentType(html1)).toBe("text/html");
      expect(detectContentType(html2)).toBe("text/html");
    });

    it("should detect JSON content", () => {
      const json = Buffer.from('{"key": "value", "number": 123}');
      expect(detectContentType(json)).toBe("application/json");
    });

    it("should return application/octet-stream for unknown content", () => {
      const unknown = Buffer.from("This is just some plain text that is not JSON or HTML.");
      expect(detectContentType(unknown)).toBe("application/octet-stream");
    });

    it("should return application/octet-stream for empty buffer", () => {
      const empty = Buffer.alloc(0);
      expect(detectContentType(empty)).toBe("application/octet-stream");
    });
  });
});
