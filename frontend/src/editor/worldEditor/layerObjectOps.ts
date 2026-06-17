import * as THREE from "three";
import { makeId } from "../strokes";
import { buildPlacementGhostGroup, cloneStroke, computeLayerCenter, createPlacementPlanesFromObject } from "./objectPlacement";

type EditorHost = any;

export function addLayer(host: EditorHost, name = `Layer ${host.layers.length + 1}`, record = true) {
    if (record) host.saveHistory();
    const layer = { id: makeId("layer"), name, visible: true, locked: false, worldPlanes: [] };
    host.layers.unshift(layer);
    host.activeLayerId = layer.id;
    host.activePlaneId = null;
    const group = new THREE.Group();
    group.name = name;
    host.layersRoot.add(group);
    host.layerRuntime.set(layer.id, { group });
    host.syncLayerOrder();
    host.updateRuntimeVisibility();
    host.syncDrawingPlaneFromGuide();
    host.emit();
}

export function selectLayer(host: EditorHost, layerId: string) {
    host.activeLayerId = layerId;
    const layer = host.getActiveLayer();
    if (layer && !layer.worldPlanes.some((plane: any) => plane.id === host.activePlaneId)) {
        host.activePlaneId = layer.worldPlanes[0]?.id || null;
    }
    const plane = host.getActivePlane();
    if (plane) host.copyPlanePoseToGuide(plane);
    host.attachTransformToGuide();
    host.emit();
}

export function toggleLayerVisible(host: EditorHost, layerId: string) {
    const layer = host.layers.find((item: any) => item.id === layerId);
    if (!layer) return;
    host.saveHistory();
    layer.visible = !layer.visible;
    host.updateRuntimeVisibility();
    host.emit();
}

export function toggleLayerLocked(host: EditorHost, layerId: string) {
    const layer = host.layers.find((item: any) => item.id === layerId);
    if (!layer) return;
    host.saveHistory();
    layer.locked = !layer.locked;
    host.emit();
}

export function renameLayer(host: EditorHost, layerId: string, name: string) {
    const layer = host.layers.find((item: any) => item.id === layerId);
    if (!layer || !name.trim()) return;
    host.saveHistory();
    layer.name = name.trim();
    const runtime = host.layerRuntime.get(layer.id);
    if (runtime) runtime.group.name = layer.name;
    host.emit();
}

export function deleteLayer(host: EditorHost, layerId: string) {
    if (host.layers.length <= 1) return;
    host.saveHistory();
    const index = host.layers.findIndex((layer: any) => layer.id === layerId);
    const [layer] = host.layers.splice(index, 1);
    for (const plane of layer.worldPlanes) host.removeWorldPlaneRuntime(plane);
    const runtime = host.layerRuntime.get(layer.id);
    if (runtime) host.layersRoot.remove(runtime.group);
    host.layerRuntime.delete(layer.id);
    if (host.activeLayerId === layer.id) host.activeLayerId = host.layers[0]?.id || null;
    if (!host.getActivePlane() || host.getActivePlane()?.layerId !== host.activeLayerId) {
        host.activePlaneId = host.getActiveLayer()?.worldPlanes[0]?.id || null;
    }
    host.syncLayerOrder();
    host.attachTransformToGuide();
    host.emit();
}

export function moveLayer(host: EditorHost, layerId: string, direction: -1 | 1) {
    const index = host.layers.findIndex((layer: any) => layer.id === layerId);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= host.layers.length) return;
    host.saveHistory();
    const [layer] = host.layers.splice(index, 1);
    host.layers.splice(next, 0, layer);
    host.syncLayerOrder();
    host.emit();
}

export function mergeLayerDown(host: EditorHost, layerId: string) {
    const sourceIndex = host.layers.findIndex((layer: any) => layer.id === layerId);
    const targetIndex = sourceIndex + 1;
    if (sourceIndex < 0 || targetIndex >= host.layers.length) {
        host.setStatus("Select a layer that has a layer below it to merge.");
        return;
    }

    host.saveHistory();
    const source = host.layers[sourceIndex];
    const target = host.layers[targetIndex];
    for (const plane of source.worldPlanes) plane.layerId = target.id;
    target.worldPlanes.push(...source.worldPlanes);
    host.layers.splice(sourceIndex, 1);

    host.activeLayerId = target.id;
    host.activePlaneId = target.worldPlanes[0]?.id || null;
    host.setStatus(`Merged ${source.name} into ${target.name}.`);
    host.rebuildRuntimeFromState();
}

export function selectObject(host: EditorHost, objectId: string) {
    if (!host.savedObjects.some((item: any) => item.id === objectId)) return;
    host.activeObjectId = objectId;
    host.emit();
}

export function createObjectFromActiveLayer(host: EditorHost, name: string) {
    const layer = host.getActiveLayer();
    const trimmed = name.trim();
    if (!layer || !trimmed) {
        host.setStatus("Select a layer and provide an object name.");
        return;
    }
    if (layer.worldPlanes.length === 0) {
        host.setStatus("The active layer has no planes to save as an object.");
        return;
    }

    const center = computeLayerCenter(layer);
    const planes = layer.worldPlanes.map((plane: any) => {
        const position = new THREE.Vector3().fromArray(plane.position).sub(center).toArray();
        return {
            name: plane.name,
            position,
            quaternion: [...plane.quaternion],
            planeType: plane.planeType,
            strokes: plane.strokes.map((stroke: any) => cloneStroke(stroke, makeId))
        };
    });

    host.saveHistory();
    const object = { id: makeId("object"), name: trimmed, planes };
    host.savedObjects.unshift(object);
    host.activeObjectId = object.id;
    host.setStatus(`Saved object ${trimmed} from ${layer.name}.`);
}

export function startObjectPlacement(host: EditorHost, objectId: string) {
    const object = host.savedObjects.find((item: any) => item.id === objectId);
    if (!object) {
        host.setStatus("Select an object to place.");
        return;
    }
    if (object.planes.length === 0) {
        host.setStatus("This object has no planes to place.");
        return;
    }

    host.clearPlacement(false);
    const planes = createPlacementPlanesFromObject(object, makeId);
    const group = buildPlacementGhostGroup(planes, (stroke) => host.createStrokeMesh(stroke));
    group.position.copy(host.drawingGuide.group.position);
    host.scene.add(group);

    host.placement.active = true;
    host.placement.stage = "preview";
    host.placement.objectId = object.id;
    host.placement.objectName = object.name;
    host.placement.group = group;
    host.placement.planes = planes;

    host.drawingGuide.group.visible = false;
    host.brushGhostLine.visible = false;
    host.activeObjectId = object.id;
    host.tcTranslate.detach();
    host.tcRotate.detach();
    host.thTranslate.visible = false;
    host.thRotate.visible = false;
    host.setStatus("Move cursor to preview object, click to place, then adjust with gizmo.");
    host.emit();
}

export function confirmObjectPlacement(host: EditorHost) {
    if (!host.placement.active || host.placement.stage !== "adjust" || !host.placement.group) {
        host.setStatus("Place the object first before accepting.");
        return;
    }
    host.saveHistory();
    const layer = host.instantiatePlacementAsLayer();
    host.clearPlacement(true);
    if (layer) {
        host.setStatus(`Placed object ${layer.name}.`);
    } else {
        host.setStatus("Object placement failed.");
    }
}

export function cancelObjectPlacement(host: EditorHost) {
    if (!host.placement.active) return;
    host.clearPlacement(true);
    host.setStatus("Object placement canceled.");
}
