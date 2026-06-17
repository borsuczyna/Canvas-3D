import type { Layer, PlaneType, SavedObject, TransformMode } from "../types";
import { makeId } from "./strokes";

const MAGIC = [0x43, 0x4e, 0x56, 0x53]; // "CNVS"
const VERSION = 2;
const PLANE_TYPES: PlaneType[] = ["XY", "XZ", "YZ"];
const TRANSFORM_MODES: TransformMode[] = ["translate", "rotate", "both"];

export type ProjectData = {
    layers: Layer[];
    savedObjects: SavedObject[];
    activeLayerId: string | null;
    activePlaneId: string | null;
    planeType: PlaneType;
    transformMode: TransformMode;
    guideChanged: boolean;
    guidePosition: number[];
    guideQuaternion: number[];
    brush: { color: string; size: number; opacity: number };
    darkMode: boolean;
    gridVisible: boolean;
};

// ** Writer ******************************************************************

class Writer {
    private chunks: Uint8Array[] = [];
    private total = 0;

    private push(buf: Uint8Array) {
        this.chunks.push(buf);
        this.total += buf.length;
    }

    u8(v: number) { this.push(new Uint8Array([v & 0xff])); }

    u16(v: number) {
        const b = new Uint8Array(2);
        new DataView(b.buffer).setUint16(0, v, true);
        this.push(b);
    }

    u32(v: number) {
        const b = new Uint8Array(4);
        new DataView(b.buffer).setUint32(0, v, true);
        this.push(b);
    }

    f32(v: number) {
        const b = new Uint8Array(4);
        new DataView(b.buffer).setFloat32(0, v, true);
        this.push(b);
    }

    str(s: string) {
        const enc = new TextEncoder().encode(s);
        this.u16(enc.length);
        this.push(enc);
    }

    // #rrggbb â†’ 3 bytes
    color(hex: string) {
        this.push(new Uint8Array([
            parseInt(hex.slice(1, 3), 16),
            parseInt(hex.slice(3, 5), 16),
            parseInt(hex.slice(5, 7), 16),
        ]));
    }

    finish(): Uint8Array {
        const out = new Uint8Array(this.total);
        let off = 0;
        for (const c of this.chunks) { out.set(c, off); off += c.length; }
        return out;
    }
}

// ** Reader ******************************************************************

class Reader {
    private view: DataView;
    private off = 0;

    constructor(buf: ArrayBuffer) { this.view = new DataView(buf); }

    u8() { return this.view.getUint8(this.off++); }
    u16() { const v = this.view.getUint16(this.off, true); this.off += 2; return v; }
    u32() { const v = this.view.getUint32(this.off, true); this.off += 4; return v; }
    f32() { const v = this.view.getFloat32(this.off, true); this.off += 4; return v; }

    str(): string {
        const len = this.u16();
        const bytes = new Uint8Array(this.view.buffer, this.off, len);
        this.off += len;
        return new TextDecoder().decode(bytes);
    }

    // 3 bytes â†’ #rrggbb
    color(): string {
        const r = this.u8().toString(16).padStart(2, "0");
        const g = this.u8().toString(16).padStart(2, "0");
        const b = this.u8().toString(16).padStart(2, "0");
        return `#${r}${g}${b}`;
    }
}

// ** Encode ******************************************************************

export function encodeProject(data: ProjectData): Uint8Array {
    const w = new Writer();

    // Header
    for (const b of MAGIC) w.u8(b);
    w.u8(VERSION);

    // Packed flags
    w.u8((data.darkMode ? 1 : 0) | (data.gridVisible ? 2 : 0) | (data.guideChanged ? 4 : 0));

    w.u8(PLANE_TYPES.indexOf(data.planeType));
    w.u8(TRANSFORM_MODES.indexOf(data.transformMode));

    // Guide transform
    for (const v of data.guidePosition) w.f32(v);
    for (const v of data.guideQuaternion) w.f32(v);

    // Brush
    w.color(data.brush.color);
    w.f32(data.brush.size);
    w.f32(data.brush.opacity);

    // Active indices (0xFFFF = none)
    const layerIdx = data.activeLayerId
        ? data.layers.findIndex(l => l.id === data.activeLayerId)
        : -1;
    w.u16(layerIdx < 0 ? 0xffff : layerIdx);

    let planeGlobalIdx = 0xffff;
    let counter = 0;
    outer: for (const layer of data.layers) {
        for (const plane of layer.worldPlanes) {
            if (plane.id === data.activePlaneId) { planeGlobalIdx = counter; break outer; }
            counter++;
        }
    }
    w.u16(planeGlobalIdx);

    // Layers
    w.u16(data.layers.length);
    for (const layer of data.layers) {
        w.str(layer.name);
        w.u8((layer.visible ? 1 : 0) | (layer.locked ? 2 : 0));
        w.u16(layer.worldPlanes.length);

        for (const plane of layer.worldPlanes) {
            w.str(plane.name);
            w.u8(PLANE_TYPES.indexOf(plane.planeType));
            for (const v of plane.position) w.f32(v);
            for (const v of plane.quaternion) w.f32(v);

            w.u32(plane.strokes.length);
            for (const stroke of plane.strokes) {
                w.color(stroke.color);
                w.f32(stroke.brushSize);
                w.f32(stroke.opacity);
                w.u32(stroke.points.length);
                for (const pt of stroke.points) { w.f32(pt.x); w.f32(pt.y); }
            }
        }
    }

    // Saved objects library
    w.u16(data.savedObjects.length);
    for (const object of data.savedObjects) {
        w.str(object.name);
        w.u16(object.planes.length);
        for (const plane of object.planes) {
            w.str(plane.name);
            w.u8(PLANE_TYPES.indexOf(plane.planeType));
            for (const v of plane.position) w.f32(v);
            for (const v of plane.quaternion) w.f32(v);
            w.u32(plane.strokes.length);
            for (const stroke of plane.strokes) {
                w.color(stroke.color);
                w.f32(stroke.brushSize);
                w.f32(stroke.opacity);
                w.u32(stroke.points.length);
                for (const pt of stroke.points) {
                    w.f32(pt.x);
                    w.f32(pt.y);
                }
            }
        }
    }

    return w.finish();
}

