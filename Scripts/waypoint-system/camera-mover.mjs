import {
    AppBase,
    Entity,
    Quat,
    Script,
    Vec3
} from 'playcanvas';
import {
    addTweenExtensions,
    Linear,
    SineInOut,
    QuadraticInOut,
    CubicInOut,
    QuarticInOut,
    QuinticInOut
} from '../tween.mjs';

class CameraMover extends Script {
    static scriptName = 'cameraMover';
    static attributes = {
        targetEntity: {
            type: 'entity',
            title: 'Target Entity'
        },
        movementMode: {
            type: 'string',
            title: 'Movement Mode',
            default: 'curve'
        },
        durationPerUnit: {
            type: 'number',
            title: 'Duration Per Unit',
            default: 0.1
        },
        minDuration: {
            type: 'number',
            title: 'Min Duration',
            default: 0.1
        },
        easing: {
            type: 'string',
            title: 'Easing',
            default: 'SineInOut'
        },
        autoStart: {
            type: 'boolean',
            title: 'Auto Start',
            default: true
        },
        loop: {
            type: 'boolean',
            title: 'Loop',
            default: false
        },
        useRotations: {
            type: 'boolean',
            title: 'Use Rotations',
            default: true
        }
    };

    targetEntity = null;
    movementMode = 'curve';
    durationPerUnit = 0.1;
    minDuration = 0.1;
    easing = 'SineInOut';
    autoStart = true;
    loop = false;
    useRotations = true;

    _tweens = [];
    _running = false;
    _lastPath = null;
    _boundOnPath = null;
    _boundOnWaypoints = null;

    initialize() {
        const appProto = /** @type {any} */ (AppBase.prototype);
        const entityProto = /** @type {any} */ (Entity.prototype);
        if (!appProto.tween || !entityProto.tween) {
            addTweenExtensions({ AppBase, Entity });
        }

        this._boundOnPath = (path) => {
            this._lastPath = path;
            if (this.autoStart) {
                this.start(path);
            }
        };
        this._boundOnWaypoints = (data) => {
            if (this._lastPath || this.movementMode !== 'linear') return;
            if (this.autoStart) {
                this.startFromWaypoints(data);
            }
        };
        this.app.on('path:ready', this._boundOnPath);
        this.app.on('waypoints:loaded', this._boundOnWaypoints);
    }

    destroy() {
        if (this._boundOnPath) {
            this.app.off('path:ready', this._boundOnPath);
        }
        if (this._boundOnWaypoints) {
            this.app.off('waypoints:loaded', this._boundOnWaypoints);
        }
    }

    start(path) {
        if (!path?.segments?.length) return;

        this.stop(false);
        this._running = true;

        const target = this.targetEntity || this.entity;
        const easingFn = this._getEasing();
        let currentRot = target.getLocalRotation().clone();

        for (let s = 0; s < path.segments.length; s++) {
            const segment = path.segments[s];
            const samples = segment.samples;
            if (!samples || samples.length < 2) continue;

            const distance = segment.distance || this._chainLength(samples);
            const duration = Math.max(distance * this.durationPerUnit, this.minDuration);
            const endIndex = segment.endIndex ?? (segment.startIndex + samples.length - 1);
            const targetRot = this._resolveRotation(path, endIndex, currentRot);

            const tween = this._createCurveTween(target, samples, currentRot, targetRot, duration, easingFn);
            const waypointIndex = endIndex;
            tween.onComplete(() => {
                const endPos = samples[samples.length - 1].clone();
                const rot = targetRot.clone();
                this.app.fire('camera:waypoint', {
                    index: waypointIndex,
                    position: endPos,
                    rotation: rot
                });
            });
            this._tweens.push(tween);
            currentRot = targetRot.clone();
        }

        if (!this._tweens.length) {
            this._finish();
            return;
        }

        for (let i = 1; i < this._tweens.length; i++) {
            this._tweens[i - 1].chain(this._tweens[i]);
        }

        const last = this._tweens[this._tweens.length - 1];
        last.onComplete(() => this._onSequenceComplete());
        this._tweens[0].start();
    }

