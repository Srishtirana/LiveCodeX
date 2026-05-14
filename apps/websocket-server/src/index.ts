import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { createClient } from "redis";

const server = http.createServer();

const wss = new WebSocketServer({
    server,
});

const redisClient = createClient();
const ROOM_TTL_SECONDS = 60 * 60 * 24 * 7;
const MAX_ROOM_CONNECTIONS = 8;
let redisAvailable = false;

type User = {
    userId: string;
    connectionId: string;
    name: string;
    ws: WebSocket;
};

type RoomsType = {
    [key: string]: User[];
};

type RoomMember = {
    userId: string;
    name: string;
    lastSeen: number;
};

type RoomMeta = {
    ownerId: string;
    members: RoomMember[];
    createdAt: number;
};

const rooms: RoomsType = {};
const roomMetas: Record<string, RoomMeta> = {};
const roomWorkspaces: Record<string, any> = {};

const getRoomKey = (roomId: string) => `livecodex:room:${roomId}`;
const getWorkspaceKey = (roomId: string) => `livecodex:workspace:${roomId}`;

function normalizeRoomMeta(meta: any): RoomMeta {
    return {
        ownerId: meta.ownerId,
        createdAt: meta.createdAt || Date.now(),
        members: (meta.members || []).map((member: any) =>
            typeof member === "string"
                ? { userId: member, name: "Collaborator", lastSeen: meta.createdAt || Date.now() }
                : {
                      userId: member.userId || member.id,
                      name: member.name || "Collaborator",
                      lastSeen: member.lastSeen || Date.now(),
                  }
        ),
    };
}

async function getRoomMeta(roomId: string): Promise<RoomMeta | null> {
    if (!redisAvailable) {
        return roomMetas[roomId] ? normalizeRoomMeta(roomMetas[roomId]) : null;
    }

    const value = await redisClient.get(getRoomKey(roomId));
    return value ? normalizeRoomMeta(JSON.parse(value)) : null;
}

async function saveRoomMeta(roomId: string, meta: RoomMeta) {
    roomMetas[roomId] = meta;

    if (!redisAvailable) {
        return;
    }

    await redisClient.setEx(
        getRoomKey(roomId),
        ROOM_TTL_SECONDS,
        JSON.stringify(meta)
    );
}

async function addRoomMember(roomId: string, userId: string, name: string) {
    const meta = await getRoomMeta(roomId);
    if (!meta) return;

    const existingMember = meta.members.find((member) => member.userId === userId);

    if (existingMember) {
        existingMember.name = name;
        existingMember.lastSeen = Date.now();
    } else {
        meta.members.push({ userId, name, lastSeen: Date.now() });
    }

    await saveRoomMeta(roomId, meta);
}

async function touchRoomMember(roomId: string, userId: string, name: string) {
    await addRoomMember(roomId, userId, name);
}

async function getRoomWorkspace(roomId: string) {
    if (roomWorkspaces[roomId]) {
        return roomWorkspaces[roomId];
    }

    if (!redisAvailable) {
        return null;
    }

    const value = await redisClient.get(getWorkspaceKey(roomId));
    if (!value) return null;

    roomWorkspaces[roomId] = JSON.parse(value);
    return roomWorkspaces[roomId];
}

async function saveRoomWorkspace(roomId: string, workspace: any) {
    roomWorkspaces[roomId] = workspace;

    if (!redisAvailable) {
        return;
    }

    await redisClient.setEx(
        getWorkspaceKey(roomId),
        ROOM_TTL_SECONDS,
        JSON.stringify(workspace)
    );
}

async function patchWorkspaceFile(
    roomId: string,
    fileId: string,
    patch: Record<string, unknown>,
    editor?: { userId: string; connectionId: string; name: string }
) {
    const workspace = await getRoomWorkspace(roomId);
    if (!workspace?.spaces || !fileId) return null;

    let updatedFile: any = null;

    workspace.spaces = workspace.spaces.map((space: any) => ({
        ...space,
        files: (space.files || []).map((file: any) => {
            if (file.id !== fileId) return file;

            updatedFile = {
                ...file,
                ...patch,
                version: (file.version || 0) + 1,
                updatedAt: Date.now(),
                updatedBy: editor?.connectionId || file.updatedBy,
                updatedByName: editor?.name || file.updatedByName,
            };

            return updatedFile;
        }),
    }));

    await saveRoomWorkspace(roomId, workspace);
    return updatedFile;
}

