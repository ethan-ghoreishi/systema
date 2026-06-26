import { db } from './db';
import { defaultSettings, mergeSettings, type Settings } from './settings';

/**
 * Reactive settings store, backed by IndexedDB. Thin wrapper around the pure
 * `settings.ts` model: load hydrates from Dexie, save persists a plain snapshot.
 */

const SETTINGS_KEY = 'settings';

class SettingsStore {
  current = $state<Settings>(structuredClone(defaultSettings));
  loaded = $state<boolean>(false);
  saving = $state<boolean>(false);
  savedAt = $state<number | null>(null);

  async load(): Promise<void> {
    try {
      const row = await db.kv.get(SETTINGS_KEY);
      if (row && row.value) {
        this.current = mergeSettings(defaultSettings, row.value as Partial<Settings>);
      }
    } catch (err) {
      console.error('Failed to load settings', err);
    } finally {
      this.loaded = true;
    }
  }

  async save(): Promise<void> {
    this.saving = true;
    try {
      // $state.snapshot strips the reactive proxy so Dexie stores a plain object.
      await db.kv.put({ key: SETTINGS_KEY, value: $state.snapshot(this.current) });
      this.savedAt = Date.now();
    } catch (err) {
      console.error('Failed to save settings', err);
      throw err;
    } finally {
      this.saving = false;
    }
  }
}

export const settingsStore = new SettingsStore();
