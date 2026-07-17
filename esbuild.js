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
const path = require('path'); // Add this import at the top of your file

function copyStaticFiles() {
  // Ensure the distribution folders exist
  fs.mkdirSync(path.join(__dirname, 'dist/media'), { recursive: true });
  fs.mkdirSync(path.join(__dirname, 'dist/agent'), { recursive: true });

  // Source files - Update 'src/agent/instrument.js' if it lives inside src/!
  const srcMediaJs = path.join(__dirname, 'src/webview/media/main.js');
  const srcMediaCss = path.join(__dirname, 'src/webview/media/style.css');
  const srcAgentJs = path.join(__dirname, 'src/agent/instrument.js'); 

  // Destination files
  const destMediaJs = path.join(__dirname, 'dist/media/main.js');
  const destMediaCss = path.join(__dirname, 'dist/media/style.css');
  const destAgentJs = path.join(__dirname, 'dist/agent/instrument.js');

  // Verify source file exists before copying to prevent ENOENT crashes
  if (fs.existsSync(srcAgentJs)) {
    fs.copyFileSync(srcMediaJs, destMediaJs);
    fs.copyFileSync(srcMediaCss, destMediaCss);
    fs.copyFileSync(srcAgentJs, destAgentJs);
  } else {
    console.error(`Error: Source file not found at ${srcAgentJs}`);
    process.exit(1);
  }
}
// function copyStaticFiles() {
//   fs.mkdirSync('dist/media', { recursive: true });
//   fs.mkdirSync('dist/agent', { recursive: true });
//   fs.copyFileSync('src/webview/media/main.js', 'dist/media/main.js');
//   fs.copyFileSync('src/webview/media/style.css', 'dist/media/style.css');
//   fs.copyFileSync('agent/instrument.js', 'dist/agent/instrument.js');
// }

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
