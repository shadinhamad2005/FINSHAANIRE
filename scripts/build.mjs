import fs from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const testing = process.argv.includes('--test'), release = process.argv.includes('--release');
const siteKey = process.env.FINZ_APPCHECK_SITE_KEY || '';
if (release && !siteKey) throw new Error('FINZ_APPCHECK_SITE_KEY is required for a release build. Local builds do not enforce App Check.');
const output = path.resolve(testing ? '.test-dist' : 'dist');
await fs.mkdir(path.join(output, 'assets'), { recursive: true });
await build({ entryPoints: ['src/app/bootstrap.js'], bundle: true, format: 'iife', platform: 'browser', target: ['es2022'],
    outfile: path.join(output, 'assets/app.js'), minify: !testing, sourcemap: testing ? 'inline' : false,
    define: { __FINZ_TEST__: JSON.stringify(testing), __FINZ_APPCHECK_SITE_KEY__: JSON.stringify(siteKey) }
});
const tailwind = spawnSync(process.execPath, [require.resolve('tailwindcss/lib/cli.js'), '-i', 'src/styles/tailwind.css', '-o', path.join(output, 'assets/app.css'), '--minify'], { encoding: 'utf8' });
if (tailwind.status !== 0) throw new Error(tailwind.stderr || tailwind.error?.message || 'Stylesheet build failed.');
const customCss = await fs.readFile('src/styles/app.css', 'utf8');
const imports = customCss.match(/@import\s+url\([^)]+\)[^;\r\n]*;?/g) || [];
const cleanCustomCss = customCss.replace(/@import\s+url\([^)]+\)[^;\r\n]*;?/g, '');
const builtCss = await fs.readFile(path.join(output, 'assets/app.css'), 'utf8');
await fs.writeFile(path.join(output, 'assets/app.css'), (imports.length ? imports.join('\n') + '\n' : '') + builtCss + '\n' + cleanCustomCss);
const csp = ["default-src 'self'", "script-src 'self' https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/ https://www.recaptcha.net/recaptcha/", "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", "font-src 'self' https://fonts.gstatic.com", "img-src 'self' data: blob:",
    "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://*.cloudfunctions.net https://*.run.app https://api.exchangerate-api.com https://api.mfapi.in https://api.gold-api.com https://www.google.com https://www.recaptcha.net",
    "frame-src https://my-finance-454c2.firebaseapp.com https://www.google.com https://www.recaptcha.net", "object-src 'none'", "base-uri 'self'", "form-action 'self'"].join('; ');
let html = await fs.readFile('index.html', 'utf8');
html = html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}">`);
if (/\bon(?:click|change|input|keydown|submit)\s*=/.test(html)) throw new Error('Inline event handler found in the HTML shell.');
await fs.writeFile(path.join(output, 'index.html'), html);
for (const file of ['manifest.json', 'sw.js']) await fs.copyFile(file, path.join(output, file));
if (!testing) {
    await fs.mkdir('assets', { recursive: true });
    await fs.copyFile(path.join(output, 'assets/app.js'), 'assets/app.js');
    await fs.copyFile(path.join(output, 'assets/app.css'), 'assets/app.css');
}
await fs.writeFile(path.join(output, 'build-info.json'), JSON.stringify({ version: '2.7.0', testing, appCheckConfigured: Boolean(siteKey) }));
console.log(`Built ${testing ? 'test' : 'application'} files in ${path.basename(output)}. App Check configured: ${Boolean(siteKey)}.`);
