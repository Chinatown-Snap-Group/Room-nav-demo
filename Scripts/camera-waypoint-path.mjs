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

    startPath() {
        if (!this.waypointPositions || this.waypointPositions.length === 0) {
            return;
        }

        this.stopPath(false);
        this._running = true;
        this._setInputEnabled(false);

        let currentPos = this.entity.getLocalPosition().clone();
        let currentRot = this.entity.getLocalRotation().clone();
        const easingFn = this._getEasing();

        for (let i = 0; i < this.waypointPositions.length; i++) {
            const targetPos = this._toVec3(this.waypointPositions[i], currentPos);
            const targetRotQuat = this._toQuat(this.waypointRotations[i], currentRot);
            const distance = currentPos.distance(targetPos);
            const duration = Math.max(distance * this.durationPerUnit, this.minDuration);

            const moveTween = this._createSegmentTween(currentPos, currentRot, targetPos, targetRotQuat, duration, easingFn);
            const logPos = targetPos.clone();
            const logRotation = new Vec3();
            targetRotQuat.getEulerAngles(logRotation);
            const waypointNumber = i + 1;
            moveTween.onComplete(() => {
                console.log(`CameraWaypointPath: waypoint ${waypointNumber}/${this.waypointPositions.length} reached at ${logPos.x.toFixed(2)},${logPos.y.toFixed(2)},${logPos.z.toFixed(2)} rotation ${logRotation.x.toFixed(1)},${logRotation.y.toFixed(1)},${logRotation.z.toFixed(1)}`);
            });
            this._tweens.push(moveTween);

            const pause = this.waypointPauses[i] || 0;
            if (pause > 0) {
                const app = /** @type {any} */ (this.app);
                const waitTween = app.tween({ t: 0 }).to({ t: 0 }, 0).delay(pause);
                this._tweens.push(waitTween);
            }

            currentPos = targetPos.clone();
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
