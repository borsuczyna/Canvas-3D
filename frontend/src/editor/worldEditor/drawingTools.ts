import * as THREE from "three";
import type { Tool } from "../../types";
import { makeId } from "../strokes";

type EditorHost = any;

export function updateBrushGhost(host: EditorHost, event: PointerEvent) {
    const isBrushLike = host.tool === "brush" || host.tool === "eraser";
    if (!isBrushLike) {
        host.brushGhostLine.visible = false;
        return;
    }
    const useGuide = Boolean(host.guideChanged);
    const plane = host.getActivePlane();
    const runtime = plane && host.planeRuntime.get(plane.id);
    const localPoint = useGuide ? host.intersectGuidePlane(event) : host.intersectActivePlane(event);
    if (!localPoint) {
        host.brushGhostLine.visible = false;
        return;
    }
    const targetGroup = useGuide ? host.drawingGuide.group : runtime?.group;
    if (!targetGroup) {
        host.brushGhostLine.visible = false;
        return;
    }
    const worldPos = targetGroup.localToWorld(new THREE.Vector3(localPoint.x, localPoint.y, 0.01));
    host.brushGhostLine.position.copy(worldPos);
    host.brushGhostLine.quaternion.copy(targetGroup.getWorldQuaternion(new THREE.Quaternion()));
    host.brushGhostLine.scale.setScalar(host.brush.size * 0.5);
    const mat = host.brushGhostLine.material as THREE.LineBasicMaterial;
    mat.color.set(host.tool === "brush" ? host.brush.color : "#ff6666");
    host.brushGhostLine.visible = true;
}

export function getShapePoints(tool: Tool, start: { x: number; y: number }, end: { x: number; y: number }): { x: number; y: number }[] {
    const N = 64;
    switch (tool) {
        case "line":
            return [start, end];
        case "circle": {
            const r = Math.hypot(end.x - start.x, end.y - start.y);
            if (r < 0.001) return [start];
            const pts = [];
            for (let i = 0; i <= N; i++) {
                const a = (i / N) * Math.PI * 2;
                pts.push({ x: start.x + r * Math.cos(a), y: start.y + r * Math.sin(a) });
            }
            return pts;
        }
        case "ellipse": {
            const rx = Math.abs(end.x - start.x);
            const ry = Math.abs(end.y - start.y);
            if (rx < 0.001 && ry < 0.001) return [start];
            const pts = [];
            for (let i = 0; i <= N; i++) {
                const a = (i / N) * Math.PI * 2;
                pts.push({ x: start.x + rx * Math.cos(a), y: start.y + ry * Math.sin(a) });
            }
            return pts;
        }
        case "rectangle": {
            const x0 = start.x;
            const y0 = start.y;
            const x1 = end.x;
            const y1 = end.y;
            return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }, { x: x0, y: y0 }];
        }
        default:
            return [];
    }
}

export function syncShapePreview(host: EditorHost, start: { x: number; y: number }, end: { x: number; y: number }) {
    const plane = host.getActivePlane();
    const runtime = plane && host.planeRuntime.get(plane.id);
    if (!runtime) return;
    const localPts = getShapePoints(host.tool, start, end);
    if (localPts.length < 2) return;
    const worldPts = localPts.map((p) => runtime.group.localToWorld(new THREE.Vector3(p.x, p.y, 0.02)));
    if (!host.shapePreviewLine) {
        const geo = new THREE.BufferGeometry().setFromPoints(worldPts);
        const mat = new THREE.LineBasicMaterial({ color: 0x2563eb, depthTest: false, transparent: true, opacity: 0.7 });
        host.shapePreviewLine = new THREE.Line(geo, mat);
        host.shapePreviewLine.renderOrder = 500;
        host.scene.add(host.shapePreviewLine);
    } else {
        host.shapePreviewLine.geometry.setFromPoints(worldPts);
    }
}

export function clearShapePreview(host: EditorHost) {
    if (!host.shapePreviewLine) return;
    host.scene.remove(host.shapePreviewLine);
    host.shapePreviewLine.geometry.dispose();
    (host.shapePreviewLine.material as THREE.Material).dispose();
    host.shapePreviewLine = null;
}

export function finalizeShape(host: EditorHost, start: { x: number; y: number }, end: { x: number; y: number }) {
    const plane = host.getActivePlane();
    if (!plane) return;
    const pts = getShapePoints(host.tool, start, end);
    if (pts.length < 2) return;
    const stroke = {
        id: makeId("stroke"),
        color: host.brush.color,
        brushSize: host.brush.size,
        opacity: host.brush.opacity,
        points: pts
    };
    plane.strokes.push(stroke);
    const runtime = host.planeRuntime.get(plane.id);
    if (!runtime) return;
    const mesh = host.createStrokeMesh(stroke);
    runtime.strokesGroup.add(mesh);
    runtime.strokeMeshes.set(stroke.id, mesh);
    host.updatePlaneRuntimeGeometry(plane);
    host.emit();
}
