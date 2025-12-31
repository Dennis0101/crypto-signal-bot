// src/paper/persist.ts
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { CONFIG } from '../config.js';
/**
 * JSON 스냅샷을 디스크에 안전하게 저장/로드하는 유틸.
 * - 원자적 쓰기(임시파일 → rename)
 * - 자동 디렉토리 생성
 * - 버전 필드 포함(향후 마이그레이션 대비)
 */
const DATA_DIR = CONFIG?.DATA_DIR || './data';
const SNAPSHOT_FILE = path.join(DATA_DIR, 'paper-store.json');
const VERSION = 1;
async function ensureDir(p) {
    await fsp.mkdir(p, { recursive: true }).catch(() => { });
}
export async function loadSnapshot() {
    try {
        await ensureDir(DATA_DIR);
        await fsp.access(SNAPSHOT_FILE, fs.constants.F_OK);
    }
    catch {
        return null;
    }
    try {
        const raw = await fsp.readFile(SNAPSHOT_FILE, 'utf8');
        const json = JSON.parse(raw);
        if (!json || typeof json !== 'object')
            return null;
        if (typeof json.version !== 'number')
            return null;
        return json;
    }
    catch (e) {
        console.error('[persist] loadSnapshot error:', e);
        return null;
    }
}
export async function saveSnapshot(s) {
    try {
        await ensureDir(DATA_DIR);
        const tmp = SNAPSHOT_FILE + '.tmp';
        const txt = JSON.stringify(s, null, 2);
        await fsp.writeFile(tmp, txt, 'utf8');
        await fsp.rename(tmp, SNAPSHOT_FILE);
    }
    catch (e) {
        console.error('[persist] saveSnapshot error:', e);
    }
}
export function makeEmptySnapshot() {
    return { version: VERSION, savedAt: Date.now(), accounts: {} };
}
