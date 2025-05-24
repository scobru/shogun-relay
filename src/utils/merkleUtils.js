import fs from "fs";
import path from "path";
import { MerkleTree } from "merkletreejs";
import keccak from "keccak";
import Gun from "gun";

export class MerkleManager {
  constructor(radataPath = "./radata") {
    this.radataPath = radataPath;
    this.merkleTree = null;
    this.allowedPubKeys = [];
  }

  async initialize() {
    try {
      console.log(`Loading public keys from ${this.radataPath}`);
      this.allowedPubKeys = await this.extractPubKeysFromRadata();

      if (this.allowedPubKeys.length === 0) {
        console.warn("No public keys found in radata, using fallback keys");
        // Fallback keys for testing only
        this.allowedPubKeys = [
          Buffer.from(
            "0x0000000000000000000000000000000000000000000000000000000000000000",
            "hex"
          ),
        ];
      }

      this.merkleTree = new MerkleTree(
        this.allowedPubKeys,
        (x) => keccak("keccak256").update(x).digest(),
        { sort: true }
      );

      console.log(
        `Merkle tree initialized with ${this.allowedPubKeys.length} keys`
      );
      return this.getRoot();
    } catch (error) {
      console.error("Error initializing Merkle tree:", error);
      throw error;
    }
  }

  async extractPubKeysFromRadata() {
    const pubKeys = [];

    try {
      console.log(
        `Searching for pub keys in: ${path.resolve(this.radataPath)}`
      );

      // List all files and directories in radata
      const entries = fs.readdirSync(this.radataPath);
      console.log(
        `Found ${entries.length} entries in radata directory:`,
        entries
      );

      // Process all files in the directory regardless of extension
      for (const entry of entries) {
        const entryPath = path.join(this.radataPath, entry);
        const stats = fs.statSync(entryPath);

        // Process all files, not just .json files
        if (stats.isFile()) {
          try {
            console.log(`Processing file: ${entry}`);
            const content = fs.readFileSync(entryPath, "utf8");

            // Try to process the content as JSON
            try {
              const data = JSON.parse(content);
              const keysFromJson = this.findPubKeysInObject(data);

              if (keysFromJson.length > 0) {
                console.log(
                  `Found ${keysFromJson.length} keys in file ${entry}`
                );
                keysFromJson.forEach((key) => {
                  if (
                    !pubKeys.some((existing) =>
                      existing.equals(Buffer.from(key, "hex"))
                    )
                  ) {
                    pubKeys.push(Buffer.from(key, "hex"));
                    console.log(
                      `Added pub key from ${entry}: ${key.substring(0, 10)}...`
                    );
                  }
                });
              }
            } catch (jsonError) {
              console.log(
                `File ${entry} is not valid JSON, trying regex parsing`
              );

              // Try to extract pub keys using regex
              const pubKeyRegex = /"pub"\s*:\s*"([0-9a-fA-F]+)"/g;
              let match;
              while ((match = pubKeyRegex.exec(content)) !== null) {
                const pubKey = match[1];
                if (pubKey && pubKey.length > 20) {
                  // Simple validation
                  if (
                    !pubKeys.some((existing) =>
                      existing.equals(Buffer.from(pubKey, "hex"))
                    )
                  ) {
                    pubKeys.push(Buffer.from(pubKey, "hex"));
                    console.log(
                      `Added pub key via regex from ${entry}: ${pubKey.substring(
                        0,
                        10
                      )}...`
                    );
                  }
                }
              }
            }
          } catch (fileError) {
            console.warn(
              `Error processing file ${entry}: ${fileError.message}`
            );
          }
        } else if (stats.isDirectory()) {
          console.log(`Found directory: ${entry}`);
          // Process subdirectories if needed
        }
      }

      console.log(`Total unique pub keys found: ${pubKeys.length}`);
      return pubKeys;
    } catch (error) {
      console.error("Error extracting pub keys from radata:", error);
      return [];
    }
  }

  // Helper method to recursively search for pub keys in nested objects
  findPubKeysInObject(obj, found = []) {
    if (!obj) return found;

    // If this is a string and looks like a pub key or key pair
    if (typeof obj === "string") {
      // Check if it's a valid public key string (either starting with ~ for user keys or containing common patterns)
      if (
        (obj.startsWith("~") || obj.includes(".")) &&
        obj.length > 20 &&
        !obj.includes(" ") &&
        !obj.includes("\n")
      ) {
        console.log(`Found potential key: ${obj}`);
        found.push(obj);
      }
      return found;
    }

    // If this is not an object, we can't process it further
    if (typeof obj !== "object") return found;

    // Check for Gun's standard format where keys are in the ':' field
    if (obj[":"] && typeof obj[":"] === "string") {
      const potentialKey = obj[":"];
      if (
        (potentialKey.startsWith("~") || potentialKey.includes(".")) &&
        potentialKey.length > 20 &&
        !potentialKey.includes(" ")
      ) {
        console.log(`Found potential key in ':' field: ${potentialKey}`);
        found.push(potentialKey);
      }
    }

    // Check for nested objects with an empty string key which is common in Gun
    if (obj[""] && typeof obj[""] === "object" && obj[""][":"]) {
      const potentialKey = obj[""][":"];
      if (
        typeof potentialKey === "string" &&
        (potentialKey.startsWith("~") || potentialKey.includes(".")) &&
        potentialKey.length > 20 &&
        !potentialKey.includes(" ")
      ) {
        console.log(`Found potential key in '' > ':' field: ${potentialKey}`);
        found.push(potentialKey);
      }
    }

    // Special case for "Pub" fields which might contain keys
    if (obj.Pub && typeof obj.Pub === "object") {
      this.findPubKeysInObject(obj.Pub, found);
    }

    // Recursively search through all object properties
    for (const key in obj) {
      if (typeof obj[key] === "object" && obj[key] !== null) {
        this.findPubKeysInObject(obj[key], found);
      }
    }

    return found;
  }

  getRoot() {
    if (!this.merkleTree) {
      throw new Error("Merkle tree not initialized");
    }
    return Buffer.from(this.merkleTree.getRoot()).toString("hex");
  }

  // Add other Merkle tree operations as needed
}
