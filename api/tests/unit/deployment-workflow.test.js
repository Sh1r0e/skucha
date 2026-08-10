"use strict";

const fs = require("fs");
const path = require("path");

const workflowPath = path.resolve(
  __dirname,
  "../../..",
  ".github",
  "workflows",
  "azure-static-web-apps-witty-bush-0164ebc10.yml"
);

describe("deployment workflow", function () {
  it("should deploy only main to production and development-preview to a preview environment", function () {
    const workflow = fs.readFileSync(workflowPath, "utf8").replace(/\r\n/g, "\n");
    const uploadJobStart = workflow.indexOf("  build_and_deploy_job:");
    const uploadJobEnd = workflow.indexOf("\n  close_pull_request_job:");

    expect(workflow).toMatch(
      /^on:\n\x20{2}push:\n\x20{4}branches:\n\x20{6}- main\n\x20{6}- development-preview\n\x20{2}pull_request:/m
    );
    expect(uploadJobStart).toBeGreaterThan(-1);
    expect(uploadJobEnd).toBeGreaterThan(uploadJobStart);

    const uploadJob = workflow.slice(uploadJobStart, uploadJobEnd);

    expect(uploadJob).toMatch(/uses: Azure\/static-web-apps-deploy@v1/);
    expect(uploadJob).toMatch(/^\s+production_branch: "main"\s*$/m);
  });
});