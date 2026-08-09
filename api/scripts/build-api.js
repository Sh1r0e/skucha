"use strict";

const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");

const apiRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(apiRoot, "..");
const outputRoot = path.join(workspaceRoot, "api-dist");
const ignoredDirectories = new Set(["node_modules", "coverage", "tests", "scripts"]);

function findFunctionDirectories(directory) {
  const result = [];

  fs.readdirSync(directory, { withFileTypes: true }).forEach(function (entry) {
    if (!entry.isDirectory() || ignoredDirectories.has(entry.name)) {
      return;
    }

    const childDirectory = path.join(directory, entry.name);
    const functionJson = path.join(childDirectory, "function.json");
    const entrypoint = path.join(childDirectory, "index.js");

    if (fs.existsSync(functionJson) && fs.existsSync(entrypoint)) {
      result.push({ directory: childDirectory, functionJson, entrypoint });
    }

    result.push(...findFunctionDirectories(childDirectory));
  });

  return result;
}

function relativeFunctionPath(directory) {
  return path.relative(apiRoot, directory);
}

async function buildApi() {
  fs.rmSync(outputRoot, { recursive: true, force: true });
  fs.mkdirSync(outputRoot, { recursive: true });

  fs.copyFileSync(path.join(apiRoot, "host.json"), path.join(outputRoot, "host.json"));
  fs.copyFileSync(path.join(apiRoot, "index.js"), path.join(outputRoot, "index.js"));
  fs.cpSync(path.join(workspaceRoot, "config"), path.join(outputRoot, "config"), { recursive: true });

  const packageJson = {
    name: "skucha-api-dist",
    version: "1.0.0",
    private: true,
    main: "index.js",
    engines: { node: ">=22 <25" }
  };
  fs.writeFileSync(
    path.join(outputRoot, "package.json"),
    JSON.stringify(packageJson, null, 2) + "\n"
  );

  const functions = findFunctionDirectories(apiRoot);

  for (const functionInfo of functions) {
    const relativePath = relativeFunctionPath(functionInfo.directory);
    const outputDirectory = path.join(outputRoot, relativePath);
    fs.mkdirSync(outputDirectory, { recursive: true });
    fs.copyFileSync(functionInfo.functionJson, path.join(outputDirectory, "function.json"));

    await esbuild.build({
      bundle: true,
      entryPoints: [functionInfo.entrypoint],
      outfile: path.join(outputDirectory, "index.js"),
      format: "cjs",
      keepNames: true,
      legalComments: "none",
      platform: "node",
      target: "node22"
    });
  }

  console.log(JSON.stringify({
    outputRoot: outputRoot,
    functionCount: functions.length,
    outputFiles: fs.readdirSync(outputRoot).length
  }));
}

buildApi().catch(function (error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
