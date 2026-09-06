#!/usr/bin/env node

/**
 * Release gate for Tauri's latest.json.
 *
 * It catches the easy-to-miss failure where the manifest is published but one
 * platform points at a missing or placeholder asset. The script accepts either
 * an https URL or a local JSON path so it is useful in CI and offline tests.
 */

import { readFile } from "node:fs/promises";

const source = process.argv[2] ||
  "https://github.com/AJSubrizi/Pi-App/releases/latest/download/latest.json";
const expectedPlatforms = [
  "darwin-aarch64",
  "darwin-x86_64",
  "windows-x86_64",
  "linux-x86_64",
];

async function readManifest(value) {
  if (/^https?:\/\//i.test(value)) {
    const response = await fetch(value, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`manifest request failed: HTTP ${response.status}`);
    return response.json();
  }
  return JSON.parse(await readFile(value, "utf8"));
}

async function assertAsset(url, platform) {
  let response = await fetch(url, { method: "HEAD", redirect: "follow" });
  if (response.status === 405 || response.status === 403) {
    response = await fetch(url, {
      headers: { range: "bytes=0-0" },
      redirect: "follow",
    });
  }
  if (!response.ok) {
    throw new Error(`${platform} asset is not reachable: HTTP ${response.status} (${url})`);
  }
}

try {
  const manifest = await readManifest(source);
  const platforms = manifest?.platforms;
  if (!platforms || typeof platforms !== "object") {
    throw new Error("manifest has no platforms object");
  }
  for (const platform of expectedPlatforms) {
    const entry = platforms[platform];
    if (!entry || typeof entry.url !== "string" || !/^https?:\/\//i.test(entry.url)) {
      throw new Error(`${platform} is missing a public https asset URL`);
    }
    if (typeof entry.signature !== "string" || !entry.signature.trim()) {
      throw new Error(`${platform} is missing an updater signature`);
    }
    if (/^https?:\/\//i.test(source)) await assertAsset(entry.url, platform);
  }
  console.log(`validated ${expectedPlatforms.length} update assets from ${source}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

