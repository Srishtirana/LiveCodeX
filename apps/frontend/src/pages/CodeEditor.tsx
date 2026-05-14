import React, { useEffect, useMemo, useRef, useState } from "react";
import MonacoEditor from "@monaco-editor/react";
import { useRecoilState } from "recoil";
import {
  FiChevronRight,
  FiCode,
  FiCopy,
  FiEdit2,
  FiFile,
  FiFolder,
  FiFolderPlus,
  FiLayers,
  FiPlay,
  FiPlus,
  FiRefreshCw,
  FiTrash2,
  FiUserCheck,
  FiUsers,
  FiZap,
} from "react-icons/fi";
import { useNavigate, useParams } from "react-router-dom";
import { connectedUsersAtom } from "../atoms/connectedUsersAtom";
import { socketAtom } from "../atoms/socketAtom";
import { userAtom } from "../atoms/userAtom";
import { EXPRESS_BASE_URL, WS_BASE_URL } from "../Globle";

type WorkspaceFolder = {
  id: string;
  name: string;
};

type WorkspaceFile = {
  id: string;
  name: string;
  folderId: string;
  language: string;
  code: string;
  version?: number;
  updatedAt?: number;
  updatedBy?: string;
  updatedByName?: string;
};

type WorkspaceSpace = {
  id: string;
  name: string;
  ownerId: string;
  members: string[];
  folders: WorkspaceFolder[];
  files: WorkspaceFile[];
};

type RemoteCursor = {
  userId: string;
  name: string;
  fileId: string;
  lineNumber: number;
  column: number;
};

type WorkspaceMember = {
  userId: string;
  name: string;
  lastSeen?: number;
};

type OutputEntry = {
  id: string;
  text: string;
  success: boolean;
  kind?: "command" | "output" | "error" | "info";
};

const languageExtensions: Record<string, string> = {
  javascript: "js",
  python: "py",
  cpp: "cpp",
  java: "java",
  rust: "rs",
  go: "go",
};

const defaultFileNames: Record<string, string> = {
  javascript: "main.js",
  python: "main.py",
  cpp: "main.cpp",
  java: "Main.java",
  rust: "main.rs",
  go: "main.go",
};

const starterCode: Record<string, string> = {
  javascript: `const fs = require("fs");\nconst input = fs.readFileSync(0, "utf8").trim();\nconsole.log(input || "Hello from JavaScript");\n`,
  python: `import sys\n\ninput_data = sys.stdin.read().strip()\nprint(input_data or "Hello from Python")\n`,
  cpp: `#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    string input;\n    getline(cin, input);\n    cout << (input.empty() ? "Hello from C++" : input) << endl;\n    return 0;\n}\n`,
  java: `import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner scanner = new Scanner(System.in);\n        System.out.println(scanner.hasNextLine() ? scanner.nextLine() : "Hello from Java");\n    }\n}\n`,
  rust: `use std::io::{self, Read};\n\nfn main() {\n    let mut input = String::new();\n    io::stdin().read_to_string(&mut input).unwrap();\n    println!("{}", if input.trim().is_empty() { "Hello from Rust" } else { input.trim() });\n}\n`,
  go: `package main\n\nimport (\n    "fmt"\n    "io"\n    "os"\n    "strings"\n)\n\nfunc main() {\n    bytes, _ := io.ReadAll(os.Stdin)\n    input := strings.TrimSpace(string(bytes))\n    if input == "" {\n        input = "Hello from Go"\n    }\n    fmt.Println(input)\n}\n`,
};

const themes = {
  aurora: {
    name: "Aurora",
    shell: "#091016",
    panel: "#0d1820",
    panelSoft: "#122330",
    border: "#224052",
    accent: "#49d2c7",
    accentTwo: "#ffbf69",
    text: "#edf7f6",
    muted: "#88a5ad",
    monaco: "vs-dark",
  },
  ember: {
    name: "Ember",
    shell: "#160f12",
    panel: "#211519",
    panelSoft: "#2b1c20",
    border: "#4f3035",
    accent: "#ff7661",
    accentTwo: "#ffd166",
    text: "#fff7f2",
    muted: "#c5a79d",
    monaco: "vs-dark",
  },
  daylight: {
    name: "Daylight",
    shell: "#edf2ef",
    panel: "#ffffff",
    panelSoft: "#e7efeb",
    border: "#c4d4cd",
    accent: "#2563eb",
    accentTwo: "#0f9f6e",
    text: "#12201b",
    muted: "#5b6e66",
    monaco: "vs",
  },
};

const createId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const getConnectionId = () => {
  const existing = sessionStorage.getItem("livecodex-connection-id");
  if (existing) return existing;

  const next = createId("connection");
  sessionStorage.setItem("livecodex-connection-id", next);
  return next;
};

const createFolder = (name = "src"): WorkspaceFolder => ({
  id: createId("folder"),
  name,
});

const createFile = (
  language = "javascript",
  folderId = "root",
  name?: string
): WorkspaceFile => ({
  id: createId("file"),
  folderId,
  name: name || defaultFileNames[language] || `main.${languageExtensions[language]}`,
  language,
  code: starterCode[language],
  version: 0,
});

