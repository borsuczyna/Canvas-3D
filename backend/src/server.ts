import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket, type WebSocket as WebSocketType } from "ws";

type ProjectSnapshot = {
    layers: unknown[];
    savedObjects: unknown[];
    activeLayerId: string | null;
    activePlaneId: string | null;
    activeObjectId: string | null;
    planeType: string;
    transformMode: string;
    guideChanged: boolean;
    guidePosition: number[];
    guideQuaternion: number[];
    brush: { color: string; size: number; opacity: number };
    darkMode: boolean;
    gridVisible: boolean;
};

type ClientMessage =
    | { type: "join"; sessionId: string; name?: string }
    | { type: "state"; sessionId: string; snapshot: ProjectSnapshot; revision: number };

type ServerMessage =
    | { type: "init"; clientId: string; sessionId: string; revision: number; snapshot: ProjectSnapshot | null }
    | { type: "state"; clientId: string; sessionId: string; revision: number; snapshot: ProjectSnapshot };

type Room = {
    revision: number;
    snapshot: ProjectSnapshot | null;
    clients: Set<WebSocketType>;
};

const rooms = new Map<string, Room>();
const server = createServer();
const wss = new WebSocketServer({ server });

wss.on("connection", (socket) => {
    const clientId = randomUUID();
    let sessionId: string | null = null;

    socket.on("message", (raw) => {
        let message: ClientMessage;
        try {
            message = JSON.parse(raw.toString()) as ClientMessage;
        } catch {
            return;
        }

        if (message.type === "join") {
            sessionId = sanitizeSessionId(message.sessionId);
            const room = getRoom(sessionId);
            room.clients.add(socket);
            send(socket, {
                type: "init",
                clientId,
                sessionId,
                revision: room.revision,
                snapshot: room.snapshot
            });
            return;
        }

        if (message.type === "state") {
            const targetSession = sanitizeSessionId(message.sessionId || sessionId || "default");
            const room = getRoom(targetSession);
            room.revision = message.revision + 1;
            room.snapshot = message.snapshot;
            broadcast(room, {
                type: "state",
                clientId,
                sessionId: targetSession,
                revision: room.revision,
                snapshot: message.snapshot
            }, socket);
        }
    });

    socket.on("close", () => {
        if (!sessionId) return;
        const room = rooms.get(sessionId);
        room?.clients.delete(socket);
        if (room && room.clients.size === 0) rooms.delete(sessionId);
    });
});

server.listen(3001, () => {
    console.log("Canvas multiplayer backend listening on ws://localhost:3001");
});

function getRoom(sessionId: string): Room {
    let room = rooms.get(sessionId);
    if (!room) {
        room = { revision: 0, snapshot: null, clients: new Set<WebSocketType>() };
        rooms.set(sessionId, room);
    }
    return room;
}

function broadcast(room: Room, message: ServerMessage, except?: WebSocket) {
    const encoded = JSON.stringify(message);
    for (const client of room.clients) {
        if (client === except || client.readyState !== WebSocket.OPEN) continue;
        client.send(encoded);
    }
}

function send(socket: WebSocket, message: ServerMessage) {
    socket.send(JSON.stringify(message));
}

function sanitizeSessionId(value: string) {
    return value.trim().replace(/[^a-z0-9_-]/gi, "_") || "default";
}