// ** Decode ******************************************************************

export function decodeProject(buffer: ArrayBuffer): ProjectData {
    const r = new Reader(buffer);

    // Verify magic
    for (const expected of MAGIC) {
        if (r.u8() !== expected) throw new Error("Not a CNVS file");
    }
    const version = r.u8();
    if (version !== 1 && version !== VERSION) throw new Error(`Unsupported version ${version}`);

    const flags = r.u8();
    const darkMode    = !!(flags & 1);
    const gridVisible = !!(flags & 2);
    const guideChanged = !!(flags & 4);

    const planeType     = PLANE_TYPES[r.u8()] ?? "XZ";
    const transformMode = TRANSFORM_MODES[r.u8()] ?? "both";

    const guidePosition   = [r.f32(), r.f32(), r.f32()];
    const guideQuaternion = [r.f32(), r.f32(), r.f32(), r.f32()];

    const brushColor   = r.color();
    const brushSize    = r.f32();
    const brushOpacity = r.f32();

    const activeLayerIdx = r.u16();
    const activePlaneIdx = r.u16();

    const layerCount = r.u16();
    const layers: Layer[] = [];
    const savedObjects: SavedObject[] = [];
    let activeLayerId: string | null = null;
    let activePlaneId: string | null = null;
    let globalPlane = 0;

    for (let li = 0; li < layerCount; li++) {
        const name  = r.str();
        const lf    = r.u8();
        const layerId = makeId("layer");
        if (li === activeLayerIdx) activeLayerId = layerId;

        const planeCount  = r.u16();
        const worldPlanes = [];

        for (let pi = 0; pi < planeCount; pi++) {
            const planeName  = r.str();
            const planePlaneType = PLANE_TYPES[r.u8()] ?? "XZ";
            const position   = [r.f32(), r.f32(), r.f32()];
            const quaternion = [r.f32(), r.f32(), r.f32(), r.f32()];

            const strokeCount = r.u32();
            const strokes = [];
            const planeId = makeId("plane");
            if (globalPlane === activePlaneIdx) activePlaneId = planeId;
            globalPlane++;

            for (let si = 0; si < strokeCount; si++) {
                const color     = r.color();
                const brushSz   = r.f32();
                const opacity   = r.f32();
                const ptCount   = r.u32();
                const points    = [];
                for (let i = 0; i < ptCount; i++) points.push({ x: r.f32(), y: r.f32() });
                strokes.push({ id: makeId("stroke"), color, brushSize: brushSz, opacity, points });
            }

            worldPlanes.push({ id: planeId, layerId, name: planeName, position, quaternion, planeType: planePlaneType, strokes });
        }

        layers.push({ id: layerId, name, visible: !!(lf & 1), locked: !!(lf & 2), worldPlanes });
    }

    if (version >= 2) {
        const objectCount = r.u16();
        for (let oi = 0; oi < objectCount; oi++) {
            const name = r.str();
            const planeCount = r.u16();
            const planes = [];
            for (let pi = 0; pi < planeCount; pi++) {
                const planeName = r.str();
                const planeTypeIdx = r.u8();
                const position = [r.f32(), r.f32(), r.f32()];
                const quaternion = [r.f32(), r.f32(), r.f32(), r.f32()];
                const strokeCount = r.u32();
                const strokes = [];
                for (let si = 0; si < strokeCount; si++) {
                    const color = r.color();
                    const brushSize = r.f32();
                    const opacity = r.f32();
                    const ptCount = r.u32();
                    const points = [];
                    for (let i = 0; i < ptCount; i++) points.push({ x: r.f32(), y: r.f32() });
                    strokes.push({ id: makeId("stroke"), color, brushSize, opacity, points });
                }
                planes.push({
                    name: planeName,
                    planeType: PLANE_TYPES[planeTypeIdx] ?? "XZ",
                    position,
                    quaternion,
                    strokes
                });
            }
            savedObjects.push({ id: makeId("object"), name, planes });
        }
    }

    return {
        layers, savedObjects, activeLayerId, activePlaneId, planeType, transformMode,
        guideChanged, guidePosition, guideQuaternion,
        brush: { color: brushColor, size: brushSize, opacity: brushOpacity },
        darkMode, gridVisible,
    };
}
