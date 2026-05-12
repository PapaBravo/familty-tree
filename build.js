#!/usr/bin/env node
/**
 * Build script: copies required vendor files from node_modules into js/vendor/.
 * Run via: npm run build
 */

const fs = require('fs');
const path = require('path');

const root = __dirname;
const vendorDir = path.join(root, 'js', 'vendor');
const nm = path.join(root, 'node_modules');

// Ensure vendor directory exists (clean slate)
fs.rmSync(vendorDir, { recursive: true, force: true });
fs.mkdirSync(vendorDir, { recursive: true });

function copy(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log(`  copied ${path.relative(root, src)} → ${path.relative(root, dest)}`);
}

function copyDir(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      copy(srcPath, destPath);
    }
  }
}

console.log('Building vendor assets...');

// d3
copy(
  path.join(nm, 'd3', 'dist', 'd3.min.js'),
  path.join(vendorDir, 'd3.min.js')
);

// jszip
copy(
  path.join(nm, 'jszip', 'dist', 'jszip.min.js'),
  path.join(vendorDir, 'jszip.min.js')
);

// leaflet JS + CSS + images
// The npm package ships leaflet.js / leaflet.css (no separate .min files)
copy(
  path.join(nm, 'leaflet', 'dist', 'leaflet.js'),
  path.join(vendorDir, 'leaflet.min.js')
);
copy(
  path.join(nm, 'leaflet', 'dist', 'leaflet.css'),
  path.join(vendorDir, 'leaflet.min.css')
);
copyDir(
  path.join(nm, 'leaflet', 'dist', 'images'),
  path.join(vendorDir, 'images')
);

// leaflet.heat (ships a single JS file)
const leafletHeatDir = path.join(nm, 'leaflet.heat', 'dist');
const leafletHeatSrc = fs.existsSync(path.join(leafletHeatDir, 'leaflet-heat.js'))
  ? path.join(leafletHeatDir, 'leaflet-heat.js')
  : path.join(nm, 'leaflet.heat', 'leaflet-heat.js');
copy(leafletHeatSrc, path.join(vendorDir, 'leaflet-heat.js'));

console.log('Done.');