async function generateRoomId(): Promise<string> {
    let roomId = "";

    do {
        roomId = Math.floor(
            100000 + Math.random() * 900000
        ).toString();
    } while (rooms[roomId] || (await getRoomMeta(roomId)));

    return roomId;
}

async function startServer() {
    redisClient.on("error", (err) => {
        console.log("Redis Error:", err);
    });

    try {
        await redisClient.connect();
        redisAvailable = true;
        console.log("Redis Client Connected");
    } catch (err) {
        redisAvailable = false;
        console.log("Redis unavailable, using in-memory room state");
    }

    wss.on("connection", async (ws, req) => {
        try {
            console.log("New WebSocket Connection");

            const url = new URL(
                req.url || "",
                `http://${req.headers.host}`
            );

            const type = url.searchParams.get("type");
            let roomId = url.searchParams.get("roomId") || "";
            const userId = url.searchParams.get("id") || "";
            const connectionId = url.searchParams.get("connectionId") || userId;
            const name = url.searchParams.get("name") || "";

            console.log({
                type,
                roomId,
                userId,
                connectionId,
                name,
            });

            // VALIDATIONS

            if (!userId || !name) {
                ws.send(
                    JSON.stringify({
                        type: "error",
                        message: "Invalid user data",
                    })
                );

                ws.close();
                return;
            }

            // CREATE ROOM

            if (type === "create") {
                roomId = await generateRoomId();

                rooms[roomId] = [];
                await saveRoomMeta(roomId, {
                    ownerId: userId,
                    members: [{ userId, name, lastSeen: Date.now() }],
                    createdAt: Date.now(),
                });
                await saveRoomWorkspace(roomId, {
                    spaces: [],
                    activeSpaceId: "",
                    activeFileId: "",
                });

                ws.send(
                    JSON.stringify({
                        type: "roomId",
                        roomId,
                        isNewRoom: true,
                        roomLimit: MAX_ROOM_CONNECTIONS,
                        message: `Room created successfully`,
                    })
                );

                console.log(`Created Room: ${roomId}`);
            }

            // JOIN ROOM

            else if (type === "join") {
                if (
                    !roomId ||
                    roomId.length !== 6
                ) {
                    ws.send(
                        JSON.stringify({
                            type: "error",
                            message: "Invalid room code",
                        })
                    );

                    ws.close();
                    return;
                }

                const roomMeta = await getRoomMeta(roomId);

                if (!roomMeta) {
                    ws.send(
                        JSON.stringify({
                            type: "error",
                            message: "Room does not exist",
                        })
                    );

                    ws.close();
                    return;
                }

                const activeUserIds = new Set(
                    (rooms[roomId] || []).map((user) => user.userId)
                );

                if (!activeUserIds.has(userId) && activeUserIds.size >= MAX_ROOM_CONNECTIONS) {
                    ws.send(
                        JSON.stringify({
                            type: "error",
                            message: `Room is full. This room allows up to ${MAX_ROOM_CONNECTIONS} active collaborators.`,
                        })
                    );

                    ws.close();
                    return;
                }

                await addRoomMember(roomId, userId, name);

                if (!rooms[roomId]) {
                    rooms[roomId] = [];
                }

                ws.send(
                    JSON.stringify({
                        type: "roomId",
                        roomId,
                        isNewRoom: false,
                        roomLimit: MAX_ROOM_CONNECTIONS,
                        message: "Joined room successfully",
                    })
                );

                console.log(`Joined Room: ${roomId}`);
            }

            else {
                ws.send(
                    JSON.stringify({
                        type: "error",
                        message: "Invalid connection type",
                    })
                );

                ws.close();
                return;
            }

            // ADD USER TO ROOM

            rooms[roomId].push({
                userId,
                connectionId,
                name,
                ws,
            });

            console.log("Current Rooms:", rooms);

            // SEND USERS LIST

            const sendUsersToRoom = () => {
                rooms[roomId].forEach(async (user) => {
                    const roomMeta = await getRoomMeta(roomId);
                    const activeUsers = Array.from(
                        rooms[roomId].reduce((userMap, activeUser) => {
                            const existingUser = userMap.get(activeUser.userId);
                            const nextConnectionIds = existingUser?.connectionIds || [];

                            userMap.set(activeUser.userId, {
                                id: activeUser.userId,
                                name: activeUser.name,
                                connectionId: activeUser.connectionId,
                                connectionIds: [...nextConnectionIds, activeUser.connectionId],
                                connectionCount: nextConnectionIds.length + 1,
                                active: true,
                            });

                            return userMap;
                        }, new Map<string, any>())
                    ).map(([, value]) => value);

                    user.ws.send(
                        JSON.stringify({
                            type: "users",
                            users: activeUsers,
                            ownerId: roomMeta?.ownerId || "",
                            members: roomMeta?.members || [],
                            roomLimit: MAX_ROOM_CONNECTIONS,
                        })
                    );
                });
            };

            sendUsersToRoom();

            // REDIS SUBSCRIBE

            let roomSubscriber: ReturnType<typeof redisClient.duplicate> | null = null;

            if (redisAvailable) {
                roomSubscriber = redisClient.duplicate();
                await roomSubscriber.connect();

                await roomSubscriber.subscribe(roomId, (message) => {
                    rooms[roomId]?.forEach((user) => {
                        if (user.userId === userId) {
                            user.ws.send(
                                JSON.stringify({
                                    type: "output",
                                    message,
                                })
                            );
                        }
                    });
                });
            }

            // HANDLE MESSAGES

            ws.on("message", async (message) => {
                try {
                    const data = JSON.parse(message.toString());

                    console.log("Message:", data.type);

                    // REQUEST USERS

                    if (data.type === "requestToGetUsers") {
                        sendUsersToRoom();
                    }

                    // CREATE ISOLATED WORKSPACE ROOM

                    if (data.type === "createWorkspaceRoom") {
                        const newRoomId = await generateRoomId();
                        rooms[newRoomId] = [];
                        await saveRoomMeta(newRoomId, {
                            ownerId: userId,
                            members: [{ userId, name, lastSeen: Date.now() }],
                            createdAt: Date.now(),
                        });
                        await saveRoomWorkspace(newRoomId, data.workspace || {
                            spaces: [],
                            activeSpaceId: "",
                            activeFileId: "",
                        });

                        ws.send(
                            JSON.stringify({
                                type: "workspaceRoomCreated",
                                roomId: newRoomId,
                                workspace: data.workspace,
                            })
                        );
                    }

                    // REQUEST FOR ALL DATA

                    if (data.type === "requestForAllData") {
                        const workspace = await getRoomWorkspace(roomId);

                        if (workspace?.spaces?.length) {
                            ws.send(
                                JSON.stringify({
                                    type: "workspace",
                                    spaces: workspace.spaces,
                                    activeSpaceId: workspace.activeSpaceId,
                                    activeFileId: workspace.activeFileId,
                                    updatedBy: "server",
                                })
                            );
                            return;
                        }

                        const otherUser = rooms[roomId].find(
                            (user) => user.connectionId !== connectionId
                        );

                        if (otherUser) {
                            otherUser.ws.send(
                                JSON.stringify({
                                    type: "requestForAllData",
                                    userId,
                                    connectionId,
                                })
                            );
                        }
                    }

                    // CODE

                    if (data.type === "code") {
                        const updatedFile = await patchWorkspaceFile(
                            roomId,
                            data.fileId,
                            {
                                code: data.code,
                            },
                            { userId, connectionId, name }
                        );

                        rooms[roomId].forEach((user) => {
                            if (user.connectionId !== connectionId) {
                                user.ws.send(
                                    JSON.stringify({
                                        type: "code",
                                        code: data.code,
                                        fileId: data.fileId,
                                        version: updatedFile?.version,
                                        updatedAt: updatedFile?.updatedAt,
                                        updatedBy: updatedFile?.updatedBy,
                                        updatedByName: updatedFile?.updatedByName,
                                    })
                                );
                            }
                        });
                    }

                    // WORKSPACE

                    if (data.type === "workspace") {
                        await saveRoomWorkspace(roomId, {
                            spaces: data.spaces,
                            activeSpaceId: data.activeSpaceId,
                            activeFileId: data.activeFileId,
                        });

                        rooms[roomId].forEach((user) => {
                            if (user.connectionId !== connectionId) {
                                user.ws.send(
                                    JSON.stringify({
                                        type: "workspace",
                                        spaces: data.spaces,
                                        activeSpaceId: data.activeSpaceId,
                                        activeFileId: data.activeFileId,
                                        updatedBy: connectionId,
                                    })
                                );
                            }
                        });
                    }

                    // INPUT

                    if (data.type === "input") {
                        rooms[roomId].forEach((user) => {
                            if (user.connectionId !== connectionId) {
                                user.ws.send(
                                    JSON.stringify({
                                        type: "input",
                                        input: data.input,
                                    })
                                );
                            }
                        });
                    }

                    // LANGUAGE

                    if (data.type === "language") {
                        const updatedFile = await patchWorkspaceFile(
                            roomId,
                            data.fileId,
                            {
                                language: data.language,
                            },
                            { userId, connectionId, name }
                        );

                        rooms[roomId].forEach((user) => {
                            if (user.connectionId !== connectionId) {
                                user.ws.send(
                                    JSON.stringify({
                                        type: "language",
                                        language: data.language,
                                        fileId: data.fileId,
                                        version: updatedFile?.version,
                                        updatedAt: updatedFile?.updatedAt,
                                        updatedBy: updatedFile?.updatedBy,
                                        updatedByName: updatedFile?.updatedByName,
                                    })
                                );
                            }
                        });
                    }

                    // SUBMIT BUTTON

                    if (data.type === "submitBtnStatus") {
                        rooms[roomId].forEach((user) => {
                            if (user.connectionId !== connectionId) {
                                user.ws.send(
                                    JSON.stringify({
                                        type: "submitBtnStatus",
                                        value: data.value,
                                        isLoading: data.isLoading,
                                    })
                                );
                            }
                        });
                    }

                    // OUTPUT BROADCAST

                    if (data.type === "outputBroadcast") {
                        rooms[roomId].forEach((user) => {
                            if (user.connectionId !== connectionId) {
                                user.ws.send(
                                    JSON.stringify({
                                        type: "output",
                                        message: data.message,
                                        success: data.success,
                                    })
                                );
                            }
                        });
                    }

                    // ALL DATA

                    if (data.type === "allData") {
                        rooms[roomId].forEach((user) => {
                            if (user.connectionId === data.connectionId) {
                                user.ws.send(
                                    JSON.stringify({
                                        type: "allData",
                                        code: data.code,
                                        input: data.input,
                                        language: data.language,
                                        currentButtonState:
                                            data.currentButtonState,
                                        isLoading: data.isLoading,
                                    })
                                );
                            }
                        });
                    }

                    // CURSOR POSITION

                    if (data.type === "cursorPosition") {
                        rooms[roomId].forEach((user) => {
                            if (user.connectionId !== connectionId) {
                                user.ws.send(
                                    JSON.stringify({
                                        type: "cursorPosition",
                                        cursorPosition:
                                            data.cursorPosition,
                                        fileId: data.fileId,
                                        name,
                                        userId,
                                        connectionId,
                                    })
                                );
                            }
                        });
                    }
                } catch (err) {
                    console.log("Message Error:", err);
                }
            });

            // DISCONNECT

            ws.on("close", async () => {
                console.log(`User disconnected: ${userId}`);

                if (!rooms[roomId]) return;

                await touchRoomMember(roomId, userId, name);

                rooms[roomId] = rooms[roomId].filter(
                    (user) => user.connectionId !== connectionId
                );

                sendUsersToRoom();

                if (rooms[roomId].length === 0) {
                    delete rooms[roomId];

                    console.log(`Room inactive: ${roomId}`);
                }

                if (roomSubscriber) {
                    await roomSubscriber.unsubscribe(roomId);
                    await roomSubscriber.quit();
                }

                console.log("Updated Rooms:", rooms);
            });
        } catch (err) {
            console.log("Connection Error:", err);

            ws.close();
        }
    });

    server.listen(5000, "0.0.0.0", () => {
        console.log("WebSocket Server Started on Port 5000");
    });
}

startServer();
