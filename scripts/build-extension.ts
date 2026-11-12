/**
 * Builds the SCOUT Live browser extension into extension/dist/, ready for "Load unpacked" in Chrome or Edge.
 * `npm run build:extension -- --zip` also writes exports/scout-live.zip for sharing.
 */
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';

const root = path.resolve(__dirname, '..');
const src = path.join(root, 'extension', 'src');
const staticDir = path.join(root, 'extension', 'static');
const dist = path.join(root, 'extension', 'dist');

async function main(): Promise<void> {
    rmSync(dist, { recursive: true, force: true });
    mkdirSync(path.join(dist, 'icons'), { recursive: true });

    await build({
        entryPoints: ['background', 'content', 'popup', 'options'].map((name) => path.join(src, `${name}.ts`)),
        outdir: dist,
        bundle: true,
        format: 'iife',
        target: 'chrome116',
        minify: false,
        sourcemap: false,
        legalComments: 'none',
        logLevel: 'warning',
    });

    copyFileSync(path.join(root, 'extension', 'manifest.json'), path.join(dist, 'manifest.json'));
    for (const file of readdirSync(staticDir)) copyFileSync(path.join(staticDir, file), path.join(dist, file));
    // SCOUT's app icon; Chrome scales it for the toolbar and notifications.
    for (const size of [16, 48, 128]) copyFileSync(path.join(root, 'app', 'apple-icon.png'), path.join(dist, 'icons', `icon${size}.png`));

    const manifest = JSON.parse(readFileSync(path.join(dist, 'manifest.json'), 'utf8')) as { version: string };
    console.log(`Built SCOUT Live ${manifest.version} -> ${path.relative(root, dist)}`);

    if (process.argv.includes('--zip')) {
        const zip = new JSZip();
        const add = (dir: string, prefix = '') => {
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) add(full, `${prefix}${entry.name}/`);
                else zip.file(`${prefix}${entry.name}`, readFileSync(full));
            }
        };
        add(dist);
        mkdirSync(path.join(root, 'exports'), { recursive: true });
        const out = path.join(root, 'exports', 'scout-live.zip');
        writeFileSync(out, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
        console.log(`Zipped -> ${path.relative(root, out)}`);
    }
}

main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});
