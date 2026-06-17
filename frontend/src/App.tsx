import { useEffect, useMemo, useRef, useState } from "react";
import {
    Circle,
    CircleDashed,
    ChevronDown,
    ChevronUp,
    Download,
    Eraser,
    MoonStar,
    MousePointer2,
    Pencil,
    Redo2,
    RectangleHorizontal,
    RotateCcw,
    SunMedium,
    Trash2,
    Minus,
    Move3D,
    Info,
} from "lucide-react";
import type { EditorUiState, GuideValues, PlaneType, Tool, TransformMode } from "./types";
import { WorldEditor } from "./editor/WorldEditor";
import { MultiplayerSession } from "./network/multiplayer";

const initialSessionParam = new URLSearchParams(window.location.search).get("session");
const defaultSessionId = initialSessionParam ?? "default";
const backendUrl = import.meta.env.VITE_BACKEND_WS_URL ?? "ws://168.119.180.164:3002";
const SESSION_CODE_LENGTH = 6;

const initialState: EditorUiState = {
    layers: [],
    savedObjects: [],
    activeLayerId: null,
    activePlaneId: null,
    activeObjectId: null,
    placement: { active: false, stage: "preview", objectId: null, objectName: null },
    planeType: "XZ",
    tool: "brush",
    transformMode: "both",
    darkMode: false,
    gridVisible: true,
    snapping: true,
    brush: { color: "#111827", size: 0.45, opacity: 1, smoothing: 0.35 },
    guide: { posX: 0, posY: 0, posZ: 0, rotX: -90, rotY: 0, rotZ: 0 },
    planeInfo: null,
    status: "Ready"
};

