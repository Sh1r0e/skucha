"use strict";

const fs = require("fs");
const path = require("path");

const apiRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(apiRoot, "..");
const outputRoot = path.join(workspaceRoot, "site-dist");

const publicFiles = [
  "index.html",
  "skucha.html",
  "skucha-print.html",
  "skucha-payment-cancel.html",
  "skucha-payment-success.html",
  "reservation-cancel.html",
  "privacy-policy.html",
  "rental-terms.html",
  "under-construction.html",
  "privacy-policy-v1.0.pdf",
  "rental-terms-v1.0.pdf",
  "admin/reservations.html",
  "config/config-loader.js",
  "config/config.json",
  "maintenance-gate.js",
  "script.js",
  "styles.css",
  "support.js",
  "staticwebapp.config.json"
];

const publicDirectories = [
  "assets",
  "images"
];

function copyFile(relativePath) {
  const source = path.join(workspaceRoot, relativePath);
  const target = path.join(outputRoot, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function copyDirectory(relativePath) {
  const source = path.join(workspaceRoot, relativePath);
  const target = path.join(outputRoot, relativePath);
  fs.cpSync(source, target, { recursive: true });
}

function buildSite() {
  fs.rmSync(outputRoot, { recursive: true, force: true });
  fs.mkdirSync(outputRoot, { recursive: true });

  publicFiles.forEach(copyFile);
  publicDirectories.forEach(copyDirectory);

  console.log(JSON.stringify({
    outputRoot: outputRoot,
    fileCount: countFiles(outputRoot)
  }));
}

function countFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).reduce(function (count, entry) {
    const child = path.join(directory, entry.name);
    return count + (entry.isDirectory() ? countFiles(child) : 1);
  }, 0);
}

if (require.main === module) {
  try {
    buildSite();
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  buildSite,
  outputRoot,
  publicDirectories,
  publicFiles
};