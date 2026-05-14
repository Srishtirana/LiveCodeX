const { spawn } = require("child_process");
const path = require("path");

const root = path.resolve(__dirname, "..");

const services = [
  ["frontend", ["run", "dev", "--workspace", "frontend", "--", "--host", "127.0.0.1"]],
  ["express-server", ["run", "dev", "--workspace", "express-server"]],
  ["websocket-server", ["run", "dev", "--workspace", "websocket-server"]],
];

for (const [name, args] of services) {
  const child = spawn("npm.cmd", args, {
    cwd: root,
    stdio: "inherit",
    shell: true,
    windowsHide: false,
  });

  child.on("exit", (code) => {
    console.log(`[${name}] exited with code ${code}`);
  });
}
