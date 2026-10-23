import { db } from './db';

export interface CloudConfig {
  projectId: string;
  apiKey: string;
}

// Default Firebase project for the default Hungry Birds installation.
// Override via env vars (VITE_FIREBASE_PROJECT_ID, VITE_FIREBASE_API_KEY)
// or the Cloud Setup wizard in Admin Settings.
const DEFAULT_CONFIG: CloudConfig = {
  projectId: 'hungry-birds-3e16f',
  apiKey: 'AIzaSyAIibLNTusvBFOEcExpdb1tYQh_1rv2q7k',
};

class ConfigManager {
  private cache: CloudConfig | null = null;
  private readonly STORAGE_KEY = 'cloud_config';

  /**
   * Retrieves the current Firebase configuration.
   * Priority: Dexie settings -> Environment variables -> null.
   */
  async getConfig(): Promise<CloudConfig | null> {
    if (this.cache) return this.cache;

    const stored = await db.settings.get(this.STORAGE_KEY);
    if (stored?.value) {
      try {
        this.cache = JSON.parse(stored.value) as CloudConfig;
        return this.cache;
      } catch {
        console.error('Failed to parse cloud config from storage');
      }
    }

    // Fallback to env vars
    const envProjectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;
    const envApiKey = import.meta.env.VITE_FIREBASE_API_KEY;

    if (envProjectId && envApiKey) {
      this.cache = { projectId: envProjectId, apiKey: envApiKey };
      return this.cache;
    }

    // Fall back to the default Hungry Birds Firebase project
    return DEFAULT_CONFIG;
  }

  /** Saves a new configuration to Dexie and updates the cache. */
  async setConfig(projectId: string, apiKey: string): Promise<void> {
    const config: CloudConfig = { projectId, apiKey };
    await db.settings.put({ key: this.STORAGE_KEY, value: JSON.stringify(config) });
    this.cache = config;
  }

  /** Clears the cloud configuration. */
  async clearConfig(): Promise<void> {
    await db.settings.delete(this.STORAGE_KEY);
    this.cache = null;
  }

  /** Synchronous check if config is available. Always true since we have a default project. */
  isConfigured(): boolean {
    return true;
  }
}

export const configManager = new ConfigManager();
