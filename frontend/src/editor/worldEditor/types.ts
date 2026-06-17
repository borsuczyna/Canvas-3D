import * as THREE from "three";
import type { EditorUiState, PlaneType, Stroke } from "../../types";

export type RuntimePlane = {
    group: THREE.Group;
    hitSurface: THREE.Mesh;
    strokesGroup: THREE.Group;
    strokeMeshes: Map<string, THREE.Mesh>;
};

export type PlacementPlane = {
    name: string;
    planeType: PlaneType;
    localPosition: THREE.Vector3;
    localQuaternion: THREE.Quaternion;
    strokes: Stroke[];
};

export type PlacementState = {
    active: boolean;
    stage: "preview" | "adjust";
    objectId: string | null;
    objectName: string | null;
    group: THREE.Group | null;
    planes: PlacementPlane[];
};

export type WorldEditorOptions = {
    canvas: HTMLCanvasElement;
    moveStick?: HTMLElement | null;
    lookStick?: HTMLElement | null;
    onChange: (state: EditorUiState) => void;
};

export const GUIDE_EMPTY_SIZE = 16;
export const GUIDE_DRAWING_PADDING = 4;
