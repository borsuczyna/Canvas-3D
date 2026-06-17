import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import type {
    EditorUiState,
    GuideValues,
    Layer,
    PlaneInfo,
    PlaneType,
    SavedObject,
    Stroke,
    Tool,
    TransformMode,
    WorldPlane
} from "../types";
import type { ProjectData } from "./serializer";
import { FreeFlyControls } from "./freeFlyControls";
import {
    exportGLB,
    applyProjectData,
    applyCollaborativeProjectData,
    createProjectData,
    loadFile,
    redo,
    restore,
    restoreFromProject,
    saveFile,
    saveHistory,
    serialize,
    undo
} from "./worldEditor/persistence";
import {
    addLayer,
    cancelObjectPlacement,
    confirmObjectPlacement,
    createObjectFromActiveLayer,
    deleteLayer,
    mergeLayerDown,
    moveLayer,
    renameLayer,
    selectLayer,
    selectObject,
    startObjectPlacement,
    toggleLayerLocked,
    toggleLayerVisible
} from "./worldEditor/layerObjectOps";
import {
    handleGlobalKeyDown,
    handleGlobalKeyUp,
    handlePointerDown,
    handlePointerLeave,
    handlePointerMove,
    handlePointerUp
} from "./worldEditor/inputHandlers";
import {
    GUIDE_DRAWING_PADDING,
    GUIDE_EMPTY_SIZE,
    type PlacementPlane,
    type PlacementState,
    type RuntimePlane,
    type WorldEditorOptions
} from "./worldEditor/types";
import {
    capitalize,
    disposeObject,
    round3
} from "./worldEditor/utils";
import {
    clearShapePreview,
    finalizeShape,
    getShapePoints,
    syncShapePreview,
    updateBrushGhost
} from "./worldEditor/drawingTools";
import {
    buildStrokeGeometry,
    clusterStrokeIslands,
    makeId,
    mergeBounds,
    simplifyAppend,
    splitStrokeByEraser,
    strokeBounds,
    type Bounds
} from "./strokes";

export class WorldEditor {
    private renderer: THREE.WebGLRenderer;
    private scene = new THREE.Scene();
    private camera = new THREE.PerspectiveCamera(64, 1, 0.03, 250000);
    private raycaster = new THREE.Raycaster();
    private pointerNdc = new THREE.Vector2();
    private pointerPlane = new THREE.Plane();
    private pointerRay = new THREE.Ray();
    private floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    private clock = new THREE.Clock();
    private layersRoot = new THREE.Group();
    private grid = new THREE.GridHelper(2000, 200, 0x9aa6b8, 0xd8dee8);
    private axisHelper = new THREE.AxesHelper(8);
    private drawingGuide = this.createDrawingGuide();
    private anchoredGuideGhost = this.createAnchoredGuideGhost();
    private tcTranslate: TransformControls;
    private thTranslate: THREE.Object3D;
    private tcRotate: TransformControls;
    private thRotate: THREE.Object3D;
    private cameraControls: FreeFlyControls;
    private layerRuntime = new Map<string, { group: THREE.Group }>();
    private planeRuntime = new Map<string, RuntimePlane>();
    private animationId = 0;
    private onChange: (state: EditorUiState) => void;

    private layers: Layer[] = [];
    private savedObjects: SavedObject[] = [];
    private activeLayerId: string | null = null;
    private activePlaneId: string | null = null;
    private activeObjectId: string | null = null;
    private tool: Tool = "brush";
    private transformMode: TransformMode = "translate";
    private planeType: PlaneType = "XZ";
    private brush = { color: "#111827", size: 0.45, opacity: 1, smoothing: 0.35 };
    private drawingStroke: Stroke | null = null;
    private drawingMesh: THREE.Mesh | null = null;
    private isPointerDrawing = false;
    private guideChanged = true;
    private previousCameraPosition = new THREE.Vector3();
    private previousCameraQuaternion = new THREE.Quaternion();
    private darkMode = false;
    private gridVisible = true;
    private snapping = true;
    private status = "Ready";
    private undoStack: string[] = [];
    private redoStack: string[] = [];
    private isRestoring = false;
    private brushGhostLine!: THREE.LineLoop;
    private shapePreviewLine: THREE.Line | null = null;
    private shapeStart: { x: number; y: number } | null = null;
    private shapeEnd: { x: number; y: number } | null = null;
    private isApplyingGuideConstraints = false;
    private placement: PlacementState = {
        active: false,
        stage: "preview",
        objectId: null,
        objectName: null,
        group: null,
        planes: []
    };

