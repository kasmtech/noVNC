export const RFB_CHANNEL_EVENTS = {
    REGISTER: 'register',
    REATTACH: 'reattach',
    UNREGISTER: 'unregister',
    MOUSEMOVE: 'mousemove',
    MOUSEDOWN: 'mousedown',
    MOUSEUP: 'mouseup',
    SCROLL: 'scroll',
    KEY_EVENT: 'keyEvent',
    SEND_BINARY_CLIPBOARD: 'sendBinaryClipboard',
    UPDATE_CURSOR: 'updateCursor',
    RECEIVED_CLIPBOARD: 'receivedClipboard',
    DISCONNECT: 'disconnect',
    TERMINATE: 'terminate',
    APPLY_SETTINGS: 'applySettings',
    APPLY_SCREEN_PLAN: 'applyScreenPlan',
    SCREEN_REGISTRATION_CONFIRMED: 'screenRegistrationConfirmed'
};

export const ACTIVE_STATE_EVENTS = new Set([
    RFB_CHANNEL_EVENTS.MOUSEMOVE,
    RFB_CHANNEL_EVENTS.MOUSEDOWN,
    RFB_CHANNEL_EVENTS.MOUSEUP,
    RFB_CHANNEL_EVENTS.SCROLL,
    RFB_CHANNEL_EVENTS.KEY_EVENT,
]);