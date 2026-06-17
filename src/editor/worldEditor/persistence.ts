import { decodeProject, encodeProject, type ProjectData } from "../serializer";
import { exportVisibleLayersGLB } from "../exporter";

type EditorHost = any;

export function saveFile(host: EditorHost) {
    const data: ProjectData = {
        layers: host.layers,
        savedObjects: host.savedObjects,
        activeLayerId: host.activeLayerId,
        activePlaneId: host.activePlaneId,
        planeType: host.planeType,
        transformMode: host.transformMode,
        guideChanged: host.guideChanged,
        guidePosition: host.drawingGuide.group.position.toArray(),
        guideQuaternion: host.drawingGuide.group.quaternion.toArray(),
        brush: { ...host.brush },
        darkMode: host.darkMode,
        gridVisible: host.gridVisible,
    };
    const bytes = encodeProject(data);
    const url = URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type: "application/octet-stream" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "canvas-project.cnvs";
    a.click();
    URL.revokeObjectURL(url);
    host.setStatus("Project saved.");
}

export function loadFile(host: EditorHost, buffer: ArrayBuffer) {
    try {
        restoreFromProject(host, decodeProject(buffer));
        host.setStatus("Project loaded.");
    } catch {
        host.setStatus("Failed to load project file.");
    }
}

export function restoreFromProject(host: EditorHost, data: ProjectData) {
    host.isRestoring = true;
    host.drawingStroke = null;
    host.drawingMesh = null;
    host.isPointerDrawing = false;
    host.shapeStart = null;
    host.shapeEnd = null;
    host.clearShapePreview();
    host.layers = data.layers;
    host.savedObjects = data.savedObjects ?? [];
    host.activeLayerId = data.activeLayerId;
    host.activePlaneId = data.activePlaneId;
    host.activeObjectId = host.savedObjects[0]?.id || null;
    host.planeType = data.planeType;
    host.transformMode = data.transformMode;
    host.guideChanged = data.guideChanged;
    host.drawingGuide.group.position.fromArray(data.guidePosition);
    host.drawingGuide.group.quaternion.fromArray(data.guideQuaternion);
    host.brush = { ...host.brush, ...data.brush };
    host.darkMode = data.darkMode;
    host.applyTheme();
    host.gridVisible = data.gridVisible;
    host.grid.visible = data.gridVisible;
    host.rebuildRuntimeFromState();
    host.updateAllStrokeMaterials();
    host.isRestoring = false;
}

export async function exportGLB(host: EditorHost) {
    host.setStatus("Exporting visible layer islands...");
    await exportVisibleLayersGLB(host.layers, host.planeRuntime);
    host.setStatus("GLB export created.");
}

export function undo(host: EditorHost) {
    if (host.undoStack.length === 0) {
        host.setStatus("Nothing to undo.");
        return;
    }
    const current = serialize(host);
    const previous = host.undoStack.pop();
    host.redoStack.push(current);
    restore(host, previous);
    host.setStatus("Undo.");
}

export function redo(host: EditorHost) {
    if (host.redoStack.length === 0) {
        host.setStatus("Nothing to redo.");
        return;
    }
    const current = serialize(host);
    const next = host.redoStack.pop();
    host.undoStack.push(current);
    restore(host, next);
    host.setStatus("Redo.");
}

export function saveHistory(host: EditorHost) {
    if (host.isRestoring || host.isPointerDrawing) return;
    const snapshot = serialize(host);
    if (snapshot === host.undoStack[host.undoStack.length - 1]) return;
    host.undoStack.push(snapshot);
    if (host.undoStack.length > 100) host.undoStack.shift();
    host.redoStack = [];
}

export function serialize(host: EditorHost) {
    const snapshot = {
        layers: host.layers,
        savedObjects: host.savedObjects,
        activeLayerId: host.activeLayerId,
        activePlaneId: host.activePlaneId,
        activeObjectId: host.activeObjectId,
        planeType: host.planeType,
        transformMode: host.transformMode,
        guideChanged: host.guideChanged,
        guidePosition: host.drawingGuide.group.position.toArray(),
        guideQuaternion: host.drawingGuide.group.quaternion.toArray()
    };
    return JSON.stringify(snapshot);
}

export function restore(host: EditorHost, snapshot: string) {
    host.isRestoring = true;
    const data = JSON.parse(snapshot);
    host.drawingStroke = null;
    host.drawingMesh = null;
    host.isPointerDrawing = false;
    host.layers = data.layers;
    host.savedObjects = data.savedObjects ?? [];
    host.activeLayerId = data.activeLayerId;
    host.activePlaneId = data.activePlaneId;
    host.activeObjectId = data.activeObjectId ?? host.savedObjects[0]?.id ?? null;
    host.planeType = data.planeType;
    host.transformMode = data.transformMode;
    host.guideChanged = data.guideChanged;
    host.drawingGuide.group.position.fromArray(data.guidePosition);
    host.drawingGuide.group.quaternion.fromArray(data.guideQuaternion);
    host.rebuildRuntimeFromState();
    host.isRestoring = false;
}
