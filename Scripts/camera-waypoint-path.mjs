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
} from './tween.mjs';

/** @typedef {import('playcanvas').Asset} asset */
/** @typedef {import('playcanvas').Entity} entity */

const EPSILON = 1e-6;

class CameraWaypointPath extends Script {
    static scriptName = 'cameraWaypointPath';
    static attributes = {
        waypointDataAsset: {
            type: 'asset',
            title: 'Waypoint Data Asset (CSV/Text)',
            default: null
        },
        waypointDataUrl: {
            type: 'string',
            title: 'Waypoint Data URL',
            default: ''
        }
    };

    /**
     * @type {Vec3[]}
     * @private
     */
    waypointPositions = [];

    /**
     * @type {Vec3[]}
     * @private
     */
    waypointRotations = [];

    /**
     * @type {number[]}
     * @private
     */
    waypointPauses = [];

    /**
     * Waypoint data asset (JSON or CSV).
     *
     * @attribute
     * @title Waypoint Data Asset (CSV/Text)
     * @type {asset}
     * @resource text
     */
    waypointDataAsset = null;

    /**
     * Waypoint data format.
     *
     * @attribute
     * @title Waypoint Data Format
     * @type {string}
     * @default auto
     */
    waypointDataFormat = 'auto';

    /**
     * Waypoint data URL (CSV or JSON). If set, this is loaded instead of the asset.
     *
     * @attribute
     * @title Waypoint Data URL
     * @type {string}
     * @default
     */
    waypointDataUrl = '';

    /**
     * CSV delimiter.
     *
     * @attribute
     * @title CSV Delimiter
     * @type {string}
     * @default ,
     */
    csvDelimiter = ',';

    /**
    * Duration per unit distance.
    *
    * @attribute
    * @title Duration Per Unit
    * @type {number}
    * @default 0.1
     */
    durationPerUnit = 0.1;

    /**
    * Minimum tween duration.
    *
    * @attribute
    * @title Min Duration
    * @type {number}
    * @default 0.1
     */
    minDuration = 0.1;

    /**
    * Easing name.
    *
    * @attribute
    * @title Easing
    * @type {string}
    * @default SineInOut
     */
    easing = 'SineInOut';

    /**
    * Auto start on initialize.
    *
    * @attribute
    * @title Auto Start
    * @type {boolean}
    * @default false
     */
    autoStart = false;

    /**
    * Loop path.
    *
    * @attribute
    * @title Loop
    * @type {boolean}
    * @default false
     */
    loop = false;

    /**
    * Entity containing input scripts to disable.
    *
    * @attribute
    * @title Input Entity
    * @type {entity}
     */
    // @ts-ignore
    inputEntity;

    /**
    * Script names to disable while tween runs.
    *
    * @attribute
    * @title Input Script Names
    * @type {string[]}
    * @default []
     */
    inputScriptNames = [];

    /**
     * @type {any[]}
     * @private
     */
    _tweens = [];

    /**
     * @type {boolean}
     * @private
     */
    _running = false;

    /**
     * @type {any[]}
     * @private
     */
    _disabledScripts = [];

    initialize() {
        const appProto = /** @type {any} */ (AppBase.prototype);
        const entityProto = /** @type {any} */ (Entity.prototype);
        if (!appProto.tween || !entityProto.tween) {
            addTweenExtensions({ AppBase, Entity });
        }

        this._tweens = [];
        this._running = false;
        this._disabledScripts = [];

        this._pendingAutoStart = false;
        this._initWaypointDataUrl();
        if (!this.waypointDataUrl) {
            this._initWaypointDataAsset();
        }

        if (this.autoStart) {
            if (this.waypointDataUrl || this.waypointDataAsset) {
                this._pendingAutoStart = true;
            } else {
                this.startPath();
            }
        }
    }

    /* eslint-disable-next-line no-undefined */
    _EPSILON = 1e-6;

