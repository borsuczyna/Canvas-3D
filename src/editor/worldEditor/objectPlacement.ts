import * as THREE from "three";
import type { Layer, SavedObject, Stroke } from "../../types";
import { strokeBounds } from "../strokes";
import type { PlacementPlane } from "./types";

export function cloneStroke(stroke: Stroke, makeId: (prefix: string) => string): Stroke {
    return {
        id: makeId("stroke"),
        color: stroke.color,
        brushSize: stroke.brushSize,
        opacity: stroke.opacity,
        points: stroke.points.map((point) => ({ x: point.x, y: point.y }))
    };
}

export function createPlacementPlanesFromObject(object: SavedObject, makeId: (prefix: string) => string): PlacementPlane[] {
    return object.planes.map((plane) => ({
        name: plane.name,
        planeType: plane.planeType,
        localPosition: new THREE.Vector3().fromArray(plane.position),
        localQuaternion: new THREE.Quaternion().fromArray(plane.quaternion as [number, number, number, number]),
        strokes: plane.strokes.map((stroke) => cloneStroke(stroke, makeId))
    }));
}

export function buildPlacementGhostGroup(
    planes: PlacementPlane[],
    createStrokeMesh: (stroke: Stroke) => THREE.Mesh
): THREE.Group {
    const group = new THREE.Group();
    group.name = "ObjectPlacementGhost";
    for (const plane of planes) {
        const planeGroup = new THREE.Group();
        planeGroup.position.copy(plane.localPosition);
        planeGroup.quaternion.copy(plane.localQuaternion);
        planeGroup.name = plane.name;
        for (const stroke of plane.strokes) {
            const mesh = createStrokeMesh(stroke);
            const material = mesh.material as THREE.MeshBasicMaterial;
            material.transparent = true;
            material.opacity = Math.min(0.6, stroke.opacity);
            material.depthWrite = false;
            planeGroup.add(mesh);
        }
        group.add(planeGroup);
    }
    return group;
}

export function computeLayerCenter(layer: Layer) {
    const worldBounds = new THREE.Box3();
    let hasBounds = false;
    for (const plane of layer.worldPlanes) {
        const position = new THREE.Vector3().fromArray(plane.position);
        const quaternion = new THREE.Quaternion().fromArray(plane.quaternion as [number, number, number, number]);
        for (const stroke of plane.strokes) {
            const bounds = strokeBounds(stroke);
            if (!bounds) continue;
            hasBounds = true;
            const corners = [
                new THREE.Vector3(bounds.minX, bounds.minY, 0),
                new THREE.Vector3(bounds.minX, bounds.maxY, 0),
                new THREE.Vector3(bounds.maxX, bounds.minY, 0),
                new THREE.Vector3(bounds.maxX, bounds.maxY, 0)
            ];
            for (const corner of corners) {
                corner.applyQuaternion(quaternion).add(position);
                worldBounds.expandByPoint(corner);
            }
        }
    }
    if (hasBounds) return worldBounds.getCenter(new THREE.Vector3());
    if (layer.worldPlanes.length === 0) return new THREE.Vector3();
    const avg = new THREE.Vector3();
    for (const plane of layer.worldPlanes) avg.add(new THREE.Vector3().fromArray(plane.position));
    return avg.multiplyScalar(1 / layer.worldPlanes.length);
}
