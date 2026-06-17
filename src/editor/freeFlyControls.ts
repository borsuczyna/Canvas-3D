import * as THREE from "three";

export class FreeFlyControls {
    enabled = true;
    baseSpeed = 18;
    fastMultiplier = 4;
    lookSensitivity = 0.003;
    panSensitivity = 0.015;

    private keys = new Set<string>();
    private pointerMode: "look" | "pan" | null = null;
    private lastPointer = new THREE.Vector2();
    private yaw = 0;
    private pitch = -0.35;
    private moveStickValue = new THREE.Vector2();
    private lookStickValue = new THREE.Vector2();
    private pinchDistance = 0;

    constructor(
        private camera: THREE.PerspectiveCamera,
        private domElement: HTMLElement,
        moveStick?: HTMLElement | null,
        lookStick?: HTMLElement | null
    ) {
        this.camera.rotation.order = "YXZ";
        this.applyRotation();
        this.bindEvents(moveStick, lookStick);
    }

    private bindEvents(moveStick?: HTMLElement | null, lookStick?: HTMLElement | null) {
        window.addEventListener("keydown", (event) => this.keys.add(event.code));
        window.addEventListener("keyup", (event) => this.keys.delete(event.code));
        this.domElement.addEventListener("contextmenu", (event) => event.preventDefault());
        this.domElement.addEventListener(
            "wheel",
            (event) => {
                event.preventDefault();
                const direction = Math.sign(event.deltaY);
                this.baseSpeed = THREE.MathUtils.clamp(this.baseSpeed * (direction > 0 ? 0.86 : 1.16), 1, 5000);
            },
            { passive: false }
        );

        this.domElement.addEventListener("pointerdown", (event) => {
            if (!this.enabled) return;
            if (event.button === 2) {
                this.pointerMode = "look";
                this.lastPointer.set(event.clientX, event.clientY);
                this.domElement.setPointerCapture(event.pointerId);
            } else if (event.button === 1) {
                this.pointerMode = "pan";
                this.lastPointer.set(event.clientX, event.clientY);
                this.domElement.setPointerCapture(event.pointerId);
            }
        });

        this.domElement.addEventListener("pointermove", (event) => {
            if (!this.enabled || !this.pointerMode) return;
            const dx = event.clientX - this.lastPointer.x;
            const dy = event.clientY - this.lastPointer.y;
            this.lastPointer.set(event.clientX, event.clientY);
            if (this.pointerMode === "look") {
                this.yaw -= dx * this.lookSensitivity;
                this.pitch -= dy * this.lookSensitivity;
                this.pitch = THREE.MathUtils.clamp(this.pitch, -Math.PI / 2 + 0.02, Math.PI / 2 - 0.02);
                this.applyRotation();
            } else {
                this.pan(dx, dy);
            }
        });

        window.addEventListener("pointerup", (event) => {
            if (this.pointerMode) {
                try {
                    this.domElement.releasePointerCapture(event.pointerId);
                } catch {
                    // Some browsers release capture automatically.
                }
            }
            this.pointerMode = null;
        });

        this.setupJoystick(moveStick, this.moveStickValue);
        this.setupJoystick(lookStick, this.lookStickValue);
        this.setupPinch();
    }

    private setupJoystick(element: HTMLElement | null | undefined, target: THREE.Vector2) {
        if (!element) return;
        const knob = element.querySelector("span") as HTMLElement | null;
        const active: { pointerId: number | null } = { pointerId: null };
        const update = (event: PointerEvent) => {
            const rect = element.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            const max = rect.width * 0.34;
            const dx = THREE.MathUtils.clamp(event.clientX - centerX, -max, max);
            const dy = THREE.MathUtils.clamp(event.clientY - centerY, -max, max);
            target.set(dx / max, -dy / max);
            if (knob) knob.style.transform = `translate(${dx}px, ${dy}px)`;
        };
        element.addEventListener("pointerdown", (event) => {
            active.pointerId = event.pointerId;
            element.setPointerCapture(event.pointerId);
            update(event);
        });
        element.addEventListener("pointermove", (event) => {
            if (active.pointerId === event.pointerId) update(event);
        });
        const reset = (event: PointerEvent) => {
            if (active.pointerId !== event.pointerId) return;
            active.pointerId = null;
            target.set(0, 0);
            if (knob) knob.style.transform = "translate(0, 0)";
        };
        element.addEventListener("pointerup", reset);
        element.addEventListener("pointercancel", reset);
    }

    private setupPinch() {
        const touches = new Map<number, THREE.Vector2>();
        this.domElement.addEventListener("pointerdown", (event) => {
            if (event.pointerType === "touch") touches.set(event.pointerId, new THREE.Vector2(event.clientX, event.clientY));
        });
        this.domElement.addEventListener("pointermove", (event) => {
            if (event.pointerType !== "touch" || !touches.has(event.pointerId)) return;
            touches.set(event.pointerId, new THREE.Vector2(event.clientX, event.clientY));
            if (touches.size !== 2) return;
            const [a, b] = [...touches.values()];
            const distance = a.distanceTo(b);
            if (this.pinchDistance > 0) {
                this.baseSpeed = THREE.MathUtils.clamp(this.baseSpeed * (distance / this.pinchDistance), 1, 5000);
            }
            this.pinchDistance = distance;
        });
        const clear = (event: PointerEvent) => {
            touches.delete(event.pointerId);
            if (touches.size < 2) this.pinchDistance = 0;
        };
        this.domElement.addEventListener("pointerup", clear);
        this.domElement.addEventListener("pointercancel", clear);
    }

    private applyRotation() {
        this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, "YXZ"));
    }

    private pan(dx: number, dy: number) {
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
        const scalar = this.baseSpeed * this.panSensitivity;
        this.camera.position.addScaledVector(right, -dx * scalar);
        this.camera.position.addScaledVector(up, dy * scalar);
    }

    update(deltaSeconds: number) {
        if (!this.enabled) return;
        this.yaw -= this.lookStickValue.x * deltaSeconds * 2.2;
        this.pitch += this.lookStickValue.y * deltaSeconds * 1.7;
        this.pitch = THREE.MathUtils.clamp(this.pitch, -Math.PI / 2 + 0.02, Math.PI / 2 - 0.02);
        this.applyRotation();

        const move = new THREE.Vector3();
        if (this.keys.has("KeyW")) move.z -= 1;
        if (this.keys.has("KeyS")) move.z += 1;
        if (this.keys.has("KeyA")) move.x -= 1;
        if (this.keys.has("KeyD")) move.x += 1;
        if (this.keys.has("KeyQ")) move.y -= 1;
        if (this.keys.has("KeyE")) move.y += 1;
        move.x += this.moveStickValue.x;
        move.z -= this.moveStickValue.y;

        if (move.lengthSq() > 0) {
            move.normalize();
            const speed = this.baseSpeed * (this.keys.has("ShiftLeft") || this.keys.has("ShiftRight") ? this.fastMultiplier : 1);
            const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
            const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
            const up = new THREE.Vector3(0, 1, 0);
            this.camera.position
                .addScaledVector(right, move.x * speed * deltaSeconds)
                .addScaledVector(up, move.y * speed * deltaSeconds)
                .addScaledVector(forward, -move.z * speed * deltaSeconds);
        }
    }
}