    startPath() {
        if (!this.waypointPositions || this.waypointPositions.length === 0) {
            return;
        }

        this.stopPath(false);
        this._running = true;
        this._setInputEnabled(false);

        const easingFn = this._getEasing();
        let currentPos = this.entity.getLocalPosition().clone();
        let currentRot = this.entity.getLocalRotation().clone();

        const segments = this._buildSegments();
        for (let s = 0; s < segments.length; s++) {
            const segment = segments[s];
            const pathPoints = this._collectSegmentPoints(segment.start, segment.end, currentPos);
            if (pathPoints.length < 2) {
                currentPos = this._toVec3(this.waypointPositions[segment.end], currentPos);
                currentRot = this._toQuat(this.waypointRotations[segment.end], currentRot);
                continue;
            }

            const totalDistance = this._chainLength(pathPoints);
            const duration = Math.max(totalDistance * this.durationPerUnit, this.minDuration);
            const curvePoints = this._sampleCurve(pathPoints, segment.prevPoint, segment.nextPoint, Math.max(24, Math.ceil(totalDistance * 6)));
            const targetRotQuat = this._toQuat(this.waypointRotations[segment.end], currentRot);

            const moveTween = this._createCurveTween(curvePoints, currentRot, targetRotQuat, duration, easingFn);
            const waypointNumber = segment.end + 1;
            moveTween.onComplete(() => {
                const endPos = curvePoints[curvePoints.length - 1];
                const eulerRot = new Vec3();
                targetRotQuat.getEulerAngles(eulerRot);
                console.log(`CameraWaypointPath: waypoint ${waypointNumber}/${this.waypointPositions.length} reached at ${endPos.x.toFixed(2)},${endPos.y.toFixed(2)},${endPos.z.toFixed(2)} rotation ${eulerRot.x.toFixed(1)},${eulerRot.y.toFixed(1)},${eulerRot.z.toFixed(1)}`);
            });
            this._tweens.push(moveTween);

            currentPos = curvePoints[curvePoints.length - 1].clone();
            currentRot = targetRotQuat.clone();
        }

        if (!this._tweens.length) {
            this._finishPath();
            return;
        }

        for (let t = 1; t < this._tweens.length; t++) {
            this._tweens[t - 1].chain(this._tweens[t]);
        }

        const last = this._tweens[this._tweens.length - 1];
        last.onComplete(() => this._onSequenceComplete());

        this._tweens[0].start();
    }

    stopPath(restoreInput = true) {
        for (let i = 0; i < this._tweens.length; i++) {
            this._tweens[i].stop();
        }
        this._tweens.length = 0;
        this._running = false;

        if (restoreInput) {
            this._setInputEnabled(true);
        }
    }

    _onSequenceComplete() {
        if (this.loop) {
            this.startPath();
            return;
        }

        this._finishPath();
    }

    _finishPath() {
        this._running = false;
        this._setInputEnabled(true);
    }

