declare module "@mblaney/holster/src/holster.js";

declare module "self-adjusting-interval" {
  const setSelfAdjustingInterval: (callback: () => void | Promise<void>, interval: number) => any;
  export default setSelfAdjustingInterval;
}
declare module "ip" {
  export function address(): string;
}

// SQLite store type
declare module "gun/lib/sqlite-store" {
  class SQLiteStore {
    constructor(options: { dbPath: string; file: string });
  }
  export default SQLiteStore;
}