const normalizeSpace = (space: any, ownerId: string): WorkspaceSpace => {
  const rootFolder = { id: "root", name: "root" };
  const folders = space.folders?.length ? space.folders : [rootFolder];
  const files = (space.files || [createFile("javascript")]).map((file: any) => ({
    ...file,
    folderId: file.folderId || "root",
  }));

  return {
    id: space.id || createId("space"),
    name: space.name || "Workspace",
    ownerId: space.ownerId || ownerId,
    members: space.members || [ownerId],
    folders,
    files,
  };
};

const createDefaultSpace = (roomId: string, ownerId: string): WorkspaceSpace => ({
  id: createId("space"),
  name: `Room ${roomId}`,
  ownerId,
  members: [ownerId],
  folders: [{ id: "root", name: "root" }, createFolder("src")],
  files: [createFile("javascript", "root")],
});

const CodeEditor: React.FC = () => {
  const navigate = useNavigate();
  const params = useParams();
  const [user, setUser] = useRecoilState(userAtom);
  const [, setSocket] = useRecoilState<WebSocket | null>(socketAtom);
  const [connectedUsers, setConnectedUsers] = useRecoilState<any[]>(connectedUsersAtom);
  const [spaces, setSpaces] = useState<WorkspaceSpace[]>([]);
  const [activeSpaceId, setActiveSpaceId] = useState("");
  const [activeFileId, setActiveFileId] = useState("");
  const [output, setOutput] = useState<OutputEntry[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [runStatus, setRunStatus] = useState("Ready");
  const [themeKey, setThemeKey] = useState<keyof typeof themes>("aurora");
  const [remoteCursors, setRemoteCursors] = useState<Record<string, RemoteCursor>>({});
  const [roomLimit, setRoomLimit] = useState(8);
  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMember[]>([]);
  const [copyStatus, setCopyStatus] = useState("Copy invite");
  const socketRef = useRef<WebSocket | null>(null);
  const userRef = useRef(user);
  const connectionIdRef = useRef(getConnectionId());
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  const remoteDecorationIdsRef = useRef<string[]>([]);
  const remoteCursorWidgetsRef = useRef<Record<string, any>>({});
  const activeFileRef = useRef<WorkspaceFile | undefined>(undefined);
  const activeFileIdRef = useRef(activeFileId);
  const activeSpaceIdRef = useRef(activeSpaceId);
  const spacesRef = useRef(spaces);
  const inputRef = useRef(input);
  const runStatusRef = useRef(runStatus);
  const isLoadingRef = useRef(isLoading);

  const activeTheme = themes[themeKey];
  const activeSpace = spaces.find((space) => space.id === activeSpaceId);
  const activeFile = activeSpace?.files.find((file) => file.id === activeFileId);
  const isOwner = Boolean(activeSpace && activeSpace.ownerId === user.id);
  const activeMemberIds = useMemo(
    () => new Set(connectedUsers.map((member: any) => member.id)),
    [connectedUsers]
  );
  const offlineMembers = useMemo(
    () => workspaceMembers.filter((member) => !activeMemberIds.has(member.userId)),
    [activeMemberIds, workspaceMembers]
  );
  const storageKey = useMemo(
    () => `livecodex-room-${user.roomId || params.roomId || "draft"}`,
    [params.roomId, user.roomId]
  );

  useEffect(() => {
    userRef.current = user;
    if (user.id) {
      localStorage.setItem("livecodex-user", JSON.stringify(user));
    }
  }, [user]);

  useEffect(() => {
    activeFileRef.current = activeFile;
    activeFileIdRef.current = activeFileId;
    activeSpaceIdRef.current = activeSpaceId;
    spacesRef.current = spaces;
    inputRef.current = input;
    runStatusRef.current = runStatus;
    isLoadingRef.current = isLoading;
  }, [activeFile, activeFileId, activeSpaceId, input, isLoading, runStatus, spaces]);

  useEffect(() => {
    const storedUser = localStorage.getItem("livecodex-user");
    if (!user.id && storedUser) {
      setUser(JSON.parse(storedUser));
    }
  }, [setUser, user.id]);

  useEffect(() => {
    if (!user.id || !user.roomId) return;

    const savedWorkspace = localStorage.getItem(storageKey);
    if (savedWorkspace) {
      const parsed = JSON.parse(savedWorkspace);
      const nextSpaces = (parsed.spaces || []).map((space: any) =>
        normalizeSpace(space, user.id)
      );
      setSpaces(nextSpaces);
      setActiveSpaceId(parsed.activeSpaceId || nextSpaces[0]?.id || "");
      setActiveFileId(parsed.activeFileId || nextSpaces[0]?.files[0]?.id || "");
      setInput(parsed.input || "");
      setThemeKey(parsed.themeKey || "aurora");
      return;
    }

    const firstSpace = createDefaultSpace(user.roomId, user.id);
    setSpaces([firstSpace]);
    setActiveSpaceId(firstSpace.id);
    setActiveFileId(firstSpace.files[0].id);
  }, [storageKey, user.id, user.roomId]);

  useEffect(() => {
    if (!spaces.length || !activeSpaceId || !activeFileId) return;
    localStorage.setItem(
      storageKey,
      JSON.stringify({ spaces, activeSpaceId, activeFileId, input, themeKey })
    );

    const workspaceIndexKey = "livecodex-workspace-index";
    const storedIndex = localStorage.getItem(workspaceIndexKey);
    const workspaceIndex = storedIndex ? JSON.parse(storedIndex) : [];
    const currentRoomId = user.roomId || params.roomId;
    const nextWorkspaceIndex = [
      {
        roomId: currentRoomId,
        name: activeSpace?.name || `Room ${currentRoomId}`,
        updatedAt: Date.now(),
      },
      ...workspaceIndex.filter((workspace: any) => workspace.roomId !== currentRoomId),
    ];
    localStorage.setItem(workspaceIndexKey, JSON.stringify(nextWorkspaceIndex));
  }, [activeFileId, activeSpaceId, input, spaces, storageKey, themeKey]);

  useEffect(() => {
    if (!editorRef.current || !monacoRef.current) return;
    Object.values(remoteCursorWidgetsRef.current).forEach((widget: any) => {
      editorRef.current.removeContentWidget(widget);
    });
    remoteCursorWidgetsRef.current = {};

    const decorations = Object.values(remoteCursors)
      .filter(
        (cursor) =>
          cursor.fileId === activeFileId && cursor.userId !== connectionIdRef.current
      )
      .map((cursor) => ({
        range: new monacoRef.current.Range(cursor.lineNumber, 1, cursor.lineNumber, 1),
        options: {
          isWholeLine: true,
          className: "remote-line-highlight",
          glyphMarginClassName: "remote-line-glyph",
          hoverMessage: { value: `**${cursor.name}** is editing line ${cursor.lineNumber}` },
        },
      }));

    Object.values(remoteCursors)
      .filter(
        (cursor) =>
          cursor.fileId === activeFileId && cursor.userId !== connectionIdRef.current
      )
      .forEach((cursor) => {
        const node = document.createElement("div");
        node.className = "remote-cursor-label";
        node.textContent = cursor.name;

        const widget = {
          getId: () => `remote-cursor-${cursor.userId}`,
          getDomNode: () => node,
          getPosition: () => ({
            position: {
              lineNumber: cursor.lineNumber,
              column: cursor.column,
            },
            preference: [monacoRef.current.editor.ContentWidgetPositionPreference.ABOVE],
          }),
        };

        remoteCursorWidgetsRef.current[cursor.userId] = widget;
        editorRef.current.addContentWidget(widget);
      });

    remoteDecorationIdsRef.current = editorRef.current.deltaDecorations(
      remoteDecorationIdsRef.current,
      decorations
    );
  }, [activeFileId, remoteCursors]);

  useEffect(() => {
    if (!user.id || !user.name || !user.roomId) return;
    if (socketRef.current && socketRef.current.readyState <= WebSocket.OPEN) {
      return;
    }

    const ws = new WebSocket(
  `${WS_BASE_URL}?roomId=${user.roomId}&id=${
    user.id
  }&connectionId=${connectionIdRef.current}&name=${encodeURIComponent(
    user.name
  )}&type=join`
);

    socketRef.current = ws;
    setSocket(ws);

    ws.onopen = () => {
      setRunStatus("Connected");
      ws.send(JSON.stringify({ type: "requestToGetUsers", userId: user.id }));
      ws.send(JSON.stringify({ type: "requestForAllData" }));
      window.setTimeout(() => {
        if (spacesRef.current.length) {
          syncWorkspace();
        }
      }, 150);
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === "users") {
        const members = (data.members || []).map((member: any) =>
          typeof member === "string"
            ? { userId: member, name: "Collaborator" }
            : {
                userId: member.userId || member.id,
                name: member.name || "Collaborator",
                lastSeen: member.lastSeen,
              }
        );

        setConnectedUsers(data.users);
        setWorkspaceMembers(members);
        setRoomLimit(data.roomLimit || 8);
        setSpaces((previous) =>
          previous.map((space) => ({
            ...space,
            ownerId: data.ownerId || space.ownerId,
            members: members.map((member: WorkspaceMember) => member.userId) || space.members,
          }))
        );
      }

      if (data.type === "workspace") {
        if (data.updatedBy === connectionIdRef.current) {
          return;
        }

        const nextSpaces = (data.spaces || []).map((space: any) =>
          normalizeSpace(space, userRef.current.id)
        );
        spacesRef.current = nextSpaces;
        setSpaces(nextSpaces);
        setActiveSpaceId(data.activeSpaceId || nextSpaces[0]?.id || "");
        setActiveFileId(data.activeFileId || nextSpaces[0]?.files[0]?.id || "");
      }

      if (data.type === "workspaceRoomCreated" && data.roomId) {
        const nextRoomId = data.roomId;
        const nextUser = { ...userRef.current, roomId: nextRoomId };
        const nextSpaces = (data.workspace?.spaces || []).map((space: any) =>
          normalizeSpace(space, userRef.current.id)
        );
        const nextActiveSpaceId = data.workspace?.activeSpaceId || nextSpaces[0]?.id || "";
        const nextActiveFileId =
          data.workspace?.activeFileId || nextSpaces[0]?.files[0]?.id || "";

        localStorage.setItem("livecodex-user", JSON.stringify(nextUser));
        localStorage.setItem(
          `livecodex-room-${nextRoomId}`,
          JSON.stringify({
            spaces: nextSpaces,
            activeSpaceId: nextActiveSpaceId,
            activeFileId: nextActiveFileId,
            input: inputRef.current,
            themeKey,
          })
        );

        spacesRef.current = nextSpaces;
        activeSpaceIdRef.current = nextActiveSpaceId;
        activeFileIdRef.current = nextActiveFileId;
        setUser(nextUser);
        setSpaces(nextSpaces);
        setActiveSpaceId(nextActiveSpaceId);
        setActiveFileId(nextActiveFileId);
        socketRef.current?.close();
        socketRef.current = null;
        setSocket(null);
        navigate(`/code/${nextRoomId}`);
      }

      if (data.type === "error") {
        const message = data.message || "Room connection failed.";
        setRunStatus("Connection error");
        setOutput((previous) => [
          ...previous,
          {
            id: createId("output"),
            text: `Error: ${message}`,
            success: false,
            kind: "error",
          },
        ]);
      }

      if (data.type === "code" && data.fileId) {
        updateFileById(data.fileId, {
          code: data.code,
          version: data.version,
          updatedAt: data.updatedAt,
          updatedBy: data.updatedBy,
          updatedByName: data.updatedByName || data.name,
        });
      } else if (data.type === "code") {
        updateCurrentFile({ code: data.code });
      }

      if (data.type === "input") {
        setInput(data.input);
      }

      if (data.type === "language") {
        const languagePatch = {
          language: data.language,
          version: data.version,
          updatedAt: data.updatedAt,
          updatedBy: data.updatedBy,
          updatedByName: data.updatedByName || data.name,
        };

        if (data.fileId) {
          updateFileById(data.fileId, languagePatch);
        } else {
          updateCurrentFile(languagePatch);
        }
      }

      if (data.type === "submitBtnStatus") {
        setRunStatus(data.value);
        setIsLoading(data.isLoading);
      }

      if (data.type === "output") {
        setOutput((previous) => [
          ...previous,
          {
            id: createId("output"),
            text: data.message || "No output returned.",
            success: data.success !== false,
            kind: data.success === false ? "error" : "output",
          },
        ]);
        setRunStatus("Ready");
        setIsLoading(false);
      }

      if (data.type === "cursorPosition" && data.fileId) {
        const cursorKey = data.connectionId || data.userId;
        setRemoteCursors((previous) => ({
          ...previous,
          [cursorKey]: {
            userId: cursorKey,
            name: data.name || "Collaborator",
            fileId: data.fileId,
            lineNumber: data.cursorPosition.lineNumber,
            column: data.cursorPosition.column,
          },
        }));
      }

      if (data.type === "requestForAllData") {
        ws.send(
          JSON.stringify({
            type: "allData",
            code: activeFileRef.current?.code || "",
            input: inputRef.current,
            language: activeFileRef.current?.language || "javascript",
            currentButtonState: runStatusRef.current,
            isLoading: isLoadingRef.current,
            userId: data.userId,
            connectionId: data.connectionId,
          })
        );
        sendSocketMessage({
          type: "workspace",
          spaces: spacesRef.current,
          activeSpaceId: activeSpaceIdRef.current,
          activeFileId: activeFileIdRef.current,
        });
      }

      if (data.type === "allData") {
        updateCurrentFile({
          code: data.code,
          language: data.language,
        });
        setInput(data.input || "");
        setRunStatus(data.currentButtonState || "Ready");
        setIsLoading(Boolean(data.isLoading));
      }
    };

    ws.onclose = () => {
      setRunStatus("Disconnected");
      setSocket(null);
    };

    return () => {
      ws.close();
    };
  }, [setConnectedUsers, setSocket, user.id, user.name, user.roomId]);

  const sendSocketMessage = (message: Record<string, unknown>) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(
        JSON.stringify({
          ...message,
          roomId: userRef.current.roomId,
        })
      );
    }
  };

  const syncWorkspace = (
    nextSpaces = spacesRef.current,
    nextSpaceId = activeSpaceIdRef.current,
    nextFileId = activeFileIdRef.current
  ) => {
    sendSocketMessage({
      type: "workspace",
      spaces: nextSpaces,
      activeSpaceId: nextSpaceId,
      activeFileId: nextFileId,
    });
  };

  const updateCurrentFile = (patch: Partial<WorkspaceFile>) => {
    if (!activeFileIdRef.current) return;
    updateFileById(activeFileIdRef.current, patch);
  };

  const updateFileById = (fileId: string, patch: Partial<WorkspaceFile>) => {
    setSpaces((previous) => {
      const nextSpaces = previous.map((space) => ({
        ...space,
        files: space.files.map((file) => (file.id === fileId ? { ...file, ...patch } : file)),
      }));
      spacesRef.current = nextSpaces;
      return nextSpaces;
    });
  };

  const mutateSpaces = (
    mutator: (current: WorkspaceSpace[]) => {
      spaces: WorkspaceSpace[];
      activeSpaceId?: string;
      activeFileId?: string;
    }
  ) => {
    setSpaces((current) => {
      const result = mutator(current);
      spacesRef.current = result.spaces;
      if (result.activeSpaceId) {
        activeSpaceIdRef.current = result.activeSpaceId;
        setActiveSpaceId(result.activeSpaceId);
      }
      if (result.activeFileId) {
        activeFileIdRef.current = result.activeFileId;
        setActiveFileId(result.activeFileId);
      }
      syncWorkspace(
        result.spaces,
        result.activeSpaceId || activeSpaceIdRef.current,
        result.activeFileId || activeFileIdRef.current
      );
      return result.spaces;
    });
  };

  const handleCodeChange = (value?: string) => {
    const nextCode = value || "";
    const nextVersion = (activeFileRef.current?.version || 0) + 1;
    const updatedAt = Date.now();
    updateCurrentFile({
      code: nextCode,
      version: nextVersion,
      updatedAt,
      updatedBy: connectionIdRef.current,
      updatedByName: userRef.current.name,
    });
    sendSocketMessage({
      type: "code",
      code: nextCode,
      fileId: activeFileIdRef.current,
      version: nextVersion,
      updatedAt,
    });
  };

  const handleLanguageChange = (language: string) => {
    if (!activeFile) return;
    const currentExtension = languageExtensions[activeFile.language];
    const nextExtension = languageExtensions[language];
    const shouldSwapStarter = activeFile.code === starterCode[activeFile.language];
    const nextName = shouldSwapStarter
      ? defaultFileNames[language]
      : activeFile.name.endsWith(`.${currentExtension}`)
        ? `${activeFile.name.slice(0, -currentExtension.length)}${nextExtension}`
        : activeFile.name;
    const patch = {
      language,
      name: nextName,
      code: shouldSwapStarter ? starterCode[language] : activeFile.code,
      version: (activeFile.version || 0) + 1,
      updatedAt: Date.now(),
      updatedBy: connectionIdRef.current,
      updatedByName: userRef.current.name,
    };

    updateCurrentFile(patch);
    sendSocketMessage({
      type: "language",
      language,
      fileId: activeFile.id,
    });
    sendSocketMessage({
      type: "code",
      code: patch.code,
      fileId: activeFile.id,
    });
  };

  const handleInputChange = (value: string) => {
    setInput(value);
    sendSocketMessage({ type: "input", input: value });
  };

  const handleSubmit = async () => {
    if (!activeFile) return;

    setOutput((previous) => [
      ...previous,
      {
        id: createId("output"),
        text: `$ run ${activeFile.name} (${activeFile.language})`,
        success: true,
        kind: "command",
      },
    ]);
    setRunStatus("Running");
    setIsLoading(true);
    sendSocketMessage({
      type: "submitBtnStatus",
      value: "Running",
      isLoading: true,
    });

    try {
     const response = await fetch(`${EXPRESS_BASE_URL}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: activeFile.code,
          language: activeFile.language,
          fileName: activeFile.name,
          roomId: user.roomId,
          input,
        }),
      });

      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || "Failed to run code.");
      }

      const result = await response.json();
      const outputEntry: OutputEntry = {
        id: createId("output"),
        text: result.output || "No output returned.",
        success: result.success !== false,
        kind: result.success === false ? "error" : "output",
      };
      setOutput((previous) => [...previous, outputEntry]);
      sendSocketMessage({
        type: "outputBroadcast",
        message: outputEntry.text,
        success: outputEntry.success,
      });
      setRunStatus("Ready");
      setIsLoading(false);
      sendSocketMessage({
        type: "submitBtnStatus",
        value: "Ready",
        isLoading: false,
      });
    } catch (error) {
      setOutput((previous) => [
        ...previous,
        {
          id: createId("output"),
          text: error instanceof Error ? `Error: ${error.message}` : "Error running code.",
          success: false,
          kind: "error",
        },
      ]);
      setRunStatus("Ready");
      setIsLoading(false);
      sendSocketMessage({
        type: "submitBtnStatus",
        value: "Ready",
        isLoading: false,
      });
    }
  };

  const addSpace = () => {
    const requestedRoomId = window.prompt(
      "Enter a room id to join an existing workspace, or leave blank to create a new private workspace.",
      ""
    );

    if (requestedRoomId === null) return;

    const trimmedRoomId = requestedRoomId.trim();
    if (trimmedRoomId) {
      if (!/^\d{6}$/.test(trimmedRoomId)) {
        setOutput((previous) => [
          ...previous,
          {
            id: createId("output"),
            text: "Error: Room id must be exactly 6 digits.",
            success: false,
            kind: "error",
          },
        ]);
        return;
      }

      const nextUser = { ...userRef.current, roomId: trimmedRoomId };
      localStorage.setItem("livecodex-user", JSON.stringify(nextUser));
      setUser(nextUser);
      socketRef.current?.close();
      socketRef.current = null;
      setSocket(null);
      navigate(`/code/${trimmedRoomId}`);
      return;
    }

    const nextSpace = createDefaultSpace("new", user.id);
    nextSpace.name = `Workspace ${spaces.length + 1}`;
    sendSocketMessage({
      type: "createWorkspaceRoom",
      workspace: {
        spaces: [nextSpace],
        activeSpaceId: nextSpace.id,
        activeFileId: nextSpace.files[0].id,
      },
    });
  };

  const addFolder = () => {
    if (!activeSpace) return;
    const name = window.prompt("Folder name", "components");
    if (!name) return;

    const folder = createFolder(name);
    mutateSpaces((current) => ({
      spaces: current.map((space) =>
        space.id === activeSpace.id
          ? { ...space, folders: [...space.folders, folder] }
          : space
      ),
    }));
  };

  const addFile = (folderId = "root") => {
    if (!activeSpace) return;
    const language = activeFile?.language || "javascript";
    const nextFile = createFile(language, folderId);
    mutateSpaces((current) => ({
      spaces: current.map((space) =>
        space.id === activeSpace.id
          ? { ...space, files: [...space.files, nextFile] }
          : space
      ),
      activeFileId: nextFile.id,
    }));
  };

  const renameActiveFile = () => {
    if (!activeFile) return;
    const name = window.prompt("File name", activeFile.name);
    if (!name) return;
    mutateSpaces((current) => ({
      spaces: current.map((space) => ({
        ...space,
        files: space.files.map((file) =>
          file.id === activeFile.id ? { ...file, name } : file
        ),
      })),
    }));
  };

  const deleteActiveFile = () => {
    if (!activeSpace || !activeFile || activeSpace.files.length === 1) return;
    const nextFile = activeSpace.files.find((file) => file.id !== activeFile.id);
    mutateSpaces((current) => ({
      spaces: current.map((space) =>
        space.id === activeSpace.id
          ? { ...space, files: space.files.filter((file) => file.id !== activeFile.id) }
          : space
      ),
      activeFileId: nextFile?.id,
    }));
  };

  const renameWorkspace = () => {
    if (!activeSpace || !isOwner) return;
    const name = window.prompt("Workspace name", activeSpace.name);
    if (!name) return;
    mutateSpaces((current) => ({
      spaces: current.map((space) =>
        space.id === activeSpace.id ? { ...space, name } : space
      ),
    }));
  };

  const copyInviteCode = async () => {
    const inviteText = `${window.location.origin}/${user.roomId}`;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(inviteText);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = inviteText;
        textarea.setAttribute("readonly", "true");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }

      setCopyStatus("Invite copied");
      window.setTimeout(() => setCopyStatus("Copy invite"), 1600);
    } catch {
      setCopyStatus("Copy failed");
      setOutput((previous) => [
        ...previous,
        {
          id: createId("output"),
          text: `Copy failed. Invite link: ${inviteText}`,
          success: false,
          kind: "error",
        },
      ]);
      window.setTimeout(() => setCopyStatus("Copy invite"), 2200);
    }
  };

  const leaveWorkspace = () => {
    localStorage.removeItem("livecodex-user");
    setUser({ id: "", name: "", roomId: "" });
    setSocket(null);
    socketRef.current?.close();
    navigate(`/${user.roomId}`);
  };

  const handleEditorMount = (editor: any, monaco: any) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    editor.onDidChangeCursorPosition((event: any) => {
      sendSocketMessage({
        type: "cursorPosition",
        fileId: activeFileIdRef.current,
        cursorPosition: event.position,
      });
    });
  };

  const getCursorForMember = (member: any) => {
    const connectionIds = member.connectionIds || [member.connectionId, member.id];
    return Object.values(remoteCursors).find((cursor) =>
      connectionIds.includes(cursor.userId)
    );
  };

  const getOutputClassName = (entry: OutputEntry) => {
    if (entry.kind === "command") {
      return "border-blue-400/30 bg-blue-500/10 text-blue-200";
    }

    if (!entry.success || entry.kind === "error") {
      return "border-red-400/40 bg-red-500/10 text-red-300";
    }

    return "border-emerald-400/30 bg-emerald-500/10 text-emerald-200";
  };

  const formatLastSeen = (lastSeen?: number) => {
    if (!lastSeen) return "offline";

    const minutes = Math.max(1, Math.round((Date.now() - lastSeen) / 60000));
    return `${minutes}m ago`;
  };

  const cssVars = {
    "--lc-shell": activeTheme.shell,
    "--lc-panel": activeTheme.panel,
    "--lc-panel-soft": activeTheme.panelSoft,
    "--lc-border": activeTheme.border,
    "--lc-accent": activeTheme.accent,
    "--lc-accent-two": activeTheme.accentTwo,
    "--lc-text": activeTheme.text,
    "--lc-muted": activeTheme.muted,
  } as React.CSSProperties;

  return (
    <div
      className="relative min-h-screen overflow-hidden bg-[var(--lc-shell)] text-[var(--lc-text)]"
      style={cssVars}
    >
      <style>
        {`
          .remote-line-highlight { background: color-mix(in srgb, var(--lc-accent) 20%, transparent); border-left: 3px solid var(--lc-accent); }
          .remote-line-glyph { background: var(--lc-accent); border-radius: 999px; width: 8px !important; margin-left: 5px; }
          .remote-cursor-label { background: var(--lc-accent); color: var(--lc-shell); border-radius: 4px; font-size: 11px; font-weight: 700; padding: 2px 6px; transform: translateY(-2px); box-shadow: 0 6px 16px rgba(0,0,0,.28); pointer-events: none; white-space: nowrap; }
        `}
      </style>

      <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[304px_minmax(0,1fr)_376px]">
        <aside className="border-r border-[var(--lc-border)] bg-[var(--lc-panel)]">
          <div className="flex h-16 items-center gap-3 border-b border-[var(--lc-border)] px-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--lc-accent)] text-[var(--lc-shell)]">
              <FiZap />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold">LiveCodex Studio</p>
              <p className="text-xs text-[var(--lc-muted)]">Shared workspaces, live files</p>
            </div>
          </div>

          <div className="space-y-5 p-4">
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-xs font-semibold uppercase text-[var(--lc-muted)]">
                  <FiLayers /> Workspaces
                </h2>
                <div className="flex gap-1">
                  <button onClick={renameWorkspace} className="rounded-md p-1.5 hover:bg-[var(--lc-panel-soft)]" title="Rename workspace">
                    <FiEdit2 />
                  </button>
                  <button onClick={addSpace} className="rounded-md p-1.5 hover:bg-[var(--lc-panel-soft)]" title="New workspace">
                    <FiPlus />
                  </button>
                </div>
              </div>
              <div className="space-y-1">
                {spaces.map((space) => (
                  <button
                    key={space.id}
                    onClick={() => {
                      setActiveSpaceId(space.id);
                      setActiveFileId(space.files[0]?.id || "");
                      syncWorkspace(spaces, space.id, space.files[0]?.id || "");
                    }}
                    className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${
                      activeSpaceId === space.id
                        ? "bg-[var(--lc-panel-soft)] text-[var(--lc-text)]"
                        : "text-[var(--lc-muted)] hover:bg-[var(--lc-panel-soft)]"
                    }`}
                  >
                    <FiFolder className="text-[var(--lc-accent)]" />
                    <span className="truncate">{space.name}</span>
                    {space.ownerId === user.id && <FiUserCheck className="ml-auto text-[var(--lc-accent-two)]" />}
                  </button>
                ))}
              </div>
            </section>

            <section>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase text-[var(--lc-muted)]">
                  Explorer
                </h2>
                <div className="flex gap-1">
                  <button onClick={addFolder} className="rounded-md p-1.5 hover:bg-[var(--lc-panel-soft)]" title="New folder">
                    <FiFolderPlus />
                  </button>
                  <button onClick={() => addFile("root")} className="rounded-md p-1.5 hover:bg-[var(--lc-panel-soft)]" title="New file">
                    <FiPlus />
                  </button>
                </div>
              </div>
              <div className="rounded-xl border border-[var(--lc-border)] bg-[var(--lc-shell)] p-2">
                {activeSpace?.folders.map((folder) => (
                  <div key={folder.id} className="mb-2">
                    <div className="flex items-center justify-between px-2 py-1 text-xs text-[var(--lc-muted)]">
                      <span className="flex items-center gap-2">
                        <FiChevronRight />
                        <FiFolder className="text-[var(--lc-accent-two)]" />
                        {folder.name}
                      </span>
                      <button onClick={() => addFile(folder.id)} className="rounded p-1 hover:bg-[var(--lc-panel-soft)]" title="Add file here">
                        <FiPlus />
                      </button>
                    </div>
                    {activeSpace.files
                      .filter((file) => file.folderId === folder.id)
                      .map((file) => (
                        <button
                          key={file.id}
                          onClick={() => {
                            setActiveFileId(file.id);
                            syncWorkspace(spaces, activeSpace.id, file.id);
                          }}
                          className={`ml-5 flex w-[calc(100%-1.25rem)] items-center gap-2 rounded-md px-3 py-2 text-left text-sm ${
                            activeFileId === file.id
                              ? "bg-[var(--lc-accent)] text-[var(--lc-shell)]"
                              : "text-[var(--lc-text)] hover:bg-[var(--lc-panel-soft)]"
                          }`}
                        >
                          <FiFile />
                          <span className="truncate">{file.name}</span>
                        </button>
                      ))}
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-xl border border-[var(--lc-border)] bg-[var(--lc-shell)] p-3">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <FiUsers className="text-[var(--lc-accent)]" />
                Collaborators
                <span className="ml-auto text-xs font-normal text-[var(--lc-muted)]">
                  {connectedUsers.length}/{roomLimit}
                </span>
              </div>
              <div className="mb-2 text-[10px] font-semibold uppercase text-[var(--lc-muted)]">
                Live now
              </div>
              <div className="space-y-2">
                {connectedUsers.length ? (
                  connectedUsers.map((member: any) => {
                    const cursor = getCursorForMember(member);

                    return (
                      <div key={member.id} className="flex items-center gap-2 text-sm">
                        <div className="relative flex h-7 w-7 items-center justify-center rounded-md bg-[var(--lc-panel-soft)] text-xs">
                          {member.name.charAt(0).toUpperCase()}
                          <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border border-[var(--lc-shell)] bg-emerald-400" />
                        </div>
                        <span className="min-w-0 flex-1 truncate">
                          {member.name}
                          {member.id === user.id ? " (you)" : ""}
                        </span>
                        {cursor?.fileId === activeFileId && (
                          <span className="shrink-0 text-xs text-[var(--lc-accent)]">
                            L{cursor.lineNumber}
                          </span>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <p className="text-sm text-[var(--lc-muted)]">Waiting for collaborators.</p>
                )}
              </div>
              <div className="mt-4 mb-2 text-[10px] font-semibold uppercase text-[var(--lc-muted)]">
                Offline members
              </div>
              <div className="space-y-2">
                {offlineMembers.length ? (
                  offlineMembers.map((member) => (
                    <div key={member.userId} className="flex items-center gap-2 text-sm text-[var(--lc-muted)]">
                      <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--lc-panel-soft)] text-xs opacity-70">
                        {member.name.charAt(0).toUpperCase()}
                      </div>
                      <span className="min-w-0 flex-1 truncate">{member.name}</span>
                      <span className="shrink-0 text-xs">{formatLastSeen(member.lastSeen)}</span>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-[var(--lc-muted)]">No offline members yet.</p>
                )}
              </div>
            </section>
          </div>
        </aside>

        <main className="flex min-w-0 flex-col">
          <header className="flex h-16 items-center justify-between border-b border-[var(--lc-border)] bg-[var(--lc-panel)] px-4">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{activeFile?.name || "No file selected"}</p>
              <p className="text-xs text-[var(--lc-muted)]">
                {runStatus} | Room {user.roomId} | {isOwner ? "Owner" : "Member"}
                {activeFile?.updatedByName ? ` | Saved by ${activeFile.updatedByName}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={themeKey}
                onChange={(event) => setThemeKey(event.target.value as keyof typeof themes)}
                className="h-9 rounded-md border border-[var(--lc-border)] bg-[var(--lc-shell)] px-3 text-sm outline-none"
              >
                {Object.entries(themes).map(([key, theme]) => (
                  <option key={key} value={key}>
                    {theme.name}
                  </option>
                ))}
              </select>
              <select
                value={activeFile?.language || "javascript"}
                onChange={(event) => handleLanguageChange(event.target.value)}
                className="h-9 rounded-md border border-[var(--lc-border)] bg-[var(--lc-shell)] px-3 text-sm outline-none"
              >
                <option value="javascript">JavaScript</option>
                <option value="python">Python</option>
                <option value="cpp">C++</option>
                <option value="java">Java</option>
                <option value="rust">Rust</option>
                <option value="go">Go</option>
              </select>
              <button onClick={renameActiveFile} className="rounded-md border border-[var(--lc-border)] p-2 hover:bg-[var(--lc-panel-soft)]" title="Rename file">
                <FiEdit2 />
              </button>
              <button onClick={deleteActiveFile} className="rounded-md border border-[var(--lc-border)] p-2 hover:bg-[var(--lc-panel-soft)]" title="Delete file">
                <FiTrash2 />
              </button>
              <button
                onClick={handleSubmit}
                disabled={isLoading || !activeFile}
                className="flex h-9 items-center gap-2 rounded-md bg-[var(--lc-accent)] px-4 text-sm font-bold text-[var(--lc-shell)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isLoading ? <FiRefreshCw className="animate-spin" /> : <FiPlay />}
                Run
              </button>
            </div>
          </header>

          <div className="min-h-0 flex-1">
            <MonacoEditor
              value={activeFile?.code || ""}
              language={activeFile?.language || "javascript"}
              theme={activeTheme.monaco}
              height="calc(100vh - 64px)"
              onChange={handleCodeChange}
              onMount={handleEditorMount}
              options={{
                glyphMargin: true,
                minimap: { enabled: false },
                fontSize: 14,
                fontLigatures: true,
                padding: { top: 18, bottom: 18 },
                scrollBeyondLastLine: false,
                smoothScrolling: true,
                wordWrap: "on",
              }}
            />
          </div>
        </main>

        <aside className="flex min-h-0 flex-col border-l border-[var(--lc-border)] bg-[var(--lc-panel)]">
          <div className="border-b border-[var(--lc-border)] p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold">Access</h2>
                <p className="text-xs text-[var(--lc-muted)]">
                  Owner: {isOwner ? "you" : "room creator"}
                </p>
              </div>
              <button onClick={copyInviteCode} className="rounded-md p-2 hover:bg-[var(--lc-panel-soft)]" title={copyStatus}>
                <FiCopy />
              </button>
            </div>
            <div className="rounded-xl border border-[var(--lc-border)] bg-[var(--lc-shell)] p-3">
              <div className="font-mono text-lg text-[var(--lc-accent)]">{user.roomId}</div>
              <div className="mt-1 text-xs text-[var(--lc-muted)]">{copyStatus}</div>
            </div>
          </div>

          <div className="border-b border-[var(--lc-border)] p-4">
            <label className="mb-2 block text-sm font-semibold">Program input</label>
            <textarea
              value={input}
              onChange={(event) => handleInputChange(event.target.value)}
              placeholder={"Optional stdin, for example:\n5\n10"}
              className="h-32 w-full resize-none rounded-xl border border-[var(--lc-border)] bg-[var(--lc-shell)] p-3 font-mono text-sm outline-none"
            />
          </div>

          <div className="flex min-h-0 flex-1 flex-col p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <FiCode /> Output
              </h2>
              <button
                onClick={() => setOutput([])}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[var(--lc-muted)] hover:bg-[var(--lc-panel-soft)]"
              >
                <FiTrash2 />
                Clear
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto rounded-xl border border-[var(--lc-border)] bg-[var(--lc-shell)] p-3 font-mono text-sm leading-6">
              {output.length ? (
                output.map((entry) => (
                  <pre
                    key={entry.id}
                    className={`rounded-md border px-3 py-2 whitespace-pre-wrap ${getOutputClassName(entry)}`}
                  >
                    {entry.text}
                  </pre>
                ))
              ) : (
                <p className="font-sans text-[var(--lc-muted)]">
                  Run the active file to see stdout, compile errors, and runtime errors.
                </p>
              )}
            </div>
            <button
              onClick={leaveWorkspace}
              className="mt-4 rounded-md border border-[var(--lc-border)] px-3 py-2 text-sm hover:bg-[var(--lc-panel-soft)]"
            >
              Leave workspace
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
};

export default CodeEditor;
