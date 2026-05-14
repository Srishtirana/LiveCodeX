import express from "express";
import { createClient } from "redis";
import cors from "cors";
import { exec } from "child_process";
import fs from "fs/promises";
import path from "path";

const app = express();
app.use(express.json());
app.use(cors());

const redisClient = createClient();
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
      const pythonResult = await executeCommand(`python "${codeFile}" < "${inputFile}"`);
      if (!isCommandMissing(pythonResult)) {
        return pythonResult;
      }
      return await executeCommand(`py -3 "${codeFile}" < "${inputFile}"`);
    }

    if (language === "java") {
      const javaFileName = safeFileName(fileName, "Main.java");
      const mainClass = javaFileName.replace(/\.java$/i, "");
      const codeFile = path.join(runDir, javaFileName);
      await fs.writeFile(codeFile, code, "utf8");
      return await executeCommand(
        `cd /d "${runDir}" && javac "${codeFile}" && java -cp "${runDir}" ${mainClass} < "${inputFile}"`
      );
    }

    if (language === "cpp") {
      const codeFile = path.join(runDir, "userCode.cpp");
      const exeFile = path.join(runDir, "a.exe");
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
      const exeFile = path.join(runDir, "a.exe");
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

    const mountPath = dockerPath(runDir);
    const dockerCommands: Record<string, { file: string; command: string }> = {
      cpp: {
        file: "userCode.cpp",
        command:
          'docker run --rm --memory="256m" --cpus="1.0" --pids-limit 100 -v "' +
          mountPath +
          ':/usr/src/app" gcc:11 sh -c "g++ /usr/src/app/userCode.cpp -o /usr/src/app/a.out && /usr/src/app/a.out < /usr/src/app/input.txt"',
      },
      rust: {
        file: "userCode.rs",
        command:
          'docker run --rm --memory="256m" --cpus="1.0" --pids-limit 100 -v "' +
          mountPath +
          ':/usr/src/app" rust:latest sh -c "rustc /usr/src/app/userCode.rs -o /usr/src/app/a.out && /usr/src/app/a.out < /usr/src/app/input.txt"',
      },
      go: {
        file: "userCode.go",
        command:
          'docker run --rm --memory="256m" --cpus="1.0" --pids-limit 100 -v "' +
          mountPath +
          ':/usr/src/app" golang:1.20 sh -c "go run /usr/src/app/userCode.go < /usr/src/app/input.txt"',
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
          "Docker Desktop is required to run C++, Rust, and Go on this machine. Start Docker Desktop, then run again.",
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

  console.log(`Received submission from room ${roomId}`);

  try {
    const result = await runLocally(code, language, input, fileName);
    res.status(200).json({ ...result, fallback: true, submissionId });
  } catch (error) {
    console.log(error);
    res.status(500).send("Failed to run submission");
  }
});

const server = app.listen(3000, '0.0.0.0', () => {
  console.log("Express Server Listening on port 3000");
});

async function main() {
  try {
    await redisClient.connect();
    redisAvailable = true;

    console.log("Redis Client Connected");
  } catch (error) {
    redisAvailable = false;
    console.log("Failed to connect to Redis", error);
    console.log("Express server will run code locally for JavaScript and Python");
  }
}

main();
