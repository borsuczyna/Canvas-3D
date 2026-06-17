import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import type { Layer, WorldPlane } from "../types";
import { clusterStrokeIslands, drawStrokeToCanvas } from "./strokes";

const MAX_TEXTURE_SIZE = 2048;
const TARGET_PIXELS_PER_UNIT = 24;

export async function exportVisibleLayersGLB(layers: Layer[], planeRuntime: Map<string, { group: THREE.Group }>) {
    const exportScene = new THREE.Scene();
    exportScene.name = "Infinite_3D_Drawing_Canvas";

    for (const layer of layers) {
        if (!layer.visible) continue;
        const layerGroup = new THREE.Group();
        layerGroup.name = sanitizeName(layer.name || layer.id);
        layerGroup.userData = { layerId: layer.id, layerName: layer.name, visible: layer.visible };
        exportScene.add(layerGroup);

        for (const worldPlane of layer.worldPlanes) {
            const strokes = worldPlane.strokes.filter((stroke) => stroke.points.length > 0);
            if (!strokes.length) continue;
            const islands = clusterStrokeIslands(strokes, 128, 12);
            const runtime = planeRuntime.get(worldPlane.id);
            islands.forEach((island, index) => {
                const mesh = createIslandMesh(worldPlane, island, index, runtime);
                if (mesh) layerGroup.add(mesh);
            });
        }
    }

    const exporter = new GLTFExporter();
    const result = await exporter.parseAsync(exportScene, {
        binary: true,
        embedImages: true,
        onlyVisible: true,
        includeCustomExtensions: false
    });
    const blob =
        result instanceof ArrayBuffer
            ? new Blob([result], { type: "model/gltf-binary" })
            : new Blob([JSON.stringify(result, null, 2)], { type: "model/gltf+json" });
    downloadBlob(blob, `world-canvas-${new Date().toISOString().replace(/[:.]/g, "-")}.glb`);
}

function createIslandMesh(
    worldPlane: WorldPlane,
    island: ReturnType<typeof clusterStrokeIslands>[number],
    index: number,
    runtime?: { group: THREE.Group }
) {
    const bounds = {
        minX: island.bounds.minX - 0.25,
        minY: island.bounds.minY - 0.25,
        maxX: island.bounds.maxX + 0.25,
        maxY: island.bounds.maxY + 0.25
    };
    const width = Math.max(0.02, bounds.maxX - bounds.minX);
    const height = Math.max(0.02, bounds.maxY - bounds.minY);
    const scale = Math.max(1, Math.min(TARGET_PIXELS_PER_UNIT, MAX_TEXTURE_SIZE / Math.max(width, height)));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(2, Math.ceil(width * scale));
    canvas.height = Math.max(2, Math.ceil(height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const stroke of island.strokes) drawStrokeToCanvas(ctx, stroke, bounds, scale, canvas.height);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    // Keep canvas textures flipped here so GLTFExporter writes correct orientation for external viewers.
    texture.flipY = true;
    texture.needsUpdate = true;

    const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        alphaTest: 0.01,
        side: THREE.DoubleSide,
        depthWrite: false
    });
    const geometry = new THREE.PlaneGeometry(width, height);
    const mesh = new THREE.Mesh(geometry, material);
    const centerLocal = new THREE.Vector3((bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2, 0.03);

    if (runtime?.group) {
        mesh.position.copy(runtime.group.localToWorld(centerLocal.clone()));
        runtime.group.getWorldQuaternion(mesh.quaternion);
    } else {
        const quaternion = new THREE.Quaternion(...(worldPlane.quaternion as [number, number, number, number]));
        mesh.position.copy(new THREE.Vector3(...(worldPlane.position as [number, number, number])).add(centerLocal.applyQuaternion(quaternion)));
        mesh.quaternion.copy(quaternion);
    }

    mesh.name = `${sanitizeName(worldPlane.name || worldPlane.id)}_Island_${index + 1}`;
    mesh.userData = {
        layerId: worldPlane.layerId,
        worldPlaneId: worldPlane.id,
        planeType: worldPlane.planeType,
        islandId: island.islandId,
        originalPosition: worldPlane.position,
        originalRotation: worldPlane.quaternion,
        localBounds: bounds,
        strokeCount: island.strokes.length
    };
    return mesh;
}

function sanitizeName(name: string) {
    return String(name).replace(/[^a-z0-9_ -]/gi, "_").replace(/\s+/g, "_");
}

function downloadBlob(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
