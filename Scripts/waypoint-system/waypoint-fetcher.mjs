import {
    Script,
    Vec3
} from 'playcanvas';

class WaypointFetcher extends Script {
    static scriptName = 'waypointFetcher';
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
        },
        waypointDataFormat: {
            type: 'string',
            title: 'Waypoint Data Format',
            default: 'auto'
        },
        csvDelimiter: {
            type: 'string',
            title: 'CSV Delimiter',
            default: ','
        },
        autoLoad: {
            type: 'boolean',
            title: 'Auto Load',
            default: true
        }
    };

    waypointDataAsset = null;
    waypointDataUrl = '';
    waypointDataFormat = 'auto';
    csvDelimiter = ',';
    autoLoad = true;

    _data = null;

    initialize() {
        if (this.autoLoad) {
            this.load();
        }
    }

    load() {
        if (this.waypointDataUrl) {
            this._loadFromUrl(this.waypointDataUrl);
            return;
        }
        if (this.waypointDataAsset) {
            this._loadFromAsset(this.waypointDataAsset);
        }
    }

    getData() {
        return this._data;
    }

    _loadFromAsset(asset) {
        if (!this.app.assets || !asset) return;
        const resolved = /** @type {any} */ (asset);
        const onReady = () => {
            const data = resolved.resource ?? resolved.data ?? resolved.file?.contents;
            this._applyWaypointData(data, resolved, 'asset');
        };
        if (resolved.resource) {
            onReady();
            return;
        }
        resolved.once('load', onReady);
        this.app.assets.load(resolved);
    }

    _loadFromUrl(url) {
        fetch(url)
        .then((res) => {
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            return res.text();
        })
        .then((text) => this._applyWaypointData(text, null, url))
        .catch((err) => {
            console.warn('WaypointFetcher: failed to load waypoint URL', url, err);
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

        let payload = null;
        try {
            if (format === 'csv') {
                const text = this._toText(data);
                payload = this._parseCsv(text);
            } else {
                const raw = typeof data === 'string' ? data : this._toText(data);
                const json = typeof raw === 'string' ? JSON.parse(raw) : raw;
                payload = this._parseJson(json);
            }
        } catch (err) {
            console.warn('WaypointFetcher: failed to parse waypoint data', err);
            return;
        }

        if (!payload?.positions?.length) {
            console.warn('WaypointFetcher: no waypoints parsed from data source');
            return;
        }

        this._data = payload;
        this.app.fire('waypoints:loaded', payload);
    }

    _parseJson(json) {
        if (!Array.isArray(json)) return null;

        const positions = [];
        const rotations = [];
        const pauses = [];

        for (let i = 0; i < json.length; i++) {
            const row = json[i];
            if (!row) continue;

            const pos = row.position || row.pos || row.p || row[0];
            const rot = row.rotation || row.rot || row.r || row[1];
            const wait = row.pause ?? row.wait ?? row.delay ?? row[2] ?? 0;

            if (pos) positions.push(this._toVec3(pos));
            if (rot) rotations.push(this._toVec3(rot));
            pauses.push(Number(wait) || 0);
        }

        return {
            positions,
            rotations,
            pauses,
            source: 'json'
        };
    }

    _parseCsv(text) {
        const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        if (!lines.length) return null;

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

        return {
            positions,
            rotations,
            pauses,
            source: 'csv'
        };
    }

    _toVec3(value) {
        if (value instanceof Vec3) {
            return value.clone();
        }
        if (value && value.x !== undefined && value.y !== undefined && value.z !== undefined) {
            return new Vec3(value.x, value.y, value.z);
        }
        const arr = Array.isArray(value) ? value : [0, 0, 0];
        return new Vec3(Number(arr[0]) || 0, Number(arr[1]) || 0, Number(arr[2]) || 0);
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

export { WaypointFetcher };
