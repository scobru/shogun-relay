/**
 * Esempio di Client per Upload IPFS con Autenticazione Smart Contract
 *
 * Questo script dimostra come utilizzare il nuovo endpoint unificato /ipfs-upload
 * con autenticazione smart contract semplificata.
 */

const RELAY_URL = "http://localhost:8765";
const USER_PUBKEY = "0x1234567890abcdef..."; // Sostituisci con la tua chiave pubblica Gun

/**
 * Upload di un file con autenticazione smart contract
 * @param {File|Blob} file - File da caricare
 * @param {string} pubKey - Chiave pubblica Gun dell'utente
 * @returns {Promise<Object>} Risposta del server
 */
async function uploadFileWithSmartContract(file, pubKey) {
  try {
    console.log(
      `📁 Uploading file: ${file.name} (${(file.size / 1024 / 1024).toFixed(
        2
      )} MB)`
    );
    console.log(`🔑 Using pubKey: ${pubKey.slice(0, 10)}...`);
    console.log(`🌐 Invio richiesta a: ${RELAY_URL}/ipfs-upload`);

    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(`${RELAY_URL}/ipfs-upload`, {
      method: "POST",
      headers: {
        "x-pubkey": pubKey, // Solo questo header richiesto!
      },
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(
        `Upload failed: ${errorData.error || response.statusText}`
      );
    }

    const result = await response.json();
    console.log("✅ Upload successful!");
    console.log(`📄 File hash: ${result.file.hash}`);
    console.log(`🌐 IPFS URL: ${result.file.ipfsUrl}`);
    console.log(`💾 Storage tracked: ${result.user.pubKey.slice(0, 10)}...`);

    return result;
  } catch (error) {
    console.error("❌ Upload failed:", error.message);
    throw error;
  }
}

/**
 * Upload di un file con autenticazione admin
 * @param {File|Blob} file - File da caricare
 * @param {string} adminToken - Token di amministrazione
 * @returns {Promise<Object>} Risposta del server
 */
async function uploadFileAsAdmin(file, adminToken) {
  try {
    console.log(
      `📁 Admin upload: ${file.name} (${(file.size / 1024 / 1024).toFixed(
        2
      )} MB)`
    );
    console.log(`🌐 Invio richiesta a: ${RELAY_URL}/ipfs-upload`);

    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(`${RELAY_URL}/ipfs-upload`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(
        `Upload failed: ${errorData.error || response.statusText}`
      );
    }

    const result = await response.json();
    console.log("✅ Admin upload successful!");
    console.log(`📄 File hash: ${result.file.hash}`);

    return result;
  } catch (error) {
    console.error("❌ Admin upload failed:", error.message);
    throw error;
  }
}

/**
 * Ottiene le informazioni di storage per un utente
 * @param {string} pubKey - Chiave pubblica Gun dell'utente
 * @param {string} adminToken - Token di amministrazione
 * @returns {Promise<Object>} Informazioni storage
 */
async function getUserStorageInfo(pubKey, adminToken) {
  try {
    console.log(`📊 Getting storage info for: ${pubKey.slice(0, 10)}...`);

    const response = await fetch(`${RELAY_URL}/api/user-storage/${pubKey}`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get storage info: ${response.statusText}`);
    }

    const result = await response.json();
    console.log("✅ Storage info retrieved!");
    console.log(`💾 Total MB: ${result.storageInfo.totalMB}`);
    console.log(`📁 File count: ${result.storageInfo.fileCount}`);

    return result;
  } catch (error) {
    console.error("❌ Failed to get storage info:", error.message);
    throw error;
  }
}

/**
 * Ottiene la lista dei file di un utente
 * @param {string} pubKey - Chiave pubblica Gun dell'utente
 * @param {string} adminToken - Token di amministrazione
 * @returns {Promise<Object>} Lista file
 */
async function getUserFiles(pubKey, adminToken) {
  try {
    console.log(`📁 Getting files for: ${pubKey.slice(0, 10)}...`);

    const response = await fetch(
      `${RELAY_URL}/api/user-storage/${pubKey}/files`,
      {
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to get files: ${response.statusText}`);
    }

    const result = await response.json();
    console.log("✅ Files retrieved!");
    console.log(`📄 Found ${result.files.length} files`);

    return result;
  } catch (error) {
    console.error("❌ Failed to get files:", error.message);
    throw error;
  }
}

// Esempio di utilizzo
async function main() {
  try {
    // Simula un file da caricare
    const fileContent = "Hello, IPFS!";
    const file = new Blob([fileContent], { type: "text/plain" });
    file.name = "test.txt";

    console.log("🚀 Starting upload example...\n");

    // Upload con autenticazione smart contract
    await uploadFileWithSmartContract(file, USER_PUBKEY);

    console.log("\n" + "=".repeat(50) + "\n");

    // Upload con autenticazione admin (commentato per sicurezza)
    // const ADMIN_TOKEN = "your-admin-token";
    // await uploadFileAsAdmin(file, ADMIN_TOKEN);

    console.log("✅ Example completed successfully!");
  } catch (error) {
    console.error("❌ Example failed:", error.message);
  }
}

// Esegui l'esempio se questo file viene eseguito direttamente
if (typeof window === "undefined") {
  // Node.js environment
  main().catch(console.error);
} else {
  // Browser environment
  window.uploadFileWithSmartContract = uploadFileWithSmartContract;
  window.uploadFileAsAdmin = uploadFileAsAdmin;
  window.getUserStorageInfo = getUserStorageInfo;
  window.getUserFiles = getUserFiles;
  console.log("📚 Functions available in window object");
}