    constructor(options: WorldEditorOptions) {
        this.onChange = options.onChange;
        this.renderer = new THREE.WebGLRenderer({ canvas: options.canvas, antialias: true, alpha: false });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setClearColor(0xf6f7fb, 1);
        this.scene.fog = new THREE.FogExp2(0xf6f7fb, 0.00045);
        this.camera.position.set(10, 10, 14);
        this.previousCameraPosition.copy(this.camera.position);
        this.previousCameraQuaternion.copy(this.camera.quaternion);

        this.layersRoot.name = "Editable_Layers";
        this.scene.add(this.layersRoot);
        this.grid.material.depthWrite = false;
        this.grid.renderOrder = -100;
        this.scene.add(this.grid);
        this.scene.add(this.axisHelper);
        this.scene.add(new THREE.HemisphereLight(0xffffff, 0xdde6f2, 1.1));
        this.scene.add(this.drawingGuide.group);
        this.scene.add(this.anchoredGuideGhost);

        const ghostPts: THREE.Vector3[] = [];
        for (let i = 0; i < 64; i++) {
            const a = (i / 64) * Math.PI * 2;
            ghostPts.push(new THREE.Vector3(Math.cos(a), Math.sin(a), 0));
        }
        this.brushGhostLine = new THREE.LineLoop(
            new THREE.BufferGeometry().setFromPoints(ghostPts),
            new THREE.LineBasicMaterial({ color: 0x2563eb, depthTest: false, transparent: true, opacity: 0.85 })
        );
        this.brushGhostLine.visible = false;
        this.brushGhostLine.renderOrder = 500;
        this.scene.add(this.brushGhostLine);

        this.tcTranslate = new TransformControls(this.camera, this.renderer.domElement);
        this.tcTranslate.setMode("translate");
        this.tcTranslate.setSize(0.8);
        this.thTranslate = this.tcTranslate as unknown as THREE.Object3D;
        this.scene.add(this.thTranslate);
        this.tcTranslate.addEventListener("dragging-changed", (event) => {
            const dragging = Boolean(event.value);
            if (dragging) {
                this.saveHistory();
                this.tcRotate.enabled = false;
            } else {
                this.tcRotate.enabled = this.tool === "select" && (this.transformMode === "rotate" || this.transformMode === "both");
            }
            this.cameraControls.enabled = !dragging;
        });
        this.tcTranslate.addEventListener("objectChange", () => {
            this.applyGuideModeConstraints(false);
            this.guideChanged = true;
            this.emit();
        });

        this.tcRotate = new TransformControls(this.camera, this.renderer.domElement);
        this.tcRotate.setMode("rotate");
        this.tcRotate.setSize(0.8);
        this.thRotate = this.tcRotate as unknown as THREE.Object3D;
        this.scene.add(this.thRotate);
        this.tcRotate.addEventListener("dragging-changed", (event) => {
            const dragging = Boolean(event.value);
            if (dragging) {
                this.saveHistory();
                this.tcTranslate.enabled = false;
            } else {
                this.tcTranslate.enabled = this.tool === "select" && (this.transformMode === "translate" || this.transformMode === "both");
            }
            this.cameraControls.enabled = !dragging;
        });
        this.tcRotate.addEventListener("objectChange", () => {
            this.applyGuideModeConstraints(false);
            this.guideChanged = true;
            this.emit();
        });

        this.cameraControls = new FreeFlyControls(this.camera, this.renderer.domElement, options.moveStick, options.lookStick);
        this.bindEvents();
        this.setGuideOrientation("XZ");
        this.addLayer("Layer 1", false);
        this.syncDrawingPlaneFromGuide();
        this.setStatus("Move the guide, draw on the active plane, export visible layers.");
        this.resize();
        this.animate();
    }

    destroy() {
        this.clearPlacement(false);
        cancelAnimationFrame(this.animationId);
        window.removeEventListener("resize", this.resize);
        window.removeEventListener("keydown", this.onGlobalKeyDown);
        window.removeEventListener("keyup", this.onGlobalKeyUp);
        this.renderer.domElement.removeEventListener("pointerdown", this.onPointerDown);
        this.renderer.domElement.removeEventListener("pointermove", this.onPointerMove);
        this.renderer.domElement.removeEventListener("pointerup", this.onPointerUp);
        this.renderer.domElement.removeEventListener("pointercancel", this.onPointerUp);
        this.renderer.domElement.removeEventListener("pointerleave", this.onPointerLeave);
        this.renderer.dispose();
    }

    getUiState(): EditorUiState {
        return {
            layers: structuredClone(this.layers),
            savedObjects: structuredClone(this.savedObjects),
            activeLayerId: this.activeLayerId,
            activePlaneId: this.activePlaneId,
            activeObjectId: this.activeObjectId,
            placement: {
                active: this.placement.active,
                stage: this.placement.stage,
                objectId: this.placement.objectId,
                objectName: this.placement.objectName
            },
            planeType: this.planeType,
            tool: this.tool,
            transformMode: this.transformMode,
            darkMode: this.darkMode,
            gridVisible: this.gridVisible,
            snapping: this.snapping,
            brush: { ...this.brush },
            guide: this.getGuideValues(),
            planeInfo: this.getPlaneInfo(),
            status: this.status
        };
    }

    setTool(tool: Tool) {
        if (this.placement.active) {
            this.setStatus("Finish object placement first: Accept or Cancel.");
            return;
        }
        this.tool = tool;
        const select = tool === "select";
        const showT = select && (this.transformMode === "translate" || this.transformMode === "both");
        const showR = select && (this.transformMode === "rotate" || this.transformMode === "both");
        this.tcTranslate.enabled = showT;
        this.thTranslate.visible = showT;
        this.tcRotate.enabled = showR;
        this.thRotate.visible = showR;
        this.drawingGuide.group.visible = true;
        this.brushGhostLine.visible = false;
        this.clearShapePreview();
        this.shapeStart = null;
        this.shapeEnd = null;
        const statusMessages: Partial<Record<Tool, string>> = {
            plane: "Click the grid to set the drawing guide position.",
            brush: "Brush tool active.",
            eraser: "Eraser tool active.",
            line: "Click and drag to draw a line.",
            circle: "Click to set center, drag to set radius.",
            ellipse: "Click to set center, drag width and height.",
            rectangle: "Click and drag to draw a rectangle.",
        };
        this.setStatus(statusMessages[tool] ?? `${capitalize(tool)} tool active.`);
        this.emit();
    }

