import * as THREE from "three";
import { isShapeTool, isTextEditingTarget } from "./utils";

type EditorHost = any;

export function handleGlobalKeyDown(host: EditorHost, event: KeyboardEvent) {
    const key = event.key.toLowerCase();
    if (event.shiftKey) host.tcRotate.setRotationSnap(THREE.MathUtils.degToRad(5));
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier) {
        if (key === "z" && !event.shiftKey) {
            event.preventDefault();
            host.undo();
        } else if (key === "y" || (key === "z" && event.shiftKey)) {
            event.preventDefault();
            host.redo();
        }
        return;
    }

    if (isTextEditingTarget(event.target)) return;

    if (key === "z") {
        event.preventDefault();
        host.setPlaneType("XY");
        host.setStatus("Plane orientation set to XY.");
        return;
    }
    if (key === "x") {
        event.preventDefault();
        host.setPlaneType("XZ");
        host.setStatus("Plane orientation set to XZ.");
        return;
    }
    if (key === "c") {
        event.preventDefault();
        host.setPlaneType("YZ");
        host.setStatus("Plane orientation set to YZ.");
        return;
    }

    if (key === "g") {
        event.preventDefault();
        host.setTransformMode("both");
        return;
    }
    if (key === "b") {
        event.preventDefault();
        host.setTool("brush");
        return;
    }
    if (key === "l") {
        event.preventDefault();
        host.setTool("line");
        return;
    }
    if (key === "o") {
        event.preventDefault();
        host.setTool("circle");
        return;
    }
    if (key === "r") {
        event.preventDefault();
        host.setTool("rectangle");
    }
}

export function handleGlobalKeyUp(host: EditorHost, event: KeyboardEvent) {
    if (event.key === "Shift") host.tcRotate.setRotationSnap(null);
}

export function handlePointerDown(host: EditorHost, event: PointerEvent) {
    if (event.button !== 0 || host.tcTranslate.dragging || host.tcRotate.dragging) return;
    if (host.placement.active) {
        if (host.placement.stage === "preview" && host.placement.group) {
            const hit = host.intersectFloor(event);
            if (hit) host.placement.group.position.copy(hit);
            host.placement.stage = "adjust";
            host.tcTranslate.attach(host.placement.group);
            host.tcRotate.attach(host.placement.group);
            host.tcTranslate.enabled = true;
            host.thTranslate.visible = true;
            host.tcRotate.enabled = true;
            host.thRotate.visible = true;
            host.setStatus("Adjust object with gizmo, then Accept or Cancel.");
            host.emit();
        }
        return;
    }
    if (host.tool === "plane") {
        const position = host.intersectFloor(event) || host.camera.position.clone().add(new THREE.Vector3(0, 0, -20).applyQuaternion(host.camera.quaternion));
        host.saveHistory();
        host.drawingGuide.group.position.copy(position);
        host.guideChanged = true;
        host.setTool("brush");
        return;
    }
    if (host.tool === "select") {
        const plane = host.pickPlane(event);
        if (plane) {
            host.activeLayerId = plane.layerId;
            host.activePlaneId = plane.id;
            host.copyPlanePoseToGuide(plane);
            host.attachTransformToGuide();
            host.setStatus(`${plane.name} pose loaded into the drawing guide.`);
        }
        return;
    }
    if (!host.canEditActiveLayer()) return;
    if (host.tool === "brush") {
        host.saveHistory();
        if (host.guideChanged) host.syncDrawingPlaneFromGuide();
    } else if (host.tool === "eraser") {
        host.saveHistory();
    } else if (isShapeTool(host.tool)) {
        host.saveHistory();
        if (host.guideChanged) host.syncDrawingPlaneFromGuide();
    }
    const localPoint = host.intersectActivePlane(event);
    if (!localPoint) return;
    if (host.tool === "brush") host.beginStroke(localPoint);
    else if (host.tool === "eraser") host.eraseAt(localPoint);
    else if (isShapeTool(host.tool)) {
        host.shapeStart = localPoint;
        host.shapeEnd = localPoint;
        host.isPointerDrawing = true;
        host.syncShapePreview(localPoint, localPoint);
    }
}

export function handlePointerMove(host: EditorHost, event: PointerEvent) {
    if (host.placement.active) {
        host.brushGhostLine.visible = false;
        if (host.placement.stage === "preview" && host.placement.group) {
            const hit = host.intersectFloor(event);
            if (hit) {
                host.placement.group.position.copy(hit);
                host.emit();
            }
        }
        return;
    }
    host.updateBrushGhost(event);
    if (host.tool === "brush" && host.isPointerDrawing) {
        const localPoint = host.intersectActivePlane(event);
        if (localPoint) host.continueStroke(localPoint);
    } else if (host.tool === "eraser" && host.isPointerDrawing) {
        const localPoint = host.intersectActivePlane(event);
        if (localPoint) host.eraseAt(localPoint);
    } else if (isShapeTool(host.tool) && host.isPointerDrawing && host.shapeStart) {
        const localPoint = host.intersectActivePlane(event);
        if (localPoint) {
            host.shapeEnd = localPoint;
            host.syncShapePreview(host.shapeStart, localPoint);
        }
    }
}

export function handlePointerLeave(host: EditorHost) {
    host.brushGhostLine.visible = false;
}

export function handlePointerUp(host: EditorHost) {
    if (host.placement.active) {
        host.isPointerDrawing = false;
        return;
    }
    if (host.tool === "brush" && host.isPointerDrawing) {
        host.endStroke();
    } else if (isShapeTool(host.tool) && host.isPointerDrawing && host.shapeStart) {
        const end = host.shapeEnd ?? host.shapeStart;
        host.finalizeShape(host.shapeStart, end);
        host.clearShapePreview();
        host.shapeStart = null;
        host.shapeEnd = null;
    }
    host.isPointerDrawing = false;
}
