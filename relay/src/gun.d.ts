/**
 * Custom type augmentations for GunDB
 * 
 * The main types (IGun, ISEA, etc.) are imported from the 'gun' package itself.
 * This file only contains project-specific augmentations if needed.
 */

// Re-export from gun package for convenience
export type { IGun, IGunChain, IGunInstance, IGunInstanceRoot } from 'gun/types/gun';
export type { ISEA, ISEAPair } from 'gun/types/sea';
