const esbuild = require('esbuild');
const fs = require('fs');

const watch = process.argv.includes('--watch');

const buildOptions = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  format: 'cjs',
};

function copyStaticFiles() {
  fs.mkdirSync('dist/media', { recursive: true });
  fs.mkdirSync('dist/agent', { recursive: true });
  fs.copyFileSync('src/webview/media/main.js', 'dist/media/main.js');
  fs.copyFileSync('src/webview/media/style.css', 'dist/media/style.css');
  fs.copyFileSync('agent/instrument.js', 'dist/agent/instrument.js');
}

async function run() {
  copyStaticFiles();
  if (watch) {
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    console.log('esbuild watching for changes...');
  } else {
    await esbuild.build(buildOptions);
    console.log('esbuild build complete.');
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
