import { describe, it, expect } from "vitest";
import { getContentTypeFromExtension } from "./utils";

describe("IPFS utils", () => {
  describe("getContentTypeFromExtension", () => {
    it("should return correct mime type for known extensions with dot", () => {
      expect(getContentTypeFromExtension("test.jpg")).toBe("image/jpeg");
      expect(getContentTypeFromExtension("test.png")).toBe("image/png");
      expect(getContentTypeFromExtension("test.json")).toBe("application/json");
      expect(getContentTypeFromExtension("test.pdf")).toBe("application/pdf");
    });

    it("should return correct mime type for known extensions without dot", () => {
      expect(getContentTypeFromExtension("jpg")).toBe("image/jpeg");
      expect(getContentTypeFromExtension("png")).toBe("image/png");
      expect(getContentTypeFromExtension("json")).toBe("application/json");
    });

    it("should handle upper and mixed case extensions", () => {
      expect(getContentTypeFromExtension("test.JPG")).toBe("image/jpeg");
      expect(getContentTypeFromExtension("test.PnG")).toBe("image/png");
      expect(getContentTypeFromExtension("test.JsOn")).toBe("application/json");
    });

    it("should return application/octet-stream for unknown extensions", () => {
      expect(getContentTypeFromExtension("test.unknown")).toBe("application/octet-stream");
      expect(getContentTypeFromExtension("test.exe")).toBe("application/octet-stream");
      expect(getContentTypeFromExtension("test.xyz")).toBe("application/octet-stream");
    });

    it("should return application/octet-stream for files with no extension", () => {
      expect(getContentTypeFromExtension("test")).toBe("application/octet-stream");
      expect(getContentTypeFromExtension("")).toBe("application/octet-stream");
      expect(getContentTypeFromExtension("file_without_ext")).toBe("application/octet-stream");
    });

    it("should handle filenames with multiple dots", () => {
      expect(getContentTypeFromExtension("test.tar.gz")).toBe("application/octet-stream");
      expect(getContentTypeFromExtension("archive.v1.zip")).toBe("application/zip");
      expect(getContentTypeFromExtension("image.final.v2.png")).toBe("image/png");
    });

    it("should map specific specific known mappings", () => {
      expect(getContentTypeFromExtension("test.jpeg")).toBe("image/jpeg");
      expect(getContentTypeFromExtension("test.gif")).toBe("image/gif");
      expect(getContentTypeFromExtension("test.webp")).toBe("image/webp");
      expect(getContentTypeFromExtension("test.svg")).toBe("image/svg+xml");
      expect(getContentTypeFromExtension("test.mp4")).toBe("video/mp4");
      expect(getContentTypeFromExtension("test.webm")).toBe("video/webm");
      expect(getContentTypeFromExtension("test.mp3")).toBe("audio/mpeg");
      expect(getContentTypeFromExtension("test.wav")).toBe("audio/wav");
      expect(getContentTypeFromExtension("test.txt")).toBe("text/plain");
      expect(getContentTypeFromExtension("test.html")).toBe("text/html");
      expect(getContentTypeFromExtension("test.css")).toBe("text/css");
      expect(getContentTypeFromExtension("test.js")).toBe("application/javascript");
      expect(getContentTypeFromExtension("test.xml")).toBe("application/xml");
      expect(getContentTypeFromExtension("test.zip")).toBe("application/zip");
    });
  });
});
