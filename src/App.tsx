import { useEffect, useMemo, useRef, useState } from "react";
import type { EditorUiState, GuideValues, PlaneType, Tool, TransformMode } from "./types";
import { WorldEditor } from "./editor/WorldEditor";

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
    brush: { color: "#111827", size: 0.45, opacity: 1 },
    guide: { posX: 0, posY: 0, posZ: 0, rotX: -90, rotY: 0, rotZ: 0 },
    planeInfo: null,
    status: "Ready"
};

export default function App() {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const moveStickRef = useRef<HTMLDivElement | null>(null);
    const lookStickRef = useRef<HTMLDivElement | null>(null);
    const editorRef = useRef<WorldEditor | null>(null);
    const [ui, setUi] = useState<EditorUiState>(initialState);

    useEffect(() => {
        if (!canvasRef.current || editorRef.current) return;
        const editor = new WorldEditor({
            canvas: canvasRef.current,
            moveStick: moveStickRef.current,
            lookStick: lookStickRef.current,
            onChange: setUi
        });
        editorRef.current = editor;
        setUi(editor.getUiState());
        return () => {
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
                <button className="bar-icon" title="Undo" onClick={() => editor?.undo()}>â†©</button>
                <button className="bar-icon" title="Redo" onClick={() => editor?.redo()}>â†Ş</button>
                <button className="bar-icon" title="Toggle theme" onClick={() => editor?.setDarkMode(!ui.darkMode)}>{ui.darkMode ? "â€" : "â—‘"}</button>
                <button className="bar-icon" title="Export GLB" onClick={() => editor?.exportGLB()}>â†“</button>
                <button className="bar-text" onClick={() => editor?.saveFile()}>Save</button>
                <button className="bar-text" onClick={handleLoad}>Load</button>
                <div className="divider" />
                <ModeButton label="Transform" active={ui.tool === "select"} onClick={() => editor?.setTransformMode("both")} />
                <div className="divider" />
                <Toggle label="Grid" active={ui.gridVisible} onClick={() => editor?.setGridVisible(!ui.gridVisible)} />
                <label className="toggle-row">
                    Plane
                    <select value={ui.planeType} onChange={(event) => editor?.setPlaneType(event.target.value as PlaneType)}>
                        <option value="XY">XY</option>
                        <option value="XZ">XZ</option>
                        <option value="YZ">YZ</option>
                    </select>
                </label>
                <label className="toggle-row">
                    Color
                    <input type="color" value={ui.brush.color} onChange={(event) => editor?.setBrush({ color: event.target.value })} />
                </label>
                <label className="toggle-row">
                    Size
                    <input type="range" min="0.05" max="3" step="0.05" value={ui.brush.size} style={{ width: "80px" }}
                        onChange={(event) => editor?.setBrush({ size: parseFloat(event.target.value) })} />
                </label>
            </div>

            <main className="workspace">
                <aside className="left-rail">
                    <RailButton label="â†–" title="Select" tool="select" active={ui.tool === "select"} disabled={ui.tool === "select"} onClick={() => editor?.setTool("select")} />
                    <RailButton label="âśĄ" title="Move guide" tool="plane" active={ui.tool === "plane"} onClick={() => editor?.setTool("plane")} />
                    <div className="rail-separator" />
                    <RailButton label="âśŽ" title="Brush" tool="brush" active={ui.tool === "brush"} onClick={() => editor?.setTool("brush")} />
                    <RailButton label="âŚ«" title="Eraser" tool="eraser" active={ui.tool === "eraser"} onClick={() => editor?.setTool("eraser")} />
                    <div className="rail-separator" />
                    <RailButton label="â•±" title="Line" tool="line" active={ui.tool === "line"} onClick={() => editor?.setTool("line")} />
                    <RailButton label="â—‹" title="Circle" tool="circle" active={ui.tool === "circle"} onClick={() => editor?.setTool("circle")} />
                    <RailButton label="â¬¬" title="Ellipse" tool="ellipse" active={ui.tool === "ellipse"} onClick={() => editor?.setTool("ellipse")} />
                    <RailButton label="â–­" title="Rectangle" tool="rectangle" active={ui.tool === "rectangle"} onClick={() => editor?.setTool("rectangle")} />
                </aside>

                <section className="viewport-card">
                    <canvas ref={canvasRef} />
                    <div className="floating-help">
                        <div className="help-title">â“ {modeLabel(ui.tool, ui.transformMode)}</div>
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
                                        className={`object-row ${active ? "active" : ""}`}
                                        onClick={() => editor?.selectObject(object.id)}
                                        title={`${object.planes.length} plane${object.planes.length === 1 ? "" : "s"}`}
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
                                            title={layer.visible ? "Hide layer" : "Show layer"}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                editor?.toggleLayerVisible(layer.id);
                                            }}
                                        >
                                            {layer.visible ? "V" : "H"}
                                        </button>
                                        <button
                                            title={layer.locked ? "Unlock layer" : "Lock layer"}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                editor?.toggleLayerLocked(layer.id);
                                            }}
                                        >
                                            {layer.locked ? "L" : "U"}
                                        </button>
                                        <input
                                            className="layer-name-input"
                                            value={layer.name}
                                            title={`${layer.worldPlanes.length} plane${layer.worldPlanes.length === 1 ? "" : "s"}`}
                                            onFocus={() => editor?.selectLayer(layer.id)}
                                            onClick={() => editor?.selectLayer(layer.id)}
                                            onChange={(event) => editor?.renameLayer(layer.id, event.target.value)}
                                        />
                                        <button
                                            title="Move up"
                                            disabled={index === 0}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                editor?.moveLayer(layer.id, -1);
                                            }}
                                        >
                                            â†‘
                                        </button>
                                        <button
                                            title="Move down"
                                            disabled={index === ui.layers.length - 1}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                editor?.moveLayer(layer.id, 1);
                                            }}
                                        >
                                            â†“
                                        </button>
                                        <button
                                            title="Merge down"
                                            disabled={index === ui.layers.length - 1}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                editor?.mergeLayerDown(layer.id);
                                            }}
                                        >
                                            M
                                        </button>
                                        <button
                                            title="Delete layer"
                                            disabled={ui.layers.length <= 1}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                editor?.deleteLayer(layer.id);
                                            }}
                                        >
                                            Ă—
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

function ModeButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
    return <button className={`tool-mode-button ${active ? "active" : ""}`} onClick={onClick}><span className="tool-dot" />{label}</button>;
}

function Toggle({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
    return <button className="toggle-row ghost-button" onClick={onClick}><span className={`switch ${active ? "on" : ""}`} />{label}</button>;
}

function RailButton({ label, title, active, disabled, onClick }: { label: string; title: string; tool: Tool; active: boolean; disabled?: boolean; onClick: () => void }) {
    return <button className={`rail-button ${active ? "active" : ""}`} title={title} disabled={disabled} onClick={onClick}>{label}</button>;
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
