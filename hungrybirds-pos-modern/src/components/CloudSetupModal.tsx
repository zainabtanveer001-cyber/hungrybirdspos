import { useState } from 'react';
import { Modal } from './Modal';
import { configManager } from '../lib/config';
import { logAudit } from '../lib/audit';

export function CloudSetupModal({ username, notify, onClose }: {
  username: string;
  notify: (message: string) => void;
  onClose: () => void;
}) {
  const [projectId, setProjectId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [testing, setTesting] = useState(false);

  async function testConnection() {
    if (!projectId || !apiKey) {
      notify('Please enter both Project ID and API Key.');
      return;
    }
    setTesting(true);
    try {
      // Attempt to read a public document or just the project metadata
      // Using a simple GET to the projects endpoint to verify the API key and Project ID
      const res = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents?key=${apiKey}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`Connection failed: ${res.status}`);
      notify('Connection successful!');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not connect to Firebase.');
    } finally {
      setTesting(false);
    }
  }

  async function save() {
    if (!projectId || !apiKey) {
      notify('Please enter both Project ID and API Key.');
      return;
    }
    await configManager.setConfig(projectId, apiKey);
    await logAudit('CLOUD_CONFIG_UPDATED', `Project: ${projectId}`, username);
    notify('Cloud configuration saved successfully.');
    onClose();
  }

  return (
    <Modal
      title="Cloud Setup Wizard"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-xs font-bold bg-gray-100 text-gray-700 hover:bg-gray-200">
            Cancel
          </button>
          <button
            type="button"
            onClick={testConnection}
            disabled={testing}
            className="px-4 py-2 rounded-xl text-xs font-bold bg-gray-200 text-gray-700 hover:bg-gray-300 disabled:opacity-50"
          >
            {testing ? 'Testing...' : 'Test Connection'}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={testing}
            className="px-4 py-2 rounded-xl text-xs font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Save Config
          </button>
        </div>
      }
    >
      <div className="space-y-4 py-2">
        <p className="text-xs text-gray-500">
          Enter your Firebase project credentials to enable multi-device synchronization and website order integration.
        </p>
        <div className="space-y-3">
          <label className="block">
            <span className="block text-[10px] font-bold uppercase tracking-wide text-gray-600 mb-1">Firebase Project ID</span>
            <input
              type="text"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              placeholder="e.g. hungry-birds-12345"
              className="w-full p-2.5 text-xs ring-1 ring-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
          <label className="block">
            <span className="block text-[10px] font-bold uppercase tracking-wide text-gray-600 mb-1">Firebase API Key</span>
            <input
              type="text"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="AIzaSy..."
              className="w-full p-2.5 text-xs ring-1 ring-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
        </div>
      </div>
    </Modal>
  );
}
