"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const esbuild = require("esbuild");

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

const componentPages = [
  "skucha.html",
  "skucha-print.html"
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

function disablePreviewTurnstile(deploymentEnvironment) {
  if (deploymentEnvironment !== "preview") {
    return;
  }

  const configPath = path.join(outputRoot, "config", "config.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  config.botProtection = config.botProtection || {};
  config.botProtection.turnstileSiteKey = "";
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
}

function replaceSection(source, startToken, endToken, replacement) {
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, start + startToken.length);
  if (start < 0 || end < 0) {
    throw new Error("Unable to harden generated runtime section: " + startToken);
  }
  return source.slice(0, start) + replacement + source.slice(end);
}

function buildReactRuntime() {
  esbuild.buildSync({
    absWorkingDir: apiRoot,
    bundle: true,
    define: { "process.env.NODE_ENV": '"production"' },
    format: "iife",
    minify: true,
    outfile: path.join(outputRoot, "react-runtime.js"),
    platform: "browser",
    stdin: {
      contents: [
        'import * as React from "react";',
        'import * as ReactDOM from "react-dom/client";',
        "window.React = React;",
        "window.ReactDOM = ReactDOM;"
      ].join("\n"),
      resolveDir: apiRoot,
      sourcefile: "react-runtime-entry.js"
    },
    target: "es2020"
  });
}

function hardenComponentRuntime() {
  const runtimePath = path.join(outputRoot, "support.js");
  let runtime = fs.readFileSync(runtimePath, "utf8").replace(/\r\n/g, "\n");

  runtime = replaceSection(
    runtime,
    "  function evalDcLogic(src) {",
    "\n\n  // src/component.ts",
    [
      "  function getPrecompiledLogic(name) {",
      "    const factories = window.__dcPrecompiledLogic || {};",
      "    const factory = factories[name];",
      "    if (typeof factory !== \"function\") {",
      "      throw new Error(\"Missing precompiled component logic: \" + name);",
      "    }",
      "    return factory(StreamableLogic, getReact());",
      "  }"
    ].join("\n")
  );
  runtime = runtime.replace("const Cls = evalDcLogic(src);", "const Cls = getPrecompiledLogic(name);");

  runtime = replaceSection(
    runtime,
    "  // src/external.ts",
    "\n\n  // src/atomics.ts",
    [
      "  // src/external.ts - disabled in the production artifact",
      "  function createExternalModules() {",
      "    const error = \"External component modules are disabled in production\";",
      "    return {",
      "      load: () => Promise.resolve(),",
      "      resolve: () => null,",
      "      resolveGlobal: () => null,",
      "      getError: () => error",
      "    };",
      "  }"
    ].join("\n")
  );

  runtime = replaceSection(
    runtime,
    "  var REACT_URL =",
    "  function init() {",
    [
      "  function hideRawTemplate() {",
      "    const style = document.createElement(\"style\");",
      "    style.textContent = \"x-dc{display:none!important}\";",
      "    document.head.appendChild(style);",
      "  }",
      ""
    ].join("\n")
  );
  runtime = runtime.replace(
    / {2}hideRawTemplate\(\);\s*loadReactUmd\(\)\.then\(init\)\.catch\(\(err\) => \{[\s\S]*?\n {2}\}\);/,
    [
      "  hideRawTemplate();",
      "  try {",
      "    init();",
      "  } catch (err) {",
      "    console.error(\"[dc] failed to boot:\", err);",
      "    throw err;",
      "  }"
    ].join("\n")
  );

  if (runtime.includes("new Function") || runtime.includes("unpkg.com") || runtime.includes("loadReactUmd")) {
    throw new Error("Production component runtime still contains dynamic or remote code loading");
  }
  new vm.Script(runtime, { filename: "support.js" });
  fs.writeFileSync(runtimePath, runtime);
}

function compileComponentPage(relativePath) {
  const targetPath = path.join(outputRoot, relativePath);
  const componentName = path.basename(relativePath, ".html");
  let html = fs.readFileSync(targetPath, "utf8");
  const componentScript = /<script type="text\/x-dc" data-dc-script([^>]*)>([\s\S]*?)<\/script>/;
  const match = componentScript.exec(html);
  if (!match || !match[2].trim()) {
    throw new Error("Missing component logic in " + relativePath);
  }

  const logicFileName = componentName + "-logic.js";
  const logicSource = [
    "window.__dcPrecompiledLogic = window.__dcPrecompiledLogic || {};",
    "window.__dcPrecompiledLogic[" + JSON.stringify(componentName) + "] = function (DCLogic) {",
    match[2],
    "return Component;",
    "};"
  ].join("\n");
  const transformed = esbuild.transformSync(logicSource, {
    format: "iife",
    loader: "js",
    minify: true,
    target: "es2020"
  });
  fs.writeFileSync(path.join(outputRoot, logicFileName), transformed.code);

  html = html.replace(
    componentScript,
    '<script type="text/x-dc" data-dc-script$1>precompiled:' + componentName + "</script>"
  );
  html = html.replace(
    '<script src="./support.js"></script>',
    '<script src="./react-runtime.js"></script>\n'
      + '<script src="./' + logicFileName + '"></script>\n'
      + '<script src="./support.js"></script>'
  );
  fs.writeFileSync(targetPath, html);
}

function extractInlineScripts() {
  const generatedDirectory = path.join(outputRoot, "assets", "generated");
  fs.mkdirSync(generatedDirectory, { recursive: true });

  publicFiles.filter(function (relativePath) {
    return relativePath.endsWith(".html");
  }).forEach(function (relativePath) {
    const targetPath = path.join(outputRoot, relativePath);
    let scriptIndex = 0;
    let html = fs.readFileSync(targetPath, "utf8");
    html = html.replace(/<script([^>]*)>([\s\S]*?)<\/script>/gi, function (full, attributes, body) {
      if (/\bsrc\s*=/.test(attributes)
        || /\btype\s*=\s*["'](?:text\/x-dc|application\/(?:json|ld\+json))["']/i.test(attributes)
        || !body.trim()) {
        return full;
      }
      scriptIndex += 1;
      const fileName = relativePath.replace(/[\\/.]+/g, "-").replace(/-html$/, "")
        + "-inline-" + scriptIndex + ".js";
      fs.writeFileSync(path.join(generatedDirectory, fileName), body.trim() + "\n");
      return '<script' + attributes + ' src="/assets/generated/' + fileName + '"></script>';
    });
    fs.writeFileSync(targetPath, html);
  });
}

function buildSite(options) {
  const deploymentEnvironment = options && options.deploymentEnvironment !== undefined
    ? options.deploymentEnvironment
    : process.env.SKUCHA_DEPLOYMENT_ENV;

  fs.rmSync(outputRoot, { recursive: true, force: true });
  fs.mkdirSync(outputRoot, { recursive: true });

  publicFiles.forEach(copyFile);
  publicDirectories.forEach(copyDirectory);
  disablePreviewTurnstile(deploymentEnvironment);
  buildReactRuntime();
  componentPages.forEach(compileComponentPage);
  hardenComponentRuntime();
  extractInlineScripts();

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
  publicFiles,
  componentPages
};