    setTransformMode(mode: TransformMode) {
        this.transformMode = mode;
        this.setTool("select");
    }

    setPlaneType(planeType: PlaneType) {
        this.saveHistory();
        this.planeType = planeType;
        this.setGuideOrientation(planeType);
        this.applyGuideModeConstraints(true);
        this.emit();
    }

    setBrush(partial: Partial<typeof this.brush>) {
        this.brush = { ...this.brush, ...partial };
        this.emit();
    }

    setDarkMode(enabled: boolean) {
        this.darkMode = enabled;
        this.applyTheme();
        this.updateAllStrokeMaterials();
        this.emit();
    }

    setGridVisible(enabled: boolean) {
        this.gridVisible = enabled;
        this.grid.visible = enabled;
        this.emit();
    }

    setSnapping(enabled: boolean) {
        this.snapping = enabled;
        this.emit();
    }

    setGuideValues(values: GuideValues) {
        this.saveHistory();
        this.drawingGuide.group.position.set(values.posX, values.posY, values.posZ);
        this.drawingGuide.group.rotation.set(
            THREE.MathUtils.degToRad(values.rotX),
            THREE.MathUtils.degToRad(values.rotY),
            THREE.MathUtils.degToRad(values.rotZ),
            "XYZ"
        );
        this.applyGuideModeConstraints(true);
        this.guideChanged = true;
        this.emit();
    }

    resetGuideRotation() {
        this.saveHistory();
        this.drawingGuide.group.quaternion.copy(this.orientationQuaternion(this.planeType));
        this.guideChanged = true;
        this.setTransformMode("rotate");
        this.setStatus("Guide rotation reset.");
    }

    addLayer(name = `Layer ${this.layers.length + 1}`, record = true) {
        addLayer(this, name, record);
    }

    selectLayer(layerId: string) {
        selectLayer(this, layerId);
    }

    toggleLayerVisible(layerId: string) {
        toggleLayerVisible(this, layerId);
    }

    toggleLayerLocked(layerId: string) {
        toggleLayerLocked(this, layerId);
    }

    renameLayer(layerId: string, name: string) {
        renameLayer(this, layerId, name);
    }

    deleteLayer(layerId: string) {
        deleteLayer(this, layerId);
    }

    moveLayer(layerId: string, direction: -1 | 1) {
        moveLayer(this, layerId, direction);
    }

    mergeLayerDown(layerId: string) {
        mergeLayerDown(this, layerId);
    }

    selectObject(objectId: string) {
        selectObject(this, objectId);
    }

    createObjectFromActiveLayer(name: string) {
        createObjectFromActiveLayer(this, name);
    }

    startObjectPlacement(objectId: string) {
        startObjectPlacement(this, objectId);
    }

    confirmObjectPlacement() {
        confirmObjectPlacement(this);
    }

    cancelObjectPlacement() {
        cancelObjectPlacement(this);
    }

    saveFile() {
        saveFile(this);
    }

    loadFile(buffer: ArrayBuffer) {
        loadFile(this, buffer);
    }

    getProjectData() {
        return createProjectData(this);
    }

    applyProjectData(data: ProjectData) {
        applyProjectData(this, data);
    }

    applyCollaborativeProjectData(data: ProjectData) {
        applyCollaborativeProjectData(this, data);
    }

    private restoreFromProject(data: any) { restoreFromProject(this, data); }

    async exportGLB() {
        await exportGLB(this);
    }

    undo() {
        undo(this);
    }

    redo() {
        redo(this);
    }

    private bindEvents() {
        window.addEventListener("resize", this.resize);
        window.addEventListener("keydown", this.onGlobalKeyDown);
        window.addEventListener("keyup", this.onGlobalKeyUp);
        this.renderer.domElement.addEventListener("pointerdown", this.onPointerDown);
        this.renderer.domElement.addEventListener("pointermove", this.onPointerMove);
        this.renderer.domElement.addEventListener("pointerup", this.onPointerUp);
        this.renderer.domElement.addEventListener("pointercancel", this.onPointerUp);
        this.renderer.domElement.addEventListener("pointerleave", this.onPointerLeave);
    }

    private onGlobalKeyDown = (event: KeyboardEvent) => handleGlobalKeyDown(this, event);

    private onGlobalKeyUp = (event: KeyboardEvent) => handleGlobalKeyUp(this, event);

    private onPointerDown = (event: PointerEvent) => handlePointerDown(this, event);

    private onPointerMove = (event: PointerEvent) => handlePointerMove(this, event);

    private onPointerLeave = () => handlePointerLeave(this);

    private onPointerUp = () => handlePointerUp(this);

    private createWorldPlane(layer: Layer, position: THREE.Vector3, planeType: PlaneType): WorldPlane | null {
        if (!layer || layer.locked) {
            this.setStatus("Select an unlocked layer before creating a plane.");
            return null;
        }
        const plane: WorldPlane = {
            id: makeId("plane"),
            layerId: layer.id,
            name: `Plane ${layer.worldPlanes.length + 1}`,
            position: position.toArray(),
            quaternion: this.drawingGuide.group.quaternion.toArray(),
            planeType,
            strokes: []
        };
        layer.worldPlanes.push(plane);
        this.createWorldPlaneRuntime(layer, plane);
        this.activeLayerId = layer.id;
        this.activePlaneId = plane.id;
        this.attachTransformToGuide();
        this.setStatus(`${planeType} drawing plane ready inside ${layer.name}.`);
        return plane;
    }