    _createSegmentTween(fromPos, fromRot, toPos, toRot, duration, easingFn) {
        const state = { t: 0 };
        const pos = new Vec3();
        const rot = new Quat();
        const app = /** @type {any} */ (this.app);

        const tween = app.tween(state).to({ t: 1 }, duration, easingFn);
        tween.onUpdate(() => {
            pos.lerp(fromPos, toPos, state.t);
            rot.slerp(fromRot, toRot, state.t);
            this.entity.setLocalPosition(pos);
            this.entity.setLocalRotation(rot);
        });

        return tween;
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

    _buildSegments() {
        const positions = this.waypointPositions;
        if (!positions.length) return [];
        const pauses = this.waypointPauses || [];
        const length = positions.length;
        const stops = new Set();
        stops.add(0);
        stops.add(length - 1);
        for (let i = 0; i < length; i++) {
            if ((pauses[i] ?? 0) > 0) {
                stops.add(i);
            }
        }
        const indices = Array.from(stops).sort((a, b) => a - b);
        const segments = [];
        for (let i = 0; i < indices.length - 1; i++) {
            const start = indices[i];
            const end = indices[i + 1];
            if (end <= start) continue;
            const prevIndex = start > 0 ? start - 1 : null;
            const nextIndex = end + 1 < length ? end + 1 : null;
            const prevPoint = prevIndex !== null ? this._toVec3(positions[prevIndex], new Vec3()) : null;
            const nextPoint = nextIndex !== null ? this._toVec3(positions[nextIndex], new Vec3()) : null;
            segments.push({ start, end, prevPoint, nextPoint });
        }
        return segments;
    }

    _collectSegmentPoints(start, end, currentPos) {
        const points = [currentPos.clone()];
        for (let idx = start; idx <= end; idx++) {
            points.push(this._toVec3(this.waypointPositions[idx], currentPos));
        }
        return points;
    }

    _chainLength(points) {
        let distance = 0;
        for (let i = 1; i < points.length; i++) {
            distance += points[i].distance(points[i - 1]);
        }
        return distance;
    }

    _sampleCurve(points, prevPoint, nextPoint, sampleCount = 32) {
        if (points.length < 2) return points.map((p) => p.clone());
        const segmentLengths = [];
        for (let i = 1; i < points.length; i++) {
            segmentLengths.push(points[i].distance(points[i - 1]));
        }
        const totalLength = this._chainLength(points) || 1;
        const extended = [];
        const startExtra = prevPoint ?? this._extrapolate(points[0], points[1] || points[0], -2);
        const endExtra = nextPoint ?? this._extrapolate(points[points.length - 1], points[points.length - 2] || points[points.length - 1], 2);
        extended.push(startExtra);
        points.forEach((point) => extended.push(point.clone()));
        extended.push(endExtra);

        const alpha = 0.7;
        const samples = [];
        const segments = points.length - 1;
        for (let i = 0; i < segments; i++) {
            const p0 = extended[i];
            const p1 = extended[i + 1];
            const p2 = extended[i + 2];
            const p3 = extended[i + 3];
            const ratio = segmentLengths[i] / totalLength;
            const steps = Math.max(4, Math.round(sampleCount * ratio));
            for (let j = 0; j < steps; j++) {
                const t = j / steps;
                samples.push(this._catmullRom(p0, p1, p2, p3, t, alpha));
            }
        }
        samples.push(points[points.length - 1].clone());
        return samples;
    }

    _catmullRom(p0, p1, p2, p3, t, alpha) {
        const t0 = 0;
        const t1 = this._getT(t0, p0, p1, alpha);
        const t2 = this._getT(t1, p1, p2, alpha);
        const t3 = this._getT(t2, p2, p3, alpha);

        const tt = t1 + (t2 - t1) * t;

        const A1 = this._lerpVec3(p0, p1, this._safeDivide(tt - t0, t1 - t0));
        const A2 = this._lerpVec3(p1, p2, this._safeDivide(tt - t1, t2 - t1));
        const A3 = this._lerpVec3(p2, p3, this._safeDivide(tt - t2, t3 - t2));

        const B1 = this._lerpVec3(A1, A2, this._safeDivide(tt - t0, t2 - t0));
        const B2 = this._lerpVec3(A2, A3, this._safeDivide(tt - t1, t3 - t1));

        return this._lerpVec3(B1, B2, this._safeDivide(tt - t1, t2 - t1));
    }

    _getT(ti, p, q, alpha) {
        const distance = p.distance(q);
        return ti + Math.pow(Math.max(distance, 1e-4), alpha);
    }

    _lerpVec3(a, b, t) {
        const v = new Vec3();
        const alpha = Math.min(Math.max(t, 0), 1);
        v.lerp(a, b, alpha);
        return v;
    }

    _safeDivide(numerator, divisor) {
        if (Math.abs(divisor) < 1e-6) {
            return 0;
        }
        return numerator / divisor;
    }

    _extrapolate(point, reference, lengthFactor) {
        const dir = point.clone().sub(reference);
        if (dir.lengthSq() < EPSILON) {
            dir.set(0, 0, 1);
        }
        dir.normalize().mulScalar(lengthFactor);
        return point.clone().add(dir);
    }

    _createCurveTween(curvePoints, fromRot, toRot, duration, easingFn) {
        const state = { t: 0 };
        const pos = new Vec3();
        const rot = new Quat();
        const app = /** @type {any} */ (this.app);
        if (curvePoints.length === 0) {
            const tween = app.tween(state).to({ t: 1 }, duration, easingFn);
            tween.onUpdate(() => {
                this.entity.setLocalRotation(toRot);
            });
            return tween;
        }
        const totalSegments = curvePoints.length - 1;
        const tween = app.tween(state).to({ t: 1 }, duration, easingFn);
        tween.onUpdate(() => {
            const scaled = Math.min(state.t, 1) * totalSegments;
            const index = Math.floor(scaled);
            const blend = scaled - index;
            const from = curvePoints[index];
            const to = curvePoints[Math.min(index + 1, totalSegments)];
            pos.lerp(from, to, blend);
            rot.slerp(fromRot, toRot, state.t);
            this.entity.setLocalPosition(pos);
            this.entity.setLocalRotation(rot);
        });

        return tween;
    }

    _toVec3(value, fallback) {
        if (value instanceof Vec3) {
            return value.clone();
        }
        if (value && value.x !== undefined && value.y !== undefined && value.z !== undefined) {
            return new Vec3(value.x, value.y, value.z);
        }
        return fallback.clone();
    }

    _toQuat(value, fallbackQuat) {
        const quat = new Quat();

        if (value instanceof Quat) {
            return value.clone();
        }

        if (value && value.x !== undefined && value.y !== undefined && value.z !== undefined) {
            quat.setFromEulerAngles(value.x, value.y, value.z);
            return quat;
        }

        return fallbackQuat.clone();
    }

    _setInputEnabled(enabled) {
        const target = this.inputEntity || this.entity;
        if (!target || !target.script) return;

        if (enabled) {
            for (let i = 0; i < this._disabledScripts.length; i++) {
                this._disabledScripts[i].enabled = true;
            }
            this._disabledScripts.length = 0;
            return;
        }

        for (let s = 0; s < this.inputScriptNames.length; s++) {
            const scriptName = this.inputScriptNames[s];
            const instance = target.script[scriptName];
            if (instance && instance.enabled) {
                instance.enabled = false;
                this._disabledScripts.push(instance);
            }
        }
    }

    _initWaypointDataAsset() {
        if (!this.waypointDataAsset || !this.app.assets) return;

        const asset = /** @type {any} */ (this.waypointDataAsset);
        const onReady = () => {
            const data = asset.resource ?? asset.data ?? asset.file?.contents;
            this._applyWaypointData(data, asset);
        };

        if (asset.resource) {
            onReady();
            return;
        }

        asset.once('load', onReady);
        this.app.assets.load(asset);
    }

    _initWaypointDataUrl() {
        if (!this.waypointDataUrl) return;

        const url = this.waypointDataUrl;
        fetch(url)
        .then((res) => {
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            return res.text();
        })
        .then((text) => this._applyWaypointData(text, null, url))
        .catch((err) => {
            console.warn('CameraWaypointPath: failed to load waypoint URL', url, err);
        });
    }

    _applyWaypointData(data, asset, sourceUrl = '') {
        if (data == null) return;

        let format = this.waypointDataFormat;
        if (format === 'auto') {
            const url = (sourceUrl || asset?.file?.url || '').toLowerCase();
            if (url.endsWith('.csv') || url.endsWith('.txt')) format = 'csv';
            else if (url.endsWith('.json')) format = 'json';
            else if (typeof data === 'string') format = 'csv';
            else if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) format = 'csv';
            else format = 'json';
        }

        try {
            if (format === 'csv') {
                const text = this._toText(data);
                this._parseCsv(text);
            } else {
                const raw = typeof data === 'string' ? data : this._toText(data);
                const json = typeof raw === 'string' ? JSON.parse(raw) : raw;
                this._parseJson(json);
            }
        } catch (err) {
            console.warn('CameraWaypointPath: failed to parse waypoint data', err);
        }

        if (!this.waypointPositions.length) {
            console.warn('CameraWaypointPath: no waypoints parsed from data source');
        }

        if (this._pendingAutoStart) {
            this._pendingAutoStart = false;
            this.startPath();
        }
    }