    startFromWaypoints(data) {
        if (!data?.positions?.length) return;

        const positions = data.positions;
        const rotations = data.rotations || [];
        const easingFn = this._getEasing();
        const target = this.targetEntity || this.entity;

        this.stop(false);
        this._running = true;

        let currentRot = target.getLocalRotation().clone();

        for (let i = 1; i < positions.length; i++) {
            const fromPos = positions[i - 1];
            const toPos = positions[i];
            const distance = fromPos.distance(toPos);
            const duration = Math.max(distance * this.durationPerUnit, this.minDuration);
            const targetRot = this.useRotations && rotations[i]
                ? this._toQuat(rotations[i])
                : currentRot.clone();
            const tween = this._createLinearTween(target, fromPos, toPos, currentRot, targetRot, duration, easingFn);
            const waypointIndex = i;
            tween.onComplete(() => {
                this.app.fire('camera:waypoint', {
                    index: waypointIndex,
                    position: toPos.clone(),
                    rotation: targetRot.clone()
                });
            });
            this._tweens.push(tween);
            currentRot = targetRot.clone();
        }

        if (!this._tweens.length) {
            this._finish();
            return;
        }

        for (let i = 1; i < this._tweens.length; i++) {
            this._tweens[i - 1].chain(this._tweens[i]);
        }

        const last = this._tweens[this._tweens.length - 1];
        last.onComplete(() => this._onSequenceComplete());
        this._tweens[0].start();
    }

    stop(restore = true) {
        for (let i = 0; i < this._tweens.length; i++) {
            this._tweens[i].stop();
        }
        this._tweens.length = 0;
        this._running = false;

        if (restore) {
            this.app.fire('camera:mover:stopped');
        }
    }

    _onSequenceComplete() {
        if (this.loop && this._lastPath) {
            this.start(this._lastPath);
            return;
        }
        this._finish();
    }

    _finish() {
        this._running = false;
        this.app.fire('camera:path:complete');
    }

    _createLinearTween(target, fromPos, toPos, fromRot, toRot, duration, easingFn) {
        const state = { t: 0 };
        const pos = new Vec3();
        const rot = new Quat();
        const app = /** @type {any} */ (this.app);

        const tween = app.tween(state).to({ t: 1 }, duration, easingFn);
        tween.onUpdate(() => {
            pos.lerp(fromPos, toPos, state.t);
            rot.slerp(fromRot, toRot, state.t);
            target.setLocalPosition(pos);
            target.setLocalRotation(rot);
        });

        return tween;
    }

    _createCurveTween(target, samples, fromRot, toRot, duration, easingFn) {
        const state = { t: 0 };
        const pos = new Vec3();
        const rot = new Quat();
        const app = /** @type {any} */ (this.app);

        const totalSegments = Math.max(1, samples.length - 1);
        const tween = app.tween(state).to({ t: 1 }, duration, easingFn);
        tween.onUpdate(() => {
            const scaled = Math.min(state.t, 1) * totalSegments;
            const index = Math.floor(scaled);
            const blend = scaled - index;
            const from = samples[index];
            const to = samples[Math.min(index + 1, totalSegments)];
            pos.lerp(from, to, blend);
            rot.slerp(fromRot, toRot, state.t);
            target.setLocalPosition(pos);
            target.setLocalRotation(rot);
        });

        return tween;
    }

    _resolveRotation(path, endIndex, fallbackRot) {
        if (!this.useRotations) return fallbackRot.clone();
        const rot = path.rotations?.[endIndex];
        if (!rot) return fallbackRot.clone();
        return this._toQuat(rot);
    }

    _toQuat(value) {
        if (value instanceof Quat) {
            return value.clone();
        }
        if (value && value.x !== undefined && value.y !== undefined && value.z !== undefined) {
            const quat = new Quat();
            quat.setFromEulerAngles(value.x, value.y, value.z);
            return quat;
        }
        return new Quat();
    }

    _chainLength(points) {
        let distance = 0;
        for (let i = 1; i < points.length; i++) {
            distance += points[i].distance(points[i - 1]);
        }
        return distance;
    }

    _getEasing() {
        const easingMap = {
            Linear,
            SineInOut,
            QuadraticInOut,
            CubicInOut,
            QuarticInOut,
            QuinticInOut
        };
        return easingMap[this.easing] || SineInOut;
    }
}

export { CameraMover };