    private createWorldPlaneRuntime(layer: Layer, plane: WorldPlane) {
        const layerGroup = this.layerRuntime.get(layer.id)!.group;
        const group = new THREE.Group();
        group.name = plane.name;
        group.position.fromArray(plane.position);
        group.quaternion.fromArray(plane.quaternion);
        group.userData = { worldPlaneId: plane.id, layerId: layer.id, planeType: plane.planeType };

        const hitSurface = new THREE.Mesh(
            new THREE.PlaneGeometry(1, 1),
            new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, colorWrite: false })
        );
        hitSurface.name = `${plane.name}_HitSurface`;
        hitSurface.userData = { worldPlaneId: plane.id, selectablePlane: true };
        hitSurface.renderOrder = -50;
        group.add(hitSurface);

        const strokesGroup = new THREE.Group();
        strokesGroup.name = `${plane.name}_Strokes`;
        group.add(strokesGroup);

        layerGroup.add(group);
        this.planeRuntime.set(plane.id, { group, hitSurface, strokesGroup, strokeMeshes: new Map() });
        this.updatePlaneRuntimeGeometry(plane);
    }

    private removeWorldPlaneRuntime(plane: WorldPlane) {
        const runtime = this.planeRuntime.get(plane.id);
        if (!runtime) return;
        runtime.group.parent?.remove(runtime.group);
        runtime.group.traverse(disposeObject);
        this.planeRuntime.delete(plane.id);
    }

    private orientationQuaternion(type: PlaneType) {
        const matrix = new THREE.Matrix4();
        if (type === "XZ") {
            matrix.makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0));
        } else if (type === "YZ") {
            matrix.makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0));
        } else {
            matrix.identity();
        }
        return new THREE.Quaternion().setFromRotationMatrix(matrix);
    }

    private createDrawingGuide() {
        const group = new THREE.Group();
        group.name = "Drawing_Plane_Guide";
        const surface = new THREE.Mesh(
            new THREE.PlaneGeometry(1, 1),
            new THREE.MeshBasicMaterial({
                color: 0x2563eb,
                transparent: true,
                opacity: 0.12,
                side: THREE.DoubleSide,
                depthWrite: false,
                depthTest: false
            })
        );
        surface.name = "Drawing_Guide_Surface";
        surface.renderOrder = 100;
        group.add(surface);
        return { group, surface };
    }

    private createAnchoredGuideGhost() {
        const ghost = new THREE.Mesh(
            new THREE.PlaneGeometry(1, 1),
            new THREE.MeshBasicMaterial({
                color: 0x2563eb,
                transparent: true,
                opacity: 0.08,
                side: THREE.DoubleSide,
                depthWrite: false,
                depthTest: false
            })
        );
        ghost.name = "Drawing_Plane_Anchored_Ghost";
        ghost.renderOrder = 95;
        ghost.visible = false;
        return ghost;
    }

    private updateAnchoredGuideGhost() {
        const plane = this.getActivePlane();
        const runtime = plane ? this.planeRuntime.get(plane.id) : null;
        if (!plane || !runtime || !this.guideChanged) {
            this.anchoredGuideGhost.visible = false;
            return;
        }

        runtime.hitSurface.updateWorldMatrix(true, false);
        runtime.hitSurface.getWorldPosition(this.anchoredGuideGhost.position);
        runtime.hitSurface.getWorldQuaternion(this.anchoredGuideGhost.quaternion);
        runtime.hitSurface.getWorldScale(this.anchoredGuideGhost.scale);
        this.anchoredGuideGhost.visible = true;
    }

    private setGuideOrientation(planeType: PlaneType) {
        this.drawingGuide.group.quaternion.copy(this.orientationQuaternion(planeType));
        this.applyGuideModeConstraints(true);
        this.guideChanged = true;
    }

    private copyPlanePoseToGuide(plane: WorldPlane) {
        this.drawingGuide.group.position.fromArray(plane.position);
        this.drawingGuide.group.quaternion.fromArray(plane.quaternion);
        this.planeType = plane.planeType;
        this.applyGuideModeConstraints(false);
        this.guideChanged = false;
        this.emit();
    }

    private applyGuideModeConstraints(lockCameraFacingPosition: boolean) {
        if (this.isApplyingGuideConstraints) return;
        this.isApplyingGuideConstraints = true;

        const guide = this.drawingGuide.group;
        const beforePosition = guide.position.clone();
        const beforeQuaternion = guide.quaternion.clone();

        this.tcTranslate.showX = this.planeType === "YZ";
        this.tcTranslate.showY = this.planeType === "XZ";
        this.tcTranslate.showZ = this.planeType === "XY";

        this.tcRotate.showX = this.planeType !== "YZ";
        this.tcRotate.showY = this.planeType !== "XZ";
        this.tcRotate.showZ = this.planeType !== "XY";

        if (lockCameraFacingPosition) {
            const forward = this.camera.getWorldDirection(new THREE.Vector3()).normalize();
            const anchorDistance = 60;
            const anchor = this.camera.position.clone().add(forward.multiplyScalar(anchorDistance));

            if (this.planeType === "XZ") {
                guide.position.x = anchor.x;
                guide.position.z = anchor.z;
            } else if (this.planeType === "XY") {
                guide.position.x = anchor.x;
                guide.position.y = anchor.y;
            } else {
                guide.position.y = anchor.y;
                guide.position.z = anchor.z;
            }
        }

        const baseEuler = new THREE.Euler().setFromQuaternion(this.orientationQuaternion(this.planeType), "XYZ");
        const euler = new THREE.Euler().setFromQuaternion(guide.quaternion, "XYZ");

        if (this.planeType === "XZ") euler.y = baseEuler.y;
        if (this.planeType === "XY") euler.z = baseEuler.z;
        if (this.planeType === "YZ") euler.x = baseEuler.x;

        guide.rotation.set(euler.x, euler.y, euler.z, "XYZ");

        this.isApplyingGuideConstraints = false;
        const positionChanged = beforePosition.distanceToSquared(guide.position) > 1e-10;
        const rotationChanged = 1 - Math.abs(beforeQuaternion.dot(guide.quaternion)) > 1e-10;
        return positionChanged || rotationChanged;
    }

    private syncDrawingPlaneFromGuide() {
        const layer = this.getActiveLayer();
        if (!layer || layer.locked) return null;
        let plane = this.getActivePlane();
        const canReuseActivePlane = plane && plane.layerId === layer.id && !this.guideChanged;
        if (!canReuseActivePlane) plane = this.createWorldPlane(layer, this.drawingGuide.group.position.clone(), this.planeType);
        this.guideChanged = false;
        this.emit();
        return plane;
    }

    private getActiveLayer() {
        return this.layers.find((layer) => layer.id === this.activeLayerId) || null;
    }

    private getActivePlane() {
        for (const layer of this.layers) {
            const plane = layer.worldPlanes.find((item) => item.id === this.activePlaneId);
            if (plane) return plane;
        }
        return null;
    }

    private findLayerForPlane(planeId: string) {
        return this.layers.find((layer) => layer.worldPlanes.some((plane) => plane.id === planeId));
    }

    private canEditActiveLayer() {
        const layer = this.getActiveLayer();
        if (!layer || !layer.visible || layer.locked) {
            this.setStatus("The active layer is hidden or locked.");
            return false;
        }
        const plane = this.getActivePlane();
        if (!plane || plane.layerId !== layer.id) this.syncDrawingPlaneFromGuide();
        if (!this.getActivePlane()) {
            this.setStatus("Select an unlocked visible layer before drawing.");
            return false;
        }
        return true;
    }

    private beginStroke(localPoint: { x: number; y: number }) {
        const plane = this.getActivePlane();
        if (!plane) return;
        this.isPointerDrawing = true;
        this.drawingStroke = {
            id: makeId("stroke"),
            color: this.brush.color,
            brushSize: this.brush.size,
            opacity: this.brush.opacity,
            points: [localPoint]
        };
        plane.strokes.push(this.drawingStroke);
        this.drawingMesh = this.createStrokeMesh(this.drawingStroke);
        const runtime = this.planeRuntime.get(plane.id)!;
        runtime.strokesGroup.add(this.drawingMesh);
        runtime.strokeMeshes.set(this.drawingStroke.id, this.drawingMesh);
        this.emit();
    }

    private continueStroke(localPoint: { x: number; y: number }) {
        const stroke = this.drawingStroke;
        if (!stroke || !this.drawingMesh) return;

        const smooth = THREE.MathUtils.clamp(this.brush.smoothing, 0, 1);
        const last = stroke.points[stroke.points.length - 1] ?? localPoint;

        // High smoothing makes points follow the pointer with a soft lag, which rounds corners.
        const follow = 1 - smooth * 0.88;
        const filteredPoint = smooth <= 0.001
            ? localPoint
            : {
                x: last.x + (localPoint.x - last.x) * follow,
                y: last.y + (localPoint.y - last.y) * follow,
            };

        const tolerance = Math.max(0.003, stroke.brushSize * (0.06 + (1 - smooth) * 0.14));
        if (!simplifyAppend(stroke.points, filteredPoint, tolerance)) {
            stroke.points[stroke.points.length - 1] = filteredPoint;
        }

        this.drawingMesh.geometry.dispose();
        this.drawingMesh.geometry = buildStrokeGeometry(stroke);
        this.updatePlaneRuntimeGeometry(this.getActivePlane());
        this.emit();
    }

    private endStroke() {
        if (this.drawingStroke && this.drawingMesh && this.drawingStroke.points.length === 1) {
            this.drawingMesh.geometry.dispose();
            this.drawingMesh.geometry = buildStrokeGeometry(this.drawingStroke);
        }
        this.drawingStroke = null;
        this.drawingMesh = null;
        this.updatePlaneRuntimeGeometry(this.getActivePlane());
        this.emit();
    }

    private createStrokeMesh(stroke: Stroke) {
        const opaque = stroke.opacity >= 1;
        const material = new THREE.MeshBasicMaterial({
            color: new THREE.Color(this.displayColor(stroke.color)),
            transparent: !opaque,
            opacity: stroke.opacity,
            side: THREE.DoubleSide,
            depthWrite: opaque,
            depthTest: true
        });
        const mesh = new THREE.Mesh(buildStrokeGeometry(stroke), material);
        mesh.name = stroke.id;
        mesh.renderOrder = opaque ? 0 : 1;
        return mesh;
    }

    private eraseAt(localPoint: { x: number; y: number }) {
        const plane = this.getActivePlane();
        if (!plane) return;
        this.isPointerDrawing = true;
        const nextStrokes: Stroke[] = [];
        for (const stroke of plane.strokes) nextStrokes.push(...splitStrokeByEraser(stroke, localPoint, this.brush.size));
        plane.strokes = nextStrokes;
        this.rebuildPlaneStrokes(plane);
        this.updatePlaneRuntimeGeometry(plane);
        this.emit();
    }

    private rebuildPlaneStrokes(plane: WorldPlane) {
        const runtime = this.planeRuntime.get(plane.id);
        if (!runtime) return;
        runtime.strokesGroup.clear();
        runtime.strokeMeshes.clear();
        for (const stroke of plane.strokes) {
            const mesh = this.createStrokeMesh(stroke);
            runtime.strokesGroup.add(mesh);
            runtime.strokeMeshes.set(stroke.id, mesh);
        }
    }

    private intersectActivePlane(event: PointerEvent) {
        const plane = this.getActivePlane();
        const runtime = this.planeRuntime.get(plane?.id || "");
        if (!plane || !runtime) return null;
        this.setPointerFromEvent(event);
        this.raycaster.setFromCamera(this.pointerNdc, this.camera);
        this.pointerRay.copy(this.raycaster.ray);
        const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(runtime.group.getWorldQuaternion(new THREE.Quaternion())).normalize();
        const origin = runtime.group.getWorldPosition(new THREE.Vector3());
        this.pointerPlane.setFromNormalAndCoplanarPoint(normal, origin);
        const hit = new THREE.Vector3();
        if (!this.pointerRay.intersectPlane(this.pointerPlane, hit)) return null;
        const local = runtime.group.worldToLocal(hit);
        return { x: local.x, y: local.y };
    }

    private intersectGuidePlane(event: PointerEvent) {
        this.setPointerFromEvent(event);
        this.raycaster.setFromCamera(this.pointerNdc, this.camera);
        this.pointerRay.copy(this.raycaster.ray);
        const guide = this.drawingGuide.group;
        const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(guide.getWorldQuaternion(new THREE.Quaternion())).normalize();
        const origin = guide.getWorldPosition(new THREE.Vector3());
        this.pointerPlane.setFromNormalAndCoplanarPoint(normal, origin);
        const hit = new THREE.Vector3();
        if (!this.pointerRay.intersectPlane(this.pointerPlane, hit)) return null;
        const local = guide.worldToLocal(hit);
        return { x: local.x, y: local.y };
    }

    private intersectFloor(event: PointerEvent) {
        this.setPointerFromEvent(event);
        this.raycaster.setFromCamera(this.pointerNdc, this.camera);
        const hit = new THREE.Vector3();
        return this.raycaster.ray.intersectPlane(this.floorPlane, hit) ? hit : null;
    }

    private pickPlane(event: PointerEvent) {
        this.setPointerFromEvent(event);
        this.raycaster.setFromCamera(this.pointerNdc, this.camera);
        const surfaces: THREE.Object3D[] = [];
        for (const [planeId, runtime] of this.planeRuntime.entries()) {
            const layer = this.findLayerForPlane(planeId);
            if (layer?.visible) surfaces.push(runtime.hitSurface);
        }
        const hit = this.raycaster.intersectObjects(surfaces, false)[0];
        if (!hit) return null;
        const planeId = hit.object.userData.worldPlaneId as string;
        return this.findLayerForPlane(planeId)?.worldPlanes.find((plane) => plane.id === planeId) || null;
    }

    private setPointerFromEvent(event: PointerEvent) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.pointerNdc.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
    }

    private updatePlaneRuntimeGeometry(plane: WorldPlane | null) {
        if (!plane) return;
        const runtime = this.planeRuntime.get(plane.id);
        if (!runtime) return;
        let bounds: Bounds | null = null;
        for (const stroke of plane.strokes) {
            const next = strokeBounds(stroke);
            if (next) bounds = mergeBounds(bounds, next);
        }
        if (!bounds) bounds = { minX: -8, minY: -8, maxX: 8, maxY: 8 };
        const pad = 6;
        bounds = { minX: bounds.minX - pad, minY: bounds.minY - pad, maxX: bounds.maxX + pad, maxY: bounds.maxY + pad };
        runtime.hitSurface.position.set((bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2, -0.01);
        runtime.hitSurface.scale.set(Math.max(4, bounds.maxX - bounds.minX), Math.max(4, bounds.maxY - bounds.minY), 1);
        this.updateDrawingGuideSurface();
    }

    private updateDrawingGuideSurface() {
        const plane = this.getActivePlane();
        let bounds: Bounds | null = null;
        if (!this.guideChanged && plane && plane.strokes.length > 0) {
            for (const stroke of plane.strokes) {
                const next = strokeBounds(stroke);
                if (next) bounds = mergeBounds(bounds, next);
            }
        }
        if (bounds) {
            bounds = {
                minX: bounds.minX - GUIDE_DRAWING_PADDING,
                minY: bounds.minY - GUIDE_DRAWING_PADDING,
                maxX: bounds.maxX + GUIDE_DRAWING_PADDING,
                maxY: bounds.maxY + GUIDE_DRAWING_PADDING
            };
            this.drawingGuide.surface.position.set((bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2, -0.02);
            this.drawingGuide.surface.scale.set(Math.max(GUIDE_EMPTY_SIZE, bounds.maxX - bounds.minX), Math.max(GUIDE_EMPTY_SIZE, bounds.maxY - bounds.minY), 1);
        } else {
            this.drawingGuide.surface.position.set(0, 0, -0.02);
            this.drawingGuide.surface.scale.set(GUIDE_EMPTY_SIZE, GUIDE_EMPTY_SIZE, 1);
        }
    }

    private attachTransformToGuide() {
        this.tcTranslate.attach(this.drawingGuide.group);
        this.tcRotate.attach(this.drawingGuide.group);
        this.applyGuideModeConstraints(false);
        const select = this.tool === "select";
        const showT = select && (this.transformMode === "translate" || this.transformMode === "both");
        const showR = select && (this.transformMode === "rotate" || this.transformMode === "both");
        this.tcTranslate.enabled = showT;
        this.thTranslate.visible = showT;
        this.tcRotate.enabled = showR;
        this.thRotate.visible = showR;
    }

    private syncLayerOrder() {
        const bottomToTop = [...this.layers].reverse();
        bottomToTop.forEach((layer, index) => {
            const runtime = this.layerRuntime.get(layer.id);
            if (!runtime) return;
            this.layersRoot.add(runtime.group);
            runtime.group.traverse((object) => {
                if (object.userData.selectablePlane) object.renderOrder = -50 + index;
            });
        });
    }

    private updateRuntimeVisibility() {
        for (const layer of this.layers) {
            const runtime = this.layerRuntime.get(layer.id);
            if (runtime) runtime.group.visible = layer.visible;
        }
    }

    private getGuideValues(): GuideValues {
        const rotation = new THREE.Euler().setFromQuaternion(this.drawingGuide.group.quaternion, "XYZ");
        return {
            posX: round3(this.drawingGuide.group.position.x),
            posY: round3(this.drawingGuide.group.position.y),
            posZ: round3(this.drawingGuide.group.position.z),
            rotX: round3(THREE.MathUtils.radToDeg(rotation.x)),
            rotY: round3(THREE.MathUtils.radToDeg(rotation.y)),
            rotZ: round3(THREE.MathUtils.radToDeg(rotation.z))
        };
    }

    private getPlaneInfo(): PlaneInfo | null {
        const plane = this.getActivePlane();
        if (!plane) return null;
        return {
            name: plane.name,
            type: plane.planeType,
            strokes: plane.strokes.length,
            islands: clusterStrokeIslands(plane.strokes, 128, 12).length,
            position: plane.position,
            guide: this.drawingGuide.group.position.toArray()
        };
    }

    private saveHistory() {
        saveHistory(this);
    }

    private serialize() {
        return serialize(this);
    }

    private restore(snapshot: string) {
        restore(this, snapshot);
    }

    private rebuildRuntimeFromState() {
        for (const [, runtime] of this.planeRuntime.entries()) runtime.group.traverse(disposeObject);
        this.layersRoot.clear();
        this.layerRuntime.clear();
        this.planeRuntime.clear();
        for (const layer of this.layers) {
            const group = new THREE.Group();
            group.name = layer.name;
            this.layersRoot.add(group);
            this.layerRuntime.set(layer.id, { group });
        }
        for (const layer of this.layers) {
            for (const plane of layer.worldPlanes) {
                this.createWorldPlaneRuntime(layer, plane);
                this.rebuildPlaneStrokes(plane);
                this.updatePlaneRuntimeGeometry(plane);
            }
        }
        this.syncLayerOrder();
        this.updateRuntimeVisibility();
        this.attachTransformToGuide();
        this.updateDrawingGuideSurface();
        this.emit();
    }

    private instantiatePlacementAsLayer() {
        if (!this.placement.group || this.placement.planes.length === 0) return null;
        const objectName = this.placement.objectName || "Object";
        const layer: Layer = {
            id: makeId("layer"),
            name: `${objectName} ${this.layers.length + 1}`,
            visible: true,
            locked: false,
            worldPlanes: []
        };

        const layerGroup = new THREE.Group();
        layerGroup.name = layer.name;
        this.layersRoot.add(layerGroup);
        this.layerRuntime.set(layer.id, { group: layerGroup });

        const base = this.placement.group.position.clone();
        const rootQ = this.placement.group.quaternion.clone();
        for (const plane of this.placement.planes) {
            const worldPosition = plane.localPosition.clone().applyQuaternion(rootQ).add(base);
            const worldQuaternion = rootQ.clone().multiply(plane.localQuaternion);
            const worldPlane: WorldPlane = {
                id: makeId("plane"),
                layerId: layer.id,
                name: plane.name,
                position: worldPosition.toArray(),
                quaternion: worldQuaternion.toArray(),
                planeType: plane.planeType,
                strokes: plane.strokes.map((stroke) => ({
                    id: makeId("stroke"),
                    color: stroke.color,
                    brushSize: stroke.brushSize,
                    opacity: stroke.opacity,
                    points: stroke.points.map((point) => ({ x: point.x, y: point.y }))
                }))
            };
            layer.worldPlanes.push(worldPlane);
            this.createWorldPlaneRuntime(layer, worldPlane);
            this.rebuildPlaneStrokes(worldPlane);
            this.updatePlaneRuntimeGeometry(worldPlane);
        }

        this.layers.unshift(layer);
        this.activeLayerId = layer.id;
        this.activePlaneId = layer.worldPlanes[0]?.id || null;
        this.syncLayerOrder();
        this.updateRuntimeVisibility();
        this.attachTransformToGuide();
        return layer;
    }

    private clearPlacement(restoreGuide: boolean) {
        if (this.placement.group) {
            this.scene.remove(this.placement.group);
            this.placement.group.traverse(disposeObject);
        }
        this.placement.group = null;
        this.placement.planes = [];
        this.placement.active = false;
        this.placement.stage = "preview";
        this.placement.objectId = null;
        this.placement.objectName = null;
        this.tcTranslate.detach();
        this.tcRotate.detach();
        this.thTranslate.visible = false;
        this.thRotate.visible = false;
        if (restoreGuide) this.drawingGuide.group.visible = true;
        this.attachTransformToGuide();
    }

    private updateBrushGhost(event: PointerEvent) { updateBrushGhost(this, event); }

    private getShapePoints(tool: Tool, start: { x: number; y: number }, end: { x: number; y: number }): { x: number; y: number }[] {
        return getShapePoints(tool, start, end);
    }

    private syncShapePreview(start: { x: number; y: number }, end: { x: number; y: number }) { syncShapePreview(this, start, end); }

    private clearShapePreview() { clearShapePreview(this); }

    private finalizeShape(start: { x: number; y: number }, end: { x: number; y: number }) { finalizeShape(this, start, end); }

    private displayColor(color: string): string {
        if (!this.darkMode) return color;
        const r = parseInt(color.slice(1, 3), 16) / 255;
        const g = parseInt(color.slice(3, 5), 16) / 255;
        const b = parseInt(color.slice(5, 7), 16) / 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h = 0, s = 0;
        const l = (max + min) / 2;
        if (max !== min) {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
            else if (max === g) h = (b - r) / d + 2;
            else h = (r - g) / d + 4;
            h /= 6;
        }
        const l2 = 1 - l;
        const q = l2 < 0.5 ? l2 * (1 + s) : l2 + s - l2 * s;
        const p = 2 * l2 - q;
        const hue = (t: number) => {
            if (t < 0) t += 1; if (t > 1) t -= 1;
            if (t < 1/6) return p + (q - p) * 6 * t;
            if (t < 1/2) return q;
            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
        };
        const toHex = (v: number) => Math.round(v * 255).toString(16).padStart(2, "0");
        if (s === 0) return `#${toHex(l2)}${toHex(l2)}${toHex(l2)}`;
        return `#${toHex(hue(h + 1/3))}${toHex(hue(h))}${toHex(hue(h - 1/3))}`;
    }

    private updateAllStrokeMaterials() {
        for (const layer of this.layers) {
            for (const plane of layer.worldPlanes) {
                const runtime = this.planeRuntime.get(plane.id);
                if (!runtime) continue;
                for (const stroke of plane.strokes) {
                    const mesh = runtime.strokeMeshes.get(stroke.id);
                    const material = mesh?.material as THREE.MeshBasicMaterial | undefined;
                    if (material) material.color.set(this.displayColor(stroke.color));
                }
            }
        }
    }

    private applyTheme() {
        this.renderer.setClearColor(this.darkMode ? 0x111827 : 0xf6f7fb, 1);
        this.scene.fog = new THREE.FogExp2(this.darkMode ? 0x111827 : 0xf6f7fb, 0.00045);
        const guideMaterial = this.drawingGuide.surface.material as THREE.MeshBasicMaterial;
        guideMaterial.color.set(this.darkMode ? 0x6ea8ff : 0x2563eb);
        guideMaterial.opacity = this.darkMode ? 0.18 : 0.12;
        const anchoredGhostMaterial = this.anchoredGuideGhost.material as THREE.MeshBasicMaterial;
        anchoredGhostMaterial.color.set(this.darkMode ? 0x6ea8ff : 0x2563eb);
        anchoredGhostMaterial.opacity = this.darkMode ? 0.12 : 0.08;
        this.grid.material.dispose();
        this.scene.remove(this.grid);
        this.grid = new THREE.GridHelper(2000, 200, this.darkMode ? 0x445066 : 0x9aa6b8, this.darkMode ? 0x273244 : 0xd8dee8);
        this.grid.material.depthWrite = false;
        this.grid.renderOrder = -100;
        this.grid.visible = this.gridVisible;
        this.scene.add(this.grid);
    }

    private setStatus(message: string) {
        this.status = message;
        this.emit();
    }

    private emit() {
        this.updateDrawingGuideSurface();
        this.updateAnchoredGuideGhost();
        this.onChange(this.getUiState());
    }

    private resize = () => {
        const parent = this.renderer.domElement.parentElement;
        const width = parent?.clientWidth || window.innerWidth;
        const height = parent?.clientHeight || window.innerHeight;
        this.renderer.setSize(width, height, false);
        this.camera.aspect = width / Math.max(1, height);
        this.camera.updateProjectionMatrix();
    };

    private animate = () => {
        this.animationId = requestAnimationFrame(this.animate);
        const delta = Math.min(this.clock.getDelta(), 0.05);
        this.cameraControls.update(delta);
        if (!this.placement.active) {
            const cameraMoved =
                this.previousCameraPosition.distanceToSquared(this.camera.position) > 1e-8 ||
                1 - Math.abs(this.previousCameraQuaternion.dot(this.camera.quaternion)) > 1e-8;
            const changed = this.applyGuideModeConstraints(cameraMoved);
            if (cameraMoved && changed) {
                this.guideChanged = true;
                this.updateDrawingGuideSurface();
                this.updateAnchoredGuideGhost();
            }
        }
        this.previousCameraPosition.copy(this.camera.position);
        this.previousCameraQuaternion.copy(this.camera.quaternion);
        this.updateInfiniteGrid();
        this.renderer.render(this.scene, this.camera);
    };

    private updateInfiniteGrid() {
        const chunk = 100;
        this.grid.position.x = Math.round(this.camera.position.x / chunk) * chunk;
        this.grid.position.z = Math.round(this.camera.position.z / chunk) * chunk;
        this.axisHelper.position.copy(this.grid.position);
    }
}
