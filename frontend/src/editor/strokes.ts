import * as THREE from "three";
import type { Stroke, StrokePoint } from "../types";

export function makeId(prefix: string): string {
    return `${prefix}_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36)}`;
}

export function distance2(a: StrokePoint, b: StrokePoint): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
}

export function pointSegmentDistance(point: StrokePoint, a: StrokePoint, b: StrokePoint): number {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const apx = point.x - a.x;
    const apy = point.y - a.y;
    const ab2 = abx * abx + aby * aby || 1;
    const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / ab2));
    const x = a.x + abx * t;
    const y = a.y + aby * t;
    return Math.hypot(point.x - x, point.y - y);
}

export function simplifyAppend(points: StrokePoint[], point: StrokePoint, minDistance: number): boolean {
    if (points.length === 0 || distance2(points[points.length - 1], point) >= minDistance * minDistance) {
        points.push(point);
        return true;
    }
    return false;
}

export type Bounds = {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
};

export function strokeBounds(stroke: Stroke): Bounds | null {
    if (!stroke.points.length) return null;
    const pad = stroke.brushSize * 0.65;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of stroke.points) {
        minX = Math.min(minX, p.x - pad);
        minY = Math.min(minY, p.y - pad);
        maxX = Math.max(maxX, p.x + pad);
        maxY = Math.max(maxY, p.y + pad);
    }
    return { minX, minY, maxX, maxY };
}

export function mergeBounds(a: Bounds | null, b: Bounds): Bounds {
    if (!a) return { ...b };
    return {
        minX: Math.min(a.minX, b.minX),
        minY: Math.min(a.minY, b.minY),
        maxX: Math.max(a.maxX, b.maxX),
        maxY: Math.max(a.maxY, b.maxY)
    };
}

export function buildStrokeGeometry(stroke: Stroke, zOffset = 0.025): THREE.BufferGeometry {
    const points = dedupePoints(stroke.points);
    const radius = Math.max(0.01, stroke.brushSize * 0.5);
    const vertices: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    if (points.length === 1) {
        addDisc(vertices, uvs, indices, points[0], radius, zOffset);
    } else if (points.length > 1) {
        addContinuousStrip(vertices, uvs, indices, points, radius, zOffset);
        addDisc(vertices, uvs, indices, points[0], radius, zOffset);
        addDisc(vertices, uvs, indices, points[points.length - 1], radius, zOffset);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    return geometry;
}

function dedupePoints(points: StrokePoint[]): StrokePoint[] {
    const result: StrokePoint[] = [];
    for (const point of points) {
        if (!result.length || distance2(result[result.length - 1], point) > 0.000001) result.push(point);
    }
    return result;
}

function addContinuousStrip(
    vertices: number[],
    uvs: number[],
    indices: number[],
    points: StrokePoint[],
    radius: number,
    zOffset: number
) {
    const left: StrokePoint[] = [];
    const right: StrokePoint[] = [];
    const normals: StrokePoint[] = [];

    for (let i = 0; i < points.length - 1; i++) {
        const a = points[i];
        const b = points[i + 1];
        const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const dx = (b.x - a.x) / length;
        const dy = (b.y - a.y) / length;
        normals.push({ x: -dy, y: dx });
    }

    for (let i = 0; i < points.length; i++) {
        const point = points[i];
        let nx: number;
        let ny: number;
        let scale = radius;

        if (i === 0) {
            nx = normals[0].x;
            ny = normals[0].y;
        } else if (i === points.length - 1) {
            nx = normals[normals.length - 1].x;
            ny = normals[normals.length - 1].y;
        } else {
            const prev = normals[i - 1];
            const next = normals[i];
            const mx = prev.x + next.x;
            const my = prev.y + next.y;
            const length = Math.hypot(mx, my);
            if (length < 0.0001) {
                nx = next.x;
                ny = next.y;
            } else {
                nx = mx / length;
                ny = my / length;
                const dot = nx * next.x + ny * next.y;
                scale = Math.min(radius / Math.max(0.35, Math.abs(dot)), radius * 2.2);
            }
        }

        left.push({ x: point.x + nx * scale, y: point.y + ny * scale });
        right.push({ x: point.x - nx * scale, y: point.y - ny * scale });
    }

    for (let i = 0; i < points.length; i++) {
        vertices.push(left[i].x, left[i].y, zOffset, right[i].x, right[i].y, zOffset);
        uvs.push(0, 0, 1, 1);
    }

    for (let i = 0; i < points.length - 1; i++) {
        const base = i * 2;
        indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    }
}

function addDisc(vertices: number[], uvs: number[], indices: number[], center: StrokePoint, radius: number, zOffset: number) {
    const segments = 18;
    const start = vertices.length / 3;
    vertices.push(center.x, center.y, zOffset);
    uvs.push(0.5, 0.5);
    for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        vertices.push(center.x + Math.cos(angle) * radius, center.y + Math.sin(angle) * radius, zOffset);
        uvs.push((Math.cos(angle) + 1) * 0.5, (Math.sin(angle) + 1) * 0.5);
    }
    for (let i = 1; i <= segments; i++) indices.push(start, start + i, start + i + 1);
}

