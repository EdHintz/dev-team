// App management service — CRUD for apps with JSON file persistence

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config.js';
import type { App } from '../../shared/types.js';

export function getAppSprintsDir(rootFolder: string): string {
  return path.join(rootFolder, 'sprints');
}

export function getAppSpecsDir(rootFolder: string): string {
  return path.join(rootFolder, 'specs');
}

export function getAllAppRootFolders(): string[] {
  return readApps().map((a) => a.rootFolder);
}

const APPS_FILE = path.join(DATA_DIR, 'apps.json');

// Seed app created on first access
const SEED_APPS: App[] = [
  {
    id: 'macro-econ',
    name: 'Macro Econ',
    rootFolder: '/Users/edhintz/dev/macro-econ',
    createdAt: new Date().toISOString(),
  },
];

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readApps(): App[] {
  ensureDataDir();
  if (!fs.existsSync(APPS_FILE)) {
    // Seed on first access
    writeApps(SEED_APPS);
    return SEED_APPS;
  }
  try {
    return JSON.parse(fs.readFileSync(APPS_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function writeApps(apps: App[]): void {
  ensureDataDir();
  fs.writeFileSync(APPS_FILE, JSON.stringify(apps, null, 2));
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function listApps(): App[] {
  return readApps();
}

export function getApp(id: string): App | undefined {
  return readApps().find((a) => a.id === id);
}

export function createApp(name: string, rootFolder: string): App {
  const apps = readApps();
  const id = slugify(name);

  if (apps.some((a) => a.id === id)) {
    throw new Error(`App with id "${id}" already exists`);
  }

  const app: App = {
    id,
    name,
    rootFolder,
    createdAt: new Date().toISOString(),
  };

  apps.push(app);
  writeApps(apps);
  return app;
}
