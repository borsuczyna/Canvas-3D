import type { Tool } from "../../types";

export function round3(value: number) {
    return Math.round(value * 1000) / 1000;
}

export function capitalize(value: string) {
    return value.slice(0, 1).toUpperCase() + value.slice(1);
}

export function isShapeTool(tool: Tool): boolean {
    return tool === "line" || tool === "circle" || tool === "ellipse" || tool === "rectangle";
}

export function isTextEditingTarget(target: EventTarget | null): boolean {
    const element = target as HTMLElement | null;
    if (!element) return false;
    const tag = element.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || element.isContentEditable;
}

export function disposeObject(object: import("three").Object3D) {
    const mesh = object as import("three").Mesh;
    mesh.geometry?.dispose?.();
    const material = mesh.material;
    if (material) {
        if (Array.isArray(material)) material.forEach((item) => item.dispose());
        else material.dispose();
    }
}
