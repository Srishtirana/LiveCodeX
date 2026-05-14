const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

const services = [
  ["express-server", path.join(root, "apps", "express-server"), path.join(root, "apps", "express-server", "dist", "index.js")],
  ["websocket-server", path.join(root, "apps", "websocket-server"), path.join(root, "apps", "websocket-server", "dist", "index.js")],
];

for (const [name, cwd, entry] of services) {
  const out = fs.openSync(path.join(root, `${name}.log`), "a");
  const err = fs.openSync(path.join(root, `${name}.err.log`), "a");
  const child = spawn(process.execPath, [entry], {
    cwd,
    stdio: ["ignore", out, err],
    detached: true,
    shell: false,
    windowsHide: true,
  });

  child.unref();
  console.log(`[${name}] started as pid ${child.pid}`);
}
