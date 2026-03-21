import fs from "fs";
import { performance } from "perf_hooks";

const ITERATIONS = 1000;
const BLOB_SIZE = 5 * 1024 * 1024; // 5 MB - realistic blob data could be big in future, let's exaggerate to see the sync issue
const DUMMY_DATA = Buffer.alloc(BLOB_SIZE, 'a');
const TEST_DIR = "data/blobs/test";

if (!fs.existsSync(TEST_DIR)) {
  fs.mkdirSync(TEST_DIR, { recursive: true });
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper to measure event loop lag
function measureLag() {
    let maxLag = 0;
    let lastTime = performance.now();
    const interval = setInterval(() => {
        const now = performance.now();
        const lag = now - lastTime - 10;
        if (lag > maxLag) maxLag = lag;
        lastTime = now;
    }, 10);

    return {
        stop: () => {
            clearInterval(interval);
            return maxLag;
        }
    };
}

async function simulateServerLoadBurst(type: string, writeFn: (id: number) => Promise<void> | void) {
  console.log(`\nMeasuring Burst Server Load with ${type}...`);

  const lagTracker = measureLag();
  const startLoad = performance.now();

  const writes = [];
  for (let i = 0; i < ITERATIONS; i++) {
    writes.push(writeFn(i));
  }

  await Promise.all(writes);

  const totalTime = performance.now() - startLoad;
  const maxLag = lagTracker.stop();

  console.log(`- Total time to handle burst of ${ITERATIONS} writes: ${totalTime.toFixed(2)}ms`);
  console.log(`- Max event loop block duration (lag): ${maxLag.toFixed(2)}ms`);
}


async function run() {
  await simulateServerLoadBurst("fs.writeFileSync", (i) => {
      const filePath = `${TEST_DIR}/sync_${i}.blob`;
      fs.writeFileSync(filePath, DUMMY_DATA);
  });

  await delay(1000); // Give GC a moment

  await simulateServerLoadBurst("fs.promises.writeFile", async (i) => {
      const filePath = `${TEST_DIR}/async_${i}.blob`;
      await fs.promises.writeFile(filePath, DUMMY_DATA);
  });

  // Cleanup
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
}

run().catch(console.error);
