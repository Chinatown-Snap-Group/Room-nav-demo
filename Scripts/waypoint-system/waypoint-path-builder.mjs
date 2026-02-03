import {
    Script,
    Vec3
} from 'playcanvas';

const EPSILON = 1e-6;

class WaypointPathBuilder extends Script {
    static scriptName = 'waypointPathBuilder';
    static attributes = {
        autoBuild: {
            type: 'boolean',
            title: 'Auto Build',
            default: true
        },
        sampleDensity: {
            type: 'number',
            title: 'Samples Per Unit',
            default: 6
        },
        minSamples: {
            type: 'number',
            title: 'Min Samples',
            default: 24
        },
        catmullAlpha: {
            type: 'number',
            title: 'Catmull Alpha',
            default: 0.7
        }
    };

    autoBuild = true;
    sampleDensity = 6;
    minSamples = 24;
    catmullAlpha = 0.7;

    _boundOnWaypoints = null;

    initialize() {
        this._boundOnWaypoints = (data) => {
            if (this.autoBuild) {
                this.buildPath(data);
            }
        };
        this.app.on('waypoints:loaded', this._boundOnWaypoints);
    }

    destroy() {
        if (this._boundOnWaypoints) {
            this.app.off('waypoints:loaded', this._boundOnWaypoints);
        }
    }

    buildPath(data) {
        if (!data?.positions?.length) return null;

        const positions = data.positions;
        const rotations = data.rotations || [];
        const pauses = data.pauses || [];

        const segments = this._buildSegments(positions, pauses);
        const built = [];

        for (let i = 0; i < segments.length; i++) {
            const segment = segments[i];
            const points = [];
            for (let idx = segment.start; idx <= segment.end; idx++) {
                points.push(positions[idx].clone());
            }
            if (points.length < 2) {
                continue;
            }
            const distance = this._chainLength(points);
            const sampleCount = Math.max(this.minSamples, Math.ceil(distance * this.sampleDensity));
            const samples = this._sampleCurve(points, segment.prevPoint, segment.nextPoint, sampleCount, this.catmullAlpha);
            built.push({
                startIndex: segment.start,
                endIndex: segment.end,
                samples,
                distance
            });
        }

        const payload = {
            segments: built,
            positions,
            rotations,
            pauses
        };

        this.app.fire('path:ready', payload);
        return payload;
    }

    _buildSegments(positions, pauses) {
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
            const prevPoint = prevIndex !== null ? positions[prevIndex].clone() : null;
            const nextPoint = nextIndex !== null ? positions[nextIndex].clone() : null;
            segments.push({ start, end, prevPoint, nextPoint });
        }
        return segments;
    }

    _chainLength(points) {
        let distance = 0;
        for (let i = 1; i < points.length; i++) {
            distance += points[i].distance(points[i - 1]);
        }
        return distance;
    }

    _sampleCurve(points, prevPoint, nextPoint, sampleCount, alpha) {
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
        if (Math.abs(divisor) < EPSILON) {
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
}

export { WaypointPathBuilder };