    _parseJson(json) {
        if (!Array.isArray(json)) return;

        const positions = [];
        const rotations = [];
        const pauses = [];

        for (let i = 0; i < json.length; i++) {
            const row = json[i];
            if (!row) continue;

            const pos = row.position || row.pos || row.p || row[0];
            const rot = row.rotation || row.rot || row.r || row[1];
            const wait = row.pause ?? row.wait ?? row.delay ?? row[2] ?? 0;

            if (pos) positions.push(this._toVec3(pos, new Vec3()));
            if (rot) rotations.push(this._toVec3(rot, new Vec3()));
            pauses.push(Number(wait) || 0);
        }

        this.waypointPositions = positions;
        this.waypointRotations = rotations;
        this.waypointPauses = pauses;
    }

    _parseCsv(text) {
        const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        if (!lines.length) return;

        const positions = [];
        const rotations = [];
        const pauses = [];

        for (let i = 0; i < lines.length; i++) {
            const cols = lines[i].split(this.csvDelimiter).map((c) => c.trim());
            if (cols.length < 6) continue;

            const nums = cols.map((c) => Number(c));
            if (nums.some((n) => Number.isNaN(n))) continue;

            positions.push(new Vec3(nums[0], nums[1], nums[2]));
            rotations.push(new Vec3(nums[3], nums[4], nums[5]));
            pauses.push(Number(cols[6]) || 0);
        }

        this.waypointPositions = positions;
        this.waypointRotations = rotations;
        this.waypointPauses = pauses;
    }

    _toText(data) {
        if (typeof data === 'string') return data;
        if (data instanceof ArrayBuffer) {
            return new TextDecoder('utf-8').decode(new Uint8Array(data));
        }
        if (ArrayBuffer.isView(data)) {
            return new TextDecoder('utf-8').decode(data);
        }
        return String(data);
    }
}

export { CameraWaypointPath };
