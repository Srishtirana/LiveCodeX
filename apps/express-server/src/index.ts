import express from "express";
import { createClient } from "redis";
import cors from "cors";
import { exec } from "child_process";
import fs from "fs/promises";
import path from "path";

const app = express();
app.use(express.json());

// ✅ CORS — allows requests from local dev and Vercel
app.use(cors({
  origin: [
    "http://localhost:5173",
    "https://live-code-x-frontend.vercel.app",
    /\.vercel\.app$/,
  ],
  credentials: true,
}));

const redisClient = createClient({
  url: process.env.REDIS_URL || "redis://localhost:6379",
});
let redisAvailable = false;

redisClient.on("error", (err) => console.log("Redis Client Error", err));

type RunResult = {
  output: string;
  success: boolean;
};

function executeCommand(command: string): Promise<RunResult> {
  return new Promise((resolve) => {
    exec(command, { timeout: 10000 }, (error, stdout, stderr) => {
      let result = [stdout, stderr].filter(Boolean).join("\n").trim();
      if (error) {
        result = result || `Error: ${error.message}`;
      }
      resolve({
        output: result || "Program finished successfully with no output.",
        success: !error && !stderr,
      });
    });
  });
}

function dockerPath(filePath: string) {
  return filePath.replace(/\\/g, "/");
}

function safeFileName(fileName: string, fallback: string) {
  const base = path.basename(fileName || fallback).replace(/[^\w.$-]/g, "_");
  return base || fallback;
}

function isCommandMissing(result: RunResult) {
  return (
    result.output.includes("not recognized") ||
    result.output.includes("Python was not found") ||
    result.output.includes("is not recognized")
  );
}

async function runLocally(
  code: string,
  language: string,
  input: string,
  fileName = ""
): Promise<RunResult> {
  const runDir = path.resolve(`./tmp/local-${Date.now()}`);
  await fs.mkdir(runDir, { recursive: true });

  try {
    const inputFile = path.join(runDir, "input.txt");
    await fs.writeFile(inputFile, input || "", "utf8");

    if (language === "javascript") {
      const codeFile = path.join(runDir, "userCode.js");
      await fs.writeFile(codeFile, code, "utf8");
      return await executeCommand(`node "${codeFile}" < "${inputFile}"`);
    }

    if (language === "python") {
      const codeFile = path.join(runDir, "userCode.py");
      await fs.writeFile(codeFile, code, "utf8");
      const pythonResult = await executeCommand(`python3 "${codeFile}" < "${inputFile}"`);
      if (!isCommandMissing(pythonResult)) {
        return pythonResult;
      }
      return await executeCommand(`python "${codeFile}" < "${inputFile}"`);
    }

    if (language === "java") {
      // ✅ Extract class name so filename matches — Java requires this
      const classMatch = code.match(/public\s+class\s+(\w+)/);
      const className = classMatch ? classMatch[1] : "Main";
      const javaFileName = `${className}.java`;
      const codeFile = path.join(runDir, javaFileName);
      await fs.writeFile(codeFile, code, "utf8");
      return await executeCommand(
        `cd "${runDir}" && javac "${javaFileName}" && java -cp "${runDir}" ${className} < "${inputFile}"`
      );
    }

    if (language === "cpp") {
      const codeFile = path.join(runDir, "userCode.cpp");
      const exeFile = path.join(runDir, "a.out");
      await fs.writeFile(codeFile, code, "utf8");
      const nativeResult = await executeCommand(
        `g++ "${codeFile}" -o "${exeFile}" && "${exeFile}" < "${inputFile}"`
      );
      if (!isCommandMissing(nativeResult)) {
        return nativeResult;
      }
    }

    if (language === "rust") {
      const codeFile = path.join(runDir, "userCode.rs");
      const exeFile = path.join(runDir, "a.out");
      await fs.writeFile(codeFile, code, "utf8");
      const nativeResult = await executeCommand(
        `rustc "${codeFile}" -o "${exeFile}" && "${exeFile}" < "${inputFile}"`
      );
      if (!isCommandMissing(nativeResult)) {
        return nativeResult;
      }
    }

    if (language === "go") {
      const codeFile = path.join(runDir, "userCode.go");
      await fs.writeFile(codeFile, code, "utf8");
      const nativeResult = await executeCommand(`go run "${codeFile}" < "${inputFile}"`);
      if (!isCommandMissing(nativeResult)) {
        return nativeResult;
      }
    }

    // ✅ Docker fallback for C++, Rust, Go when native compilers not available
    const mountPath = dockerPath(runDir);
    const dockerCommands: Record<string, { file: string; command: string }> = {
      cpp: {
        file: "userCode.cpp",
        command:
          `docker run --rm --memory="256m" --cpus="1.0" --pids-limit 100 -v "${mountPath}:/usr/src/app" gcc:11 sh -c "g++ /usr/src/app/userCode.cpp -o /usr/src/app/a.out && /usr/src/app/a.out < /usr/src/app/input.txt"`,
      },
      rust: {
        file: "userCode.rs",
        command:
          `docker run --rm --memory="256m" --cpus="1.0" --pids-limit 100 -v "${mountPath}:/usr/src/app" rust:latest sh -c "rustc /usr/src/app/userCode.rs -o /usr/src/app/a.out && /usr/src/app/a.out < /usr/src/app/input.txt"`,
      },
      go: {
        file: "userCode.go",
        command:
          `docker run --rm --memory="256m" --cpus="1.0" --pids-limit 100 -v "${mountPath}:/usr/src/app" golang:1.20 sh -c "go run /usr/src/app/userCode.go < /usr/src/app/input.txt"`,
      },
    };

    const dockerRun = dockerCommands[language];
    if (!dockerRun) {
      return { output: `Unsupported language: ${language}`, success: false };
    }

    await fs.writeFile(path.join(runDir, dockerRun.file), code, "utf8");
    const result = await executeCommand(dockerRun.command);

    if (
      result.output.toLowerCase().includes("docker") &&
      (result.output.includes("not recognized") ||
        result.output.includes("Cannot connect") ||
        result.output.includes("pipe") ||
        result.output.includes("daemon"))
    ) {
      return {
        output:
          "Docker is required to run C++, Rust, and Go on this server. Please contact the admin.",
        success: false,
      };
    }

    return result;
  } finally {
    await fs.rm(runDir, { recursive: true, force: true });
  }
}

app.post("/submit", async (req, res) => {
  const { code, language, roomId, input, fileName } = req.body;
  const submissionId = `submission-${Date.now()}-${roomId}`;

  console.log(`Received submission from room ${roomId} | language: ${language}`);

  try {
    const result = await runLocally(code, language, input, fileName);
    res.status(200).json({ ...result, fallback: true, submissionId });
  } catch (error) {
    console.log(error);
    res.status(500).send("Failed to run submission");
  }
});

// ✅ Health check — Render pings this to keep the service alive
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Express Server listening on port ${PORT}`);
});

async function main() {
  try {
    await redisClient.connect();
    redisAvailable = true;
    console.log("Redis Client Connected");
  } catch (error) {
    redisAvailable = false;
    console.log("Redis unavailable — running code locally");
  }
}

main();