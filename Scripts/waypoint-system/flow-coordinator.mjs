import {
    Script
} from 'playcanvas';

class FlowCoordinator extends Script {
    static scriptName = 'flowCoordinator';
    static attributes = {
        uiEntity: {
            type: 'entity',
            title: 'UI Entity'
        },
        uiScriptName: {
            type: 'string',
            title: 'UI Script Name',
            default: ''
        },
        uiMethodName: {
            type: 'string',
            title: 'UI Method Name',
            default: 'showWaypoint'
        }
    };

    uiEntity = null;
    uiScriptName = '';
    uiMethodName = 'showWaypoint';

    _boundOnWaypoint = null;
    _boundOnComplete = null;

    initialize() {
        this._boundOnWaypoint = (data) => {
            this._showWaypoint(data);
        };
        this._boundOnComplete = () => {
            this.app.fire('flow:complete');
        };
        this.app.on('camera:waypoint', this._boundOnWaypoint);
        this.app.on('camera:path:complete', this._boundOnComplete);
    }

    destroy() {
        if (this._boundOnWaypoint) {
            this.app.off('camera:waypoint', this._boundOnWaypoint);
        }
        if (this._boundOnComplete) {
            this.app.off('camera:path:complete', this._boundOnComplete);
        }
    }

    _showWaypoint(data) {
        const target = this.uiEntity;
        const scriptName = this.uiScriptName;
        if (target && scriptName && target.script && target.script[scriptName]) {
            const instance = target.script[scriptName];
            const methodName = this.uiMethodName;
            if (typeof instance[methodName] === 'function') {
                instance[methodName](data);
                return;
            }
        }
        this.app.fire('ui:waypoint', data);
    }
}

export { FlowCoordinator };
