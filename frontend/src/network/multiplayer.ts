import type { ProjectData } from "../editor/serializer";
import type { WorldEditor } from "../editor/WorldEditor";

type InitMessage = {
    type: "init";
    clientId: string;
    sessionId: string;
    revision: number;
    snapshot: ProjectData | null;
};

type StateMessage = {
    type: "state";
    clientId: string;
    sessionId: string;
    revision: number;
    snapshot: ProjectData;
};

type ClientMessage =
    | { type: "join"; sessionId: string; name?: string }
    | { type: "state"; sessionId: string; snapshot: ProjectData; revision: number };

type MultiplayerOptions = {
    serverUrl: string;
    onStatusChange: (status: string) => void;
};

export class MultiplayerSession {
    private socket: WebSocket | null = null;
    private editor: WorldEditor | null = null;
    private sessionId: string | null = null;
    private revision = 0;
    private lastSentSnapshot = "";
    private syncTimer: number | null = null;
    private applyingRemote = false;

    constructor(private options: MultiplayerOptions) {}

    connect(sessionId: string, editor: WorldEditor) {
        this.disconnect();
        this.editor = editor;
        this.sessionId = sanitizeSessionId(sessionId);
        this.revision = 0;
        this.lastSentSnapshot = "";
        this.options.onStatusChange(`Connecting to ${this.sessionId}...`);

        const socket = new WebSocket(this.options.serverUrl);
        this.socket = socket;

        socket.addEventListener("open", () => {
            this.send({ type: "join", sessionId: this.sessionId! });
            this.options.onStatusChange(`Connected to session ${this.sessionId}.`);
        });

        socket.addEventListener("message", (event) => {
            let message: InitMessage | StateMessage;
            try {
                message = JSON.parse(event.data as string) as InitMessage | StateMessage;
            } catch {
                return;
            }

            if (message.type === "init") {
                this.revision = message.revision;
                if (message.snapshot) this.applyRemoteSnapshot(message.snapshot);
                return;
            }

            if (message.type === "state") {
                this.revision = message.revision;
                this.applyRemoteSnapshot(message.snapshot);
            }
        });

        socket.addEventListener("close", () => {
            this.options.onStatusChange("Disconnected");
            this.socket = null;
        });

        socket.addEventListener("error", () => {
            this.options.onStatusChange("Connection error");
        });
    }

    disconnect() {
        if (this.syncTimer !== null) {
            window.clearTimeout(this.syncTimer);
            this.syncTimer = null;
        }
        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }
        this.editor = null;
        this.sessionId = null;
        this.options.onStatusChange("Disconnected");
    }

    onEditorChange() {
        if (this.applyingRemote || !this.socket || this.socket.readyState !== WebSocket.OPEN || !this.editor || !this.sessionId) {
            return;
        }
        if (this.syncTimer !== null) window.clearTimeout(this.syncTimer);
        this.syncTimer = window.setTimeout(() => {
            this.syncTimer = null;
            const snapshot = this.editor?.getProjectData();
            if (!snapshot) return;
            const encoded = JSON.stringify(snapshot);
            if (encoded === this.lastSentSnapshot) return;
            this.lastSentSnapshot = encoded;
            this.send({ type: "state", sessionId: this.sessionId!, snapshot, revision: this.revision });
        }, 75);
    }

    getSessionId() {
        return this.sessionId;
    }

    private applyRemoteSnapshot(snapshot: ProjectData) {
        if (!this.editor) return;
        const encoded = JSON.stringify(snapshot);
        if (encoded === this.lastSentSnapshot) return;
        this.applyingRemote = true;
        try {
            this.editor.applyCollaborativeProjectData(snapshot);
        } finally {
            this.applyingRemote = false;
        }
    }

    private send(message: ClientMessage) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
        this.socket.send(JSON.stringify(message));
    }
}

function sanitizeSessionId(value: string) {
    return value.trim().replace(/[^a-z0-9_-]/gi, "_") || "default";
}
