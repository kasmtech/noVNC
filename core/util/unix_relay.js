/*
 * Helpers for the server's reply to a unix relay subscribe request.
 */

/**
 * Maps a subscribe reply to the policy for that relay:
 *   true  = subscribed
 *   false = the relay cannot be used in this session: it is not registered ("No such
 *           unix channel") or this viewer lacks write permission ("No permissions"),
 *           so passthrough cannot work for this client either way
 *   null  = the server failed for another reason, so the policy is unknown
 */
export function classifySubscribeReply(success, message) {
    if (success) {
        return true;
    }
    if (message === "No such unix channel" || message === "No permissions") {
        return false;
    }
    return null;
}
