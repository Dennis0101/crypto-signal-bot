import fs from 'node:fs/promises';
import path from 'node:path';

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const from = path.join(src, e.name);
    const to = path.join(dest, e.name);
    if (e.isDirectory()) {
      await copyDir(from, to);
    } else if (e.isFile()) {
      await fs.copyFile(from, to);
    }
  }
}

const root = process.cwd();
const srcDir = path.join(root, 'src', 'saas', 'web');
const distDir = path.join(root, 'dist', 'saas', 'web');

if (!(await exists(srcDir))) {
  console.error(`Missing source dir: ${srcDir}`);
  process.exit(1);
}
if (!(await exists(path.join(root, 'dist')))) {
  console.error('dist/ not found. Run `npm run build` first.');
  process.exit(1);
}

await copyDir(srcDir, distDir);
console.log(`Copied SaaS web assets -> ${distDir}`);

