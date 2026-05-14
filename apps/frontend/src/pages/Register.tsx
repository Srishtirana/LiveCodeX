import { useEffect, useState } from "react";
import { useRecoilState } from "recoil";
import { userAtom } from "../atoms/userAtom";
import { socketAtom } from "../atoms/socketAtom";
import { useNavigate, useParams } from "react-router-dom";
import { WS_BASE_URL } from "../Globle";

const ROOM_LIMIT = 8;

const createId = (prefix: string) =>
    `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const getConnectionId = () => {
    const existing = sessionStorage.getItem("livecodex-connection-id");
    if (existing) return existing;

    const next = createId("connection");
    sessionStorage.setItem("livecodex-connection-id", next);
    return next;
};

const Register = () => {
    const storedUser = localStorage.getItem("livecodex-user");
    const savedUser = storedUser ? JSON.parse(storedUser) : null;
    const [name, setName] = useState<string>(savedUser?.name || "");
    const [roomId, setRoomId] = useState<string>("");
    const [loading, setLoading] = useState<boolean>(false);

    const [user, setUser] = useRecoilState(userAtom);
    const [, setSocket] = useRecoilState<WebSocket | null>(socketAtom);

    const navigate = useNavigate();
    const params = useParams();

    useEffect(() => {
        if (params.roomId) {
            setRoomId(params.roomId);
        }
    }, [params.roomId]);

    const generateId = () => {
        return Math.floor(Math.random() * 100000).toString();
    };

    const initializeSocket = (type: 'create' | 'join') => {
        if (loading) return;

        if (name.trim() === "") {
            alert("Please enter your name");
            return;
        }

        if (type === "join") {
            if (roomId.trim() === "" || roomId.length !== 6) {
                alert("Please enter a valid 6-digit room ID");
                return;
            }
        }

        setLoading(true);

        let generatedId = user.id;

        if (!generatedId) {
            generatedId = generateId();

                setUser({
                    id: generatedId,
                    name: name.trim(),
                    roomId: "",
                });
        }

        console.log("Connecting socket with:", {
            type,
            roomId,
            id: generatedId,
            name,
        });

        const connectionId = getConnectionId();
       const ws = new WebSocket(
  `${WS_BASE_URL}?roomId=${roomId.trim()}&id=${generatedId}&connectionId=${connectionId}&name=${encodeURIComponent(
    name.trim()
  )}&type=${type}`
);

        setSocket(ws);

        ws.onopen = () => {
            console.log("Connected to WebSocket");
        };

        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);

            console.log("Socket message:", data);

            if (data.type === "roomId") {
                setRoomId(data.roomId);

                setUser({
                    id: generatedId,
                    name,
                    roomId: data.roomId,
                });
                localStorage.setItem(
                    "livecodex-user",
                    JSON.stringify({
                        id: generatedId,
                        name: name.trim(),
                        roomId: data.roomId,
                    })
                );

                setLoading(false);
                ws.close();
                setSocket(null);
                navigate(`/code/${data.roomId}`);
            }

            if (data.type === "error") {
                alert(data.message);
                setLoading(false);
            }
        };

        ws.onerror = (error) => {
            console.error("WebSocket Error:", error);
            alert("Failed to connect to server");
            setLoading(false);
        };

        ws.onclose = () => {
            console.log("WebSocket connection closed");
            setLoading(false);
        };
    };

    const handleCreateRoom = () => {
        initializeSocket("create");
    };

    const handleJoinRoom = () => {
        if (roomId != "" && roomId.length == 6 && !loading) {
            initializeSocket('join');
        }
        else {
            alert("Please enter a room ID to join a room");
        }
    };

    
    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white">
            <div className="bg-gray-800/90 border border-gray-700 p-8 rounded-xl shadow-2xl w-full max-w-md">
                <h1 className="text-3xl font-bold text-center text-white mb-2">
                    LiveCodex
                </h1>
                <p className="text-center text-gray-400 mb-6">
                    Enter your name first. Create a private workspace, or join one with its 6-digit room id.
                </p>

                <input
                    type="text"
                    placeholder="Enter your name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
                />

                <input
                    type="text"
                    placeholder="Enter Room ID"
                    value={roomId}
                    onChange={(e) => setRoomId(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    className="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 mb-6"
                />
                <p className="mb-6 text-center text-xs text-gray-400">
                    Room limit: {ROOM_LIMIT} active collaborators. Only people with the room id can enter.
                </p>

                <button
                    disabled={loading}
                    onClick={handleCreateRoom}
                    className="w-full py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold transition mb-4"
                >
                    {loading ? "Loading..." : "Create New Room"}
                </button>

                <button
                    disabled={loading}
                    onClick={handleJoinRoom}
                    className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 rounded-lg font-semibold transition"
                >
                    {loading ? "Loading..." : "Join Room"}
                </button>
            </div>
        </div>
    );
};

export default Register;
