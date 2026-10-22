import { db } from './db';

export interface CloudConfig {
  projectId: string;
  apiKey: string;
}

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

    // Fallback to env vars for existing installation
    const envProjectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;
    const envApiKey = import.meta.env.VITE_FIREBASE_API_KEY;

    if (envProjectId && envApiKey) {
      this.cache = { projectId: envProjectId, apiKey: envApiKey };
      return this.cache;
    }

    return null;
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

  /** Synchronous check if config is available (cache or env fallback). */
  isConfigured(): boolean {
    if (this.cache !== null) return true;
    return Boolean(import.meta.env.VITE_FIREBASE_PROJECT_ID && import.meta.env.VITE_FIREBASE_API_KEY);
  }
}

export const configManager = new ConfigManager();
