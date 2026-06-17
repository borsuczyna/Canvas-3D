export type Tool = "brush" | "eraser" | "plane" | "select" | "line" | "circle" | "ellipse" | "rectangle";
export type TransformMode = "translate" | "rotate" | "both";
export type PlaneType = "XY" | "XZ" | "YZ";

export type StrokePoint = {
    x: number;
    y: number;
};

export type Stroke = {
    id: string;
    color: string;
    brushSize: number;
    opacity: number;
    points: StrokePoint[];
};

export type WorldPlane = {
    id: string;
    layerId: string;
    name: string;
    position: number[];
    quaternion: number[];
    planeType: PlaneType;
    strokes: Stroke[];
};

export type Layer = {
    id: string;
    name: string;
    visible: boolean;
    locked: boolean;
    worldPlanes: WorldPlane[];
};

export type ObjectPlane = {
    name: string;
    position: number[];
    quaternion: number[];
    planeType: PlaneType;
    strokes: Stroke[];
};

export type SavedObject = {
    id: string;
    name: string;
    planes: ObjectPlane[];
};

export type ObjectPlacementUi = {
    active: boolean;
    stage: "preview" | "adjust";
    objectId: string | null;
    objectName: string | null;
};

export type GuideValues = {
    posX: number;
    posY: number;
    posZ: number;
    rotX: number;
    rotY: number;
    rotZ: number;
};

export type PlaneInfo = {
    name: string;
    type: PlaneType;
    strokes: number;
    islands: number;
    position: number[];
    guide: number[];
};

export type EditorSnapshot = {
    layers: Layer[];
    savedObjects: SavedObject[];
    activeLayerId: string | null;
    activePlaneId: string | null;
    activeObjectId: string | null;
    planeType: PlaneType;
    transformMode: TransformMode;
    guideChanged: boolean;
    guidePosition: number[];
    guideQuaternion: number[];
};

export type EditorUiState = {
    layers: Layer[];
    savedObjects: SavedObject[];
    activeLayerId: string | null;
    activePlaneId: string | null;
    activeObjectId: string | null;
    placement: ObjectPlacementUi;
    planeType: PlaneType;
    tool: Tool;
    transformMode: TransformMode;
    darkMode: boolean;
    gridVisible: boolean;
    snapping: boolean;
    brush: {
        color: string;
        size: number;
        opacity: number;
        smoothing: number;
    };
    guide: GuideValues;
    planeInfo: PlaneInfo | null;
    status: string;
};
