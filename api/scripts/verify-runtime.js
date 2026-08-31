"use strict";

const fs = require("fs");
const path = require("path");

const apiRoot = path.join(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(apiRoot, "package.json"), "utf8"));
const requiredProductionPackages = [
  "@azure/communication-email",
  "@azure/data-tables",
  "stripe"
];

function listFunctionDirectories(directory) {
  const functionDirectories = [];

  fs.readdirSync(directory, { withFileTypes: true }).forEach(function (entry) {
    if (!entry.isDirectory() || ["node_modules", "coverage", "tests", "scripts"].includes(entry.name)) {
      return;
    }

    const childDirectory = path.join(directory, entry.name);
    if (fs.existsSync(path.join(childDirectory, "function.json"))) {
      functionDirectories.push(childDirectory);
    }

    functionDirectories.push(...listFunctionDirectories(childDirectory));
  });

  return functionDirectories;
}

function verifyProductionPackages() {
  requiredProductionPackages.forEach(function (packageName) {
    require.resolve(packageName, { paths: [apiRoot] });
  });
}

function verifyFunctionEntrypoints() {
  listFunctionDirectories(apiRoot).forEach(function (directory) {
    const entrypoint = path.join(directory, "index.js");
    if (!fs.existsSync(entrypoint)) {
      throw new Error("Missing Function entrypoint: " + entrypoint);
    }
    require(entrypoint);
  });
}

function verifyPackageEntrypoint() {
  const main = packageJson.main || "index.js";
  require(path.join(apiRoot, main));
}

verifyProductionPackages();
verifyPackageEntrypoint();
verifyFunctionEntrypoints();

console.log(JSON.stringify({
  node: process.version,
  packageEngine: packageJson.engines && packageJson.engines.node,
  productionPackages: requiredProductionPackages,
  functionEntrypoints: listFunctionDirectories(apiRoot).length,
  verified: true
}));