export function drawStrokeToCanvas(
    ctx: CanvasRenderingContext2D,
    stroke: Stroke,
    bounds: Bounds,
    scale: number,
    height: number
) {
    if (!stroke.points.length) return;
    ctx.save();
    ctx.globalAlpha = stroke.opacity;
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineWidth = Math.max(1, stroke.brushSize * scale);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const toCanvas = (point: StrokePoint) => ({
        x: (point.x - bounds.minX) * scale,
        y: height - (point.y - bounds.minY) * scale
    });

    if (stroke.points.length === 1) {
        const p = toCanvas(stroke.points[0]);
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(1, (stroke.brushSize * scale) / 2), 0, Math.PI * 2);
        ctx.fill();
    } else {
        const first = toCanvas(stroke.points[0]);
        ctx.beginPath();
        ctx.moveTo(first.x, first.y);
        for (let i = 1; i < stroke.points.length; i++) {
            const p = toCanvas(stroke.points[i]);
            ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
    }
    ctx.restore();
}

export function clusterStrokeIslands(strokes: Stroke[], cellSize = 128, mergePadding = 8) {
    const records = strokes
        .map((stroke, index) => ({ stroke, index, bounds: strokeBounds(stroke) }))
        .filter((record): record is { stroke: Stroke; index: number; bounds: Bounds } => Boolean(record.bounds));
    const parent = records.map((_, index) => index);
    const cells = new Map<string, number[]>();

    const find = (index: number): number => {
        while (parent[index] !== index) {
            parent[index] = parent[parent[index]];
            index = parent[index];
        }
        return index;
    };
    const union = (a: number, b: number) => {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) parent[rb] = ra;
    };
    const key = (x: number, y: number) => `${x},${y}`;
    const padded = (bounds: Bounds) => ({
        minX: bounds.minX - mergePadding,
        minY: bounds.minY - mergePadding,
        maxX: bounds.maxX + mergePadding,
        maxY: bounds.maxY + mergePadding
    });
    const overlaps = (a: Bounds, b: Bounds) =>
        a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;

    records.forEach((record, recordIndex) => {
        const bounds = padded(record.bounds);
        const minCellX = Math.floor(bounds.minX / cellSize);
        const maxCellX = Math.floor(bounds.maxX / cellSize);
        const minCellY = Math.floor(bounds.minY / cellSize);
        const maxCellY = Math.floor(bounds.maxY / cellSize);
        const nearby = new Set<number>();

        for (let x = minCellX - 1; x <= maxCellX + 1; x++) {
            for (let y = minCellY - 1; y <= maxCellY + 1; y++) {
                for (const other of cells.get(key(x, y)) || []) nearby.add(other);
            }
        }
        for (const otherIndex of nearby) {
            if (overlaps(bounds, padded(records[otherIndex].bounds))) union(recordIndex, otherIndex);
        }
        for (let x = minCellX; x <= maxCellX; x++) {
            for (let y = minCellY; y <= maxCellY; y++) {
                const cellKey = key(x, y);
                if (!cells.has(cellKey)) cells.set(cellKey, []);
                cells.get(cellKey)!.push(recordIndex);
            }
        }
    });

    const groups = new Map<number, { strokes: Stroke[]; bounds: Bounds | null }>();
    records.forEach((record, index) => {
        const root = find(index);
        if (!groups.has(root)) groups.set(root, { strokes: [], bounds: null });
        const group = groups.get(root)!;
        group.strokes.push(record.stroke);
        group.bounds = mergeBounds(group.bounds, record.bounds);
    });

    return [...groups.values()].map((group, index) => ({ ...group, bounds: group.bounds!, islandId: `island_${index + 1}` }));
}

export function splitStrokeByEraser(stroke: Stroke, point: StrokePoint, radius: number): Stroke[] {
    if (!stroke.points.length) return [];
    const kept: StrokePoint[][] = [];
    let current: StrokePoint[] = [];
    const hitRadius = radius + stroke.brushSize * 0.5;

    for (let i = 0; i < stroke.points.length; i++) {
        const p = stroke.points[i];
        const prev = stroke.points[i - 1] || p;
        const next = stroke.points[i + 1] || p;
        const hit = pointSegmentDistance(point, prev, p) <= hitRadius || pointSegmentDistance(point, p, next) <= hitRadius;
        if (hit) {
            if (current.length > 0) kept.push(current);
            current = [];
        } else {
            current.push({ ...p });
        }
    }
    if (current.length > 0) kept.push(current);

    return kept.filter((points) => points.length > 0).map((points) => ({ ...stroke, id: makeId("stroke"), points }));
}