export default function App() {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const moveStickRef = useRef<HTMLDivElement | null>(null);
    const lookStickRef = useRef<HTMLDivElement | null>(null);
    const editorRef = useRef<WorldEditor | null>(null);
    const multiplayerRef = useRef<MultiplayerSession | null>(null);
    const [ui, setUi] = useState<EditorUiState>(initialState);
    const [sessionId, setSessionId] = useState(defaultSessionId);
    const [sessionStatus, setSessionStatus] = useState("Disconnected");
    const [sessionModalOpen, setSessionModalOpen] = useState(false);
    const [sessionMode, setSessionMode] = useState<"join" | "host">("join");
    const [sessionError, setSessionError] = useState("");

    useEffect(() => {
        multiplayerRef.current = new MultiplayerSession({
            serverUrl: backendUrl,
            onStatusChange: setSessionStatus
        });
        return () => multiplayerRef.current?.disconnect();
    }, []);

    useEffect(() => {
        if (!canvasRef.current || editorRef.current) return;
        const editor = new WorldEditor({
            canvas: canvasRef.current,
            moveStick: moveStickRef.current,
            lookStick: lookStickRef.current,
            onChange: (state) => {
                setUi(state);
                multiplayerRef.current?.onEditorChange();
            }
        });
        editorRef.current = editor;
        setUi(editor.getUiState());
        if (initialSessionParam) multiplayerRef.current?.connect(initialSessionParam, editor);
        return () => {
            multiplayerRef.current?.disconnect();
            editor.destroy();
            editorRef.current = null;
        };
    }, []);

    const editor = editorRef.current;
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const guideDraft = useMemo(() => ui.guide, [ui.guide]);

    const updateGuide = (key: keyof GuideValues, value: string) => {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return;
        editor?.setGuideValues({ ...guideDraft, [key]: numeric });
    };

    const handleLoad = () => fileInputRef.current?.click();

    const handleOpenDrawTogether = () => {
        setSessionError("");
        setSessionMode("join");
        setSessionModalOpen(true);
        if (sessionId === "default") setSessionId("");
    };

    const connectToSession = (code: string) => {
        if (!editorRef.current) return;
        multiplayerRef.current?.connect(code, editorRef.current);
        const url = new URL(window.location.href);
        url.searchParams.set("session", code);
        window.history.replaceState({}, "", url);
    };

    const handleJoinSession = () => {
        const code = normalizeSessionCode(sessionId);
        if (code.length !== SESSION_CODE_LENGTH) {
            setSessionError(`Session code must be ${SESSION_CODE_LENGTH} characters.`);
            return;
        }
        setSessionId(code);
        setSessionError("");
        setSessionModalOpen(false);
        connectToSession(code);
    };

    const handleHostSession = () => {
        const code = generateSessionCode();
        setSessionId(code);
        setSessionError("");
        setSessionMode("host");
        setSessionModalOpen(true);
        connectToSession(code);
    };

    const handleCopyInvite = async () => {
        const code = normalizeSessionCode(sessionId);
        if (code.length !== SESSION_CODE_LENGTH) return;
        const url = new URL(window.location.href);
        url.searchParams.set("session", code);
        await navigator.clipboard.writeText(url.toString());
    };

    const handleDisconnect = () => {
        multiplayerRef.current?.disconnect();
        setSessionStatus("Disconnected");
    };

    const handleCreateObject = () => {
        const name = window.prompt("Object name");
        if (!name) return;
        editor?.createObjectFromActiveLayer(name);
    };

    const handlePlaceObject = () => {
        if (!ui.activeObjectId) return;
        editor?.startObjectPlacement(ui.activeObjectId);
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => editor?.loadFile(ev.target?.result as ArrayBuffer);
        reader.readAsArrayBuffer(file);
        e.target.value = "";
    };

    return (
        <div className={`app-shell ${ui.darkMode ? "dark" : ""}`}>
            <input ref={fileInputRef} type="file" accept=".cnvs" style={{ display: "none" }} onChange={handleFileChange} />
            <div className="mode-bar">
                <button className="bar-icon tooltip-host" data-tooltip="Undo" aria-label="Undo" onClick={() => editor?.undo()}><RotateCcw size={18} strokeWidth={2.1} /></button>
                <button className="bar-icon tooltip-host" data-tooltip="Redo" aria-label="Redo" onClick={() => editor?.redo()}><Redo2 size={18} strokeWidth={2.1} /></button>
                <button className="bar-icon tooltip-host" data-tooltip="Toggle theme" aria-label="Toggle theme" onClick={() => editor?.setDarkMode(!ui.darkMode)}>{ui.darkMode ? <SunMedium size={18} strokeWidth={2.1} /> : <MoonStar size={18} strokeWidth={2.1} />}</button>
                <button className="bar-icon tooltip-host" data-tooltip="Export GLB" aria-label="Export GLB" onClick={() => editor?.exportGLB()}><Download size={18} strokeWidth={2.1} /></button>
                <button className="bar-text" onClick={() => editor?.saveFile()}>Save</button>
                <button className="bar-text" onClick={handleLoad}>Load</button>
                <div className="divider" />
                <button className="bar-text" onClick={handleOpenDrawTogether}>Draw together</button>
                <button className="bar-text" onClick={handleDisconnect}>Leave</button>
                <span className="session-status">{sessionStatus}</span>
                <div className="divider" />
                <Toggle label="Grid" active={ui.gridVisible} onClick={() => editor?.setGridVisible(!ui.gridVisible)} />
                <label className="control-group">
                    <span className="control-label">Plane</span>
                    <span className="select-wrap">
                        <select className="ui-select" value={ui.planeType} onChange={(event) => editor?.setPlaneType(event.target.value as PlaneType)}>
                            <option value="XY">XY</option>
                            <option value="XZ">XZ</option>
                            <option value="YZ">YZ</option>
                        </select>
                        <ChevronDown className="select-icon" size={14} strokeWidth={2.2} />
                    </span>
                </label>
                <label className="control-group">
                    <span className="control-label">Color</span>
                    <span className="color-wrap">
                        <input className="ui-color" type="color" value={ui.brush.color} onChange={(event) => editor?.setBrush({ color: event.target.value })} />
                        <span className="color-code">{ui.brush.color.toUpperCase()}</span>
                    </span>
                </label>
                <label className="control-group control-size">
                    <span className="control-label">Size</span>
                    <span className="range-wrap">
                        <input className="ui-range" type="range" min="0.05" max="3" step="0.05" value={ui.brush.size}
                            onChange={(event) => editor?.setBrush({ size: parseFloat(event.target.value) })} />
                        <span className="range-value">{ui.brush.size.toFixed(2)}</span>
                    </span>
                </label>
                <label className="control-group control-size">
                    <span className="control-label">Smooth</span>
                    <span className="range-wrap">
                        <input className="ui-range" type="range" min="0" max="1" step="0.01" value={ui.brush.smoothing}
                            onChange={(event) => editor?.setBrush({ smoothing: parseFloat(event.target.value) })} />
                        <span className="range-value">{ui.brush.smoothing.toFixed(2)}</span>
                    </span>
                </label>
            </div>

            <main className="workspace">
                <aside className="left-rail">
                    <RailButton
                        icon={<span className="rail-glyph">G</span>}
                        title="Transform"
                        tool="select"
                        active={ui.tool === "select"}
                        onClick={() => editor?.setTransformMode("both")}
                    />
                    <RailButton icon={<MousePointer2 size={16} strokeWidth={2.1} />} title="Select" tool="select" active={ui.tool === "select"} disabled={ui.tool === "select"} onClick={() => editor?.setTransformMode("both")} />
                    <RailButton icon={<Move3D size={16} strokeWidth={2.1} />} title="Move guide" tool="plane" active={ui.tool === "plane"} onClick={() => editor?.setTool("plane")} />
                    <div className="rail-separator" />
                    <RailButton icon={<Pencil size={16} strokeWidth={2.1} />} title="Brush" tool="brush" active={ui.tool === "brush"} onClick={() => editor?.setTool("brush")} />
                    <RailButton icon={<Eraser size={16} strokeWidth={2.1} />} title="Eraser" tool="eraser" active={ui.tool === "eraser"} onClick={() => editor?.setTool("eraser")} />
                    <div className="rail-separator" />
                    <RailButton icon={<Minus size={16} strokeWidth={2.1} />} title="Line" tool="line" active={ui.tool === "line"} onClick={() => editor?.setTool("line")} />
                    <RailButton icon={<Circle size={16} strokeWidth={2.1} />} title="Circle" tool="circle" active={ui.tool === "circle"} onClick={() => editor?.setTool("circle")} />
                    <RailButton icon={<CircleDashed size={16} strokeWidth={2.1} />} title="Ellipse" tool="ellipse" active={ui.tool === "ellipse"} onClick={() => editor?.setTool("ellipse")} />
                    <RailButton icon={<RectangleHorizontal size={16} strokeWidth={2.1} />} title="Rectangle" tool="rectangle" active={ui.tool === "rectangle"} onClick={() => editor?.setTool("rectangle")} />
                </aside>

                {sessionModalOpen && (
                    <div className="modal-backdrop" role="presentation" onClick={() => setSessionModalOpen(false)}>
                        <div className="session-modal" role="dialog" aria-modal="true" aria-labelledby="session-dialog-title" onClick={(event) => event.stopPropagation()}>
                            <div className="section-header">
                                <h2 id="session-dialog-title">Draw together</h2>
                                <button className="ghost-button" onClick={() => setSessionModalOpen(false)}>Close</button>
                            </div>
                            <p className="session-helper">
                                {sessionMode === "host"
                                    ? `Your session code is ${sessionId}. Share it so others can join.`
                                    : `Enter a ${SESSION_CODE_LENGTH}-character session code to join someone else's canvas.`}
                            </p>
                            <label className="session-field">
                                Session code
                                <input
                                    className="session-input session-input-modal"
                                    maxLength={SESSION_CODE_LENGTH}
                                    value={sessionId}
                                    onChange={(event) => setSessionId(normalizeSessionCode(event.target.value))}
                                    placeholder="ABC123"
                                />
                            </label>
                            {sessionError && <p className="session-error">{sessionError}</p>}
                            <div className="session-actions">
                                <button className="bar-text" onClick={handleJoinSession}>Join</button>
                                <button className="bar-text" onClick={handleHostSession}>Host session</button>
                                <button className="bar-text" onClick={handleCopyInvite} disabled={normalizeSessionCode(sessionId).length !== SESSION_CODE_LENGTH}>Copy invite</button>
                            </div>
                        </div>
                    </div>
                )}

                <section className="viewport-card">
                    <canvas ref={canvasRef} />
                    <div className="floating-help">
                        <div className="help-title"><Info size={16} strokeWidth={2.1} /> {modeLabel(ui.tool, ui.transformMode)}</div>
                        <p className="help-text">{ui.status}</p>
                        <div className="hotkeys">
                            <span>RMB Look</span>
                            <span>WASD Move</span>
                            <span>QE Up/Down</span>
                            <span>MMB Pan</span>
                            <span>Ctrl+Z</span>
                        </div>
                    </div>
                    <div className="mobile-joysticks" aria-hidden="true">
                        <div className="joystick" id="moveStick" ref={moveStickRef}><span /></div>
                        <div className="joystick" id="lookStick" ref={lookStickRef}><span /></div>
                    </div>
                    {ui.placement.active && ui.placement.stage === "adjust" && (
                        <div className="placement-toolbar">
                            <div className="placement-title">Placing: {ui.placement.objectName ?? "Object"}</div>
                            <button className="ghost-button" onClick={() => editor?.confirmObjectPlacement()}>Accept</button>
                            <button className="ghost-button" onClick={() => editor?.cancelObjectPlacement()}>Cancel</button>
                        </div>
                    )}
                </section>

                <aside className="right-panel">
                    <section className="panel-section">
                        <div className="section-header">
                            <h2>Objects</h2>
                            <button className="ghost-button" onClick={handleCreateObject}>+ From Layer</button>
                        </div>
                        <div className="object-actions">
                            <button className="ghost-button" disabled={!ui.activeObjectId} onClick={handlePlaceObject}>
                                Place In World
                            </button>
                        </div>
                        <div className="objects-list">
                            {ui.savedObjects.length === 0 && <p className="empty-hint">No saved objects yet.</p>}
                            {ui.savedObjects.map((object) => {
                                const active = object.id === ui.activeObjectId;
                                return (
                                    <button
                                        key={object.id}
                                        className={`object-row tooltip-host ${active ? "active" : ""}`}
                                        onClick={() => editor?.selectObject(object.id)}
                                        data-tooltip={`${object.planes.length} plane${object.planes.length === 1 ? "" : "s"}`}
                                    >
                                        <span className="object-name">{object.name}</span>
                                        <span className="object-meta">{object.planes.length}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </section>
                    <section className="panel-section">
                        <div className="section-header">
                            <h2>Layers</h2>
                            <button className="ghost-button" onClick={() => editor?.addLayer()}>
                                + Add
                            </button>
                        </div>
                        <div className="layers-list">
                            {ui.layers.map((layer, index) => {
                                const isActive = layer.id === ui.activeLayerId;
                                return (
                                    <div
                                        key={layer.id}
                                        className={`layer-row ${isActive ? "active" : ""}`}
                                        onClick={() => editor?.selectLayer(layer.id)}
                                    >
                                        <button
                                            className="tooltip-host"
                                            data-tooltip={layer.visible ? "Hide layer" : "Show layer"}
                                            aria-label={layer.visible ? "Hide layer" : "Show layer"}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                editor?.toggleLayerVisible(layer.id);
                                            }}
                                        >
                                            {layer.visible ? "V" : "H"}
                                        </button>
                                        <button
                                            className="tooltip-host"
                                            data-tooltip={layer.locked ? "Unlock layer" : "Lock layer"}
                                            aria-label={layer.locked ? "Unlock layer" : "Lock layer"}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                editor?.toggleLayerLocked(layer.id);
                                            }}
                                        >
                                            {layer.locked ? "L" : "U"}
                                        </button>
                                        <input
                                            className="layer-name-input tooltip-host"
                                            value={layer.name}
                                            data-tooltip={`${layer.worldPlanes.length} plane${layer.worldPlanes.length === 1 ? "" : "s"}`}
                                            onFocus={() => editor?.selectLayer(layer.id)}
                                            onClick={() => editor?.selectLayer(layer.id)}
                                            onChange={(event) => editor?.renameLayer(layer.id, event.target.value)}
                                        />
                                        <button
                                            className="tooltip-host"
                                            data-tooltip="Move up"
                                            aria-label="Move up"
                                            disabled={index === 0}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                editor?.moveLayer(layer.id, -1);
                                            }}
                                        >
                                            <ChevronUp size={16} strokeWidth={2.1} />
                                        </button>
                                        <button
                                            className="tooltip-host"
                                            data-tooltip="Move down"
                                            aria-label="Move down"
                                            disabled={index === ui.layers.length - 1}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                editor?.moveLayer(layer.id, 1);
                                            }}
                                        >
                                            <ChevronDown size={16} strokeWidth={2.1} />
                                        </button>
                                        <button
                                            className="tooltip-host"
                                            data-tooltip="Merge down"
                                            aria-label="Merge down"
                                            disabled={index === ui.layers.length - 1}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                editor?.mergeLayerDown(layer.id);
                                            }}
                                        >
                                            M
                                        </button>
                                        <button
                                            className="tooltip-host"
                                            data-tooltip="Delete layer"
                                            aria-label="Delete layer"
                                            disabled={ui.layers.length <= 1}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                editor?.deleteLayer(layer.id);
                                            }}
                                        >
                                            <Trash2 size={14} strokeWidth={2.2} />
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                    <section className="panel-section">
                        <div className="section-header">
                            <h2>Position</h2>
                        </div>
                        <div className="property-grid">
                            <NumberField label="X" value={ui.guide.posX} onChange={(v) => updateGuide("posX", v)} />
                            <NumberField label="Y" value={ui.guide.posY} onChange={(v) => updateGuide("posY", v)} />
                            <NumberField label="Z" value={ui.guide.posZ} onChange={(v) => updateGuide("posZ", v)} />
                        </div>
                    </section>
                    <section className="panel-section">
                        <div className="section-header">
                            <h2>Rotation</h2>
                            <button className="ghost-button" onClick={() => editor?.resetGuideRotation()}>Reset</button>
                        </div>
                        <div className="property-grid">
                            <NumberField label="X" value={ui.guide.rotX} onChange={(v) => updateGuide("rotX", v)} />
                            <NumberField label="Y" value={ui.guide.rotY} onChange={(v) => updateGuide("rotY", v)} />
                            <NumberField label="Z" value={ui.guide.rotZ} onChange={(v) => updateGuide("rotZ", v)} />
                        </div>
                    </section>
                </aside>

            </main>
        </div>
    );
}

function normalizeSessionCode(value: string) {
    return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, SESSION_CODE_LENGTH);
}

function generateSessionCode() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let index = 0; index < SESSION_CODE_LENGTH; index += 1) {
        code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return code;
}

function Toggle({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
    return <button className="toggle-row ghost-button" onClick={onClick}><span className={`switch ${active ? "on" : ""}`} />{label}</button>;
}

function RailButton({ icon, title, active, disabled, onClick }: { icon: React.ReactNode; title: string; tool: Tool; active: boolean; disabled?: boolean; onClick: () => void }) {
    return <button className={`rail-button tooltip-host ${active ? "active" : ""}`} data-tooltip={title} data-tooltip-side="right" aria-label={title} disabled={disabled} onClick={onClick}>{icon}</button>;
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: string) => void }) {
    return <label>{label}<input type="number" step="0.1" value={value} onChange={(e) => onChange(e.target.value)} /></label>;
}

function modeLabel(tool: Tool, mode: TransformMode) {
    const labels: Partial<Record<Tool, string>> = {
        brush: "Brush", eraser: "Eraser", plane: "Set Plane",
        line: "Line", circle: "Circle", ellipse: "Ellipse", rectangle: "Rectangle",
    };
    return labels[tool] ?? (mode === "both" ? "Transform" : mode === "rotate" ? "Rotate" : "Move");
}
